-- Removing a person's personal data: erase_personal_data() (latest
-- definition in 20261007130203_suspensions.sql; README invariant 9;
-- docs/DATA_RETENTION.md). Every foreign key to people that
-- tests/retentionCoverage.test.ts classifies as "erased" is listed below
-- (that test fails if one is missing here), seeded with a row for the person,
-- and checked after the removal: the rows are gone, or for event answers and
-- payments, kept with the personal parts blanked. The playing record stays.
begin;

-- 'table.column' = a foreign key to people classified "erased".
-- deleted: no row may refer to the person afterwards; blanked: the row stays.
create temp table erased_fks (fk text primary key, how text not null);
insert into erased_fks values
  ('family_members.person_id', 'deleted'),
  ('relatives.person_id', 'deleted'),
  ('previous_clubs.person_id', 'deleted'),
  ('applicant_trials.person_id', 'deleted'),
  ('quiz_scores.person_id', 'deleted'),
  ('kit_sizes.person_id', 'deleted'),
  ('season_plans.person_id', 'deleted'),
  ('course_signups.person_id', 'deleted'),
  ('team_people.person_id', 'deleted'),
  ('availability_exceptions.person_id', 'deleted'),
  ('availability_rules.person_id', 'deleted'),
  ('ranking_events.person_id', 'deleted'),
  ('commitments.person_id', 'deleted'),
  ('message_log.person_id', 'deleted'),
  ('files.person_id', 'deleted'),
  ('signatures.signer_person_id', 'deleted'),
  ('signatures.subject_person_id', 'deleted'),
  ('steps.person_id', 'deleted'),
  ('declarations.person_id', 'deleted'),
  ('applications.person_id', 'deleted'),
  ('trial_availability.person_id', 'deleted'),
  ('suspensions.person_id', 'deleted'),
  ('event_responses.person_id', 'blanked'),
  ('event_payments.payer_id', 'blanked');

-- One "seeded" test per column, one "no rows left" per deleted one, and eleven more.
select plan((select count(*)::int + count(*) filter (where how = 'deleted')::int from erased_fks) + 11);

-- Rows in one table.column that refer to the person being removed.
create function pg_temp.rows_for(p_fk text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from public.%I where %I = (select id from public.people where airtable_id = %L)',
                 split_part(p_fk, '.', 1), split_part(p_fk, '.', 2), 'recErP')
    into n;
  return n;
end;
$$;

-- Each listed column really is a foreign key to people.
select is((select count(*) from erased_fks e
           where not exists (
             select 1 from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
             where c.contype = 'f' and c.confrelid = 'public.people'::regclass
               and c.conrelid = to_regclass('public.' || split_part(e.fk, '.', 1))
               and a.attname = split_part(e.fk, '.', 2))),
          0::bigint, 'every listed column is a foreign key to people');

-- ── The person, someone else, and one row for every listed column ──
insert into public.people (airtable_id, given_names, surname, email, mobile_no, active, registered_team, section_rank, opt_in_only)
values ('recErP', 'Leaving', 'Member', 'leaving.member@example.com', '+852 5555 0000', true, 'HKFC D', 12, true),
       ('recErQ', 'Staying', 'Member', 'staying.member@example.com', null, true, 'HKFC D', null, false);
insert into public.teams (airtable_id, team_name, team_rank, active) values ('recErTeam', 'HKFC D', 4, true);
insert into public.matches (airtable_id, match_date, home_team, away_team, match_status)
values ('recErMatch', now() + interval '3 days', 'HKFC D', 'Other', 'Scheduled');
insert into public.events (event_type, title, starts_at) values ('team_social', 'Erase test social', now() + interval '10 days');
insert into public.trial_sessions (starts_at, place) values (now() + interval '5 days', 'Happy Valley');

create function pg_temp.p() returns uuid language sql as $$ select id from public.people where airtable_id = 'recErP' $$;
create function pg_temp.q() returns uuid language sql as $$ select id from public.people where airtable_id = 'recErQ' $$;

insert into public.family_members (person_id, relation, given_names) values (pg_temp.p(), 'spouse', 'Spouse');
insert into public.relatives (person_id, name) values (pg_temp.p(), 'A Relative');
insert into public.previous_clubs (person_id, club) values (pg_temp.p(), 'Old Club');
insert into public.applicant_trials (person_id, trial_date) values (pg_temp.p(), current_date);
insert into public.quiz_scores (person_id, quiz, score) values (pg_temp.p(), 'Rules', 9);
insert into public.kit_sizes (person_id, supplier, item, size) values (pg_temp.p(), 'Kukri', 'Shirt', 'M');
insert into public.season_plans (person_id, season) values (pg_temp.p(), '2026-2027');
insert into public.course_signups (person_id, course) values (pg_temp.p(), 'Umpire course');
insert into public.team_people (team_id, person_id, role)
select id, pg_temp.p(), 'coach' from public.teams where airtable_id = 'recErTeam';
insert into public.availability_exceptions (person_id, match_id, status, player_notes)
select pg_temp.p(), id, 'Unavailable', 'away' from public.matches where airtable_id = 'recErMatch';
insert into public.availability_rules (person_id, rule_type, availability) values (pg_temp.p(), 'All future', 'Maybe');
insert into public.ranking_events (person_id, kind, justification) values (pg_temp.p(), 'move', 'test');
insert into public.commitments (person_id, year_no) values (pg_temp.p(), 1);
insert into public.message_log (person_id, message) values (pg_temp.p(), 'hello');
insert into public.files (person_id, r2_key, kind) values (pg_temp.p(), 'test/erase/photo', 'photo');
insert into public.files (person_id, r2_key, kind) values (pg_temp.p(), 'test/erase/p-form', 'signature');
insert into public.files (person_id, r2_key, kind) values (pg_temp.q(), 'test/erase/q-form', 'signature');
-- The person signs someone else's form, and someone else signs theirs.
insert into public.signatures (file_id, signer_person_id, signer_role, document, subject_person_id)
select id, pg_temp.p(), 'sponsor', 'application', pg_temp.q() from public.files where r2_key = 'test/erase/q-form';
insert into public.signatures (file_id, signer_person_id, signer_role, document, subject_person_id)
select id, pg_temp.q(), 'sponsor', 'application', pg_temp.p() from public.files where r2_key = 'test/erase/p-form';
insert into public.steps (process, step, person_id) values ('new_joiner', 'Sponsor review', pg_temp.p());
insert into public.declarations (person_id, season, wording_version, accepted) values (pg_temp.p(), '2026-2027', 'v1', array['waiver']);
insert into public.applications (person_id, application_type, wording_version, accepted)
values (pg_temp.p(), 'New HKFC Member', 'v1', array['rules']);
insert into public.trial_availability (person_id, session_id) select pg_temp.p(), id from public.trial_sessions where place = 'Happy Valley';
insert into public.suspensions (person_id, from_date, serving_team, reason) values (pg_temp.p(), current_date, 'HKFC D', 'Red card');
insert into public.event_responses (event_id, person_id, status, guests, answers, notes)
select id, pg_temp.p(), 'going', '[{"name": "Jane Guest", "age": "child"}]', '{"diet": "vegan"}', 'Arriving late'
from public.events where title = 'Erase test social';
insert into public.event_payments (event_id, payer_id, read_status, reference, payee, amount_due)
select id, pg_temp.p(), 'matched', 'FPS 123456', 'HKFC Hockey', 100 from public.events where title = 'Erase test social';
-- Web Push devices: removed by a trigger on personal_data_removed_at
-- (20261007180005), not by erase_personal_data itself ("erasedBy" in
-- tests/retentionCoverage.test.ts). The other person's device stays.
insert into public.push_subscriptions (person_id, endpoint, p256dh, auth)
values (pg_temp.p(), 'https://push.example/erase-p', 'k', 'a'), (pg_temp.q(), 'https://push.example/erase-q', 'k', 'a');
-- The playing record, which stays.
insert into public.match_selections (match_id, side, person_id)
select id, 'home', pg_temp.p() from public.matches where airtable_id = 'recErMatch';

select cmp_ok(pg_temp.rows_for(fk), '>', 0::bigint, fk || ': seeded') from erased_fks order by fk;

-- ── Remove ──
select lives_ok($$ select public.erase_personal_data(pg_temp.p(), 'retention-remove') $$, 'erase_personal_data runs');

select is(pg_temp.rows_for(fk), 0::bigint, fk || ': no rows left') from erased_fks where how = 'deleted' order by fk;

select results_eq(
  $$ select guests, answers, notes from public.event_responses where person_id = pg_temp.p() $$,
  $$ values ('[{"name": "Guest", "age": "child"}]'::jsonb, '{}'::jsonb, null::text) $$,
  'event_responses.person_id: kept for the bill, guest names, answers and notes blanked');
select results_eq(
  $$ select reference, payee, amount_due from public.event_payments where payer_id = pg_temp.p() $$,
  $$ values (null::text, null::text, 100::numeric) $$,
  'event_payments.payer_id: kept for the accounts, the transaction details blanked');

select ok((select email is null and mobile_no is null and section_rank is null and not opt_in_only
                  and personal_data_removed_at is not null
           from public.people where id = pg_temp.p()),
          'the people row stays, with its personal fields cleared and the removal stamped');
select set_eq($$ select r2_key from public.r2_deletions where r2_key like 'test/erase/%' $$,
              array['test/erase/p-form', 'test/erase/photo'], 'their stored files are queued for deletion, not the other person''s');
select is((select count(*) from public.files where r2_key = 'test/erase/q-form'), 1::bigint,
          'the form they signed for someone else is kept');
select is((select count(*) from public.push_subscriptions where person_id = pg_temp.p()), 0::bigint,
          'push_subscriptions: their devices are removed with their personal data');
select is((select count(*) from public.push_subscriptions where person_id = pg_temp.q()), 1::bigint,
          'push_subscriptions: someone else''s device stays');
select is((select count(*) from public.match_selections where person_id = pg_temp.p()), 1::bigint,
          'the playing record (match_selections) is kept');
select results_eq(
  $$ select action, fields from public.activity_log where entity = 'people' and entity_id = pg_temp.p() $$,
  $$ values ('retention-remove', array['personal details', 'files', 'sign-in']) $$,
  'one activity_log row, field names only');

select * from finish();
rollback;
