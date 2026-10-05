-- Umpiring duties (owner, 6 Oct 2026). HKHA gives each game two umpiring
-- slots, and a slot is often a club's duty ("HKFC F"), in other clubs'
-- games as much as our own. George Lam, the Umpire Coordinator, fills
-- HKFC's duties each week from the club's umpires, and pays an umpire for
-- any gap.
--
--  - hkha-sync writes every slot whose duty team is an HKFC team, read from
--    the all-clubs fixture page, into umpire_duties. They are not matches:
--    other clubs' games stay out of the fixture lists, selection and stats.
--  - A club umpire puts their name down. Unpaid (anyone still on their
--    commitment, or anyone happy to do it free) is confirmed at once; paid
--    (only once the commitment has ended) waits for the coordinator, so a
--    free umpire can still take the game first.
--  - The coordinator can confirm, assign anyone, or add an outside umpire by
--    name. Paid is a flag only: no fee is recorded.
--  - Other clubs' match cards can't be read, so a confirmed umpire counts as
--    having umpired unless the coordinator marks a no-show.

alter table public.offices drop constraint offices_role_check;
alter table public.offices add constraint offices_role_check
  check (role in ('sponsor', 'section_chair', 'section_captain', 'membership_officer', 'hockey_convenor', 'kit_convenor',
                  'social_secretary', 'assistant_director', 'umpire_coordinator'));

create or replace view public.api_offices with (security_invoker = true) as
  select o.api_id as id,
         case o.role when 'membership_officer' then 'membershipOfficer' when 'section_chair' then 'sectionChair'
                     when 'section_captain' then 'sectionCaptain' when 'sponsor' then 'sponsor'
                     when 'hockey_convenor' then 'hockeyConvenor' when 'kit_convenor' then 'kitConvenor'
                     when 'assistant_director' then 'assistantDirector'
                     when 'umpire_coordinator' then 'umpireCoordinator' end as office,
         o.designation, o.status, p.api_id as member
  from public.offices o
  left join public.people p on p.id = o.person_id;

-- One HKFC umpiring slot. duty_key is "yyyy-mm-dd|home|away|slot" (the
-- matches.match_key plus the slot), so a change of duty team or time updates
-- the row. A slot that leaves HKHA's list (moved to another date, or given
-- to another club) is marked cancelled by the next sync, never deleted, so
-- anyone already down for it can be told.
create table public.umpire_duties (
  id uuid primary key default gen_random_uuid(),
  duty_key text not null unique,
  -- HK time; a TBC time is midnight, as in matches.
  match_date timestamptz not null,
  time_tbc boolean not null default false,
  division text,
  venue text,
  home_team text not null,
  away_team text not null,
  slot smallint not null check (slot in (1, 2)),
  duty_team text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'rescheduled', 'cancelled')),
  last_hkha_sync timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index umpire_duties_date_idx on public.umpire_duties (match_date);
create trigger umpire_duties_updated_at before update on public.umpire_duties
  for each row execute function public.set_updated_at();

-- Who umpires a slot: a club umpire (person_id) or an outside umpire the
-- coordinator names (external_name).
--   offered    a paid offer waiting for the coordinator; once the slot is
--              confirmed to someone else it stays as a reserve
--   confirmed  umpiring it
--   withdrawn  pulled out, or taken off by the coordinator
--   no_show    confirmed but didn't umpire (the coordinator marks it)
create table public.umpire_assignments (
  id uuid primary key default gen_random_uuid(),
  duty_id uuid not null references public.umpire_duties (id) on delete cascade,
  -- A deleted profile takes its umpiring history with it.
  person_id uuid references public.people (id) on delete cascade,
  external_name text check (external_name is null or btrim(external_name) <> ''),
  paid boolean not null default false,
  status text not null check (status in ('offered', 'confirmed', 'withdrawn', 'no_show')),
  -- Who put them down: themselves, or the coordinator.
  created_by uuid references public.people (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(person_id, external_name) = 1),
  check (external_name is null or paid)
);
-- One umpire per slot, and one live entry per person per slot.
create unique index umpire_assignments_one_per_slot on public.umpire_assignments (duty_id)
  where status in ('confirmed', 'no_show');
create unique index umpire_assignments_one_per_person on public.umpire_assignments (duty_id, person_id)
  where status in ('offered', 'confirmed', 'no_show') and person_id is not null;
create index umpire_assignments_person_idx on public.umpire_assignments (person_id);
create index umpire_assignments_created_by_idx on public.umpire_assignments (created_by);
create trigger umpire_assignments_updated_at before update on public.umpire_assignments
  for each row execute function public.set_updated_at();

alter table public.umpire_duties enable row level security;
alter table public.umpire_assignments enable row level security;
revoke all on public.umpire_duties, public.umpire_assignments from public, anon, authenticated;
grant select, insert, update, delete on public.umpire_duties, public.umpire_assignments to service_role;
