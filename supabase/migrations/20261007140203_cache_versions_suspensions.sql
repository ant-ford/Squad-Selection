-- Cache versions for the Men's Convenor's suspensions (Track C, 7 Oct 2026).
--
-- The season index, which decides who is eligible, now reads the open
-- suspensions too (20261007130203_suspensions.sql). The Worker keys it on
-- the cache versions of the tables it is built from
-- (20261007140003_cache_versions.sql), so suspensions needs a counter of its
-- own: without one, a new or cleared suspension would show only after some
-- other tracked table changed. Same rules as the others: statement
-- triggers, bumping only on a real change (updated_at ignored).

insert into public.cache_versions (key) values ('suspensions')
on conflict (key) do nothing;

do $$
declare
  t record;
  args text;
begin
  for t in
    select * from (values
      ('suspensions',             'suspensions',             array[]::text[])
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

-- Check after applying (read-only):
--   select version from public.cache_versions where key = 'suspensions';
--   select count(*) from pg_trigger where tgname like 'suspensions\_cache\_%';   -- 4
