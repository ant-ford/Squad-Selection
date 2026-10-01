-- Registering interest to join (owner, 2026-10-01), replacing the trials
-- registration form: any member shares a link; whoever registers confirms
-- their email, becomes an applicant at "1. Trial Application" and fills
-- in the old trial form's questions on Eddy's applicant page.
--
--  - Before the season there are trial sessions, which the Section
--    Captains keep up to date; a registrant says which they can come to.
--  - Once the season has started there are none: the Section Captains
--    decide who is invited to a practice trial (players for the Premier
--    League or Division 1 teams, perhaps umpires), and the Assistant
--    Director of Hockey and that team's coach are told.

create table public.trial_sessions (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  place text not null,
  notes text,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index trial_sessions_starts_idx on public.trial_sessions (starts_at);
create index trial_sessions_created_by_idx on public.trial_sessions (created_by);

-- Which sessions a registrant can come to.
create table public.trial_availability (
  person_id uuid not null references public.people (id) on delete cascade,
  session_id uuid not null references public.trial_sessions (id) on delete cascade,
  primary key (person_id, session_id)
);
create index trial_availability_session_idx on public.trial_availability (session_id);

alter table public.people
  -- The member whose link they registered through.
  add column referred_by_id uuid references public.people (id) on delete set null,
  -- When they finished registering their interest.
  add column trial_registered_at timestamptz;
create index people_referred_by_idx on public.people (referred_by_id);

alter table public.trial_sessions enable row level security;
alter table public.trial_availability enable row level security;
revoke all on public.trial_sessions, public.trial_availability from public, anon, authenticated;
grant select, insert, update, delete on public.trial_sessions, public.trial_availability to service_role;
