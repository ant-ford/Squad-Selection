-- Cache versions (Track C, 7 Oct 2026): one counter per table the Worker
-- caches, bumped in the same transaction as every real change to it.
--
-- The Worker keeps reads in each isolate's memory, and Cloudflare runs many
-- isolates. A write cleared only the isolate that took it, so every other
-- isolate kept its copy until the TTL ran out (up to ~2.5 minutes through
-- the chained raw-read, season-index and players-for-match caches), and
-- writes made outside the Worker (hkha-sync) were never announced at all.
--
-- Now every write bumps its table's counter here, from a statement-level
-- trigger. The Worker reads the counters once per request
-- (read_cache_versions(), and later auth_context()) and puts them in its
-- cache keys, so a cached value is reused only while nothing it was built
-- from has changed, in every isolate, whoever wrote.
--
--  - One row per key. The row is updated under its row lock, so versions
--    follow commit order: nobody sees a version before the data it stands
--    for is visible. (A sequence would not do: nextval is visible before
--    commit.)
--  - The Worker must read the versions BEFORE (or in the same snapshot as)
--    the data it caches under them. Data read later is at least as new, so
--    the worst case is newer data under an older key, which the next
--    version simply misses.
--  - Only a real change bumps: an INSERT or DELETE that affected rows, and
--    an UPDATE whose rows differ apart from bookkeeping columns (updated_at
--    everywhere, matches.last_hkha_sync, people.last_seen_at). So a no-op
--    save or an hkha-sync pass that changes nothing keeps every cache warm.
--    The comparison is of the whole rows' multiset, so it also works for the
--    tables keyed without an id (match_selections, team_people).
--  - A function that deletes a set of rows and inserts them again (the old
--    whole-squad set_match_selection) bumps even when the squad came back
--    the same: each statement is judged on its own.
--  - shirt_numbers bumps "people": players are shown with their shirt number.
--  - Writers of one table serialise on its row until they commit
--    (milliseconds for PostgREST calls and Eddy's RPCs). Two transactions
--    that write the same two tables in opposite orders can deadlock; Postgres
--    aborts one with 40P01 and nothing is applied.

create table public.cache_versions (
  key text primary key,
  version bigint not null default 1,
  bumped_at timestamptz not null default now()
) with (fillfactor = 50);  -- room for HOT updates: these rows are rewritten constantly

insert into public.cache_versions (key) values
  ('matches'), ('match_cards'), ('match_selections'), ('availability_exceptions'), ('availability_rules'),
  ('people'), ('teams'), ('team_people'), ('offices'), ('events'), ('event_responses');

alter table public.cache_versions enable row level security;
revoke all on public.cache_versions from public, anon, authenticated;
-- update: the triggers run with the writer's rights (the service role for
-- the Worker and hkha-sync; the owner for migrations and the retention cron).
grant select, update on public.cache_versions to service_role;

-- tg_argv[0] is the cache_versions key; any further arguments are columns an
-- UPDATE may change without it counting (updated_at always). One function
-- for every event, as in the Postgres manual's transition-table example:
-- each trigger declares only the transition tables its branch reads.
create function public.cache_versions_bump() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignore text[] := array['updated_at'] || tg_argv[1:tg_nargs - 1];
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := exists (select 1 from new_rows);
  elsif tg_op = 'DELETE' then
    v_changed := exists (select 1 from old_rows);
  elsif tg_op = 'UPDATE' then
    -- The same multiset of rows (less the ignored columns) before and after:
    -- nothing a reader can see has changed.
    v_changed := exists (
      select to_jsonb(n) - v_ignore from new_rows n
      except all
      select to_jsonb(o) - v_ignore from old_rows o
    );
  else
    v_changed := true;  -- TRUNCATE
  end if;
  if v_changed then
    update public.cache_versions set version = version + 1, bumped_at = now() where key = tg_argv[0];
  end if;
  return null;
end;
$$;
revoke all on function public.cache_versions_bump() from public, anon, authenticated;

-- Four statement triggers per table. Postgres allows transition tables only
-- on single-event triggers, hence insert, update and delete separately.
do $$
declare
  t record;
  args text;
begin
  for t in
    select * from (values
      ('matches',                 'matches',                 array['last_hkha_sync']),
      ('match_cards',             'match_cards',             array[]::text[]),
      ('match_selections',        'match_selections',        array[]::text[]),
      ('availability_exceptions', 'availability_exceptions', array[]::text[]),
      ('availability_rules',      'availability_rules',      array[]::text[]),
      ('people',                  'people',                  array['last_seen_at']),
      ('shirt_numbers',           'people',                  array[]::text[]),
      ('teams',                   'teams',                   array[]::text[]),
      ('team_people',             'team_people',             array[]::text[]),
      ('offices',                 'offices',                 array[]::text[]),
      ('events',                  'events',                  array[]::text[]),
      ('event_responses',         'event_responses',         array[]::text[])
    ) as x(tbl, key, ignore)
  loop
    args := array_to_string(array(select quote_literal(a) from unnest(array[t.key] || t.ignore) as a), ', ');
    execute format(
      'create trigger %I after insert on public.%I referencing new table as new_rows '
      'for each statement execute function public.cache_versions_bump(%s)',
      t.tbl || '_cache_insert', t.tbl, args);
    execute format(
      'create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows '
      'for each statement execute function public.cache_versions_bump(%s)',
      t.tbl || '_cache_update', t.tbl, args);
    execute format(
      'create trigger %I after delete on public.%I referencing old table as old_rows '
      'for each statement execute function public.cache_versions_bump(%s)',
      t.tbl || '_cache_delete', t.tbl, args);
    execute format(
      'create trigger %I after truncate on public.%I '
      'for each statement execute function public.cache_versions_bump(%s)',
      t.tbl || '_cache_truncate', t.tbl, args);
  end loop;
end;
$$;

-- What the Worker reads where nothing else hands it the versions (calendar
-- feeds, the scheduled jobs): {"matches": 12, "people": 40, ...}. One
-- indexed scan of eleven rows.
create function public.read_cache_versions() returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, version), '{}'::jsonb) from public.cache_versions
$$;
revoke all on function public.read_cache_versions() from public, anon, authenticated;
grant execute on function public.read_cache_versions() to service_role;

-- Check after applying (read-only):
--   select key, version, bumped_at from public.cache_versions order by key;
--   select count(*) from pg_trigger where tgname like '%\_cache\_%';   -- 48
