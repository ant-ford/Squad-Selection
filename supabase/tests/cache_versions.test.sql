-- Cache versions (migrations 20261007140003_cache_versions.sql and
-- 20261007140203_cache_versions_suspensions.sql; README invariant 7): a
-- statement trigger bumps a table's counter on a real change, and not on a
-- write that changes nothing a reader can see (a no-op update, a statement
-- that touched no rows, or only the bookkeeping columns).
begin;
select plan(19);

create function pg_temp.v(p_key text) returns bigint language sql as
  $$ select version from public.cache_versions where key = p_key $$;
-- The counter's change while p_sql runs.
create function pg_temp.bump(p_key text, p_sql text) returns bigint language plpgsql as $$
declare
  v0 bigint := pg_temp.v(p_key);
begin
  execute p_sql;
  return pg_temp.v(p_key) - v0;
end;
$$;

-- Every counter has its four triggers (insert, update, delete, truncate).
select is((select count(*) from public.cache_versions c
           where (select count(*) from pg_trigger t
                  where not t.tgisinternal and t.tgfoid = 'public.cache_versions_bump'::regproc
                    and split_part(encode(t.tgargs, 'escape'), '\000', 1) = c.key) < 4),
          0::bigint, 'every cache_versions key has insert, update, delete and truncate triggers');

-- ── teams ──
select is(pg_temp.bump('teams', $$ insert into public.teams (airtable_id, team_name, team_rank, active) values ('recCvTeam', 'HKFC Z', 9, true) $$),
          1::bigint, 'an insert bumps');
select is(pg_temp.bump('teams', $$ update public.teams set team_rank = team_rank where airtable_id = 'recCvTeam' $$),
          0::bigint, 'update set x = x does not bump');
select is(pg_temp.bump('teams', $$ update public.teams set team_rank = 10 where airtable_id = 'recCvTeam' $$),
          1::bigint, 'a real update bumps once');
select is(pg_temp.bump('teams', $$ update public.teams set updated_at = now() - interval '1 day' where airtable_id = 'recCvTeam' $$),
          0::bigint, 'changing only updated_at does not bump');
select is(pg_temp.bump('teams', $$ update public.teams set team_rank = 11 where false $$),
          0::bigint, 'an update of no rows does not bump');
select is(pg_temp.bump('teams', $$ delete from public.teams where false $$),
          0::bigint, 'a delete of no rows does not bump');
select is(pg_temp.bump('teams', $$ insert into public.teams (team_name) select 'never' where false $$),
          0::bigint, 'an insert of no rows does not bump');

-- ── people: last_seen_at is bookkeeping ──
insert into public.people (airtable_id, given_names, surname, active, registered_team)
values ('recCvP', 'Cache', 'Person', true, 'HKFC Z');
select is(pg_temp.bump('people', $$ update public.people set last_seen_at = now() where airtable_id = 'recCvP' $$),
          0::bigint, 'people: stamping last_seen_at does not bump');
select is(pg_temp.bump('people', $$ update public.people set registered_team = registered_team, active = active where airtable_id = 'recCvP' $$),
          0::bigint, 'people: a no-op update does not bump');
select is(pg_temp.bump('people', $$ update public.people set opt_in_only = true where airtable_id = 'recCvP' $$),
          1::bigint, 'people: a real update bumps');
select is(pg_temp.bump('people', $$ insert into public.shirt_numbers (shirt_no) values (987) $$),
          1::bigint, 'shirt_numbers bump people (players are shown with their number)');

-- ── matches: last_hkha_sync is bookkeeping ──
insert into public.matches (airtable_id, match_date, home_team, away_team, match_status)
values ('recCvMatch', now() + interval '2 days', 'HKFC Z', 'Other', 'Scheduled');
select is(pg_temp.bump('matches', $$ update public.matches set last_hkha_sync = now() where airtable_id = 'recCvMatch' $$),
          0::bigint, 'matches: an hkha-sync pass that changes nothing does not bump');
select is(pg_temp.bump('matches', $$ update public.matches set venue = 'HKFC', last_hkha_sync = now() where airtable_id = 'recCvMatch' $$),
          1::bigint, 'matches: a real change bumps');

-- ── tables keyed without an id ──
select is(pg_temp.bump('team_people', $$ insert into public.team_people (team_id, person_id, role)
                                         select t.id, p.id, 'coach' from public.teams t, public.people p
                                         where t.airtable_id = 'recCvTeam' and p.airtable_id = 'recCvP' $$),
          1::bigint, 'team_people: an insert bumps');
select is(pg_temp.bump('team_people', $$ update public.team_people set ordinal = ordinal $$),
          0::bigint, 'team_people: a no-op update does not bump');
select is(pg_temp.bump('match_selections', $$ select public.apply_squad_changes('recCvMatch', 'home', array['recCvP'], '{}', 0) $$),
          1::bigint, 'match_selections: a squad save bumps');
select is(pg_temp.bump('match_selections', $$ select public.apply_squad_changes('recCvMatch', 'home', array['recCvP'], '{}', null) $$),
          0::bigint, 'match_selections: an unchanged squad save does not bump');

-- ── read_cache_versions hands the Worker every counter ──
select is((select count(*) from jsonb_object_keys(public.read_cache_versions())),
          (select count(*) from public.cache_versions), 'read_cache_versions returns every key');

select * from finish();
rollback;
