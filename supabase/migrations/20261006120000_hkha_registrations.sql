-- HKHA registration (owner, 6 Oct 2026). The Hockey Convenor registers every
-- Active player with HockeyHK at the start of each season, and new players
-- and team changes during it. Each row records that one player was
-- registered for one team in one season, ticked off on the Convenor's
-- registration screen (worker/src/registration.ts) or by marking a new
-- joiner's registration request done.
--
-- A player "needs registering" while there is no row for this season and
-- his current registered team: a new player, an automatic re-registration
-- after play-ups (registration_events) or any other team change brings him
-- back onto the Convenor's list.

create table public.hkha_registrations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  season text not null,
  team text not null,
  registered_at timestamptz not null default now(),
  registered_by_person_id uuid references public.people (id) on delete set null,
  unique (person_id, season, team)
);
create index hkha_registrations_season_idx on public.hkha_registrations (season);
create index hkha_registrations_registered_by_idx on public.hkha_registrations (registered_by_person_id);

alter table public.hkha_registrations enable row level security;
revoke all on public.hkha_registrations from public, anon, authenticated;
grant select, insert, update, delete on public.hkha_registrations to service_role;
