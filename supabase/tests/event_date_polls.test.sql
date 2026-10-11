-- Real database checks for date polling, choosing a date and personal-data removal.
begin;
select plan(40);

insert into public.people(airtable_id, given_names, surname, active)
values ('recDateA', 'Alice', 'Date', true), ('recDateB', 'Ben', 'Date', true), ('recDateC', 'Chris', 'Date', true), ('recDateD', 'Dan', 'Date', true);
create function pg_temp.person(p text) returns uuid language sql as $$ select id from public.people where airtable_id = p $$;
create function pg_temp.options() returns jsonb language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('id','one','startsAt',now() + interval '7 days','endsAt',now() + interval '7 days 1 hour'),
    jsonb_build_object('id','two','startsAt',now() + interval '10 days','endsAt',null))
$$;
create function pg_temp.poll() returns uuid language sql as $$ select id from public.events where title = 'Date test' $$;

select ok(public.valid_event_date_options(pg_temp.options()), 'two valid options are accepted');
select ok(not public.valid_event_date_options(jsonb_build_array(pg_temp.options()->0)), 'one option is refused');
select ok(not public.valid_event_date_options(jsonb_build_array(pg_temp.options()->0, pg_temp.options()->0)), 'duplicate dates and IDs are refused');
select ok(not public.valid_event_date_options('[{"id":"a","startsAt":"bad"},{"id":"b","startsAt":"bad"}]'), 'invalid timestamps are refused');
select lives_ok($$
  insert into public.events(event_type,title,starts_at,date_options,status)
  values ('team_social','Date test',now() + interval '7 days',pg_temp.options(),'published')
$$, 'a Team Social can be published as a date poll');

select lives_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateA'), '{"one":"available","two":"unavailable"}') $$, 'an invitee saves each date');
select is((select answers from public.event_date_responses where person_id = pg_temp.person('recDateA')), '{"one":"available","two":"unavailable"}'::jsonb, 'No is saved explicitly');
select is((select count(*) from public.event_responses where event_id = pg_temp.poll()), 0::bigint, 'date availability creates no attendance RSVP');
select throws_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateA'), '{"one":"available"}') $$, '22023', null, 'missing answers are refused');
select throws_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateA'), '{"one":"available","unknown":"maybe"}') $$, '22023', null, 'foreign option IDs are refused');
select throws_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateA'), '{"one":"going","two":"maybe"}') $$, '22023', null, 'attendance status is not date availability');
select lives_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateB'), '{"one":"unavailable","two":"available"}') $$, 'another invitee can answer');
select lives_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateA'), '{"one":"available","two":"maybe"}') $$, 'an invitee can revise availability before choosing');
select is((select count(*) from public.event_date_responses where event_id = pg_temp.poll()), 2::bigint, 'repeat replies replace their own row');
select throws_ok($$ update public.events set date_options = '[]' where id = pg_temp.poll() $$, '40001', null, 'published proposed dates stay stable');
select throws_ok($$ select public.choose_event_date(pg_temp.poll(), 'missing', pg_temp.options()) $$, '22023', null, 'only a proposed date can be chosen');
select throws_ok($$ select public.choose_event_date(pg_temp.poll(), 'two', '[]') $$, '40001', null, 'a stale organiser page cannot choose a date');
select lives_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateC'), '{"one":"available","two":"unavailable"}') $$, 'a No reply for the chosen date is recorded');
select lives_ok($$ select public.choose_event_date(pg_temp.poll(), 'two', pg_temp.options()) $$, 'the organiser chooses one proposed date');
select is((select chosen_date_id from public.events where id = pg_temp.poll()), 'two', 'the selected option is recorded');
select is((select starts_at from public.events where id = pg_temp.poll()), now() + interval '10 days', 'the event moves to the chosen date');
select is((select respond_by from public.events where id = pg_temp.poll()), null::timestamptz, 'final attendance gets the normal RSVP deadline');
select is((select count(*) from public.event_date_responses where event_id = pg_temp.poll()), 3::bigint, 'original availability remains for comparison');
select throws_ok($$ select public.save_event_date_answers(pg_temp.poll(), pg_temp.person('recDateA'), '{"one":"available","two":"available"}') $$, 'P0001', null, 'a reply that arrives after date selection is refused');
select throws_ok($$ select public.choose_event_date(pg_temp.poll(), 'one', pg_temp.options()) $$, 'P0001', null, 'a second selection cannot replace the chosen date');
select throws_ok($$ update public.events set starts_at = now() + interval '7 days' where id = pg_temp.poll() $$, '40001', null, 'a stale details edit cannot overwrite the chosen date');
select is((select count(*) from public.event_responses where event_id = pg_temp.poll()), 1::bigint, 'only Available for the chosen date becomes an RSVP');
select is((select status from public.event_responses where event_id = pg_temp.poll() and person_id = pg_temp.person('recDateB')), 'going', 'Available for the chosen date becomes Going');
select ok(not exists(select 1 from public.event_responses where event_id = pg_temp.poll() and person_id = pg_temp.person('recDateA')), 'Maybe is not automatically confirmed');
select ok(not exists(select 1 from public.event_responses where event_id = pg_temp.poll() and person_id = pg_temp.person('recDateC')), 'Available on another date and No on the chosen date do not carry over');
select ok(not exists(select 1 from public.event_responses where event_id = pg_temp.poll() and person_id = pg_temp.person('recDateD')), 'unanswered invitees are not automatically confirmed');
select ok((select signed_up_by_id is null and guests = '[]'::jsonb from public.event_responses where event_id = pg_temp.poll() and person_id = pg_temp.person('recDateB')), 'carried-over answers add no guests or proxy payer');
select ok(not has_function_privilege('anon','public.choose_event_date(uuid,text,jsonb)','execute'), 'anonymous clients cannot select dates');
select ok(not has_function_privilege('authenticated','public.save_event_date_answers(uuid,uuid,jsonb)','execute'), 'clients answer through the Worker access checks');
select ok(not has_table_privilege('authenticated','public.event_date_responses','select'), 'other invitees cannot read names and availability directly');
select ok(has_function_privilege('service_role','public.choose_event_date(uuid,text,jsonb)','execute'), 'the Worker can select dates');
select ok(exists(select 1 from public.cache_versions where key = 'event_date_responses'), 'date replies have a cache-version counter');

update public.people set personal_data_removed_at = now() where id = pg_temp.person('recDateA');
select is((select count(*) from public.event_date_responses where person_id = pg_temp.person('recDateA')), 0::bigint, 'personal-data removal erases their date availability');
select is((select count(*) from public.event_date_responses where person_id = pg_temp.person('recDateB')), 1::bigint, 'someone else''s date availability stays');
delete from public.events where id = pg_temp.poll();
select is((select count(*) from public.event_date_responses where person_id = pg_temp.person('recDateB')), 0::bigint, 'deleting an event also removes its date replies');

select * from finish();
rollback;
