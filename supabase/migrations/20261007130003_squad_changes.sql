-- Squad saves as changes (Track B6; 7 Oct 2026).
--
-- A coach's save used to send the whole squad, which set_match_selection
-- wrote back over whatever was there. Two coaches on one squad (or one coach
-- on two devices) silently undid each other's picks. A save now sends only
-- the players it adds and removes, applied to the squad as it is NOW, and
-- each side of a match carries a version number.
--
-- Owner decision (6 Oct 2026): changes merge when they don't touch the same
-- player. A save is refused (status 'conflict') only when a change made
-- since the version the coach loaded touched one of the players this save
-- adds or removes. A null version skips the check (same-day releases).
--
--   match_selection_versions  one row per match side, created on first write
--   match_selection_changes   the diff of every write: who was added/removed,
--                             by which path (source) and by whom (actor)
--   lock_match_selection()    locks both sides of a match, always in the
--                             same order, so derby saves can't deadlock
--   on_squad_changed()        THE single place a squad change is recorded:
--                             bumps the version and stores the diff. Every
--                             writer calls it, inside its own transaction.
--                             Change history (activity_log) hooks in here.
--   apply_squad_changes()     the coach save and the same-day release
--   set_match_selection()     redefined: still replaces a whole side (the
--                             old /api/squad/sync, kept for stale PWAs), now
--                             locked, diffed and logged as source 'replace'
--
-- api_matches gains selection_version_home / selection_version_away so the
-- squad page can send back the version it loaded.

create table public.match_selection_versions (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  version integer not null default 0 check (version >= 0),
  primary key (match_id, side)
);

create table public.match_selection_changes (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  version integer not null,
  added uuid[] not null default '{}',
  removed uuid[] not null default '{}',
  source text not null check (source in ('coach', 'derby', 'release', 'replace')),
  actor_person_id uuid references public.people (id) on delete set null,
  occurred_at timestamptz not null default now(),
  unique (match_id, side, version),
  check (cardinality(added) + cardinality(removed) > 0)
);
create index match_selection_changes_actor_idx on public.match_selection_changes (actor_person_id);

alter table public.match_selection_versions enable row level security;
alter table public.match_selection_changes enable row level security;
revoke all on public.match_selection_versions, public.match_selection_changes from public, anon, authenticated;
grant select, insert, update, delete on public.match_selection_versions, public.match_selection_changes to service_role;

-- Locks both sides' version rows (creating them on first use), always in the
-- same order (away, then home), so two saves on the two sides of a derby
-- can't each hold one lock and wait for the other.
create function public.lock_match_selection(p_match uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.match_selection_versions (match_id, side)
  values (p_match, 'away'), (p_match, 'home')
  on conflict do nothing;
  perform 1 from public.match_selection_versions
  where match_id = p_match
  order by side
  for update;
end;
$$;

-- One side's selected players (api ids), in squad order.
create function public.selection_api_ids(p_match uuid, p_side text) returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.api_id order by s.ordinal, p.api_id), '[]'::jsonb)
  from public.match_selections s
  join public.people p on p.id = s.person_id
  where s.match_id = p_match and s.side = p_side
$$;

-- The actor's uuid, or null when unknown: an unrecognised actor must never
-- stop a squad being saved.
create function public.selection_actor(p_actor text) returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.people where api_id = p_actor
$$;

-- Records one real change to one side. The caller holds the lock.
create function public.on_squad_changed(
  p_match uuid, p_side text, p_added uuid[], p_removed uuid[], p_source text, p_actor uuid
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v integer;
begin
  update public.match_selection_versions
  set version = version + 1
  where match_id = p_match and side = p_side
  returning version into v;
  if v is null then
    raise exception 'match selection not locked' using errcode = '55000';
  end if;
  insert into public.match_selection_changes (match_id, side, version, added, removed, source, actor_person_id)
  values (p_match, p_side, v, coalesce(p_added, '{}'), coalesce(p_removed, '{}'), p_source, p_actor);
  -- Change history hooks in here: one call per real change, inside the
  -- save's transaction, from every writer (coach, derby, release, replace).
  return v;
end;
$$;

-- Applies a coach's adds and removes to one side as it is now.
--
-- Returns jsonb:
--   {status:'ok', version, otherVersion, added[], removed[], selected[]}
--       added/removed are the players that really changed (adding someone
--       already there, or removing someone who isn't, is a no-op)
--   {status:'unchanged', version, selected[]}
--   {status:'conflict', version, players[], selected[]}
--       players: api ids changed by someone else since p_version (empty
--       when p_version itself is not a version this side has had)
-- Adding a player takes them off the other side of a derby (logged there
-- with source 'derby').
create function public.apply_squad_changes(
  p_match text, p_side text, p_add text[], p_remove text[], p_version integer,
  p_actor text default null, p_source text default 'coach'
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m uuid := public.match_uuid(p_match);
  v_other text := case p_side when 'home' then 'away' else 'home' end;
  v_actor uuid := public.selection_actor(p_actor);
  v_add uuid[];
  v_remove uuid[];
  v_current integer;
  v_clash jsonb;
  v_before uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_other_removed uuid[];
  v_version integer;
  v_other_version integer;
begin
  if p_side is null or p_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('coach', 'release') then
    raise exception 'source must be coach or release' using errcode = '22023';
  end if;
  select coalesce(array_agg(public.person_uuid(x.pid) order by x.ord), '{}') into v_add
  from unnest(coalesce(p_add, '{}')) with ordinality as x(pid, ord);
  select coalesce(array_agg(public.person_uuid(x.pid)), '{}') into v_remove
  from unnest(coalesce(p_remove, '{}')) as x(pid);
  if v_add && v_remove then
    raise exception 'a player cannot be added and removed in one save' using errcode = '22023';
  end if;

  perform public.lock_match_selection(m);
  select version into v_current
  from public.match_selection_versions
  where match_id = m and side = p_side;

  if p_version is not null and p_version <> v_current then
    if p_version > v_current or p_version < 0 then
      v_clash := '[]'::jsonb;
    else
      select coalesce(jsonb_agg(distinct p.api_id), '[]'::jsonb) into v_clash
      from public.match_selection_changes c
      cross join lateral unnest(c.added || c.removed) as t(pid)
      join public.people p on p.id = t.pid
      where c.match_id = m and c.side = p_side and c.version > p_version
        and (t.pid = any (v_add) or t.pid = any (v_remove));
    end if;
    if p_version > v_current or p_version < 0 or jsonb_array_length(v_clash) > 0 then
      return jsonb_build_object('status', 'conflict', 'version', v_current, 'players', v_clash,
                                'selected', public.selection_api_ids(m, p_side));
    end if;
  end if;

  select coalesce(array_agg(person_id), '{}') into v_before
  from public.match_selections
  where match_id = m and side = p_side;
  v_removed := array(select x from unnest(v_remove) as x where x = any (v_before));
  v_added := array(
    select u.x from unnest(v_add) with ordinality as u(x, o)
    where not (u.x = any (v_before))
    group by u.x
    order by min(u.o)
  );
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return jsonb_build_object('status', 'unchanged', 'version', v_current,
                              'selected', public.selection_api_ids(m, p_side));
  end if;

  delete from public.match_selections
  where match_id = m and side = p_side and person_id = any (v_removed);
  insert into public.match_selections (match_id, side, person_id, ordinal)
  select m, p_side, x.pid,
         (select coalesce(max(s.ordinal), 0) from public.match_selections s
          where s.match_id = m and s.side = p_side) + x.o
  from unnest(v_added) with ordinality as x(pid, o);

  -- Derby: nobody plays for both sides.
  if cardinality(v_added) > 0 then
    with gone as (
      delete from public.match_selections
      where match_id = m and side = v_other and person_id = any (v_added)
      returning person_id
    )
    select coalesce(array_agg(person_id), '{}') into v_other_removed from gone;
    if cardinality(v_other_removed) > 0 then
      v_other_version := public.on_squad_changed(m, v_other, '{}', v_other_removed, 'derby', v_actor);
    end if;
  end if;

  v_version := public.on_squad_changed(m, p_side, v_added, v_removed, p_source, v_actor);
  return jsonb_build_object(
    'status', 'ok',
    'version', v_version,
    'otherVersion', v_other_version,
    'added', (select coalesce(jsonb_agg(p.api_id order by a.o), '[]'::jsonb)
              from unnest(v_added) with ordinality as a(pid, o) join public.people p on p.id = a.pid),
    'removed', (select coalesce(jsonb_agg(p.api_id), '[]'::jsonb)
                from unnest(v_removed) as r(pid) join public.people p on p.id = r.pid),
    'selected', public.selection_api_ids(m, p_side)
  );
end;
$$;

-- Replaces one side's selection, in the order given (the old whole-squad
-- save). Same behaviour as before, plus the lock and the change record.
drop function public.set_match_selection(text, text, text[]);
create function public.set_match_selection(p_match text, p_side text, p_people text[], p_actor text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m uuid := public.match_uuid(p_match);
  v_before uuid[];
  v_after uuid[];
  v_added uuid[];
  v_removed uuid[];
begin
  if p_side is null or p_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  select coalesce(array_agg(public.person_uuid(x.pid) order by x.ord), '{}') into v_after
  from unnest(coalesce(p_people, '{}')) with ordinality as x(pid, ord);

  perform public.lock_match_selection(m);
  select coalesce(array_agg(person_id), '{}') into v_before
  from public.match_selections
  where match_id = m and side = p_side;

  delete from public.match_selections where match_id = m and side = p_side;
  insert into public.match_selections (match_id, side, person_id, ordinal)
  select m, p_side, x.pid, x.ord from unnest(v_after) with ordinality as x(pid, ord);

  v_added := array(select unnest(v_after) except select unnest(v_before));
  v_removed := array(select unnest(v_before) except select unnest(v_after));
  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    perform public.on_squad_changed(m, p_side, v_added, v_removed, 'replace', public.selection_actor(p_actor));
  end if;
end;
$$;

-- As 20260929170000_api_views.sql, plus the two version columns at the end.
create or replace view public.api_matches with (security_invoker = true) as
  select b.api_id as id, public.airtable_ts(m.match_date) as match_date, m.season, m.division, m.competition_type,
         m.home_team, m.home_score, m.away_team, m.away_score, m.match_status, m.venue, m.fixture_id,
         coalesce(array(select p.api_id from public.match_selections ms join public.people p on p.id = ms.person_id
                        where ms.match_id = m.id and ms.side = 'home' order by ms.ordinal), '{}') as selected_players_home,
         coalesce(array(select p.api_id from public.match_selections ms join public.people p on p.id = ms.person_id
                        where ms.match_id = m.id and ms.side = 'away' order by ms.ordinal), '{}') as selected_players_away,
         m.auto_select_enabled, m.home_kit, m.away_kit, m.ump_1, m.ump_2,
         coalesce((select v.version from public.match_selection_versions v
                   where v.match_id = m.id and v.side = 'home'), 0) as selection_version_home,
         coalesce((select v.version from public.match_selection_versions v
                   where v.match_id = m.id and v.side = 'away'), 0) as selection_version_away
  from public.matches_v m
  join public.matches b on b.id = m.id;
revoke all on public.api_matches from anon, authenticated;
grant select on public.api_matches to service_role;

revoke all on function
  public.lock_match_selection(uuid),
  public.selection_api_ids(uuid, text),
  public.selection_actor(text),
  public.on_squad_changed(uuid, text, uuid[], uuid[], text, uuid),
  public.apply_squad_changes(text, text, text[], text[], integer, text, text),
  public.set_match_selection(text, text, text[], text)
from public, anon, authenticated;
grant execute on function
  public.lock_match_selection(uuid),
  public.selection_api_ids(uuid, text),
  public.selection_actor(text),
  public.on_squad_changed(uuid, text, uuid[], uuid[], text, uuid),
  public.apply_squad_changes(text, text, text[], text[], integer, text, text),
  public.set_match_selection(text, text, text[], text)
to service_role;

notify pgrst, 'reload schema';
