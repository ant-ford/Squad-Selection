-- Data retention: a person's personal details are removed 13 months after
-- they were last active in the section (owner decision, 2 Oct 2026: a
-- season's break plus a month, so someone who sat out the season before
-- can come back without starting from scratch). A person can also delete
-- their own profile at any time (delete_own_profile, the same removal).
--
-- What stays is the club's playing record: their name, gender, teams,
-- position, membership dates and every appearance, selection and match
-- card. Everything else about them goes: contact, address, work, ID and
-- bank details, family, guardian, medical, applications, declarations,
-- commitment reviews, availability, rankings and selection notes, kit
-- sizes, season plans, volunteering, quiz scores, their files (photos, ID
-- scans, signatures, PDFs), their sign-in account and their raw Airtable
-- copy. Encrypted backups age out on their own (35 days daily, 400 days
-- monthly; docs/RESTORE.md).
--
-- The Worker's cron runs it (worker/src/retention.ts): retention_stamp(),
-- then remove_personal_data() for each person retention_due_v lists, then
-- deletes the R2 objects queued in r2_deletions.
--
-- Also here: people.hkid_hidden, for members who would rather the app
-- neither showed nor asked for their HKID (set by the owner only).

-- ── When someone stopped being active ────────────────────────────────────
alter table public.people
  add column inactive_since timestamptz,
  add column personal_data_removed_at timestamptz,
  -- My Details neither shows nor asks for their HKID or passport; what is
  -- held stays held, for the officers who need it (owner, 2 Oct 2026).
  -- The owner sets it by hand: update public.people set hkid_hidden = true where ...
  add column hkid_hidden boolean not null default false;

-- Stamped when Active goes off, cleared when it comes back on.
create function public.people_stamp_inactive() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active then
    new.inactive_since := null;
  elsif old.active and new.inactive_since is not distinct from old.inactive_since then
    new.inactive_since := now();
  end if;
  return new;
end;
$$;
revoke all on function public.people_stamp_inactive() from public, anon, authenticated;

create trigger people_stamp_inactive before update of active on public.people
  for each row execute function public.people_stamp_inactive();

-- People already inactive when they arrive (the Airtable import, a new
-- applicant) have no stamp yet. The daily run gives them one: the Airtable
-- record's creation time while the raw copy exists, else when the row was
-- created here - for the import that is the import date, so anyone with no
-- other trace gets the full 13 months from the switch-over.
create function public.retention_stamp() returns integer
language sql
set search_path = ''
as $$
  with stamped as (
    update public.people p
    set inactive_since = coalesce(
      (select a.created_time from archive.airtable_records a where a.airtable_id = p.airtable_id),
      p.created_at)
    where not p.active and p.inactive_since is null
    returning 1
  )
  select count(*)::integer from stamped;
$$;

-- ── Who is due ───────────────────────────────────────────────────────────
-- Last activity: the latest of the inactive stamp and every dated trace the
-- person leaves - a match played or picked for, an availability answer or
-- rule, an application stage, a form, a declaration, a commitment period.
-- Never due while they hold an active office, coach or captain an active
-- team, or have a step open that waits on them or is about them.
create view public.retention_schedule_v with (security_invoker = true) as
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
    (select max(d.signed_at) from public.declarations d where d.person_id = p.id)
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

create view public.retention_due_v with (security_invoker = true) as
select * from public.retention_schedule_v where due_on <= (now() at time zone 'Asia/Hong_Kong')::date;

-- ── R2 objects waiting to be deleted ─────────────────────────────────────
-- The database can't reach R2, so removal queues the keys and the Worker
-- deletes the objects, then the rows. A failed delete is retried next run;
-- a key is never lost between the two.
create table public.r2_deletions (
  r2_key text primary key,
  queued_at timestamptz not null default now()
);

-- ── Removing one person's personal data ──────────────────────────────────
-- The removal itself, for the two callers below; p_action names it in the
-- activity log. Not callable from outside.
create function public.erase_personal_data(p_person uuid, p_action text) returns void
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

  -- Their files: filed on them, their family or their commitment reviews,
  -- or attached to their applications and declarations.
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
  where file_id = any (v_files) or subject_person_id = p_person or commitment_id = any (v_commitments);

  -- Separate statements: within one, the existence check would still see
  -- the rows being deleted. A key another files row still uses is kept.
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

  -- The raw Airtable copy of their People record, while the archive exists.
  if v_person.airtable_id is not null then
    delete from archive.airtable_records where airtable_id = v_person.airtable_id;
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

-- The retention job's: re-checks they are still due (they may have come
-- back since the list was read). True when removed, false when not due.
create function public.remove_personal_data(p_person uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.people where id = p_person for update;
  if not exists (select 1 from public.retention_due_v where id = p_person) then
    return false;
  end if;
  perform public.erase_personal_data(p_person, 'remove_personal_data');
  return true;
end;
$$;

-- "Delete my profile": the person's own, at any time, confirmed in the app.
-- The same removal, and they stop being active and give up any office
-- (owner, 2 Oct 2026: officers and coaches may too). Their offices are
-- retired rather than deleted, so who held them stays on record.
create function public.delete_own_profile(p_person uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.people set active = false where id = p_person;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  update public.offices set status = 'Retired' where person_id = p_person and status = 'Active';
  perform public.erase_personal_data(p_person, 'delete_own_profile');
end;
$$;

-- Service role only, like everything else (20260929130500_lock_down.sql).
alter table public.r2_deletions enable row level security;
revoke all on public.r2_deletions from public, anon, authenticated;
grant select, insert, update, delete on public.r2_deletions to service_role;
revoke all on public.retention_schedule_v, public.retention_due_v from public, anon, authenticated;
grant select on public.retention_schedule_v, public.retention_due_v to service_role;
revoke all on function public.retention_stamp() from public, anon, authenticated;
revoke all on function public.erase_personal_data(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.remove_personal_data(uuid) from public, anon, authenticated;
revoke all on function public.delete_own_profile(uuid) from public, anon, authenticated;
grant execute on function public.retention_stamp() to service_role;
grant execute on function public.remove_personal_data(uuid) to service_role;
grant execute on function public.delete_own_profile(uuid) to service_role;
