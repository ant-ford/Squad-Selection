-- Waivers & declarations in Eddy, replacing Fillout form 10 (Member -
-- Waivers & Consent). Owner decisions, 2026-09-30:
--  - everyone agrees to the HKFC Hockey Code of Conduct & Disclaimers (six
--    boxes); under-18s add their parent or guardian's consent and signature;
--  - the HockeyHK league declaration, HKHA's waiver clauses and the HockeyHK
--    Google Form are not asked for this season;
--  - every signing is kept as a dated record (wording version, boxes ticked,
--    guardian details), and people.waivers_signed_at is set, which is what
--    My Tasks checks;
--  - the HKHA Under 18 Registration Form PDF is made later, from this record.

create table public.declarations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  -- The season it counts for (July to June, Hong Kong time), e.g. 2026-2027.
  season text not null,
  signed_at timestamptz not null default now(),
  -- Which wording was agreed to (shared/declarations.ts DECLARATIONS_VERSION).
  wording_version text not null,
  -- The keys of the boxes ticked.
  accepted text[] not null,
  under_18 boolean not null default false,
  guardian_surname text,
  guardian_given_names text,
  guardian_mobile_no text,
  guardian_email text,
  guardian_signature_file_id uuid references public.files (id) on delete set null,
  created_at timestamptz not null default now()
);
create index declarations_person_idx on public.declarations (person_id, signed_at desc);
alter table public.declarations enable row level security;
revoke all on public.declarations from public, anon, authenticated;
grant select, insert, update, delete on public.declarations to service_role;

-- Records one signing. The Worker checks the wording and the boxes; this
-- checks whose record it is, the under-18 rule and the guardian's part.
-- Errors: P0002 not found (404), 22023 an invalid answer (400).
create function public.submit_declarations(
  p_actor text, p_version text, p_accepted text[], p_required text[], p jsonb, p_signature uuid
) returns public.declarations
language plpgsql
set search_path = ''
as $$
declare
  person public.people;
  today date := (now() at time zone 'Asia/Hong_Kong')::date;
  minor boolean;
  signed public.declarations;
begin
  select * into person from public.people where api_id = p_actor;
  if person.id is null then raise exception 'Your People record was not found' using errcode = 'P0002'; end if;
  if exists (select 1 from unnest(p_required) k where not k = any (p_accepted)) then
    raise exception 'Tick every box to agree' using errcode = '22023';
  end if;
  minor := person.date_of_birth is not null and person.date_of_birth > (today - interval '18 years')::date;
  if minor then
    if coalesce(btrim(p->>'guardianSurname'), '') = '' or coalesce(btrim(p->>'guardianGivenNames'), '') = ''
       or coalesce(btrim(p->>'guardianMobileNo'), '') = '' or coalesce(btrim(p->>'guardianEmail'), '') = '' then
      raise exception 'Enter the parent or guardian''s name, mobile and email' using errcode = '22023';
    end if;
    if not 'guardian_consent' = any (p_accepted) then
      raise exception 'The parent or guardian must confirm their consent' using errcode = '22023';
    end if;
    if not exists (select 1 from public.files f
                    where f.id = p_signature and f.person_id = person.id and f.kind = 'guardian_consent_signature') then
      raise exception 'The parent or guardian must sign' using errcode = '22023';
    end if;
  end if;

  insert into public.declarations (person_id, season, wording_version, accepted, under_18,
    guardian_surname, guardian_given_names, guardian_mobile_no, guardian_email, guardian_signature_file_id)
  values (person.id,
    extract(year from today - interval '6 months')::int || '-' || (extract(year from today - interval '6 months')::int + 1),
    p_version, p_accepted, minor,
    case when minor then btrim(p->>'guardianSurname') end,
    case when minor then btrim(p->>'guardianGivenNames') end,
    case when minor then btrim(p->>'guardianMobileNo') end,
    case when minor then btrim(p->>'guardianEmail') end,
    case when minor then p_signature end)
  returning * into signed;

  -- The profile keeps the latest guardian details, and the date My Tasks reads.
  update public.people set
    waivers_signed_at = signed.signed_at,
    guardian_surname = coalesce(signed.guardian_surname, guardian_surname),
    guardian_given_names = coalesce(signed.guardian_given_names, guardian_given_names),
    guardian_mobile_no = coalesce(signed.guardian_mobile_no, guardian_mobile_no),
    guardian_email = coalesce(signed.guardian_email, guardian_email)
  where id = person.id;

  return signed;
end;
$$;
revoke all on function public.submit_declarations(text, text, text[], text[], jsonb, uuid) from public, anon, authenticated;
