-- Manual suspensions, set by the Men's Convenor (owner, 6 Oct 2026).
--
-- Red cards and Disciplinary Committee decisions are not turned into
-- suspensions automatically (worker/src/suspension.ts says why), so the
-- Convenor records them here: a number of matches, or until cleared,
-- counted from a start date against one serving team. The Worker counts
-- what has been served (suspension.ts manualSuspensionProgress): Played
-- league and cup fixtures of the serving team whose Hong Kong date is
-- strictly after from_date. Friendlies never count.
--
-- Every write is one function that also writes its activity_log row (field
-- names only), so the change and its record land together or not at all.
--
-- people.is_suspended / matches_to_serve were the hand-set Airtable flags.
-- Eligibility still reads them, so nothing that set them is lost, but
-- nothing in Eddy writes them any more: flags set today move into this
-- table below (counting from today) and are zeroed. A flag on someone with
-- no registered team stays where it is (such a player cannot be selected
-- anyway) and is cleared when the Convenor records a suspension for them.

create table public.suspensions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  -- null: until cleared.
  matches smallint check (matches is null or matches between 1 and 52),
  from_date date not null,
  serving_team text not null references public.teams (team_name) on update cascade on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 280),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references public.people (id) on delete set null,
  clear_reason text check (clear_reason is null or char_length(clear_reason) <= 280)
);
create index suspensions_person_idx on public.suspensions (person_id);
create index suspensions_open_idx on public.suspensions (person_id) where cleared_at is null;
create index suspensions_serving_team_idx on public.suspensions (serving_team);
create index suspensions_created_by_idx on public.suspensions (created_by);
create index suspensions_cleared_by_idx on public.suspensions (cleared_by);
create trigger suspensions_updated_at before update on public.suspensions
  for each row execute function public.set_updated_at();

alter table public.suspensions enable row level security;
revoke all on public.suspensions from public, anon, authenticated;
grant select, insert, update, delete on public.suspensions to service_role;

-- What the Worker reads: links as api_ids, timestamps in Airtable's form.
create view public.api_suspensions with (security_invoker = true) as
  select s.id::text as id, p.api_id as player, s.matches, s.from_date, s.serving_team, s.reason,
         public.airtable_ts(s.created_at) as created_at, cb.api_id as created_by,
         public.airtable_ts(s.cleared_at) as cleared_at, xb.api_id as cleared_by, s.clear_reason
  from public.suspensions s
  join public.people p on p.id = s.person_id
  left join public.people cb on cb.id = s.created_by
  left join public.people xb on xb.id = s.cleared_by;
revoke all on public.api_suspensions from public, anon, authenticated;
grant select on public.api_suspensions to service_role;

-- ── The hand-set flags ─────────────────────────────────────────────────
-- Counting from today, served by the registered team. None are set on
-- preview (6 Oct 2026).
insert into public.suspensions (person_id, matches, from_date, serving_team, reason)
select p.id,
       case when coalesce(p.matches_to_serve, 0) > 0 then least(p.matches_to_serve, 52) end,
       (now() at time zone 'Asia/Hong_Kong')::date,
       p.registered_team,
       'Carried over from Is Suspended / Matches To Serve'
from public.people p
where (p.is_suspended or coalesce(p.matches_to_serve, 0) > 0)
  and p.registered_team in (select team_name from public.teams);

update public.people
set is_suspended = false, matches_to_serve = null
where (is_suspended or coalesce(matches_to_serve, 0) > 0)
  and registered_team in (select team_name from public.teams);

-- ── Writes ──────────────────────────────────────────────────────────────

-- Records a suspension, or changes an open one.
-- p = {"player": api_id, "matches": 1-52 | null, "fromDate": "YYYY-MM-DD",
--      "servingTeam": team name (default: the registered team), "reason": text}
-- or {"id": uuid, and any of "matches", "fromDate", "servingTeam", "reason"}.
-- p_actor is the Convenor's api_id. Returns the suspension's id.
create function public.admin_save_suspension(p jsonb, p_actor text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_id uuid;
  v_person uuid;
  v_team text;
  v_action text;
  v_fields text[];
begin
  if p ? 'id' then
    update public.suspensions set
      matches = case when p ? 'matches' then (p ->> 'matches')::smallint else matches end,
      from_date = case when p ? 'fromDate' then (p ->> 'fromDate')::date else from_date end,
      serving_team = case when p ? 'servingTeam' then nullif(btrim(p ->> 'servingTeam'), '') else serving_team end,
      reason = case when p ? 'reason' then btrim(p ->> 'reason') else reason end
    where id = (p ->> 'id')::uuid and cleared_at is null
    returning id, person_id into v_id, v_person;
    if v_id is null then
      raise exception 'No open suspension %', p ->> 'id' using errcode = 'P0002';
    end if;
    v_action := 'admin-suspension-edit';
    select coalesce(array_agg(f), '{}') into v_fields
    from unnest(array['matches', 'from_date', 'serving_team', 'reason']) f
    where p ? (case f when 'from_date' then 'fromDate' when 'serving_team' then 'servingTeam' else f end);
  else
    v_person := public.person_uuid(p ->> 'player');
    v_team := coalesce(nullif(btrim(p ->> 'servingTeam'), ''),
                       (select registered_team from public.people where id = v_person));
    if v_team is null then
      raise exception 'No serving team' using errcode = '22023';
    end if;
    insert into public.suspensions (person_id, matches, from_date, serving_team, reason, created_by)
    values (v_person, (p ->> 'matches')::smallint, (p ->> 'fromDate')::date, v_team,
            btrim(p ->> 'reason'), v_actor)
    returning id into v_id;
    v_action := 'admin-suspension-set';
    v_fields := array['suspensions'];
    -- A hand-set flag left over from Airtable is replaced by this record.
    update public.people set is_suspended = false, matches_to_serve = null
    where id = v_person and (is_suspended or coalesce(matches_to_serve, 0) > 0);
    if found then
      v_fields := v_fields || array['is_suspended', 'matches_to_serve'];
    end if;
  end if;

  -- Field names only, as everywhere in the activity log.
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, v_action, 'people', v_person, v_fields);
  -- History triggers (Track C) skip a transaction that logged itself.
  perform set_config('eddy.audit_written', 'on', true);
  return v_id::text;
end;
$$;

-- Ends an open suspension now (served early, overturned, entered by mistake).
create function public.admin_clear_suspension(p_id uuid, p_actor text, p_reason text default null) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_person uuid;
begin
  update public.suspensions
  set cleared_at = now(), cleared_by = v_actor, clear_reason = nullif(btrim(p_reason), '')
  where id = p_id and cleared_at is null
  returning person_id into v_person;
  if v_person is null then
    raise exception 'No open suspension %', p_id using errcode = 'P0002';
  end if;
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, 'admin-suspension-clear', 'people', v_person, array['suspensions']);
  perform set_config('eddy.audit_written', 'on', true);
end;
$$;

revoke all on function public.admin_save_suspension(jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_clear_suspension(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_save_suspension(jsonb, text) to service_role;
grant execute on function public.admin_clear_suspension(uuid, text, text) to service_role;

-- ── Removing personal data ──────────────────────────────────────────────
-- A suspension's reason is about the person, so the 13-month removal and
-- "Delete my profile" delete their suspensions, as they already reset
-- is_suspended. As in 20261007000102_retention_without_archive.sql, with
-- that one line added; tests/retentionCoverage.test.ts checks it.
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
  -- Their suspensions: the reason is about them (20261007010203).
  delete from public.suspensions where person_id = p_person;

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
revoke all on function public.erase_personal_data(uuid, text) from public, anon, authenticated, service_role;
