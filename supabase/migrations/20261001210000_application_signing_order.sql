-- The application is signed in order after all (owner, 2026-10-01): the
-- Chairman reviews the sponsor's support, so signs after the sponsor; the
-- Membership Officer signs last and sends the application on to the
-- Club's membership office. Each signature moves the stage on one:
-- 3 -> 4 sponsor, 4 -> 5 Chairman, 5 -> 6 Membership Officer.
create or replace function public.sign_application(p_person text, p_actor text, p_role text, p jsonb, p_signature uuid)
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
  turn text;
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

  office := case p_role when 'sponsor' then person.sponsored_by_sponsor_id
                        when 'chair' then person.sponsored_by_chair_id
                        else person.sponsored_by_officer_id end;
  select o.person_id into holder from public.offices o where o.id = office;
  if holder is null or holder is distinct from actor then
    raise exception 'You''re not the % on this application', label using errcode = '42501';
  end if;

  -- Whose turn it is, from the stage.
  turn := case person.applicant_stage
    when '3. Club Application (Signed)' then 'sponsor'
    when '4. Sponsor (Signed)' then 'chair'
    when '5. Chairman (Signed)' then 'officer'
  end;
  if turn is null then raise exception 'This application isn''t waiting for signatures' using errcode = '22023'; end if;
  if turn <> p_role then
    raise exception '%', case
      when (p_role = 'sponsor' and app.sponsor_signed_at is not null) or (p_role = 'chair' and app.chair_signed_at is not null)
           or (p_role = 'officer' and app.officer_signed_at is not null) then 'You''ve already signed this application'
      when turn = 'sponsor' then 'The sponsor signs first'
      else 'The Chairman signs before the Membership Officer'
    end using errcode = '22023';
  end if;
  if not exists (select 1 from public.files f where f.id = p_signature and f.person_id = actor and f.kind = 'signature') then
    raise exception 'Sign the application' using errcode = '22023';
  end if;

  if p_role = 'sponsor' then
    update public.people set
      playing_position = p->>'playingPosition',
      selected_team_sos = p->>'team',
      sports_background_sponsor = p->>'sportsBackground',
      training_comments_sponsor = p->>'trainingComments',
      applicant_level_sponsor = p->>'level'
    where id = person.id;
    update public.applications set sponsor_signature_file_id = p_signature, sponsor_signed_at = now(), sponsor_signed_by = actor where id = app.id;
    stage := '4. Sponsor (Signed)';
  elsif p_role = 'chair' then
    update public.applications set chair_signature_file_id = p_signature, chair_signed_at = now(), chair_signed_by = actor where id = app.id;
    stage := '5. Chairman (Signed)';
  else
    update public.applications set officer_signature_file_id = p_signature, officer_signed_at = now(), officer_signed_by = actor where id = app.id;
    stage := '6. Membership Officer (Signed)';
  end if;
  update public.people set applicant_stage = stage where id = person.id;
  return stage;
end;
$$;
revoke all on function public.sign_application(text, text, text, jsonb, uuid) from public, anon, authenticated;
