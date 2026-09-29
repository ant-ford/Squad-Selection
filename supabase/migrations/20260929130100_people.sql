-- People, the offices they hold, and the per-person detail that the Airtable
-- People table kept in numbered column groups (Child 1-4, Relative 1-3, ...).
-- Field decisions: docs/migration/FIELDS.md (GATE A).

create table public.shirt_numbers (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  shirt_no integer not null unique,
  team_range text,
  -- The size of the shirt ordered for this number; an unallocated number is
  -- a spare to hand to a joiner of that size.
  stock_size text,
  gender text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,

  -- Identity & membership
  surname text,
  given_names text,
  preferred_name text,
  chinese_name text,
  registered_name text,
  salutation text,
  email text,
  gender text,
  status text,
  applicant_stage text,
  stage_updated_at timestamptz,
  applicant_type text,
  application_date timestamptz,
  join_date date,
  commitment_end_date date,
  membership_no text,
  member_type text,
  category_type text,
  sports_type text,
  active boolean not null default false,

  -- Personal details (sensitive)
  date_of_birth date,
  hkid_no text,
  passport_no text,
  nationality text,
  place_of_birth text,
  marital_status text,
  arrived_in_hk_on date,
  academic_qualifications text[] not null default '{}',
  ae_training text,
  emergency_contact text,
  emergency_contact_no text,
  medical_conditions text,

  -- Contact, address & work
  telephone_no text,
  mobile_no text,
  home_flat_type text,
  home_unit text,
  home_floor text,
  home_block text,
  home_building text,
  home_street text,
  home_district text,
  home_region text,
  company_name text,
  business_flat_type text,
  business_unit text,
  business_floor text,
  business_block text,
  business_building text,
  business_street text,
  business_district text,
  business_region text,
  work_position text,
  nature_of_business text,
  office_telephone_no text,
  office_email text,

  -- Guardian (under 18s)
  guardian_surname text,
  guardian_given_names text,
  guardian_bank_account_name text,
  guardian_email text,
  guardian_mobile_no text,

  -- Billing (sensitive)
  bill_payer text,
  bank_name text,
  bank_branch_no text,
  bank_account_no text,
  bank_contact_no text,
  bank_payment_limit text,
  bank_payment_limit_amount numeric(12, 2),
  billing_channels text[] not null default '{}',
  correspondence_channels text[] not null default '{}',

  -- Kit: one shirt number per person, unique across the club
  shirt_number_id uuid unique references public.shirt_numbers (id) on delete set null,

  -- Squad & selection
  player_coach text[] not null default '{}',
  registered_team text,
  selected_team_sos text,
  selected_team_eos text,
  previous_eos text,
  playing_position text,
  playing_level text[] not null default '{}',
  section_rank integer,
  rank_updated_at timestamptz,
  playing_ability text,
  selection_comments text,
  opt_in_only boolean not null default false,
  -- Maintained by the Hockey Convenor; read by the eligibility engine.
  is_visiting_player boolean not null default false,
  is_suspended boolean not null default false,
  matches_to_serve integer,

  -- Volunteering, committees & umpiring
  qualified_coach text,
  qualified_umpire text,
  hockey_committee_roles text[] not null default '{}',
  mens_sub_committee text[] not null default '{}',
  team_roles text[] not null default '{}',
  touring_committee text[] not null default '{}',
  junior_hockey_volunteers text[] not null default '{}',
  easter_5s_committee text[] not null default '{}',
  general_volunteers text[] not null default '{}',
  improvement_ideas text,

  -- Application & sponsor assessment (the office links are added below)
  participation_details text,
  sports_background text,
  personal_interest text,
  training_comments_sponsor text,
  sports_background_sponsor text,
  applicant_level_sponsor text,
  -- AI drafts for the sponsor, regenerated when the applicant submits.
  training_comments_draft text,
  sports_background_draft text,

  -- Waivers & declarations
  profile_updated_at timestamptz,
  waivers_signed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Email is how a person signs in, so it must be unique regardless of case.
-- (Airtable could not enforce this; the import reports clashes, never merges.)
create unique index people_email_key on public.people (lower(email)) where email is not null;
create index people_active_idx on public.people (active) where active;
create index people_applicant_stage_idx on public.people (applicant_stage) where applicant_stage is not null;
create index people_membership_no_idx on public.people (membership_no) where membership_no is not null;

-- Stage Updated At, as Airtable's last-modified field did: only when the
-- stage actually changes, and not when the writer supplies the time itself
-- (the Airtable import carries the original over).
create function public.people_stamp_stage() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.applicant_stage is not null and new.stage_updated_at is null then
      new.stage_updated_at := now();
    end if;
  elsif new.applicant_stage is distinct from old.applicant_stage
        and new.stage_updated_at is not distinct from old.stage_updated_at then
    new.stage_updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.people_stamp_stage() from public, anon, authenticated;

create trigger people_stamp_stage before insert or update of applicant_stage on public.people
  for each row execute function public.people_stamp_stage();
create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();
create trigger shirt_numbers_updated_at before update on public.shirt_numbers
  for each row execute function public.set_updated_at();

-- One table for every office that used to be its own Airtable table:
-- Sponsors, Section Chairs, Section Captains, Membership Officers, Hockey
-- Convenor, Kit Convenor. Access to officer sections depends on the role
-- (worker/src/auth.ts SECTION_OFFICES), never on the designation.
create table public.offices (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  role text not null check (role in (
    'sponsor', 'section_chair', 'section_captain', 'membership_officer', 'hockey_convenor', 'kit_convenor'
  )),
  person_id uuid references public.people (id) on delete restrict,
  designation text,
  status text not null default 'Active' check (status in ('Active', 'Retired')),
  -- The office's own mailbox where it has one (e.g. the membership inbox).
  office_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offices_person_idx on public.offices (person_id);
create index offices_role_active_idx on public.offices (role) where status = 'Active';
create trigger offices_updated_at before update on public.offices
  for each row execute function public.set_updated_at();

-- Who signs each stage of a person's application.
alter table public.people
  add column sponsored_by_sponsor_id uuid references public.offices (id) on delete set null,
  add column sponsored_by_chair_id uuid references public.offices (id) on delete set null,
  add column sponsored_by_officer_id uuid references public.offices (id) on delete set null,
  add column sponsored_by_hockey_convenor_id uuid references public.offices (id) on delete set null,
  add column sponsored_by_kit_convenor_id uuid references public.offices (id) on delete set null;
create index people_sponsored_by_sponsor_idx on public.people (sponsored_by_sponsor_id);
create index people_sponsored_by_chair_idx on public.people (sponsored_by_chair_id);
create index people_sponsored_by_officer_idx on public.people (sponsored_by_officer_id);
create index people_sponsored_by_hockey_convenor_idx on public.people (sponsored_by_hockey_convenor_id);
create index people_sponsored_by_kit_convenor_idx on public.people (sponsored_by_kit_convenor_id);

-- Spouse and children: one row each, instead of Spouse: / Child 1-4 columns.
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  relation text not null check (relation in ('spouse', 'child')),
  -- Children keep the order they were entered in (Child 1, Child 2, ...).
  ordinal smallint not null default 1,
  surname text,
  given_names text,
  chinese_name text,
  salutation text,
  date_of_birth date,
  gender text,
  hkid_no text,
  passport_no text,
  nationality text,
  email text,
  mobile_no text,
  wedding_anniversary date,
  company_name text,
  business_flat_type text,
  business_unit text,
  business_floor text,
  business_block text,
  business_building text,
  business_street text,
  business_district text,
  business_region text,
  work_position text,
  nature_of_business text,
  office_email text,
  office_telephone_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, relation, ordinal)
);
create trigger family_members_updated_at before update on public.family_members
  for each row execute function public.set_updated_at();

-- Relatives who are club members (Relative 1-3).
create table public.relatives (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  ordinal smallint not null default 1,
  name text,
  membership_no text,
  relationship text,
  created_at timestamptz not null default now(),
  unique (person_id, ordinal)
);

-- Other private clubs the applicant belongs to (Club 1-4).
create table public.previous_clubs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  ordinal smallint not null default 1,
  club text,
  since_year smallint,
  created_at timestamptz not null default now(),
  unique (person_id, ordinal)
);

-- Trials the applicant attended before applying (Trial 1-5).
create table public.applicant_trials (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  ordinal smallint not null default 1,
  trial_date date,
  participation_types text[] not null default '{}',
  highest_division text,
  created_at timestamptz not null default now(),
  unique (person_id, ordinal)
);

-- Hockey Rules Quiz scores: one row per person per quiz.
create table public.quiz_scores (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  quiz text not null,
  score numeric(6, 2),
  taken_at timestamptz,
  created_at timestamptz not null default now(),
  unique (person_id, quiz)
);

-- Kit sizes per supplier (Kukri today, Tsunami where labelled), so a new
-- supplier is new rows rather than new columns.
create table public.kit_sizes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  supplier text not null,
  item text not null,
  size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, supplier, item)
);
create trigger kit_sizes_updated_at before update on public.kit_sizes
  for each row execute function public.set_updated_at();

-- Season planning: expressions of interest that start empty each season.
create table public.season_plans (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  season text not null check (season ~ '^\d{4}-\d{4}$'),
  playing_availability text[] not null default '{}',
  tournament_interest text[] not null default '{}',
  tour_interest text[] not null default '{}',
  trials_availability text[] not null default '{}',
  playing_preference text,
  captaincy_interest text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, season)
);
create index season_plans_season_idx on public.season_plans (season);
create trigger season_plans_updated_at before update on public.season_plans
  for each row execute function public.set_updated_at();

-- The choices offered in a season's plan (tournament dates, tours, trial
-- dates), set by the captain each season rather than fixed in code.
create table public.season_plan_options (
  id uuid primary key default gen_random_uuid(),
  season text not null check (season ~ '^\d{4}-\d{4}$'),
  question text not null,
  option text not null,
  ordinal smallint not null default 1,
  created_at timestamptz not null default now(),
  unique (season, question, option)
);

-- Course sign-ups and attendance (umpire courses first).
create table public.course_signups (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  course text not null,
  signed_up text,
  attended text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, course)
);
create trigger course_signups_updated_at before update on public.course_signups
  for each row execute function public.set_updated_at();
