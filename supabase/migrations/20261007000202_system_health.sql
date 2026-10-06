-- System health (owner, 6 Oct 2026). The owner can't tail the Worker's
-- logs, so failures were invisible. Two small tables make them visible on
-- the /system screen, and a daily check (worker/src/systemHealth.ts) puts a
-- line in the owner's My Tasks and emails him when something is wrong.
--
--  - error_log: every 5xx the Worker answers, and crashes the app reports
--    (POST /api/client-error). No personal data beyond the person's id.
--  - heartbeats: one row per run of each scheduled job: the Worker's crons,
--    the nightly backup (.github/workflows/backup.yml) and hkha-sync.
--
-- Both are kept 90 days (prune_system_health(), from the daily check).

create table public.error_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null check (source in ('worker', 'client', 'cron')),
  -- The path only, never the query string.
  route text check (char_length(route) <= 200),
  status integer,
  message text check (char_length(message) <= 500),
  -- people.api_id of the signed-in person, when known. No foreign key: the
  -- row outlives nothing (90 days) and must never block a profile removal.
  person_id text,
  -- Cloudflare's cf-ray for a Worker error.
  request_id text check (char_length(request_id) <= 100),
  detail jsonb check (detail is null or pg_column_size(detail) <= 4096)
);
create index error_log_at_idx on public.error_log (at);
-- The client-error rate limit counts one person's last hour.
create index error_log_client_person_idx on public.error_log (person_id, at) where source = 'client';

create table public.heartbeats (
  id bigint generated always as identity primary key,
  job text not null check (job ~ '^[a-z0-9-]{1,40}$'),
  ran_at timestamptz not null default now(),
  ok boolean not null,
  detail jsonb check (detail is null or pg_column_size(detail) <= 4096)
);
create index heartbeats_job_idx on public.heartbeats (job, ran_at desc);

alter table public.error_log enable row level security;
alter table public.heartbeats enable row level security;
revoke all on public.error_log, public.heartbeats from public, anon, authenticated;
grant select, insert, update, delete on public.error_log, public.heartbeats to service_role;

-- A crash the app reported, unless this person has already reported
-- p_limit in the last hour. True when it was logged. One call, so the
-- Worker's rate limit costs no extra round trip.
create function public.log_client_error(p_person text, p_route text, p_message text, p_detail jsonb, p_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.error_log
      where source = 'client' and person_id = p_person and at > now() - interval '1 hour') >= p_limit then
    return false;
  end if;
  insert into public.error_log (source, route, message, person_id, detail)
  values ('client', left(p_route, 200), left(p_message, 500), p_person, p_detail);
  return true;
end $$;

-- Everything the health check reads, in one call:
--   jobs               the latest heartbeat of each job, and its last good run
--   server_errors_24h  5xx answers in the last 24 hours
--   client_errors_24h  app crashes reported in the last 24 hours
--   sync_errors        fixtures whose match card hkha-sync failed to read
--                      in the last 7 days (older errors are no longer retried)
--   last_match_at      the latest match that started between 48 and 8 hours
--                      ago: hkha-sync should have run since it ended
create function public.system_health_snapshot()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'now', now(),
    'jobs', coalesce((
      select jsonb_agg(j order by j.job)
      from (
        select distinct on (h.job) h.job, h.ran_at, h.ok, h.detail,
               (select max(g.ran_at) from public.heartbeats g where g.job = h.job and g.ok) as last_ok_at
        from public.heartbeats h
        order by h.job, h.ran_at desc
      ) j
    ), '[]'::jsonb),
    'server_errors_24h', (select count(*) from public.error_log e
                          where e.source = 'worker' and e.status >= 500 and e.at > now() - interval '24 hours'),
    'client_errors_24h', (select count(*) from public.error_log e
                          where e.source = 'client' and e.at > now() - interval '24 hours'),
    'sync_errors', (select count(*) from public.hkha_sync_state s
                    where s.sync_status = 'Error' and s.last_scraped > now() - interval '7 days'),
    'last_match_at', (select max(m.match_date) from public.matches m
                      where m.match_date between now() - interval '48 hours' and now() - interval '8 hours'
                        and coalesce(m.match_status, '') not in ('Rescheduled', 'Cancelled', 'Postponed'))
  )
$$;

-- The 90-day rule for both tables. Returns the rows removed.
create function public.prune_system_health()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
  m integer;
begin
  delete from public.error_log where at < now() - interval '90 days';
  get diagnostics n = row_count;
  delete from public.heartbeats where ran_at < now() - interval '90 days';
  get diagnostics m = row_count;
  return n + m;
end $$;

revoke all on function public.log_client_error(text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.system_health_snapshot() from public, anon, authenticated;
revoke all on function public.prune_system_health() from public, anon, authenticated;
grant execute on function public.log_client_error(text, text, text, jsonb, integer) to service_role;
grant execute on function public.system_health_snapshot() to service_role;
grant execute on function public.prune_system_health() to service_role;
