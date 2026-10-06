-- set_availability (7 Oct 2026): one availability answer as one transaction,
-- with the store-or-delete decision made in the database.
--
-- worker/src/availability.ts used to do a read-modify-write across about six
-- sequential round trips: the player (getById), the Scheduled matches (to find
-- the seasons), every answer of those seasons read fresh (~177 KB on preview),
-- the standing rules, the reference data (~150 KB), then
-- apply_availability_changes. Two taps landing on different isolates could
-- interleave between the read and the write. This does the same in one call,
-- under a per-player lock, and keeps the model exactly (memory note
-- availability-model-limits; availabilityRules.ts):
--
--   - opt-out by default: no row means Available;
--   - Maybe or Unavailable is always stored (the existing row updated, or a
--     row created);
--   - Available is STORED only where it overrides a different default - the
--     coach's Opt-In Only, or one of the player's own standing rules - and
--     otherwise the player's row for that match is DELETED. As in
--     needsExplicitAvailable, only a Scheduled match can need it; for any
--     other match an Available answer deletes;
--   - the precedence is effectiveAvailability's: Opt-In Only above the
--     player's rules; the most specific rule first (Date range 4, Midweek 3,
--     Play-ups and Support games 2, All future 1); ties to the most recently
--     modified (to the millisecond, as airtable_ts shows it), then to api_id
--     (the order api_availability_rules is read in, kept by a stable sort);
--   - "play-up" and "support" are by team rank, as the write path has always
--     resolved them: the fixture's rank is the better of its Active HKFC
--     sides, the player's that of their Registered Team, and a blank or 0 rank
--     counts as 99 (getReferenceData's teamRankMap, toTeam);
--   - dates are Hong Kong calendar days (hkDateKey); Midweek is Monday to
--     Friday; a match with no date matches no Midweek rule, and a dated rule
--     only through an open start (hkDateKey's "" compared as a string);
--   - notes are written as given: an update without notes clears them, as
--     apply_availability_changes did;
--   - Updated By is p_updated_by (a coach answering for a player), else the
--     player.
--
-- The rules are checked against the same table of cases as the TypeScript
-- engine: tests/fixtures/availabilityRuleCases.json (tests/availabilityRuleCases.test.ts
-- runs the TypeScript side; scripts/availability-rule-checks.mjs writes the SQL
-- checks for this function).
--
-- What stays in TypeScript: the input checks and their 400 messages, the 404s
-- (from P0002 here), the audit log lines (this returns what it found and did)
-- and the in-isolate cache clearing (from the seasons returned).
--
-- Differences from the old path, on purpose: a match id given twice is
-- answered once (the old path failed on the unique index), and the Scheduled
-- check reads the match itself rather than a list cached for up to 30 s.
--
-- apply_availability_changes stays for now: the Worker that is live while this
-- is applied still calls it. A later migration can drop it.

-- The status a player's standing rules give one fixture, or null when none
-- applies (resolveRuleStatus). p_date null behaves as hkDateKey's "" did.
create function public.availability_rule_status(p_person uuid, p_date date, p_is_play_up boolean, p_is_support boolean)
returns text
language sql stable
set search_path = ''
as $$
  select r.availability
  from public.availability_rules r
  where r.person_id = p_person
    and r.active
    and coalesce(r.availability, '') <> ''
    and case r.rule_type
          when 'Play-ups' then coalesce(p_is_play_up, false)
          when 'Support games' then coalesce(p_is_support, false)
          when 'Midweek' then coalesce(extract(isodow from p_date) between 1 and 5, false)
          -- Both bounds inclusive, a missing bound open-ended; at least one set.
          -- "" < start is true and "" > end false, hence the null cases.
          when 'Date range' then (r.start_date is not null or r.end_date is not null)
                                 and (r.start_date is null or (p_date is not null and p_date >= r.start_date))
                                 and (r.end_date is null or p_date is null or p_date <= r.end_date)
          when 'All future' then r.start_date is null or (p_date is not null and p_date >= r.start_date)
          else false
        end
  order by case r.rule_type when 'Date range' then 4 when 'Midweek' then 3 when 'Play-ups' then 2
                            when 'Support games' then 2 when 'All future' then 1 else 0 end desc,
           date_trunc('milliseconds', r.updated_at) desc nulls last,
           r.api_id
  limit 1
$$;

-- One player's answer for some matches (match api ids). Returns
--   {"updated": n,
--    "results": [{"matchId", "exceptionId" | null}],   -- kept and deleted in input order, then created
--    "before":  [{"matchId", "exceptionId", "status"}], -- the rows found, for the audit log line
--    "seasons": [season, ...]}                          -- of the matches found, for cache clearing
-- Errors: 22023 for a bad status or blank match id; P0002 'Player not found or
-- inactive'; P0002 'No match <id>' when a stored answer names no match; P0002
-- 'No person <id>' for an unknown p_updated_by.
create function public.set_availability(
  p_player text,
  p_matches text[],
  p_status text,
  p_notes text default null,
  p_updated_by text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_person public.people;
  v_by uuid;
  v_player_rank integer;
  v_needed boolean;
  v_new text;
  v_kept jsonb := '[]';
  v_created jsonb := '[]';
  v_before jsonb := '[]';
  v_seasons text[] := '{}';
  r record;
begin
  if p_status is null or p_status not in ('Available', 'Maybe', 'Unavailable') then
    raise exception 'status must be Available, Maybe or Unavailable' using errcode = '22023';
  end if;
  if p_matches is null or exists (select 1 from unnest(p_matches) as x where coalesce(x, '') = '') then
    raise exception 'matchIds[] must be record ids' using errcode = '22023';
  end if;

  select * into v_person from public.people where api_id = p_player;
  if not found or not v_person.active then
    raise exception 'Player not found or inactive' using errcode = 'P0002';
  end if;
  v_by := case when coalesce(p_updated_by, '') = '' then v_person.id else public.person_uuid(p_updated_by) end;

  -- One answer at a time per player, taken before anything is read: two taps
  -- on different isolates no longer act on the same old state. The row for a
  -- match may not exist yet, so the lock is on the player, not on a row.
  perform pg_advisory_xact_lock(hashtextextended('set_availability:' || v_person.id::text, 0));

  v_player_rank := coalesce(
    (select min(coalesce(nullif(t.team_rank, 0), 99)) from public.teams t
     where t.active and t.team_name = v_person.registered_team),
    99);

  for r in
    select i.api, i.ord, mt.id as match_id,
           mt.match_status = 'Scheduled' as scheduled,
           (mt.match_date at time zone 'Asia/Hong_Kong')::date as hk_date,
           public.season_of(mt.match_date) as season,
           coalesce((select min(coalesce(nullif(t.team_rank, 0), 99)) from public.teams t
                     where t.active and t.team_name in (mt.home_team, mt.away_team)), 99) as fixture_rank,
           e.id as exc_id, e.api_id as exc_api, e.status as old_status
    from (select distinct on (x.api) x.api, x.ord
          from unnest(p_matches) with ordinality as x(api, ord)
          order by x.api, x.ord) i
    left join public.matches mt on mt.api_id = i.api
    left join public.availability_exceptions e on e.person_id = v_person.id and e.match_id = mt.id
    order by i.ord
  loop
    if r.season is not null and not (r.season = any (v_seasons)) then
      v_seasons := v_seasons || r.season;
    end if;
    if r.exc_id is not null then
      v_before := v_before || jsonb_build_object('matchId', r.api, 'exceptionId', r.exc_api, 'status', r.old_status);
    end if;

    -- Would this fixture read as anything but Available with no answer?
    v_needed := false;
    if p_status = 'Available' and r.match_id is not null and coalesce(r.scheduled, false) then
      v_needed := v_person.opt_in_only
        or coalesce(public.availability_rule_status(v_person.id, r.hk_date,
                                                    r.fixture_rank < v_player_rank,
                                                    r.fixture_rank > v_player_rank), 'Available') <> 'Available';
    end if;

    if p_status = 'Available' and not v_needed then
      -- Absence already says Available: keep the table sparse.
      if r.exc_id is not null then
        delete from public.availability_exceptions where id = r.exc_id;
      end if;
      v_kept := v_kept || jsonb_build_object('matchId', r.api, 'exceptionId', null);
    elsif r.match_id is null then
      raise exception 'No match %', r.api using errcode = 'P0002';
    elsif r.exc_id is not null then
      update public.availability_exceptions
         set status = p_status, player_notes = nullif(p_notes, ''), updated_by_id = v_by
       where id = r.exc_id;
      v_kept := v_kept || jsonb_build_object('matchId', r.api, 'exceptionId', r.exc_api);
    else
      -- The lock means no other set_availability wrote this row since the
      -- read above; on conflict covers any other writer.
      insert into public.availability_exceptions (match_id, person_id, status, player_notes, updated_by_id)
      values (r.match_id, v_person.id, p_status, nullif(p_notes, ''), v_by)
      on conflict (person_id, match_id) do update
        set status = excluded.status, player_notes = excluded.player_notes, updated_by_id = excluded.updated_by_id
      returning api_id into v_new;
      v_created := v_created || jsonb_build_object('matchId', r.api, 'exceptionId', v_new);
    end if;
  end loop;

  return jsonb_build_object(
    'updated', jsonb_array_length(v_kept) + jsonb_array_length(v_created),
    'results', v_kept || v_created,
    'before', v_before,
    'seasons', to_jsonb(v_seasons)
  );
end;
$$;

-- "I'm away this Saturday": every Scheduled match on that Hong Kong day with
-- an Active HKFC team on either side (setMyAvailabilityForDate), in api_id
-- order (the order getScheduledMatches read them in).
create function public.set_availability_for_date(
  p_player text,
  p_date date,
  p_status text,
  p_notes text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ids text[];
begin
  select coalesce(array_agg(m.api_id order by m.api_id), '{}') into v_ids
  from public.matches m
  where m.match_status = 'Scheduled'
    and (m.match_date at time zone 'Asia/Hong_Kong')::date = p_date
    and exists (select 1 from public.teams t where t.active and t.team_name in (m.home_team, m.away_team));
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('updated', 0, 'results', '[]'::jsonb, 'before', '[]'::jsonb, 'seasons', '[]'::jsonb);
  end if;
  return public.set_availability(p_player, v_ids, p_status, p_notes, null);
end;
$$;

revoke all on function public.availability_rule_status(uuid, date, boolean, boolean) from public, anon, authenticated;
grant execute on function public.availability_rule_status(uuid, date, boolean, boolean) to service_role;
revoke all on function public.set_availability(text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.set_availability(text, text[], text, text, text) to service_role;
revoke all on function public.set_availability_for_date(text, date, text, text) from public, anon, authenticated;
grant execute on function public.set_availability_for_date(text, date, text, text) to service_role;
