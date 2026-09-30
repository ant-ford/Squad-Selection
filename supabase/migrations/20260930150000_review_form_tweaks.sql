-- The member's report, as the owner asked on 2026-09-30:
--  - no "None" option for social functions: choosing none is saying none;
--  - (screen only) the reason for low participation is asked only when match
--    attendance is under the 70% the commitment requires.
-- Otherwise submit_member_report is unchanged from 20260930130000.

create or replace function public.submit_member_report(p_commitment text, p_actor text, p jsonb) returns setof public.review_next
language plpgsql
set search_path = ''
as $$
declare
  c public.commitments;
  actor uuid;
  sponsor uuid;
  officer uuid;
  att record;
  socials text[];
  s uuid;
begin
  select * into c from public.commitments where api_id = p_commitment for update;
  if c.id is null then raise exception 'Commitment review not found' using errcode = 'P0002'; end if;
  select id into actor from public.people where api_id = p_actor;
  if actor is null or c.person_id is distinct from actor then
    raise exception 'Only the member can submit their Player Statement' using errcode = '42501';
  end if;
  if c.review_progress is distinct from 'Notified Member' then
    raise exception 'This review is at "%"', coalesce(c.review_progress, 'no stage') using errcode = '55000';
  end if;

  if coalesce(p->>'gamesUmpired', '') not in ('0', '1', '2', '3', '4', '5+') then
    raise exception 'Choose how many games you umpired' using errcode = '22023';
  end if;
  if coalesce(p->>'practices', '') not in ('Very Regular 70%+', 'Moderate 50-70%', 'Hardly Ever <50%') then
    raise exception 'Choose how often you came to practice' using errcode = '22023';
  end if;
  select coalesce(array_agg(x), '{}') into socials from jsonb_array_elements_text(coalesce(p->'socialFunctions', '[]')) x;
  if exists (select 1 from unnest(socials) x
              where x not in ('Start of Season', 'Christmas Party', 'End of Season', 'Hockey Section AGM')) then
    raise exception 'Unknown social function' using errcode = '22023';
  end if;

  select id into sponsor from public.offices
   where api_id = p->>'sponsor' and role = 'sponsor' and status = 'Active';
  if sponsor is null then raise exception 'Choose your sponsor' using errcode = '22023'; end if;
  select id into officer from public.offices
   where api_id = p->>'officer' and role = 'membership_officer' and status = 'Active';

  select * into att from public.review_attendance(c.id);

  update public.commitments set
    games_umpired = p->>'gamesUmpired',
    practices = p->>'practices',
    social_functions = socials,
    other_contributions = nullif(btrim(coalesce(p->>'otherContributions', '')), ''),
    section_service_member = nullif(btrim(coalesce(p->>'sectionService', '')), ''),
    hkfc_service_member = nullif(btrim(coalesce(p->>'hkfcService', '')), ''),
    low_participation_reason = nullif(btrim(coalesce(p->>'lowParticipationReason', '')), ''),
    sponsor_office_id = sponsor,
    membership_officer_office_id = coalesce(officer, c.membership_officer_office_id),
    -- The attendance the review is judged on, as it stood on submission.
    matches_played = att.matches_played,
    teams_played = att.teams_played,
    matches_team_played = att.matches_team_played,
    matches_not_available = att.matches_not_available,
    review_progress = 'Member Submitted (with Sponsor)',
    member_submitted_at = now()
  where id = c.id;

  update public.steps set done_at = now(), done_by_person_id = actor
   where commitment_id = c.id and step = 'member_report' and done_at is null;
  insert into public.steps (process, step, person_id, commitment_id, waiting_on_person_id, waiting_on_role)
  select 'commitment_review', 'sponsor_review', c.person_id, c.id, o.person_id, 'sponsor'
    from public.offices o where o.id = sponsor
  returning id into s;

  return query
    select s, c.id, np.id, np.email, coalesce(np.preferred_name, split_part(np.given_names, ' ', 1)),
           concat_ws(' ', coalesce(mp.preferred_name, split_part(mp.given_names, ' ', 1)), mp.surname), c.year_no
    from public.offices o
    join public.people np on np.id = o.person_id
    join public.people mp on mp.id = c.person_id
    where o.id = sponsor;
end;
$$;
revoke all on function public.submit_member_report(text, text, jsonb) from public, anon, authenticated;
