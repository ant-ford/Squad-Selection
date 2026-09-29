-- Foundations for Eddy's data in Postgres (moving off Airtable, October 2026).
--
-- Access model: only the Cloudflare Worker reads and writes these tables,
-- with the service role, which bypasses RLS. Every table has RLS enabled and
-- NO policies, and the anon / authenticated roles are refused outright, so
-- the public anon key (it ships in the web app) opens nothing. Adding a
-- policy is a design change for the owner to approve.
--
-- Keys: uuid primary keys, plus airtable_id (unique, nullable) on every table
-- that came from Airtable, so an import can be re-run as an upsert and every
-- row can be traced back while Airtable still exists. The API keeps using the
-- Airtable id for imported rows (calendar feed links are signed over it).

-- Nothing created in public from here on is readable by anon/authenticated
-- unless granted explicitly. Supabase's defaults grant them everything.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- updated_at, maintained by the database rather than by every caller.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- Raw copy of every Airtable record, kept until the owner removes it after
-- Airtable closes (20 Oct 2026). Values the typed tables drop still exist
-- here. Not in an API-exposed schema: PostgREST cannot see it at all.
create schema archive;
revoke all on schema archive from public, anon, authenticated;
grant usage on schema archive to service_role;

create table archive.airtable_records (
  airtable_id text primary key,
  table_id text not null,
  table_name text not null,
  created_time timestamptz,
  fields jsonb not null,
  imported_at timestamptz not null default now()
);
create index airtable_records_table_idx on archive.airtable_records (table_name);
alter table archive.airtable_records enable row level security;
revoke all on archive.airtable_records from public, anon, authenticated;
grant select, insert, update, delete on archive.airtable_records to service_role;
