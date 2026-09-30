-- Commitment reviews in Eddy: the member's report, the sponsor's review and
-- the Membership Officer's review, replacing Fillout forms 11-13 and their
-- three Make.com routes. Each submission is one transaction: it saves the
-- answers, moves Review Progress on, closes this person's step and opens the
-- next person's (who the Worker then emails, once). No 20-second wait, no
-- matching people by name.
--
-- Who may submit is decided here as well as in the Worker: the member for
-- the report, the review's sponsor for the sponsor review, and the review's
-- Membership Officer (or, if that office is empty or retired, any active
-- Membership Officer) for the last step.

-- ── Attendance for one review ──────────────────────────────────────────
-- The same counting as commitment_attendance_v, for one review at a time, so
-- the screen and the submission snapshot never compute it differently.
create function public.review_attendance(p_commitment uuid) returns table (
  matches_played integer, teams_played text[], matches_team_played integer, matches_not_available integer
)
language sql stable
set search_path = ''
as $$
  select
    (select count(distinct mc.match_id)::int
       from public.match_cards mc join public.matches_v m on m.id = mc.match_id
      where mc.person_id = c.person_id and m.match_date::date between c.period_start and c.period_end
        and m.competition_type is distinct from 'FRIENDLY'),
    coalesce((select array_agg(distinct mc.team order by mc.team)
       from public.match_cards mc join public.matches_v m on m.id = mc.match_id
      where mc.person_id = c.person_id and mc.team is not null
        and m.match_date::date between c.period_start and c.period_end
        and m.competition_type is distinct from 'FRIENDLY'), '{}'),
    (select count(*)::int from public.matches_v tm
      where tm.match_status = 'Played' and tm.competition_type is distinct from 'FRIENDLY'
        and tm.match_date::date between c.period_start and c.period_end
        and p.registered_team in (tm.home_team, tm.away_team)),
    (select count(*)::int from public.availability_exceptions ae join public.matches am on am.id = ae.match_id
      where ae.person_id = c.person_id and ae.status = 'Unavailable'
        and am.match_date::date between c.period_start and c.period_end)
  from public.commitments c
  join public.people p on p.id = c.person_id
  where c.id = p_commitment and c.period_start is not null and c.period_end is not null
$$;

-- ── Signatures ─────────────────────────────────────────────────────────
-- A signer's signature is saved once on their People record (files, kind
-- 'signature') and reused; a review points at the one used rather than
-- copying it. Imported reviews keep their own 'sponsor_signature' files.
alter table public.commitments
  add column sponsor_signature_file_id uuid references public.files (id) on delete set null,
  add column officer_signature_file_id uuid references public.files (id) on delete set null;
create index commitments_sponsor_signature_idx on public.commitments (sponsor_signature_file_id);
create index commitments_officer_signature_idx on public.commitments (officer_signature_file_id);

-- ── What the review screen reads ───────────────────────────────────────
create view public.api_reviews with (security_invoker = true) as
  select c.api_id as id,
         c.review_progress as stage,
         per.api_id as person,
         coalesce(pv.preferred_name, split_part(pv.given_names, ' ', 1)) as preferred_name,
         pv.full_name, pv.membership_no,
         c.year_no, c.period_start, c.period_end,
         coalesce(pv.selected_team_eos, pv.selected_team_sos, pv.registered_team) as team,
         pv.playing_position, pv.qualified_umpire,
         -- Live until the member submits; as recorded after.
         case when c.member_submitted_at is null then a.matches_played else c.matches_played end as matches_played,
         case when c.member_submitted_at is null then a.matches_team_played else c.matches_team_played end as matches_team_played,
         case when c.member_submitted_at is null then a.matches_not_available else c.matches_not_available end as matches_not_available,
         case when c.member_submitted_at is null then a.teams_played else c.teams_played end as teams_played,
         so.api_id as sponsor_office, sp.api_id as sponsor_person,
         coalesce(sp.preferred_name, split_part(sp.given_names, ' ', 1)) as sponsor_name,
         mo.api_id as officer_office, mp.api_id as officer_person,
         coalesce(mp.preferred_name, split_part(mp.given_names, ' ', 1)) as officer_name,
         -- The sponsor on the member's application, offered first on the report.
         (select o.api_id from public.offices o
           where o.id = pv.sponsored_by_sponsor_id and o.role = 'sponsor' and o.status = 'Active') as usual_sponsor_office,
         c.games_umpired, c.practices, c.social_functions, c.other_contributions,
         c.section_service_member, c.hkfc_service_member, c.low_participation_reason,
         public.airtable_ts(c.member_submitted_at) as member_submitted_at,
         c.section_service_sponsor, c.hkfc_service_sponsor, c.recommendation_sponsor,
         public.airtable_ts(c.sponsor_submitted_at) as sponsor_submitted_at,
         c.players_available_for_team, c.optimum_players_for_team, c.is_player_needed_officer,
         c.other_comments_officer, c.other_information_officer, c.recommended_reduction,
         public.airtable_ts(c.officer_submitted_at) as officer_submitted_at,
         coalesce(c.sponsor_signature_file_id,
                  (select f.id from public.files f where f.commitment_id = c.id and f.kind = 'sponsor_signature'
                    order by f.created_at desc limit 1)) as sponsor_signature_file,
         c.officer_signature_file_id as officer_signature_file
  from public.commitments c
  left join lateral public.review_attendance(c.id) a on true
  left join public.people per on per.id = c.person_id
  left join public.people_v pv on pv.id = c.person_id
  left join public.offices so on so.id = c.sponsor_office_id
  left join public.people sp on sp.id = so.person_id
  left join public.offices mo on mo.id = c.membership_officer_office_id
  left join public.people mp on mp.id = mo.person_id;

-- Active sponsors and Membership Officers, for the member's pickers.
create view public.api_review_offices with (security_invoker = true) as
  select o.api_id as id, o.role, coalesce(p.preferred_name, split_part(p.given_names, ' ', 1)) as preferred_name,
         p.surname, o.designation
  from public.offices o
  join public.people p on p.id = o.person_id
  where o.status = 'Active' and o.role in ('sponsor', 'membership_officer');

-- ── Submissions ────────────────────────────────────────────────────────
-- Errors carry an SQLSTATE the Worker turns into an HTTP answer:
--   P0002 not found (404), 42501 not this person's step (403),
--   55000 not at this step any more (409), 22023 an invalid answer (400).

-- Who the next step waits on, and what their email needs.
create type public.review_next as (
  step_id uuid, commitment_id uuid, person_id uuid, email text, preferred_name text,
  member_name text, year_no smallint
);

create function public.submit_member_report(p_commitment text, p_actor text, p jsonb) returns setof public.review_next
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
  if cardinality(socials) = 0 or exists (
       select 1 from unnest(socials) x
        where x not in ('Start of Season', 'Christmas Party', 'End of Season', 'Hockey Section AGM', 'None'))
     or ('None' = any (socials) and cardinality(socials) > 1) then
    raise exception 'Choose the social functions you went to, or None' using errcode = '22023';
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

-- The review's Membership Officer, or any active one when that office is empty or retired.
create function public.review_officer_office(p_commitment uuid) returns uuid
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select o.id from public.commitments c join public.offices o on o.id = c.membership_officer_office_id
      where c.id = p_commitment and o.status = 'Active' and o.person_id is not null),
    (select o.id from public.offices o
      where o.role = 'membership_officer' and o.status = 'Active' and o.person_id is not null
      order by o.created_at limit 1))
$$;

create function public.submit_sponsor_review(p_commitment text, p_actor text, p jsonb, p_signature uuid) returns setof public.review_next
language plpgsql
set search_path = ''
as $$
declare
  c public.commitments;
  actor uuid;
  officer uuid;
  s uuid;
begin
  select * into c from public.commitments where api_id = p_commitment for update;
  if c.id is null then raise exception 'Commitment review not found' using errcode = 'P0002'; end if;
  select id into actor from public.people where api_id = p_actor;
  if actor is null or not exists (select 1 from public.offices o where o.id = c.sponsor_office_id and o.person_id = actor) then
    raise exception 'Only this member''s sponsor can review their Player Statement' using errcode = '42501';
  end if;
  if c.review_progress is distinct from 'Member Submitted (with Sponsor)' then
    raise exception 'This review is at "%"', coalesce(c.review_progress, 'no stage') using errcode = '55000';
  end if;
  if coalesce(btrim(p->>'sectionService'), '') = '' or coalesce(btrim(p->>'hkfcService'), '') = ''
     or coalesce(btrim(p->>'recommendation'), '') = '' then
    raise exception 'Answer all three questions' using errcode = '22023';
  end if;
  if not exists (select 1 from public.files f where f.id = p_signature and f.person_id = actor and f.kind = 'signature') then
    raise exception 'Sign the review' using errcode = '22023';
  end if;

  officer := public.review_officer_office(c.id);
  update public.commitments set
    section_service_sponsor = btrim(p->>'sectionService'),
    hkfc_service_sponsor = btrim(p->>'hkfcService'),
    recommendation_sponsor = btrim(p->>'recommendation'),
    sponsor_signature_file_id = p_signature,
    membership_officer_office_id = coalesce(officer, c.membership_officer_office_id),
    review_progress = 'Sponsor Submitted (with Membership Officer)',
    sponsor_submitted_at = now()
  where id = c.id;

  update public.steps set done_at = now(), done_by_person_id = actor
   where commitment_id = c.id and step = 'sponsor_review' and done_at is null;
  insert into public.steps (process, step, person_id, commitment_id, waiting_on_person_id, waiting_on_role)
  select 'commitment_review', 'officer_review', c.person_id, c.id, o.person_id, 'membership_officer'
    from public.offices o where o.id = officer
  returning id into s;

  return query
    select s, c.id, np.id, np.email, coalesce(np.preferred_name, split_part(np.given_names, ' ', 1)),
           concat_ws(' ', coalesce(mp.preferred_name, split_part(mp.given_names, ' ', 1)), mp.surname), c.year_no
    from public.offices o
    join public.people np on np.id = o.person_id
    join public.people mp on mp.id = c.person_id
    where o.id = officer;
end;
$$;

create function public.submit_officer_review(p_commitment text, p_actor text, p jsonb, p_signature uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  c public.commitments;
  actor uuid;
begin
  select * into c from public.commitments where api_id = p_commitment for update;
  if c.id is null then raise exception 'Commitment review not found' using errcode = 'P0002'; end if;
  select id into actor from public.people where api_id = p_actor;
  if actor is null or not exists (
       select 1 from public.offices o
        where o.person_id = actor and o.role = 'membership_officer' and o.status = 'Active') then
    raise exception 'Only a Membership Officer can complete the review' using errcode = '42501';
  end if;
  if c.review_progress is distinct from 'Sponsor Submitted (with Membership Officer)' then
    raise exception 'This review is at "%"', coalesce(c.review_progress, 'no stage') using errcode = '55000';
  end if;
  if coalesce(p->>'recommendedReduction', '') not in ('None', '1 year', '1.5 years', '2 years') then
    raise exception 'Choose the recommended commitment reduction' using errcode = '22023';
  end if;
  if coalesce(btrim(p->>'isPlayerNeeded'), '') = '' then
    raise exception 'Say whether the player is needed' using errcode = '22023';
  end if;
  if coalesce(p->>'playersAvailable', '') !~ '^\d{1,3}$' or coalesce(p->>'optimumPlayers', '') !~ '^\d{1,3}$' then
    raise exception 'Enter the players available and the optimum number for the team' using errcode = '22023';
  end if;
  if not exists (select 1 from public.files f where f.id = p_signature and f.person_id = actor and f.kind = 'signature') then
    raise exception 'Sign the review' using errcode = '22023';
  end if;

  update public.commitments set
    players_available_for_team = (p->>'playersAvailable')::int,
    optimum_players_for_team = (p->>'optimumPlayers')::int,
    is_player_needed_officer = btrim(p->>'isPlayerNeeded'),
    other_comments_officer = nullif(btrim(coalesce(p->>'otherComments', '')), ''),
    other_information_officer = nullif(btrim(coalesce(p->>'otherInformation', '')), ''),
    recommended_reduction = p->>'recommendedReduction',
    officer_signature_file_id = p_signature,
    membership_officer_office_id = coalesce(
      (select o.id from public.offices o where o.person_id = actor and o.role = 'membership_officer' and o.status = 'Active' limit 1),
      c.membership_officer_office_id),
    review_progress = 'Complete',
    officer_submitted_at = now()
  where id = c.id;

  update public.steps set done_at = now(), done_by_person_id = actor
   where commitment_id = c.id and step = 'officer_review' and done_at is null;
end;
$$;

revoke all on function public.review_attendance(uuid) from public, anon, authenticated;
revoke all on function public.review_officer_office(uuid) from public, anon, authenticated;
revoke all on function public.submit_member_report(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.submit_sponsor_review(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.submit_officer_review(text, text, jsonb, uuid) from public, anon, authenticated;
