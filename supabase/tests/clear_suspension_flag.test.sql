-- The Men's Convenor clears an old hand-set suspension flag:
-- admin_clear_suspension_flag() (20261008063211_clear_suspension_flag.sql).
-- Both flags go, one activity_log row names the Convenor and the columns,
-- and a person with no flag is refused (P0002) with nothing logged.
begin;
select plan(7);

insert into public.people (airtable_id, given_names, surname, active, registered_team, is_suspended, matches_to_serve)
values ('recFlagP', 'Flagged', 'Player', true, null, true, 2),
       ('recFlagNone', 'Clear', 'Player', true, null, false, null),
       ('recFlagConvenor', 'The', 'Convenor', true, null, false, null);

create function pg_temp.person(p text) returns public.people language sql as
  $$ select * from public.people where airtable_id = p $$;
create function pg_temp.logs() returns bigint language sql as
  $$ select count(*) from public.activity_log where action = 'admin-suspension-flag-clear' $$;

select lives_ok($$ select public.admin_clear_suspension_flag('recFlagP', 'recFlagConvenor') $$, 'clears a flag');
select is((pg_temp.person('recFlagP')).is_suspended, false, 'is_suspended is off');
select is((pg_temp.person('recFlagP')).matches_to_serve, null::integer, 'matches_to_serve is empty');
select results_eq(
  $$ select actor_person_id, entity_id, fields from public.activity_log where action = 'admin-suspension-flag-clear' $$,
  $$ select (pg_temp.person('recFlagConvenor')).id, (pg_temp.person('recFlagP')).id, array['is_suspended', 'matches_to_serve'] $$,
  'one activity_log row: the Convenor, the person, the column names');

select throws_ok($$ select public.admin_clear_suspension_flag('recFlagP', 'recFlagConvenor') $$, 'P0002', null, 'a flag already cleared is refused');
select throws_ok($$ select public.admin_clear_suspension_flag('recFlagNone', 'recFlagConvenor') $$, 'P0002', null, 'someone with no flag is refused');
select is(pg_temp.logs(), 1::bigint, 'nothing more is logged');

select * from finish();
rollback;
