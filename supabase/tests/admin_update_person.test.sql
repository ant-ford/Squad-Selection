-- Officers' edits to a person: admin_update_person() (latest definition in
-- 20261007130503_commitment_period_fixups.sql). Only the allow-listed
-- columns change; any other column refuses the whole call (42501); a real
-- change writes one activity_log row of column names, and the generic audit
-- trigger then stays quiet (eddy.audit_written).
begin;
select plan(17);

insert into public.people (airtable_id, given_names, surname, email, active, registered_team, playing_position, section_rank)
values ('recAdmP', 'Edited', 'Person', 'edited.person@example.com', true, 'HKFC D', 'Midfield', 30),
       ('recAdmOfficer', 'The', 'Officer', null, true, null, null, null);

create function pg_temp.person() returns public.people language sql as
  $$ select * from public.people where airtable_id = 'recAdmP' $$;
create function pg_temp.logs(p_action text) returns bigint language sql as
  $$ select count(*) from public.activity_log
     where entity = 'people' and entity_id = (select id from public.people where airtable_id = 'recAdmP')
       and action = p_action $$;

-- ── Allowed columns change, and are logged by name ──
create temp table r1 as
  select public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-edit',
                                    '{"registered_team": "HKFC C", "playing_position": "Defender"}') as r;
select is((select r ->> 'status' from r1), 'ok', 'an allowed patch: ok');
select is((select r -> 'changed' from r1), '["playing_position", "registered_team"]'::jsonb, 'it reports the changed columns');
select is((pg_temp.person()).registered_team, 'HKFC C', 'registered_team changed');
select is((pg_temp.person()).playing_position, 'Defender', 'playing_position changed');
select is(pg_temp.logs('admin-person-edit'), 1::bigint, 'one activity_log row');
select results_eq(
  $$ select actor_person_id, fields from public.activity_log
     where action = 'admin-person-edit' and entity_id = (pg_temp.person()).id $$,
  $$ select (select id from public.people where airtable_id = 'recAdmOfficer'), array['playing_position', 'registered_team'] $$,
  'the row names the officer and the column names, no values');

-- '' clears a column.
select is(public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-edit', '{"playing_position": ""}') -> 'changed',
          '["playing_position"]'::jsonb, 'an empty string clears a column');
select is((pg_temp.person()).playing_position, null::text, '... to null');

-- ── Anything off the allow-list refuses the whole call ──
select throws_ok($$ select public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-edit', '{"email": "new@example.com"}') $$,
                 '42501', 'Column email cannot be changed here', 'a column off the allow-list is refused');
select throws_ok($$ select public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-edit',
                                                      '{"registered_team": "HKFC B", "section_rank": 1}') $$,
                 '42501', null, 'one bad column refuses the allowed ones with it');
select throws_ok($$ select public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-edit',
                                                      '{"registered_team": "HKFC B"}', '{"hkid_no": "x"}') $$,
                 '42501', null, 'expect is held to the same allow-list');
select ok((select email = 'edited.person@example.com' and registered_team = 'HKFC C' and section_rank = 30
            from pg_temp.person()), 'refused calls changed nothing');
select throws_ok($$ select public.admin_update_person('recAdmP', 'recAdmOfficer', 'edit', '{"registered_team": "HKFC B"}') $$,
                 '22023', null, 'the action must be admin-...');

-- ── Someone else saved meanwhile: conflict, nothing written ──
select is(public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-edit',
                                     '{"registered_team": "HKFC B"}', '{"registered_team": "HKFC D"}'),
          '{"status": "conflict", "field": "registered_team"}'::jsonb, 'a stale expect: conflict');
select is((pg_temp.person()).registered_team, 'HKFC C', '... and the team is unchanged');

-- ── A patch that changes nothing logs nothing ──
select is(public.admin_update_person('recAdmP', 'recAdmOfficer', 'admin-person-noop', '{"registered_team": "HKFC C"}') -> 'changed',
          '[]'::jsonb, 'the same value again changes nothing');

-- The generic audit trigger (people_audit, deferred to commit) skips a
-- transaction an officer's function has logged. Fire it now.
set constraints all immediate;
select is((select count(*) from public.activity_log
           where entity_id = (pg_temp.person()).id and action not like 'admin-%'), 0::bigint,
          'no second, generic log row for the officer''s edits');

select * from finish();
rollback;
