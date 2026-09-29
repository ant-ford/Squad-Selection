-- Commitment reviews, the WhatsApp mail merge, and the platform tables the
-- new flows need: files, signatures, the activity log, the email log and
-- process steps (who a new-joiner or commitment step is waiting on).

-- One row per member per commitment year, with the three-stage review.
create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  person_id uuid references public.people (id) on delete cascade,
  year_no smallint,
  period_start date,
  period_end date,
  review_progress text,
  review_progress_updated_at timestamptz,
  sponsor_office_id uuid references public.offices (id) on delete set null,
  membership_officer_office_id uuid references public.offices (id) on delete set null,

  -- Attendance, as recorded for the review (history; the open period is
  -- also computed live from match cards and availability).
  matches_played integer,
  matches_available_not_played integer,
  matches_not_available integer,
  matches_team_played integer,
  teams_played text[] not null default '{}',

  -- Member's report
  games_umpired text,
  practices text,
  social_functions text[] not null default '{}',
  other_contributions text,
  section_service_member text,
  hkfc_service_member text,
  low_participation_reason text,
  member_submitted_at timestamptz,

  -- Sponsor's review
  section_service_sponsor text,
  hkfc_service_sponsor text,
  recommendation_sponsor text,
  sponsor_submitted_at timestamptz,

  -- Membership Officer's review
  players_available_for_team integer,
  optimum_players_for_team integer,
  is_player_needed_officer text,
  other_comments_officer text,
  other_information_officer text,
  recommended_reduction text,
  officer_submitted_at timestamptz,

  -- AI drafts, regenerated when the previous person submits so they are
  -- ready for the next. Suggestions only; the reviewer's own fields above
  -- are what the review says.
  section_service_draft text,
  hkfc_service_draft text,
  recommendation_draft text,
  is_player_needed_draft text,
  other_comments_draft text,
  other_information_draft text,
  outcome_email_draft text,
  drafts_generated_at timestamptz,
  drafts_model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commitments_person_idx on public.commitments (person_id);
create index commitments_period_end_idx on public.commitments (period_end);
create index commitments_review_idx on public.commitments (review_progress);
create index commitments_sponsor_idx on public.commitments (sponsor_office_id);
create index commitments_officer_idx on public.commitments (membership_officer_office_id);

create function public.commitments_stamp_review() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.review_progress_updated_at is null then
      new.review_progress_updated_at := now();
    end if;
  elsif new.review_progress is distinct from old.review_progress then
    new.review_progress_updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.commitments_stamp_review() from public, anon, authenticated;
create trigger commitments_stamp_review before insert or update of review_progress on public.commitments
  for each row execute function public.commitments_stamp_review();
create trigger commitments_updated_at before update on public.commitments
  for each row execute function public.set_updated_at();

-- The captain's WhatsApp mail merge: templates with {placeholders}, filled
-- per person when sent, and a log of what went to whom.
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  name text not null,
  body text,
  -- Kept from Airtable; purpose to confirm with the owner.
  masters_o40_team text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();

create table public.message_log (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  person_id uuid references public.people (id) on delete set null,
  template_id uuid references public.message_templates (id) on delete set null,
  message text,
  mobile_no text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index message_log_person_idx on public.message_log (person_id);
create index message_log_template_idx on public.message_log (template_id);

-- Every stored document: photos, ID scans, certificates, signatures and
-- generated PDFs. The bytes live in the private R2 bucket under a key that
-- carries no personal data; the Worker serves them through short-lived
-- signed links after an access check.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  r2_key text not null unique,
  kind text not null,
  person_id uuid references public.people (id) on delete cascade,
  family_member_id uuid references public.family_members (id) on delete cascade,
  commitment_id uuid references public.commitments (id) on delete cascade,
  filename text,
  content_type text,
  bytes bigint,
  sha256 text,
  -- The Airtable attachment id (att...) it was imported from: re-running the
  -- import skips files it already copied.
  airtable_attachment_id text unique,
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, family_member_id, commitment_id) >= 1)
);
create index files_person_idx on public.files (person_id, kind);
create index files_family_member_idx on public.files (family_member_id);
create index files_commitment_idx on public.files (commitment_id);

-- A signature given on a document: who signed, as what, for whom, when.
create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files (id) on delete restrict,
  signer_person_id uuid references public.people (id) on delete set null,
  signer_role text not null,
  document text not null,
  subject_person_id uuid references public.people (id) on delete cascade,
  commitment_id uuid references public.commitments (id) on delete cascade,
  signed_at timestamptz not null default now()
);
create index signatures_file_idx on public.signatures (file_id);
create index signatures_signer_idx on public.signatures (signer_person_id);
create index signatures_subject_idx on public.signatures (subject_person_id);
create index signatures_commitment_idx on public.signatures (commitment_id);

-- Who did what to which record, when. Field NAMES only, never values: this
-- is read by officers and must not become a second copy of personal data.
create table public.activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_person_id uuid references public.people (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  fields text[] not null default '{}',
  airtable_id text unique
);
create index activity_log_occurred_idx on public.activity_log (occurred_at desc);
create index activity_log_entity_idx on public.activity_log (entity, entity_id);
create index activity_log_actor_idx on public.activity_log (actor_person_id);

-- Every email Eddy sends, by recipient record rather than address.
create table public.email_log (
  id bigint generated always as identity primary key,
  sent_at timestamptz not null default now(),
  to_person_id uuid references public.people (id) on delete set null,
  sender text not null,
  template text not null,
  step_id uuid,
  provider_message_id text,
  status text not null default 'sent',
  error text
);
create index email_log_person_idx on public.email_log (to_person_id);

-- A step in a process (new joiner, commitment review) and who it waits on.
-- Starting one sends one email; its My Tasks line shows until done_at.
create table public.steps (
  id uuid primary key default gen_random_uuid(),
  process text not null check (process in ('new_joiner', 'commitment_review')),
  step text not null,
  person_id uuid references public.people (id) on delete cascade,
  commitment_id uuid references public.commitments (id) on delete cascade,
  waiting_on_person_id uuid references public.people (id) on delete set null,
  waiting_on_role text,
  started_at timestamptz not null default now(),
  done_at timestamptz,
  done_by_person_id uuid references public.people (id) on delete set null
);
create index steps_open_waiting_idx on public.steps (waiting_on_person_id) where done_at is null;
create index steps_person_idx on public.steps (person_id);
create index steps_commitment_idx on public.steps (commitment_id);
create index steps_done_by_idx on public.steps (done_by_person_id);
alter table public.email_log
  add constraint email_log_step_fkey foreign key (step_id) references public.steps (id) on delete set null;
create index email_log_step_idx on public.email_log (step_id);
