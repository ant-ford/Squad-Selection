-- The July season rollover: season_rollover(), season_rollover_undo()
-- (migration 20261006230004_season_rollover.sql; docs/SEASON_ROLLOVER.md).
-- A dry run changes nothing and returns the plan; apply moves each Active
-- person's finishing team into previous_eos and the proposed SOS and clears
-- EOS; undo puts the before-values back.
--
-- The migration marks 2026-2027 as rolled over (it started in Airtable), so
-- nothing can be applied before July 2027. To test the apply, this file
-- deletes the current season's mark inside its rolled-back transaction.
begin;
select plan(19);

-- finished_in = EOS, else SOS, else the registered team.
insert into public.people (airtable_id, given_names, surname, active, registered_team, selected_team_sos, selected_team_eos, previous_eos, last_seen_at) values
  ('recRoA', 'Moved', 'Up', true, 'HKFC C', 'HKFC D', 'HKFC B', 'HKFC E', null),         -- finished in B: all three change
  ('recRoB', 'No', 'Selected', true, 'HKFC C', null, null, 'HKFC C', now()),            -- finished in C: SOS proposed as C
  ('recRoC', 'Already', 'Rolled', true, 'HKFC E', 'HKFC D', null, 'HKFC D', now()),     -- finished in D: nothing to change
  ('recRoD', 'Not', 'Active', false, 'HKFC C', 'HKFC C', 'HKFC A', 'HKFC F', null);     -- inactive: left alone

create temp table before_people as
  select airtable_id, previous_eos, selected_team_sos, selected_team_eos
  from public.people where airtable_id like 'recRo_';
create function pg_temp.teams_now() returns setof record language sql as
  $$ select airtable_id, previous_eos, selected_team_sos, selected_team_eos
     from public.people where airtable_id like 'recRo_' order by airtable_id $$;

-- ── The season is already marked: apply is refused ──
select ok(exists (select 1 from public.season_rollovers where season = '2026-2027'),
          'the migration marks 2026-2027 as rolled over');
-- The current season's mark: the migration's until July 2027, then this one.
insert into public.season_rollovers (season, note) values (public.current_season(), 'test') on conflict (season) do nothing;
select throws_ok($$ select * from public.season_rollover(true) $$, '23505', null,
                 'apply is refused for a season already rolled over');

-- ── Dry run ──
create temp table dry as select * from public.season_rollover();
select ok((select detail from dry where kind = 'summary') like '%Dry run: nothing changed.',
          'the dry run says so');
select set_eq($$ select person from dry where kind = 'team' and person like 'recRo_' $$,
              array['recRoA', 'recRoB'], 'the plan lists the two Active people whose teams change');
select is((select detail from dry where kind = 'team' and person = 'recRoA'),
          'finished in HKFC B; previous EOS HKFC E -> HKFC B; SOS HKFC D -> HKFC B; EOS cleared',
          'the plan says what changes for each');
select set_eq($$ select person from dry where kind = 'not seen' and person like 'recRo_' $$,
              array['recRoA'], 'the plan lists the Active person never seen in Eddy');
select results_eq($$ select * from pg_temp.teams_now() as t(a text, b text, c text, d text) $$,
                  $$ select * from before_people order by airtable_id $$,
                  'the dry run changed no one');
select is((select count(*) from public.season_rollover_people), 0::bigint, 'the dry run saved nothing');

-- ── Apply ──
delete from public.season_rollovers where season = public.current_season();
create temp table applied as select * from public.season_rollover(true);
select ok((select detail from applied where kind = 'summary') like '%Applied.', 'apply says so');
select results_eq($$ select * from pg_temp.teams_now() as t(a text, b text, c text, d text) $$,
                  $$ values ('recRoA', 'HKFC B', 'HKFC B', null::text),
                            ('recRoB', 'HKFC C', 'HKFC C', null),
                            ('recRoC', 'HKFC D', 'HKFC D', null),
                            ('recRoD', 'HKFC F', 'HKFC C', 'HKFC A') $$,
                  'previous EOS and SOS become the finishing team, EOS is cleared; the inactive person is untouched');
select is((select people_changed from public.season_rollovers where season = public.current_season()), 2,
          'the season is marked, with the number of people changed');
select set_eq($$ select p.airtable_id from public.season_rollover_people s join public.people p on p.id = s.person_id
                 where s.season = public.current_season() $$,
              array['recRoA', 'recRoB'], 'the before-values of the changed people are kept');
select throws_ok($$ select * from public.season_rollover(true) $$, '23505', null,
                 'a season rolls over once');

-- ── Undo ──
select is(public.season_rollover_undo(public.current_season()), 2, 'undo restores the two changed people');
select results_eq($$ select * from pg_temp.teams_now() as t(a text, b text, c text, d text) $$,
                  $$ select * from before_people order by airtable_id $$,
                  'every team field is back to its before-value');
select ok(not exists (select 1 from public.season_rollovers where season = public.current_season()),
          'the season is unmarked, so it can be run again');
select is((select count(*) from public.season_rollover_people where season = public.current_season()), 0::bigint,
          'the saved before-values go with it');
select throws_ok($$ select public.season_rollover_undo(public.current_season()) $$, 'P0002', null,
                 'a second undo has nothing to undo');
select throws_ok($$ select public.season_rollover_undo('1999-2000') $$, 'P0002', null,
                 'undo of a season never rolled over is refused');

select * from finish();
rollback;
