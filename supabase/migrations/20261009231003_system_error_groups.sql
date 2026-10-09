-- Count the whole selected period before limiting the System screen to 50
-- issues. Existing rows and log_client_error() stay unchanged: new clients
-- put build and browser metadata in the existing bounded detail object.
create function public.system_error_groups(p_days integer default 1)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_days is null or p_days not in (1, 7, 30) then
    raise exception 'Choose 1, 7 or 30 days.' using errcode = '22023';
  end if;

  with classified as materialized (
    select e.*,
      case
        when e.source = 'client' and coalesce(e.message, '') ~*
          $pattern$dynamically imported module|Importing a module script failed|ChunkLoadError|expected a JavaScript(-or-Wasm)? module|Unable to preload CSS|Cannot read properties of undefined \(reading ['"]default['"]\)|undefined is not an object .*_result[.]default$pattern$
          then 'screen-load'
        when coalesce(e.message, '') ~* 'Supabase .*failed|Database error' then 'database'
        when e.source = 'worker' then 'server'
        when e.source = 'cron' then 'scheduled'
        else 'app'
      end as kind,
      -- Different matches/people behind the same endpoint share an issue,
      -- but their original paths remain visible in the examples.
      regexp_replace(regexp_replace(coalesce(e.route, ''),
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi'),
        'rec[A-Za-z0-9]{10,}', ':id', 'g') as route_key
    from public.error_log e
    where e.at > now() - make_interval(days => p_days) and e.at <= now()
  ), keyed as materialized (
    select c.*,
      md5(jsonb_build_array(source, status,
        case when kind = 'screen-load' then kind else coalesce(message, '') end,
        case when kind = 'screen-load' then '' else route_key end)::text) as issue_key
    from classified c
  ), ranked as (
    select k.*, row_number() over (partition by issue_key order by at desc, id desc) as sample_number
    from keyed k
  ), grouped as materialized (
    select issue_key, kind, source, status, max(message) as message,
      count(*) as occurrences,
      count(*) filter (where at > now() - interval '24 hours') as recent_count,
      min(at) as first_seen, max(at) as last_seen,
      (array_agg(distinct route order by route) filter (where route is not null))[1:20] as routes,
      count(distinct route) as route_count,
      jsonb_agg(jsonb_build_object(
        'at', at, 'source', source, 'route', route, 'status', status,
        'message', message, 'request_id', request_id,
        'build', detail->>'build', 'browser', detail->>'browser', 'stack', detail->>'stack'
      ) order by at desc, id desc) filter (where sample_number <= 5) as samples
    from ranked
    group by issue_key, kind, source, status
  ), build_counts as (
    select issue_key, detail->>'build' as build, count(*) as occurrences, max(at) as last_seen
    from keyed group by issue_key, detail->>'build'
  ), ranked_builds as (
    select b.*, row_number() over (partition by issue_key order by last_seen desc, build nulls last) as build_number
    from build_counts b
  ), builds as (
    select issue_key, count(*) as build_count,
      jsonb_agg(jsonb_build_object('build', build, 'count', occurrences, 'lastSeen', last_seen)
        order by last_seen desc, build nulls last) filter (where build_number <= 10) as items
    from ranked_builds group by issue_key
  ), limited as (
    select g.*, b.build_count, b.items as builds
    from grouped g join builds b using (issue_key)
    order by g.last_seen desc, g.issue_key limit 50
  )
  select jsonb_build_object(
    'days', p_days,
    'totalGroups', (select count(*) from grouped),
    'totalOccurrences', (select coalesce(sum(occurrences), 0) from grouped),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'key', issue_key, 'kind', kind, 'source', source, 'status', status, 'message', message,
      'count', occurrences, 'recentCount', recent_count,
      'firstSeen', first_seen, 'lastSeen', last_seen,
      'routes', coalesce(routes, array[]::text[]), 'routeCount', route_count,
      'buildCount', build_count, 'builds', builds, 'samples', samples
    ) order by last_seen desc, issue_key) from limited), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- The Worker checks officer access before invoking this read-only function.
revoke all on function public.system_error_groups(integer) from public, anon, authenticated;
grant execute on function public.system_error_groups(integer) to service_role;
