-- The sponsor, Chairman and Membership Officer sign a new HKFC member's
-- application in Eddy, replacing Fillout forms 4 (Sponsor) and 5
-- (Signatures) and the separate "Page 7" (owner decisions: the three sign
-- in any order; an officer's signature is saved once on their People
-- record and reused, as in the commitment reviews).
--
-- The stage follows the club's order: 4 once the sponsor has signed, 5
-- once the Chairman has too, 6 once all three have. Someone signing early
-- is kept, and the stage catches up when the one before them signs.
-- Existing HKFC members' applications don't go through this.

alter table public.applications
  add column sponsor_signature_file_id uuid references public.files (id) on delete set null,
  add column sponsor_signed_at timestamptz,
  add column sponsor_signed_by uuid references public.people (id) on delete set null,
  add column chair_signature_file_id uuid references public.files (id) on delete set null,
  add column chair_signed_at timestamptz,
  add column chair_signed_by uuid references public.people (id) on delete set null,
  add column officer_signature_file_id uuid references public.files (id) on delete set null,
  add column officer_signed_at timestamptz,
  add column officer_signed_by uuid references public.people (id) on delete set null;
create index applications_sponsor_signature_idx on public.applications (sponsor_signature_file_id);
create index applications_chair_signature_idx on public.applications (chair_signature_file_id);
create index applications_officer_signature_idx on public.applications (officer_signature_file_id);
create index applications_sponsor_signed_by_idx on public.applications (sponsor_signed_by);
create index applications_chair_signed_by_idx on public.applications (chair_signed_by);
create index applications_officer_signed_by_idx on public.applications (officer_signed_by);

-- One signature on the applicant's latest application, by whoever holds
-- the office their record names for that role. The sponsor's assessment
-- (p) is written to People with it. Returns the stage afterwards.
-- Errors: P0002 not found, 42501 not theirs to sign, 22023 not possible.
create function public.sign_application(p_person text, p_actor text, p_role text, p jsonb, p_signature uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  person public.people;
  actor uuid;
  app public.applications;
  office uuid;
  holder uuid;
  label text := case p_role when 'sponsor' then 'sponsor' when 'chair' then 'Chairman' when 'officer' then 'Membership Officer' end;
  stage text;
begin
  if label is null then raise exception 'Unknown signer' using errcode = '22023'; end if;
  select * into person from public.people where api_id = p_person for update;
  if person.id is null then raise exception 'Application not found' using errcode = 'P0002'; end if;
  select id into actor from public.people where api_id = p_actor;
  select * into app from public.applications where person_id = person.id order by submitted_at desc limit 1 for update;
  if app.id is null then raise exception 'They haven''t submitted an application yet' using errcode = '22023'; end if;
  if app.application_type <> 'New HKFC Member' then
    raise exception 'Only a new HKFC member''s application is signed by the sponsor, Chairman and Membership Officer' using errcode = '22023';
  end if;
  if person.applicant_stage is null
     or person.applicant_stage not in ('3. Club Application (Signed)', '4. Sponsor (Signed)', '5. Chairman (Signed)') then
    raise exception 'This application isn''t waiting for signatures' using errcode = '22023';
  end if;

  office := case p_role when 'sponsor' then person.sponsored_by_sponsor_id
                        when 'chair' then person.sponsored_by_chair_id
                        else person.sponsored_by_officer_id end;
  select o.person_id into holder from public.offices o where o.id = office;
  if holder is null or holder is distinct from actor then
    raise exception 'You''re not the % on this application', label using errcode = '42501';
  end if;
  if not exists (select 1 from public.files f where f.id = p_signature and f.person_id = actor and f.kind = 'signature') then
    raise exception 'Sign the application' using errcode = '22023';
  end if;

  if p_role = 'sponsor' then
    if app.sponsor_signed_at is not null then raise exception 'You''ve already signed this application' using errcode = '22023'; end if;
    update public.people set
      playing_position = p->>'playingPosition',
      selected_team_sos = p->>'team',
      sports_background_sponsor = p->>'sportsBackground',
      training_comments_sponsor = p->>'trainingComments',
      applicant_level_sponsor = p->>'level'
    where id = person.id;
    update public.applications set sponsor_signature_file_id = p_signature, sponsor_signed_at = now(), sponsor_signed_by = actor
    where id = app.id returning * into app;
  elsif p_role = 'chair' then
    if app.chair_signed_at is not null then raise exception 'You''ve already signed this application' using errcode = '22023'; end if;
    update public.applications set chair_signature_file_id = p_signature, chair_signed_at = now(), chair_signed_by = actor
    where id = app.id returning * into app;
  else
    if app.officer_signed_at is not null then raise exception 'You''ve already signed this application' using errcode = '22023'; end if;
    update public.applications set officer_signature_file_id = p_signature, officer_signed_at = now(), officer_signed_by = actor
    where id = app.id returning * into app;
  end if;

  stage := case
    when app.sponsor_signed_at is not null and app.chair_signed_at is not null and app.officer_signed_at is not null then '6. Membership Officer (Signed)'
    when app.sponsor_signed_at is not null and app.chair_signed_at is not null then '5. Chairman (Signed)'
    when app.sponsor_signed_at is not null then '4. Sponsor (Signed)'
    else '3. Club Application (Signed)'
  end;
  update public.people set applicant_stage = stage where id = person.id;
  return stage;
end;
$$;
revoke all on function public.sign_application(text, text, text, jsonb, uuid) from public, anon, authenticated;
