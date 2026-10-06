-- Season rollover (6 Oct 2026 review, item E1). Run once each July, after the
-- season ends and before the new season's teams are picked; the checklist is
-- docs/SEASON_ROLLOVER.md.
--
--   select * from public.season_rollover();                 -- dry run
--   select * from public.season_rollover(p_apply => true);
--   select public.season_rollover_undo('2027-2028');
--
-- For every Active person:
--  - previous_eos becomes the team they finished the season in: Selected Team
--    EOS, else SOS, else the registered team (what the app displays);
--  - Selected Team EOS is cleared;
--  - Selected Team SOS is proposed as that same team, for the Section Captain
--    to change while picking the new season's teams.
-- Inactive people are left alone: they didn't play the season that ended.
--
-- It also lists Active players not seen in Eddy since 1 January
-- (people.last_seen_at, stamped at most once a day when someone uses the
-- app), so the captains can ask whether they are still playing.
--
-- A season rolls over once. The before-values of every changed person are
-- kept, so season_rollover_undo() can put them back.

alter table public.people add column last_seen_at timestamptz;

create table public.season_rollovers (
  season text primary key check (season ~ '^\d{4}-\d{4}$'),
  rolled_at timestamptz not null default now(),
  people_changed integer not null default 0,
  note text
);
alter table public.season_rollovers enable row level security;
revoke all on public.season_rollovers from public, anon, authenticated;
grant select on public.season_rollovers to service_role;

-- This season started in Airtable. Marking it stops a rollover being applied
-- before July 2027 (current_season() turns over on 1 July).
insert into public.season_rollovers (season, note)
values ('2026-2027', 'Started in Airtable; moved to Eddy on 2 Oct 2026');

create table public.season_rollover_people (
  season text not null references public.season_rollovers (season) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  previous_eos text,
  selected_team_sos text,
  selected_team_eos text,
  primary key (season, person_id)
);
create index season_rollover_people_person_idx on public.season_rollover_people (person_id);
alter table public.season_rollover_people enable row level security;
revoke all on public.season_rollover_people from public, anon, authenticated;
grant select on public.season_rollover_people to service_role;

-- What a rollover would do to each Active person.
create function public.season_rollover_plan()
returns table (id uuid, api_id text, name text, previous_eos text, selected_team_sos text,
               selected_team_eos text, finished_in text, last_seen_at timestamptz, changes boolean)
language sql stable
set search_path = ''
as $$
  select r.*,
         r.previous_eos is distinct from r.finished_in
           or r.selected_team_sos is distinct from r.finished_in
           or r.selected_team_eos is not null
  from (
    select p.id, p.api_id,
           coalesce(nullif(btrim(concat_ws(' ', coalesce(p.preferred_name, p.given_names), p.surname)), ''), '(no name)'),
           p.previous_eos, p.selected_team_sos, p.selected_team_eos,
           coalesce(p.selected_team_eos, p.selected_team_sos, p.registered_team),
           p.last_seen_at
    from public.people p
    where p.active
  ) r (id, api_id, name, previous_eos, selected_team_sos, selected_team_eos, finished_in, last_seen_at)
$$;
revoke all on function public.season_rollover_plan() from public, anon, authenticated;

create function public.season_rollover(p_apply boolean default false)
returns table (kind text, person text, name text, detail text)
language plpgsql
set search_path = ''
as $$
declare
  v_season text := public.current_season();
  v_since date := make_date(extract(year from (now() at time zone 'Asia/Hong_Kong'))::int, 1, 1);
  v_active integer;
  v_changed integer;
  v_silent integer;
begin
  if p_apply and exists (select 1 from public.season_rollovers r where r.season = v_season) then
    raise exception 'Season % has already been rolled over', v_season using errcode = '23505';
  end if;

  select count(*), count(*) filter (where r.changes),
         count(*) filter (where r.last_seen_at is null or r.last_seen_at < v_since)
    into v_active, v_changed, v_silent
    from public.season_rollover_plan() r;

  return query select 'summary', null::text, null::text,
    format('Into %s: %s Active people, %s to change, %s not seen since %s. %s',
           v_season, v_active, v_changed, v_silent, to_char(v_since, 'FMDD Mon YYYY'),
           case when p_apply then 'Applied.' else 'Dry run: nothing changed.' end);

  return query
    select 'team', r.api_id, r.name,
           concat_ws('; ',
             'finished in ' || coalesce(r.finished_in, 'no team'),
             case when r.previous_eos is distinct from r.finished_in
                  then format('previous EOS %s -> %s', coalesce(r.previous_eos, 'none'), coalesce(r.finished_in, 'none')) end,
             case when r.selected_team_sos is distinct from r.finished_in
                  then format('SOS %s -> %s', coalesce(r.selected_team_sos, 'none'), coalesce(r.finished_in, 'none')) end,
             case when r.selected_team_eos is not null then 'EOS cleared' end)
    from public.season_rollover_plan() r
    where r.changes
    order by r.finished_in nulls last, r.name;

  return query
    select 'not seen', r.api_id, r.name,
           case when r.last_seen_at is null then 'never seen in Eddy'
                else 'last seen ' || to_char(r.last_seen_at at time zone 'Asia/Hong_Kong', 'FMDD Mon YYYY') end
             || ' (' || coalesce(r.finished_in, 'no team') || ')'
    from public.season_rollover_plan() r
    where r.last_seen_at is null or r.last_seen_at < v_since
    order by r.last_seen_at nulls first, r.name;

  if p_apply then
    insert into public.season_rollovers (season, people_changed) values (v_season, v_changed);
    insert into public.season_rollover_people (season, person_id, previous_eos, selected_team_sos, selected_team_eos)
      select v_season, r.id, r.previous_eos, r.selected_team_sos, r.selected_team_eos
      from public.season_rollover_plan() r
      where r.changes;
    update public.people p
       set previous_eos = r.finished_in,
           selected_team_sos = r.finished_in,
           selected_team_eos = null
      from public.season_rollover_plan() r
     where r.changes and p.id = r.id;
  end if;
end;
$$;
revoke all on function public.season_rollover(boolean) from public, anon, authenticated;

-- Puts back the three team fields saved by a rollover and forgets it, so it
-- can be run again. Undo straight away: it overwrites any team changes made
-- since. Returns how many people were restored.
create function public.season_rollover_undo(p_season text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_restored integer;
begin
  if not exists (select 1 from public.season_rollovers r where r.season = p_season) then
    raise exception 'Season % has not been rolled over', p_season using errcode = 'P0002';
  end if;
  -- Includes 2026-2027, which started in Airtable and saved nothing.
  if not exists (select 1 from public.season_rollover_people s where s.season = p_season) then
    raise exception 'Season % saved nothing to undo', p_season using errcode = '22023';
  end if;
  update public.people p
     set previous_eos = s.previous_eos,
         selected_team_sos = s.selected_team_sos,
         selected_team_eos = s.selected_team_eos
    from public.season_rollover_people s
   where s.season = p_season and p.id = s.person_id;
  get diagnostics v_restored = row_count;
  delete from public.season_rollovers where season = p_season;
  return v_restored;
end;
$$;
revoke all on function public.season_rollover_undo(text) from public, anon, authenticated;
