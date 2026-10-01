-- The new joiner (applicant) form in Eddy, replacing Fillout form 3. The
-- answers go where the member details do (People and its child tables:
-- family_members, relatives, previous_clubs, applicant_trials); this adds
-- the dated record of what they agreed to and signed, and the submit that
-- moves the application on (owner decisions, 2026-10-01).
--
-- Which questions an applicant gets follows the Fillout form's own rules:
-- new HKFC members also give private clubs, trials attended, background,
-- bank details and agree to the commitment pledge and the Sports Associate
-- terms; existing HKFC members agree to the hockey section's notes.

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  application_type text not null check (application_type in ('Existing HKFC Member', 'New HKFC Member')),
  -- shared/application.ts APPLICATION_VERSION: the wording agreed to.
  wording_version text not null,
  -- The keys of the boxes ticked.
  accepted text[] not null,
  -- Drawn signatures (files rows): the applicant's, and where needed the
  -- spouse's, the parent or guardian's consent and their bank-account
  -- signature. Children's are files rows on their family_members row.
  signature_file_id uuid references public.files (id) on delete set null,
  spouse_signature_file_id uuid references public.files (id) on delete set null,
  guardian_signature_file_id uuid references public.files (id) on delete set null,
  guardian_account_signature_file_id uuid references public.files (id) on delete set null,
  submitted_at timestamptz not null default now()
);
create index applications_person_idx on public.applications (person_id, submitted_at desc);
alter table public.applications enable row level security;
revoke all on public.applications from public, anon, authenticated;
grant select, insert, update, delete on public.applications to service_role;

-- Records the application and moves it from the applicant's step (stage 2)
-- to the sponsor's (stage 3). The Worker checks the answers are complete;
-- this checks whose it is, the boxes and the signatures' owners.
-- Errors: P0002 not found, 22023 not possible.
create function public.submit_application(p_actor text, p jsonb)
returns public.applications
language plpgsql
set search_path = ''
as $$
declare
  person public.people;
  saved public.applications;
  required text[] := array(select jsonb_array_elements_text(coalesce(p->'required', '[]')));
  accepted text[] := array(select jsonb_array_elements_text(coalesce(p->'accepted', '[]')));
  f text;
begin
  select * into person from public.people where api_id = p_actor for update;
  if person.id is null then raise exception 'Your People record was not found' using errcode = 'P0002'; end if;
  if person.status is distinct from 'Applicant' then
    raise exception 'Only applicants submit an application' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(required) k where not k = any (accepted)) then
    raise exception 'Tick every box to agree' using errcode = '22023';
  end if;
  foreach f in array array['signature', 'spouseSignature', 'guardianSignature', 'guardianAccountSignature'] loop
    if p->>f is not null and not exists (select 1 from public.files x where x.id = (p->>f)::uuid and x.person_id = person.id) then
      raise exception 'A signature is missing' using errcode = '22023';
    end if;
  end loop;
  if p->>'signature' is null then raise exception 'Sign the application' using errcode = '22023'; end if;

  insert into public.applications (person_id, application_type, wording_version, accepted,
    signature_file_id, spouse_signature_file_id, guardian_signature_file_id, guardian_account_signature_file_id)
  values (person.id, p->>'applicationType', p->>'version', accepted,
    (p->>'signature')::uuid, (p->>'spouseSignature')::uuid, (p->>'guardianSignature')::uuid, (p->>'guardianAccountSignature')::uuid)
  returning * into saved;

  update public.people set
    applicant_type = saved.application_type,
    applicant_stage = case when applicant_stage is null or applicant_stage = '2. Section Captain Invitation'
                           then '3. Club Application (Signed)' else applicant_stage end
  where id = person.id;
  return saved;
end;
$$;
revoke all on function public.submit_application(text, jsonb) from public, anon, authenticated;
