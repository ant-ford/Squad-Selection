-- What the Worker reads and writes on the Supabase backend.
--
-- 1. api_id: the id the app and its links use for a row - the Airtable id
--    for imported rows (calendar feed URLs are signed over it, pages and
--    bookmarks carry it), the uuid for rows created in Eddy. Every link the
--    views return is an api_id too, so the browser never sees a change.
-- 2. api_* views: one per domain object, shaped as the Worker's mappers
--    expect, timestamps in the same ISO form Airtable returns.
-- 3. Functions for writes that touch several rows and must happen together.

-- ── 1. api_id ────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'people', 'offices', 'shirt_numbers', 'teams', 'matches', 'match_cards', 'availability_exceptions',
    'availability_rules', 'ability_group_config', 'ranking_events', 'commitments', 'message_templates',
    'message_log', 'hkha_sync_state'
  ] loop
    execute format(
      'alter table public.%I add column api_id text generated always as (coalesce(airtable_id, id::text)) stored', t);
    execute format('create unique index %I on public.%I (api_id)', t || '_api_id_key', t);
  end loop;
end;
$$;

-- Airtable's timestamp format, so both backends hand the app identical strings.
create function public.airtable_ts(t timestamptz) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- ── 2. Read views ───────────────────────────────────────────────────────
create view public.api_players with (security_invoker = true) as
  select b.api_id as id,
         p.preferred_name, p.given_names, p.surname,
         s.shirt_no::text as shirt_no_value,
         p.email, lower(p.email) as email_lower, p.mobile_no, p.active,
         p.registered_team, p.selected_team_sos, p.selected_team_eos, p.playing_position, p.playing_ability,
         p.is_visiting_player, p.is_suspended, p.matches_to_serve, p.ever_registered_to_premier, p.u21_eligible,
         p.player_coach, p.section_rank, public.airtable_ts(p.rank_updated_at) as rank_updated_at,
         p.status, p.applicant_stage, p.sports_background, p.selection_comments, p.opt_in_only, p.date_of_birth,
         (select f.id from public.files f where f.person_id = p.id and f.kind = 'photo' order by f.created_at limit 1) as photo_file_id
  from public.people_v p
  join public.people b on b.id = p.id
  left join public.shirt_numbers s on s.id = p.shirt_number_id;

create view public.api_teams with (security_invoker = true) as
  select t.api_id as id, t.team_name, t.team_rank, t.is_premier, t.target_squad_size, t.active,
         coalesce(array(select p.api_id from public.team_people tp join public.people p on p.id = tp.person_id
                        where tp.team_id = t.id and tp.role = 'coach' order by tp.ordinal), '{}') as coach,
         coalesce(array(select p.api_id from public.team_people tp join public.people p on p.id = tp.person_id
                        where tp.team_id = t.id and tp.role = 'team_captain' order by tp.ordinal), '{}') as team_captain,
         coalesce(array(select p.api_id from public.team_people tp join public.people p on p.id = tp.person_id
                        where tp.team_id = t.id and tp.role = 'section_captain' order by tp.ordinal), '{}') as section_captain,
         coalesce(array(select p.api_id from public.team_people tp join public.people p on p.id = tp.person_id
                        where tp.team_id = t.id and tp.role = 'auto_select' order by tp.ordinal), '{}') as auto_select_players
  from public.teams t;

create view public.api_matches with (security_invoker = true) as
  select b.api_id as id, public.airtable_ts(m.match_date) as match_date, m.season, m.division, m.competition_type,
         m.home_team, m.home_score, m.away_team, m.away_score, m.match_status, m.venue, m.fixture_id,
         coalesce(array(select p.api_id from public.match_selections ms join public.people p on p.id = ms.person_id
                        where ms.match_id = m.id and ms.side = 'home' order by ms.ordinal), '{}') as selected_players_home,
         coalesce(array(select p.api_id from public.match_selections ms join public.people p on p.id = ms.person_id
                        where ms.match_id = m.id and ms.side = 'away' order by ms.ordinal), '{}') as selected_players_away,
         m.auto_select_enabled, m.home_kit, m.away_kit, m.ump_1, m.ump_2
  from public.matches_v m
  join public.matches b on b.id = m.id;

create view public.api_match_cards with (security_invoker = true) as
  select b.api_id as id, p.api_id as player, m.api_id as match, c.team, c.player_team, c.play_up, c.goalkeeper,
         c.jersey_number, c.goals_scored, c.cards, c.u21, c.vp, c.captain, c.season, c.fixture_id, c.raw_player_name
  from public.match_cards_v c
  join public.match_cards b on b.id = c.id
  left join public.people p on p.id = c.person_id
  left join public.matches m on m.id = c.match_id;

create view public.api_availability_exceptions with (security_invoker = true) as
  select e.api_id as id, p.api_id as player, m.api_id as match, e.status as availability_status,
         e.player_notes as note, public.season_of(m.match_date) as season, public.airtable_ts(e.updated_at) as updated_at
  from public.availability_exceptions e
  left join public.people p on p.id = e.person_id
  left join public.matches m on m.id = e.match_id;

create view public.api_availability_rules with (security_invoker = true) as
  select r.api_id as id, p.api_id as player, r.rule_type, r.availability, r.active, r.start_date, r.end_date, r.notes,
         public.airtable_ts(r.updated_at) as last_modified
  from public.availability_rules r
  left join public.people p on p.id = r.person_id;

create view public.api_offices with (security_invoker = true) as
  select o.api_id as id,
         case o.role when 'membership_officer' then 'membershipOfficer' when 'section_chair' then 'sectionChair'
                     when 'section_captain' then 'sectionCaptain' when 'sponsor' then 'sponsor'
                     when 'hockey_convenor' then 'hockeyConvenor' when 'kit_convenor' then 'kitConvenor' end as office,
         o.designation, o.status, p.api_id as member
  from public.offices o
  left join public.people p on p.id = o.person_id;

create view public.api_ranking_events with (security_invoker = true) as
  select e.api_id as id, p.api_id as player, a.api_id as actor, e.actor_email, e.kind, e.old_rank, e.new_rank,
         e.justification, public.airtable_ts(e.occurred_at) as occurred_at
  from public.ranking_events e
  left join public.people p on p.id = e.person_id
  left join public.people a on a.id = e.actor_id;

-- ── 3. Writes that must happen together ─────────────────────────────────

-- The uuid behind an api_id, or an error naming what was not found.
create function public.person_uuid(p_api text) returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from public.people where api_id = p_api;
  if v is null then
    raise exception 'No person %', p_api using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create function public.match_uuid(p_api text) returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from public.matches where api_id = p_api;
  if v is null then
    raise exception 'No match %', p_api using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Replaces one side's selection, in the order given.
create function public.set_match_selection(p_match text, p_side text, p_people text[]) returns void
language plpgsql
set search_path = ''
as $$
declare
  m uuid := public.match_uuid(p_match);
begin
  if p_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  delete from public.match_selections where match_id = m and side = p_side;
  insert into public.match_selections (match_id, side, person_id, ordinal)
  select m, p_side, public.person_uuid(x.pid), x.ord
  from unnest(p_people) with ordinality as x(pid, ord);
end;
$$;

-- Replaces one role's list on a team (e.g. its Auto Select Players).
create function public.set_team_people(p_team text, p_role text, p_people text[]) returns void
language plpgsql
set search_path = ''
as $$
declare
  t uuid;
begin
  select id into t from public.teams where api_id = p_team;
  if t is null then
    raise exception 'No team %', p_team using errcode = 'P0002';
  end if;
  delete from public.team_people where team_id = t and role = p_role;
  insert into public.team_people (team_id, person_id, role, ordinal)
  select t, public.person_uuid(x.pid), p_role, x.ord
  from unnest(p_people) with ordinality as x(pid, ord);
end;
$$;

-- An availability change set: deletes, updates, creates, all or nothing.
-- p = {"delete": [api_id...], "update": [{id, match, player, status, notes, updatedBy}], "create": [{match, player, ...}]}
-- Returns the created rows' api_ids, in the order given.
create function public.apply_availability_changes(p jsonb) returns text[]
language plpgsql
set search_path = ''
as $$
declare
  created text[] := '{}';
  w jsonb;
  new_id text;
begin
  delete from public.availability_exceptions
  where api_id in (select jsonb_array_elements_text(coalesce(p -> 'delete', '[]')));

  for w in select * from jsonb_array_elements(coalesce(p -> 'update', '[]')) loop
    update public.availability_exceptions
       set match_id = public.match_uuid(w ->> 'match'),
           person_id = public.person_uuid(w ->> 'player'),
           status = w ->> 'status',
           player_notes = nullif(w ->> 'notes', ''),
           updated_by_id = public.person_uuid(w ->> 'updatedBy')
     where api_id = w ->> 'id';
  end loop;

  for w in select * from jsonb_array_elements(coalesce(p -> 'create', '[]')) loop
    insert into public.availability_exceptions (match_id, person_id, status, player_notes, updated_by_id)
    values (public.match_uuid(w ->> 'match'), public.person_uuid(w ->> 'player'), w ->> 'status',
            nullif(w ->> 'notes', ''), public.person_uuid(w ->> 'updatedBy'))
    returning api_id into new_id;
    created := created || new_id;
  end loop;

  return created;
end;
$$;

-- Several people's rank fields at once (a reorder), all or nothing.
-- p = [{"id": api_id, "sectionRank": n|null, "playingAbility": s|null, "rankUpdatedAt": iso, "active": bool}]
-- Only the keys present are written.
create function public.update_people_ranks(p jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  w jsonb;
begin
  for w in select * from jsonb_array_elements(p) loop
    update public.people set
      section_rank = case when w ? 'sectionRank' then (w ->> 'sectionRank')::integer else section_rank end,
      playing_ability = case when w ? 'playingAbility' then w ->> 'playingAbility' else playing_ability end,
      rank_updated_at = case when w ? 'rankUpdatedAt' then (w ->> 'rankUpdatedAt')::timestamptz else rank_updated_at end,
      active = case when w ? 'active' then (w ->> 'active')::boolean else active end,
      opt_in_only = case when w ? 'optInOnly' then (w ->> 'optInOnly')::boolean else opt_in_only end
    where api_id = w ->> 'id';
    if not found then
      raise exception 'No person %', w ->> 'id' using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

-- Ranking history rows, resolving the api ids.
create function public.insert_ranking_events(p jsonb) returns void
language sql
set search_path = ''
as $$
  insert into public.ranking_events (person_id, actor_id, actor_email, kind, old_rank, new_rank, justification, occurred_at)
  select public.person_uuid(w ->> 'playerId'),
         case when w ->> 'actorId' is null then null else public.person_uuid(w ->> 'actorId') end,
         nullif(w ->> 'actorEmail', ''), w ->> 'kind',
         (w ->> 'oldRank')::integer, (w ->> 'newRank')::integer,
         nullif(w ->> 'justification', ''), (w ->> 'timestamp')::timestamptz
  from jsonb_array_elements(p) as w;
$$;

-- A new standing availability rule for a person.
create function public.create_availability_rule(p jsonb) returns text
language sql
set search_path = ''
as $$
  insert into public.availability_rules (person_id, rule_type, availability, active, start_date, end_date, notes)
  values (public.person_uuid(p ->> 'playerId'), p ->> 'ruleType', p ->> 'availability', true,
          nullif(p ->> 'startDate', '')::date, nullif(p ->> 'endDate', '')::date, nullif(p ->> 'notes', ''))
  returning api_id;
$$;

-- ── Lock down everything above, as the first migrations did ─────────────
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on %s from anon, authenticated', r.rel);
    execute format('grant select on %s to service_role', r.rel);
  end loop;
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end;
$$;
