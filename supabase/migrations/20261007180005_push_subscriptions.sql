-- Web Push (6 Oct 2026 review, item D7): personal alerts on a phone or
-- computer that has said yes to notifications. One row per device (its
-- push endpoint), belonging to one person: a device signed in by someone
-- else moves to them. The Worker reads it fresh for each send (never
-- cached, so no cache_versions counter), and deletes a row when the push
-- service answers 404 or 410 (the device unsubscribed or went away).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  endpoint text not null unique,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  updated_at timestamptz not null default now()
);
create index push_subscriptions_person_idx on public.push_subscriptions (person_id);
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- The 13-month removal and "Delete my profile" keep the People row
-- (erase_personal_data blanks it and stamps personal_data_removed_at), so
-- the cascade above doesn't fire. This trigger removes their devices when
-- that stamp is set, without redefining erase_personal_data.
create function public.push_subscriptions_erase() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.push_subscriptions where person_id = new.id;
  return new;
end;
$$;
revoke all on function public.push_subscriptions_erase() from public, anon, authenticated;
create trigger people_erase_push_subscriptions
  after update of personal_data_removed_at on public.people
  for each row
  when (new.personal_data_removed_at is not null and old.personal_data_removed_at is distinct from new.personal_data_removed_at)
  execute function public.push_subscriptions_erase();
