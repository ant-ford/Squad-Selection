-- auth_context (Track C, 7 Oct 2026): everything worker/src/auth.ts
-- resolves for a signed-in email, in one call.
--
-- Before, every authenticated request read the person by email
-- (api_players, select=*), every team (api_teams) and every Active office
-- (api_offices), and the player page then read offices, team_people, a
-- year of matches and every Active person again to decide which header
-- buttons to show. This returns, for one email (about 1 KB):
--
--   person                the Player fields the app shows and decides on,
--                         plus uuid, api id, the photo's file id (the Worker
--                         signs it into a link) and profileUpdatedAt;
--                         null when no People record has the email
--   isTeamCoach           any Teams.Coach link, named team or not
--   coachTeams            the names of the teams they coach, ALL teams
--   teamSectionCaptain    a Teams.Section Captain link (coach rights everywhere)
--   allTeamNames          every team name, only when they coach everything
--                         (a Section Captain link or the Assistant Director)
--   captainTeams          Team Captain links on ACTIVE teams
--   socialSecretaryTeams  {id: team uuid, name} (eventAccess.ts)
--   offices               every Active office row they hold, sponsors
--                         included: {role, office, designation}; office is
--                         the app's name for the seven offices that open
--                         parts of the app, null for the others
--   umpire                in the club's umpire pool (umpire_pool below)
--   versions              cache_versions, for the Worker's cache keys
--
-- The Worker starts this in parallel with Supabase's /auth/v1/user, using
-- the email in the (not yet verified) token, and uses the result only when
-- the verified email is the same (owner, 6 Oct 2026: Supabase still checks
-- the session on every request). The decisions stay in TypeScript
-- (auth.ts): this only gathers the facts.

-- ── The umpire pool ─────────────────────────────────────────────────────
-- Who sees the umpiring duties (owner, 6 Oct 2026): Active people with an
-- umpiring qualification, anyone confirmed for a duty in Eddy in the last
-- 12 months, and anyone named as umpire on an HKFC match in the last 12
-- months. The last needs shared/umpires.ts to read the free-text Ump 1 /
-- Ump 2 fields, so it stays in the Worker: umpiring.ts stores the pool it
-- computes here (daily from the scheduled handler, and whenever the
-- umpiring screens rebuild it). auth_context checks the two live conditions
-- itself, so a newly qualified umpire sees the screen at once, and someone
-- known only by name on a match card within a day.
create table public.umpire_pool (
  person_id uuid primary key references public.people (id) on delete cascade,
  refreshed_at timestamptz not null default now()
);
alter table public.umpire_pool enable row level security;
revoke all on public.umpire_pool from public, anon, authenticated;
grant select, insert, update, delete on public.umpire_pool to service_role;

-- Replaces the stored pool with the one the Worker computed (People uuids).
-- Ids that are no longer People are skipped.
create function public.set_umpire_pool(p_people uuid[]) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.umpire_pool where not (person_id = any (coalesce(p_people, '{}')));
  insert into public.umpire_pool (person_id)
  select distinct x from unnest(coalesce(p_people, '{}')) as x
  where exists (select 1 from public.people p where p.id = x)
  on conflict (person_id) do update set refreshed_at = now();
  select count(*) into v_count from public.umpire_pool;
  return v_count;
end;
$$;

-- ── auth_context ────────────────────────────────────────────────────────
create function public.auth_context(p_email text) returns jsonb
language sql stable
set search_path = ''
as $$
  with base as (
    -- lower(email) is unique (people_email_key); the Active preference is
    -- kept for parity with the old lookup.
    select b.id, b.api_id
    from public.people b
    where lower(b.email) = lower(btrim(p_email))
    order by b.active desc
    limit 1
  ),
  me as (
    select p.*, base.api_id, s.shirt_no
    from base
    join public.people_v p on p.id = base.id
    left join public.shirt_numbers s on s.id = p.shirt_number_id
  ),
  links as (
    select tp.role, t.id as team_uuid, t.team_name, t.active, t.api_id
    from public.team_people tp
    join public.teams t on t.id = tp.team_id
    where tp.person_id = (select id from base)
  ),
  offs as (
    select o.role, o.designation, o.api_id,
           case o.role when 'membership_officer' then 'membershipOfficer' when 'section_chair' then 'sectionChair'
                       when 'section_captain' then 'sectionCaptain' when 'hockey_convenor' then 'hockeyConvenor'
                       when 'kit_convenor' then 'kitConvenor' when 'assistant_director' then 'assistantDirector'
                       when 'umpire_coordinator' then 'umpireCoordinator' end as office
    from public.offices o
    where o.person_id = (select id from base) and o.status = 'Active'
  )
  select jsonb_build_object(
    'person', (
      select jsonb_build_object(
        'uuid', me.id, 'id', me.api_id,
        'preferredName', me.preferred_name, 'givenNames', me.given_names, 'surname', me.surname,
        'shirtNoValue', me.shirt_no::text, 'email', me.email, 'mobileNo', me.mobile_no, 'active', me.active,
        'registeredTeam', me.registered_team, 'selectedTeamSos', me.selected_team_sos,
        'selectedTeamEos', me.selected_team_eos, 'playingPosition', me.playing_position,
        'playingAbility', me.playing_ability, 'isVisitingPlayer', me.is_visiting_player,
        'isSuspended', me.is_suspended, 'matchesToServe', me.matches_to_serve,
        'everRegisteredToPremier', me.ever_registered_to_premier, 'u21Eligible', me.u21_eligible,
        'playerCoach', me.player_coach, 'sectionRank', me.section_rank, 'status', me.status,
        'applicantStage', me.applicant_stage, 'optInOnly', me.opt_in_only,
        'birthday', to_char(me.date_of_birth, 'MM-DD'), 'profileUpdatedAt', me.profile_updated_at,
        'photoFileId', (select f.id from public.files f
                        where f.person_id = me.id and f.kind = 'photo' order by f.created_at limit 1)
      )
      from me
    ),
    'isTeamCoach', exists (select 1 from links where role = 'coach'),
    'coachTeams', coalesce((select jsonb_agg(team_name order by api_id) from links
                            where role = 'coach' and coalesce(team_name, '') <> ''), '[]'),
    'teamSectionCaptain', exists (select 1 from links where role = 'section_captain'),
    'allTeamNames', case
        when exists (select 1 from links where role = 'section_captain')
          or exists (select 1 from offs where role = 'assistant_director')
        then coalesce((select jsonb_agg(t.team_name order by t.api_id) from public.teams t
                       where coalesce(t.team_name, '') <> ''), '[]')
        else '[]'::jsonb end,
    'captainTeams', coalesce((select jsonb_agg(coalesce(team_name, '') order by api_id) from links
                              where role = 'team_captain' and active), '[]'),
    'socialSecretaryTeams', coalesce((select jsonb_agg(jsonb_build_object('id', team_uuid, 'name', team_name) order by api_id)
                                      from links where role = 'social_secretary'), '[]'),
    -- In the order auth.ts always listed them: office by office, then by row.
    'offices', coalesce((
        select jsonb_agg(jsonb_build_object('role', role, 'office', office, 'designation', coalesce(designation, ''))
                         order by array_position(array['membership_officer', 'section_chair', 'section_captain', 'kit_convenor',
                                                       'hockey_convenor', 'assistant_director', 'umpire_coordinator'], role) nulls last,
                                  api_id)
        from offs), '[]'),
    'umpire', coalesce((
        select me.active and (
                 (coalesce(me.qualified_umpire, '') not in ('', 'Not Applicable'))
                 or exists (select 1 from public.umpire_pool u where u.person_id = me.id)
                 or exists (select 1 from public.umpire_assignments a
                            join public.umpire_duties d on d.id = a.duty_id
                            where a.person_id = me.id and a.status = 'confirmed'
                              and d.match_date >= now() - interval '365 days' and d.match_date <= now()))
        from me), false),
    'versions', (select coalesce(jsonb_object_agg(key, version), '{}'::jsonb) from public.cache_versions)
  )
$$;

revoke all on function public.set_umpire_pool(uuid[]) from public, anon, authenticated;
grant execute on function public.set_umpire_pool(uuid[]) to service_role;
revoke all on function public.auth_context(text) from public, anon, authenticated;
grant execute on function public.auth_context(text) to service_role;
