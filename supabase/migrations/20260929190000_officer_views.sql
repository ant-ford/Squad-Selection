-- Views for the officer sections' reads (membership board, Insights,
-- export, the chairman's email lists, contacts, Stats names, My Tasks, the
-- Statements board). Their columns are named after the field-map KEYS the
-- Worker already reads (worker/src/data/people.ts, data/commitments.ts),
-- quoted because they are camelCase, and their values keep Airtable's
-- shapes: a lookup is an array, a link is an array of api ids, an
-- attachment is a list of {fileId, filename} that the Worker turns into
-- signed links. So the modules read either backend without knowing which.
--
-- The Fillout form links Airtable computed are NULL here: those forms close
-- at the switch-over and Eddy's own screens replace them.

-- The season a date belongs to, by the Hong Kong season boundary (1 July),
-- as worker/src/seasonContext.ts currentSeason() counts it.
create function public.current_season() returns text
language sql stable
set search_path = ''
as $$
  select extract(year from (now() at time zone 'Asia/Hong_Kong')::date - interval '6 months')::int
    || '-' || (extract(year from (now() at time zone 'Asia/Hong_Kong')::date - interval '6 months')::int + 1)
$$;

create function public.file_refs(p_person uuid, p_kind text) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('fileId', f.id, 'filename', f.filename) order by f.created_at), '[]'::jsonb)
  from public.files f where f.person_id = p_person and f.kind = p_kind
$$;

create view public.api_people_crm with (security_invoker = true) as
  select b.api_id as id,
         p.preferred_name as "preferredName", p.given_names as "givenNames", p.surname,
         public.file_refs(p.id, 'photo') as photo,
         p.status, p.applicant_stage as "applicantStage",
         public.airtable_ts(p.stage_updated_at) as "stageUpdatedAt",
         public.airtable_ts(p.application_date) as "applicationDate",
         p.membership_no as "membershipNo", p.join_date as "joinDate", p.commitment_end_date as "commitmentEndDate",
         p.mobile_no as "mobileNo", p.applicant_type as "applicantType", p.category_type as "categoryType",
         p.member_type as "memberType", p.gender, p.playing_position as "playingPosition",
         p.registered_team as "registeredTeam", p.selected_team_sos as "selectedTeamSos", p.selected_team_eos as "selectedTeamEos",
         coalesce(array(select sp.preferred_name from public.offices o join public.people sp on sp.id = o.person_id
                        where o.id = p.sponsored_by_sponsor_id and sp.preferred_name is not null), '{}') as "sponsorName",
         p.sports_background as "sportsBackground", p.personal_interest as "personalInterest",
         coalesce(plan.tour_interest, '{}') as "tourInterest",
         coalesce(plan.tournament_interest, '{}') as "tournamentInterest",
         plan.captaincy_interest as "captaincyInterest",
         p.qualified_umpire as "qualifiedUmpire", p.qualified_coach as "qualifiedCoach",
         p.playing_level as "playingLevel", p.selection_comments as "selectionComments",
         public.file_refs(p.id, 'application_form') as "applicationForm",
         p.date_of_birth as "dateOfBirth",
         coalesce(array(select o.api_id from public.offices o where o.id = p.sponsored_by_sponsor_id), '{}') as "sponsoredBySponsor",
         coalesce(array(select o.api_id from public.offices o where o.id = p.sponsored_by_chair_id), '{}') as "sponsoredByChair",
         coalesce(array(select o.api_id from public.offices o where o.id = p.sponsored_by_officer_id), '{}') as "sponsoredByOfficer",
         -- Chairman's email lists
         p.active, p.player_coach as "playerCoach", p.age_band as "ageBand", p.age,
         p.hockey_committee_roles as "hockeyCommittee", p.mens_sub_committee as "subCommittee",
         p.team_roles as "teamRoles", p.touring_committee as "touringCommittee",
         p.junior_hockey_volunteers as "juniorVolunteers", p.easter_5s_committee as "easter5s",
         p.general_volunteers as "generalVolunteers",
         p.email, p.guardian_email as "guardianEmail",
         -- My Tasks
         public.airtable_ts(p.waivers_signed_at) as "waiversSubmittedAt",
         null::text as "waiversFormUrl",
         null::text as "joinerFormUrl", null::text as "sponsorFormUrl",
         null::text as "chairFormUrl", null::text as "officerFormUrl"
  from public.people_v p
  join public.people b on b.id = p.id
  left join public.season_plans plan on plan.person_id = p.id and plan.season = public.current_season();

create view public.api_commitments_crm with (security_invoker = true) as
  select b.api_id as id,
         c.review_progress as "reviewProgress",
         public.airtable_ts(c.review_progress_updated_at) as "reviewUpdatedAt",
         false as "notifyNow",
         coalesce(array_remove(array[per.api_id], null), '{}') as people,
         coalesce(array_remove(array[pv.full_name], null), '{}') as "fullName",
         coalesce(array_remove(array[pv.preferred_name], null), '{}') as "preferredName",
         coalesce(array_remove(array[pv.membership_no], null), '{}') as "membershipNo",
         coalesce(array_remove(array[pv.join_date::text], null), '{}') as "joinDate",
         coalesce(array_remove(array[pv.commitment_end_date::text], null), '{}') as "commitmentEndDate",
         c.year_no as "yearNo", c.period, c.period_start as "periodStart", c.period_end as "periodEnd",
         coalesce(array_remove(array[pv.selected_team_sos], null), '{}') as "selectedTeamSos",
         coalesce(array_remove(array[pv.selected_team_eos], null), '{}') as "selectedTeamEos",
         coalesce(array(select sp.preferred_name from public.offices o join public.people sp on sp.id = o.person_id
                        where o.id = c.sponsor_office_id and sp.preferred_name is not null), '{}') as "sponsorName",
         coalesce(array(select o.api_id from public.offices o where o.id = c.sponsor_office_id), '{}') as "sponsorLink",
         coalesce(array(select o.api_id from public.offices o where o.id = c.membership_officer_office_id), '{}') as "officerLink",
         c.matches_played as "matchesPlayed", c.matches_available_not_played as "matchesAvailable",
         c.matches_not_available as "matchesNotAvailable", c.matches_team_played as "matchesTeamPlayed",
         c.teams_played as "teamsPlayed", c.practices, c.social_functions as "socialFunctions",
         c.games_umpired as "gamesUmpired",
         coalesce(array_remove(array[pv.qualified_umpire], null), '{}') as "qualifiedUmpire",
         c.other_contributions as "otherContributions", c.low_participation_reason as "lowParticipationReason",
         c.section_service_member as "sectionServiceMember", c.hkfc_service_member as "hkfcServiceMember",
         c.section_service_sponsor as "sectionServiceSponsor", c.hkfc_service_sponsor as "hkfcServiceSponsor",
         c.recommendation_sponsor as "sponsorRecommendation", c.recommended_reduction as "recommendedReduction",
         public.airtable_ts(c.member_submitted_at) as "memberSubmittedAt",
         public.airtable_ts(c.sponsor_submitted_at) as "sponsorSubmittedAt",
         public.airtable_ts(c.officer_submitted_at) as "officerSubmittedAt",
         coalesce((select jsonb_agg(jsonb_build_object('fileId', f.id, 'filename', f.filename) order by f.created_at)
                   from public.files f where f.commitment_id = c.id and f.kind = 'player_statement'), '[]'::jsonb) as "playerStatement",
         null::text as "officerFormUrl", null::text as "memberFormUrl", null::text as "sponsorFormUrl"
  from public.commitments_v c
  join public.commitments b on b.id = c.id
  left join public.people per on per.id = c.person_id
  left join public.people_v pv on pv.id = c.person_id;

-- Membership Events become activity-log rows: who, what, which record, when.
-- Field NAMES only; the values the Airtable table held are not copied.
create function public.log_activity(p jsonb) returns void
language sql
set search_path = ''
as $$
  insert into public.activity_log (occurred_at, actor_person_id, action, entity, entity_id, fields)
  values (
    coalesce((p ->> 'occurredAt')::timestamptz, now()),
    case when p ->> 'actorId' is null then null else public.person_uuid(p ->> 'actorId') end,
    p ->> 'action',
    p ->> 'entity',
    case when p ->> 'entityId' is null then null else public.person_uuid(p ->> 'entityId') end,
    coalesce(array(select jsonb_array_elements_text(p -> 'fields')), '{}')
  );
$$;

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on %s from anon, authenticated', r.rel);
    execute format('grant select on %s to service_role', r.rel);
  end loop;
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end;
$$;
