-- Data retention without the Airtable archive, the newer tables in the
-- removal, and R2 files kept 35 days after release (6 Oct 2026). Follows
-- 20261002160000_data_retention.sql; docs/DATA_RETENTION.md.
--
--  1. retention_stamp() and erase_personal_data() read
--     archive.airtable_records, which Postgres doesn't track. Dropping the
--     archive schema (planned after 20 Oct) would have broken the nightly
--     job and "Delete my profile" for every imported person. The one value
--     the stamp took from it, the Airtable creation time of people who
--     arrived inactive, is copied into people.inactive_since now; afterwards
--     neither function needs the archive, and erase only clears a person's
--     raw copy while the table still exists.
--  2. The removal now also covers the event tables added since: guest names
--     and dietary needs, question answers and notes on event responses, and
--     the payment reference read from a proof (the proof file itself goes
--     with their other files). Attendance, guest counts and amounts stay, so
--     an event's bill and register stay whole.
--  3. Umpiring a duty and answering an event count as activity.
--  4. R2 objects released by a removal are deleted 35 days later, not at
--     once: daily database backups are kept 35 days (docs/RESTORE.md), and a
--     restored backup must not point at files that are gone.
--
-- tests/retentionCoverage.test.ts lists every foreign key to public.people
-- and fails until each is classified as erased here or kept on purpose.

-- ── 1. Copy what the stamp needed from the archive ───────────────────────
-- The same stamp retention_stamp() gave until now, for anyone still
-- inactive without one. Idempotent; without the archive, the creation date
-- here (the import date for imported people) is used, as before.
do $$
begin
  if to_regclass('archive.airtable_records') is not null then
    execute $sql$
      update public.people p
      set inactive_since = coalesce(
        (select a.created_time from archive.airtable_records a where a.airtable_id = p.airtable_id),
        p.created_at)
      where not p.active and p.inactive_since is null
    $sql$;
  else
    update public.people p
    set inactive_since = p.created_at
    where not p.active and p.inactive_since is null;
  end if;
end;
$$;

-- People already inactive when they arrive (a new applicant, an import) have
-- no stamp yet. The daily run gives them one: when the row was created here.
-- The Airtable creation times were copied in above, so this no longer reads
-- the archive.
create or replace function public.retention_stamp() returns integer
language sql
set search_path = ''
as $$
  with stamped as (
    update public.people p
    set inactive_since = p.created_at
    where not p.active and p.inactive_since is null
    returning 1
  )
  select count(*)::integer from stamped;
$$;

-- ── 2. Who is due: umpiring and events count as activity ─────────────────
-- As in 20261002160000, plus the last confirmed umpiring duty and the last
-- event answer (a club umpire need not be an Active player). Same columns,
-- so retention_due_v carries on unchanged.
create or replace view public.retention_schedule_v with (security_invoker = true) as
select p.id,
       p.api_id,
       concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.given_names), p.surname) as name,
       p.inactive_since,
       la.last_activity,
       (la.last_activity + interval '13 months')::date as due_on
from public.people p
cross join lateral (
  select greatest(
    p.inactive_since,
    p.stage_updated_at,
    p.application_date,
    p.profile_updated_at,
    p.waivers_signed_at,
    p.volunteering_updated_at,
    p.trial_registered_at,
    p.join_date::timestamptz,
    p.commitment_end_date::timestamptz,
    (select max(m.match_date) from public.match_cards mc join public.matches m on m.id = mc.match_id where mc.person_id = p.id),
    (select max(m.match_date) from public.match_selections ms join public.matches m on m.id = ms.match_id where ms.person_id = p.id),
    (select max(ae.updated_at) from public.availability_exceptions ae where ae.person_id = p.id),
    (select max(ar.updated_at) from public.availability_rules ar where ar.person_id = p.id),
    (select max(greatest(c.period_end::timestamptz, c.member_submitted_at)) from public.commitments c where c.person_id = p.id),
    (select max(a.submitted_at) from public.applications a where a.person_id = p.id),
    (select max(d.signed_at) from public.declarations d where d.person_id = p.id),
    (select max(ud.match_date) from public.umpire_assignments ua join public.umpire_duties ud on ud.id = ua.duty_id
      where ua.person_id = p.id and ua.status = 'confirmed'),
    (select max(er.updated_at) from public.event_responses er where er.person_id = p.id)
  ) as last_activity
) la
where not p.active
  and p.inactive_since is not null
  -- Removed already, unless they came back and have left again since.
  and (p.personal_data_removed_at is null or la.last_activity > p.personal_data_removed_at)
  and not exists (select 1 from public.offices o where o.person_id = p.id and o.status = 'Active')
  and not exists (
    select 1 from public.team_people tp join public.teams t on t.id = tp.team_id
    where tp.person_id = p.id and tp.role in ('coach', 'section_captain', 'team_captain') and t.active)
  and not exists (
    select 1 from public.steps s
    where s.done_at is null and (s.waiting_on_person_id = p.id or s.person_id = p.id));

-- ── 3. R2 objects wait 35 days ───────────────────────────────────────────
-- A key is queued when its last files row goes; the Worker deletes the
-- object once delete_after has passed (worker/src/retention.ts). Rows
-- already queued count from when they were queued.
alter table public.r2_deletions add column delete_after timestamptz;
update public.r2_deletions set delete_after = queued_at + interval '35 days' where delete_after is null;
alter table public.r2_deletions
  alter column delete_after set default now() + interval '35 days',
  alter column delete_after set not null;
create index r2_deletions_delete_after_idx on public.r2_deletions (delete_after);

-- ── 4. Removing one person's personal data ───────────────────────────────
-- As in 20261002160000, with the event tables added and the archive read
-- only while it exists. Every other table that refers to a person is listed,
-- with why it stays, in tests/retentionCoverage.test.ts.
create or replace function public.erase_personal_data(p_person uuid, p_action text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.people;
  v_files uuid[];
  v_keys text[];
  v_commitments uuid[];
begin
  select * into v_person from public.people where id = p_person for update;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), '{}') into v_commitments from public.commitments where person_id = p_person;

  -- Their files: filed on them (including event payment proofs), their
  -- family or their commitment reviews, or attached to their applications
  -- and declarations.
  select coalesce(array_agg(distinct f.id), '{}') into v_files
  from public.files f
  where f.person_id = p_person
     or f.family_member_id in (select id from public.family_members where person_id = p_person)
     or f.commitment_id = any (v_commitments)
     or f.id in (
       select unnest(array[a.signature_file_id, a.spouse_signature_file_id, a.guardian_signature_file_id,
                           a.guardian_account_signature_file_id, a.pdf_file_id])
       from public.applications a where a.person_id = p_person
       union
       select d.guardian_signature_file_id from public.declarations d where d.person_id = p_person);

  -- Signatures hold their file with "restrict": go first. That includes the
  -- record of a signature they gave on someone else's form; that form keeps
  -- who signed and when (sponsor_signed_by / sponsor_signed_at).
  delete from public.signatures
  where file_id = any (v_files) or subject_person_id = p_person or signer_person_id = p_person
     or commitment_id = any (v_commitments);

  -- Separate statements: within one, the existence check would still see
  -- the rows being deleted. A key another files row still uses is kept.
  -- The object itself goes 35 days later (r2_deletions.delete_after).
  select coalesce(array_agg(distinct r2_key), '{}') into v_keys from public.files where id = any (v_files);
  delete from public.files where id = any (v_files);
  insert into public.r2_deletions (r2_key)
  select k from unnest(v_keys) k
  where not exists (select 1 from public.files f where f.r2_key = k)
  on conflict (r2_key) do nothing;

  delete from public.applications where person_id = p_person;
  delete from public.declarations where person_id = p_person;
  delete from public.commitments where person_id = p_person;
  delete from public.steps where person_id = p_person;
  delete from public.family_members where person_id = p_person;
  delete from public.relatives where person_id = p_person;
  delete from public.previous_clubs where person_id = p_person;
  delete from public.applicant_trials where person_id = p_person;
  delete from public.quiz_scores where person_id = p_person;
  delete from public.kit_sizes where person_id = p_person;
  delete from public.season_plans where person_id = p_person;
  delete from public.course_signups where person_id = p_person;
  delete from public.trial_availability where person_id = p_person;
  delete from public.availability_exceptions where person_id = p_person;
  delete from public.availability_rules where person_id = p_person;
  delete from public.ranking_events where person_id = p_person;
  delete from public.message_log where person_id = p_person;
  delete from public.team_people where person_id = p_person;

  -- Their event answers: guest names and dietary needs, answers and notes
  -- go; whether they (and how many guests, adult or child) went and were
  -- charged stays, so the event's bill and register stay whole.
  update public.event_responses r set
    guests = coalesce((
      select jsonb_agg(jsonb_build_object('name', 'Guest', 'age', coalesce(g -> 'age', '"adult"'::jsonb)))
      from jsonb_array_elements(case jsonb_typeof(r.guests) when 'array' then r.guests else '[]'::jsonb end) g), '[]'::jsonb),
    answers = '{}'::jsonb,
    notes = null
  where r.person_id = p_person;

  -- Their event payments: the proof file went above (file_id is now null);
  -- what was read from it about their bank or PayMe transaction goes too.
  -- What was owed, paid and confirmed stays, as the event's accounts.
  update public.event_payments set reference = null, payee = null
  where payer_id = p_person;

  -- The raw Airtable copy of their People record, while the archive exists.
  -- Dynamic, so this compiles and runs once the archive schema is dropped.
  if v_person.airtable_id is not null and to_regclass('archive.airtable_records') is not null then
    execute 'delete from archive.airtable_records where airtable_id = $1' using v_person.airtable_id;
  end if;

  -- Their sign-in account (the data and sign-in projects are the same one
  -- in production). Not fatal: the email is cleared below either way.
  if v_person.email is not null then
    begin
      delete from auth.users where lower(email) = lower(v_person.email);
    exception when others then
      raise warning 'remove_personal_data: sign-in account not removed (%)', sqlstate;
    end;
  end if;

  update public.people set
    salutation = null, email = null, membership_no = null,
    date_of_birth = null, hkid_no = null, passport_no = null, nationality = null, place_of_birth = null,
    marital_status = null, arrived_in_hk_on = null, academic_qualifications = '{}', ae_training = null,
    emergency_contact = null, emergency_contact_no = null, medical_conditions = null,
    telephone_no = null, mobile_no = null,
    home_flat_type = null, home_unit = null, home_floor = null, home_block = null,
    home_building = null, home_street = null, home_district = null, home_region = null,
    company_name = null, business_flat_type = null, business_unit = null, business_floor = null,
    business_block = null, business_building = null, business_street = null, business_district = null,
    business_region = null, work_position = null, nature_of_business = null,
    office_telephone_no = null, office_email = null,
    guardian_surname = null, guardian_given_names = null, guardian_bank_account_name = null,
    guardian_email = null, guardian_mobile_no = null,
    bill_payer = null, bank_name = null, bank_branch_no = null, bank_account_no = null,
    bank_contact_no = null, bank_payment_limit = null, bank_payment_limit_amount = null,
    billing_channels = '{}', correspondence_channels = '{}',
    shirt_number_id = null,
    playing_level = '{}', section_rank = null, rank_updated_at = null, playing_ability = null,
    selection_comments = null, opt_in_only = false, is_suspended = false, matches_to_serve = null,
    qualified_coach = null, qualified_umpire = null,
    hockey_committee_roles = '{}', mens_sub_committee = '{}', team_roles = '{}', touring_committee = '{}',
    junior_hockey_volunteers = '{}', easter_5s_committee = '{}', general_volunteers = '{}',
    improvement_ideas = null,
    participation_details = null, sports_background = null, personal_interest = null,
    training_comments_sponsor = null, sports_background_sponsor = null, applicant_level_sponsor = null,
    training_comments_draft = null, sports_background_draft = null,
    personal_data_removed_at = now()
  where id = p_person;

  -- Field names only, as everywhere in the activity log.
  insert into public.activity_log (action, entity, entity_id, fields)
  values (p_action, 'people', p_person, array['personal details', 'files', 'sign-in']);
end;
$$;

-- The same privileges as 20261002160000 (create or replace keeps them; set
-- again so this file reads on its own).
revoke all on public.retention_schedule_v from public, anon, authenticated;
grant select on public.retention_schedule_v to service_role;
revoke all on function public.retention_stamp() from public, anon, authenticated;
grant execute on function public.retention_stamp() to service_role;
revoke all on function public.erase_personal_data(uuid, text) from public, anon, authenticated, service_role;
