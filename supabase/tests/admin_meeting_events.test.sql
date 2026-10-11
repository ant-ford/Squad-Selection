-- Meetings use the existing event records and remain service-role only.
begin;
select plan(6);

select lives_ok($$
  insert into public.events (event_type, title, starts_at, audience, link_url)
  values ('admin_meeting', 'Captains'' Meeting', now() + interval '1 day',
          '{"eventRoles":["Team captain","Section Captain","Assistant Director of Hockey"]}',
          'https://teams.microsoft.com/l/meetup-join/example')
$$, 'an admin meeting can be saved with its audience and meeting link');

select lives_ok($$
  insert into public.events (event_type, title, starts_at)
  select kind, kind, now() + interval '1 day'
  from unnest(array['trial','social_function','team_social','tournament','tour']) as kind
$$, 'all existing event types still work');

select throws_ok($$
  insert into public.events (event_type, title, starts_at)
  values ('unknown', 'Unknown', now())
$$, '23514', null, 'unknown event types are refused');

select throws_ok($$
  insert into public.events (event_type, title, starts_at, social_function)
  values ('admin_meeting', 'Meeting', now(), 'Hockey Section AGM')
$$, '23514', null, 'admin meetings cannot count as commitment social functions');

select ok(not has_table_privilege('anon', 'public.events', 'select'), 'anonymous clients cannot read meetings');
select ok(not has_table_privilege('authenticated', 'public.events', 'select'), 'signed-in clients still read meetings through the Worker');

select * from finish();
rollback;
