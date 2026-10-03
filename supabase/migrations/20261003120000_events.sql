-- Special events (owner, 3 Oct 2026): trials, social functions, team
-- socials, tournaments and tours, alongside the fixtures (friendlies stay
-- fixtures). A light addition: an event has a poster, the details people
-- need and who's invited; members say Going, Maybe or Not going, for
-- themselves and for other players, with +1 guests.
--
--  - Social secretaries keep them: a team's own (team_people role
--    social_secretary) for that team, and the overall Social Secretary
--    (offices role social_secretary) and the Section Captains for any.
--  - Who's invited is a filter over the chairman's email-list groups
--    (shared/emailLists.ts), worked out when read, so someone joining a team
--    later is invited too.
--  - Unanswered is not Going (unlike fixtures). Answers can change until
--    the deadline. Whoever signs someone up pays for them (signed_up_by_id).

alter table public.team_people drop constraint team_people_role_check;
alter table public.team_people add constraint team_people_role_check
  check (role in ('coach', 'team_captain', 'section_captain', 'auto_select', 'social_secretary'));

alter table public.offices drop constraint offices_role_check;
alter table public.offices add constraint offices_role_check
  check (role in ('sponsor', 'section_chair', 'section_captain', 'membership_officer', 'hockey_convenor', 'kit_convenor', 'social_secretary'));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('trial', 'social_function', 'team_social', 'tournament', 'tour')),
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- Answers can change until then; none means until it starts.
  respond_by timestamptz,
  member_price numeric(8, 2) check (member_price >= 0),
  guest_adult_price numeric(8, 2) check (guest_adult_price >= 0),
  guest_child_price numeric(8, 2) check (guest_child_price >= 0),
  payment_mode text not null default 'free' check (payment_mode in ('free', 'on_the_night', 'payme_fps', 'account')),
  guests_allowed boolean not null default false,
  max_guests smallint check (max_guests between 1 and 10),
  -- What help is wanted ("3 for the BBQ and setting up"); none: no "I can help".
  help_needed text,
  -- Which of the commitment social functions it is (shared/commitmentReview.ts SOCIAL_FUNCTIONS).
  social_function text check (social_function in ('Start of Season', 'Christmas Party', 'End of Season', 'Hockey Section AGM')),
  -- A team's own event (its social secretary keeps it); none: club-wide.
  team_id uuid references public.teams (id) on delete set null,
  -- The email-list groups invited: {groupKey: [values]}; {} is everyone.
  audience jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check (social_function is null or event_type = 'social_function')
);
create index events_starts_idx on public.events (starts_at);
create index events_team_idx on public.events (team_id);
create index events_created_by_idx on public.events (created_by);
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

create table public.event_responses (
  event_id uuid not null references public.events (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  status text not null check (status in ('going', 'maybe', 'not_going')),
  -- Who signed them up, and so pays; none: they answered themselves.
  signed_up_by_id uuid references public.people (id) on delete set null,
  -- Their +1s: [{name, age: adult|child, dietary}].
  guests jsonb not null default '[]',
  can_help boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, person_id)
);
create index event_responses_person_idx on public.event_responses (person_id);
create index event_responses_signed_up_by_idx on public.event_responses (signed_up_by_id);
create trigger event_responses_updated_at before update on public.event_responses
  for each row execute function public.set_updated_at();

-- The poster: the newest 'event_poster' file on the event.
alter table public.files add column event_id uuid references public.events (id) on delete cascade;
create index files_event_idx on public.files (event_id);
alter table public.files drop constraint files_check;
alter table public.files add constraint files_check
  check (num_nonnulls(person_id, family_member_id, commitment_id, event_id) >= 1);

alter table public.events enable row level security;
alter table public.event_responses enable row level security;
revoke all on public.events, public.event_responses from public, anon, authenticated;
grant select, insert, update, delete on public.events, public.event_responses to service_role;
