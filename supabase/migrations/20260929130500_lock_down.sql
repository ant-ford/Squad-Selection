-- Every table and view in public: RLS on, no policies, and nothing for the
-- anon or authenticated roles. The Worker's service role is the only way in.
-- A later migration that adds a table must do the same for it; the security
-- advisor (splinter) is run after every migration to catch one that doesn't.
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  loop
    if r.relkind in ('r', 'p') then
      execute format('alter table %s enable row level security', r.rel);
    end if;
    execute format('revoke all on %s from anon, authenticated', r.rel);
    execute format('grant select, insert, update, delete on %s to service_role', r.rel);
  end loop;
end;
$$;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;
