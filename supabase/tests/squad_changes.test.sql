-- Squad saves as changes: apply_squad_changes() and on_squad_changed()
-- (migration 20261007130003_squad_changes.sql; README "Where business rules
-- live", invariant 8). Two coaches' saves merge unless a change since the
-- version a coach loaded touched the same player; the Worker turns that
-- 'conflict' into a 409 (worker/src/squad.ts).
begin;
select plan(27);

-- The club's teams: people's team columns reference teams.team_name
-- (20261007170006_data_constraints).
insert into public.teams (airtable_id, team_name, team_rank, active)
select 'recSqTeam' || l, 'HKFC ' || l, o, true
from unnest(array['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) with ordinality as x(l, o);

insert into public.people (airtable_id, given_names, surname, active, registered_team) values
  ('recSqP1', 'One', 'Player', true, 'HKFC C'),
  ('recSqP2', 'Two', 'Player', true, 'HKFC C'),
  ('recSqP3', 'Three', 'Player', true, 'HKFC C'),
  ('recSqP4', 'Four', 'Player', true, 'HKFC C'),
  ('recSqCoach1', 'First', 'Coach', true, 'HKFC C'),
  ('recSqCoach2', 'Second', 'Coach', true, 'HKFC C');
insert into public.matches (airtable_id, match_date, home_team, away_team, match_status)
values ('recSqMatch', now() + interval '3 days', 'HKFC C', 'HKFC D', 'Scheduled');

create function pg_temp.match_id() returns uuid language sql as
  $$ select id from public.matches where airtable_id = 'recSqMatch' $$;
create function pg_temp.pid(p text) returns uuid language sql as
  $$ select id from public.people where airtable_id = p $$;
create function pg_temp.home() returns jsonb language sql as
  $$ select public.selection_api_ids(pg_temp.match_id(), 'home') $$;

-- ── Both coaches load the empty squad at version 0 ──
create temp table r1 as
  select public.apply_squad_changes('recSqMatch', 'home', array['recSqP1'], '{}', 0, 'recSqCoach1') as r;
select is((select r ->> 'status' from r1), 'ok', 'coach 1 adds P1: ok');
select is((select (r ->> 'version')::int from r1), 1, 'coach 1''s save is version 1');
select is((select r -> 'added' from r1), '["recSqP1"]'::jsonb, 'coach 1''s save reports P1 added');

-- Coach 2 still holds version 0 and adds a different player: merged.
create temp table r2 as
  select public.apply_squad_changes('recSqMatch', 'home', array['recSqP2'], '{}', 0, 'recSqCoach2') as r;
select is((select r ->> 'status' from r2), 'ok', 'coach 2 (stale version 0) adds P2: merged, not refused');
select is((select (r ->> 'version')::int from r2), 2, 'the merged save is version 2');
select is((select r -> 'selected' from r2), '["recSqP1", "recSqP2"]'::jsonb, 'both coaches'' players are in the squad');

-- Coach 2, still on version 0, removes P1, whom coach 1 changed since: refused.
create temp table r3 as
  select public.apply_squad_changes('recSqMatch', 'home', '{}', array['recSqP1'], 0, 'recSqCoach2') as r;
select is((select r ->> 'status' from r3), 'conflict', 'removing a player changed since the loaded version: conflict');
select is((select r -> 'players' from r3), '["recSqP1"]'::jsonb, 'the conflict names the player');
select is((select (r ->> 'version')::int from r3), 2, 'the conflict reports the current version');
select is(pg_temp.home(), '["recSqP1", "recSqP2"]'::jsonb, 'a refused save changes nothing');

-- Adding the same player from the stale version is refused too.
select is(public.apply_squad_changes('recSqMatch', 'home', array['recSqP1'], '{}', 0, 'recSqCoach2') ->> 'status',
          'conflict', 'adding a player changed since the loaded version: conflict');

-- From the current version the same removal goes through.
select is(public.apply_squad_changes('recSqMatch', 'home', '{}', array['recSqP1'], 2, 'recSqCoach2') ->> 'status',
          'ok', 'the same removal from the current version: ok');
select is(pg_temp.home(), '["recSqP2"]'::jsonb, 'P1 is out');

-- A version this side never had: conflict with no players named.
create temp table r4 as
  select public.apply_squad_changes('recSqMatch', 'home', array['recSqP4'], '{}', 99, 'recSqCoach1') as r;
select is((select r ->> 'status' from r4), 'conflict', 'a version from the future: conflict');
select is((select r -> 'players' from r4), '[]'::jsonb, '... naming nobody');

-- A save that changes nothing does not bump the version.
create temp table r5 as
  select public.apply_squad_changes('recSqMatch', 'home', array['recSqP2'], array['recSqP4'], 3, 'recSqCoach1') as r;
select is((select r ->> 'status' from r5), 'unchanged', 'adding a player already in and removing one not in: unchanged');
select is((select v.version from public.match_selection_versions v where v.match_id = pg_temp.match_id() and v.side = 'home'),
          3, 'an unchanged save keeps the version');

-- ── on_squad_changed: one match_selection_changes row per real change ──
select is((select count(*)::int from public.match_selection_changes where match_id = pg_temp.match_id() and side = 'home'),
          3, 'three real changes, three change rows');
select results_eq(
  $$ select version, added, removed, source, actor_person_id from public.match_selection_changes
     where match_id = pg_temp.match_id() and side = 'home' order by version $$,
  $$ values (1, array[pg_temp.pid('recSqP1')], '{}'::uuid[], 'coach', pg_temp.pid('recSqCoach1')),
            (2, array[pg_temp.pid('recSqP2')], '{}'::uuid[], 'coach', pg_temp.pid('recSqCoach2')),
            (3, '{}'::uuid[], array[pg_temp.pid('recSqP1')], 'coach', pg_temp.pid('recSqCoach2')) $$,
  'each change row holds the version, who was added or removed, the source and the coach');
select is((select selection_version_home from public.api_matches where id = 'recSqMatch'), 3,
          'api_matches shows the version the squad page sends back');

-- ── Derby: adding a player takes them off the other side ──
select is(public.apply_squad_changes('recSqMatch', 'away', array['recSqP3'], '{}', 0, 'recSqCoach1') ->> 'status',
          'ok', 'P3 picked for the away side');
create temp table r6 as
  select public.apply_squad_changes('recSqMatch', 'home', array['recSqP3'], '{}', 3, 'recSqCoach2') as r;
select is((select (r ->> 'otherVersion')::int from r6), 2, 'picking P3 at home bumps the away side''s version');
select is(public.selection_api_ids(pg_temp.match_id(), 'away'), '[]'::jsonb, 'P3 is no longer on the away side');
select is((select source from public.match_selection_changes
           where match_id = pg_temp.match_id() and side = 'away' and version = 2),
          'derby', 'the away side''s change is logged as a derby removal');

-- ── Guards ──
select throws_ok($$ select public.apply_squad_changes('recSqMatch', 'home', array['recSqP4'], array['recSqP4'], null) $$,
                 '22023', null, 'a player cannot be added and removed in one save');
select throws_ok($$ select public.on_squad_changed(gen_random_uuid(), 'home', array[gen_random_uuid()], '{}', 'coach', null) $$,
                 '55000', null, 'on_squad_changed refuses a side nobody locked');
select is(public.apply_squad_changes('recSqMatch', 'home', array['recSqP4'], '{}', null, 'recSqCoach1') ->> 'status',
          'ok', 'a null version skips the check (same-day releases)');

select * from finish();
rollback;
