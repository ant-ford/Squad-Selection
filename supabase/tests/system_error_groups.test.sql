begin;
select plan(24);

delete from public.error_log;
select is((public.system_error_groups(1)->>'totalGroups')::integer, 0, 'empty period has no groups');
select is(public.system_error_groups(1)->'groups', '[]'::jsonb, 'empty groups are an array');
select throws_ok('select public.system_error_groups(2)', '22023', 'Choose 1, 7 or 30 days.', 'reject unsupported periods');
select throws_ok('select public.system_error_groups(null)', '22023', 'Choose 1, 7 or 30 days.', 'reject a null period');
select ok(not has_function_privilege('anon', 'public.system_error_groups(integer)', 'EXECUTE'), 'anon cannot read errors');
select ok(not has_function_privilege('authenticated', 'public.system_error_groups(integer)', 'EXECUTE'), 'browser sessions cannot read errors directly');
select ok(has_function_privilege('service_role', 'public.system_error_groups(integer)', 'EXECUTE'), 'Worker service role can read errors');

insert into public.error_log (at, source, route, message, person_id, detail)
select now() - (121 - n) * interval '1 minute', 'client',
  (array['/coach', '/umpiring', '/coach/availability'])[1 + n % 3],
  case when n % 2 = 0 then
    $message$TypeError: Cannot read properties of undefined (reading 'default')$message$
  else
    $message$TypeError: undefined is not an object (evaluating 'v._result.default')$message$
  end,
  'private-person-id',
  jsonb_build_object('build', case when n <= 90 then 'old-build' else 'new-build' end,
                    'browser', 'Safari 17', 'userAgent', 'private-full-user-agent')
from generate_series(1, 120) n;

select is((public.system_error_groups(1)->>'totalGroups')::integer, 1, 'browser variants and routes share one screen-loading issue');
select is((public.system_error_groups(1)->>'totalOccurrences')::integer, 120, 'count covers more than the old 50-row limit');
select is((public.system_error_groups(1)->'groups'->0->>'count')::integer, 120, 'group count is complete');
select is((public.system_error_groups(1)->'groups'->0->>'recentCount')::integer, 120, 'recent count is complete');
select is(public.system_error_groups(1)->'groups'->0->>'kind', 'screen-load', 'recognises the reported React failures');
select is((public.system_error_groups(1)->'groups'->0->>'routeCount')::integer, 3, 'retains affected route count');
select is((public.system_error_groups(1)->'groups'->0->>'firstSeen')::timestamptz, now() - interval '120 minutes', 'first occurrence covers all rows');
select is((public.system_error_groups(1)->'groups'->0->>'lastSeen')::timestamptz, now() - interval '1 minute', 'latest occurrence is exact');
select is(jsonb_array_length(public.system_error_groups(1)->'groups'->0->'samples'), 5, 'examples are bounded independently of counts');
select is((public.system_error_groups(1)->'groups'->0->'builds'->0->>'count')::integer, 30, 'shows recurrence on the newer build');
select ok(public.system_error_groups(1)::text not like '%private-%', 'never returns person ids or full user agents');

insert into public.error_log (at, source, route, message)
values
  (now() - interval '2 days', 'client', '/club', 'ChunkLoadError: loading a screen failed'),
  (now() - interval '10 days', 'client', '/', 'TypeError: Failed to fetch dynamically imported module'),
  (now() + interval '1 day', 'client', '/', 'ChunkLoadError: future timestamp');

select is((public.system_error_groups(1)->>'totalOccurrences')::integer, 120, '24-hour view excludes older and future reports');
select is((public.system_error_groups(7)->>'totalOccurrences')::integer, 121, '7-day history includes older matching reports');
select is((public.system_error_groups(30)->>'totalOccurrences')::integer, 122, '30-day history includes ten-day reports');

delete from public.error_log;
insert into public.error_log (at, source, route, message)
select now() - n * interval '1 minute', 'client', '/club', 'Distinct app failure ' || n
from generate_series(1, 61) n;
select is((public.system_error_groups(1)->>'totalGroups')::integer, 61, 'counts all issues before the group limit');
select is(jsonb_array_length(public.system_error_groups(1)->'groups'), 50, 'limits returned groups');
select is(public.system_error_groups(1)->'groups'->0->>'message', 'Distinct app failure 1', 'orders issues by latest occurrence');

select * from finish();
rollback;
