-- The membership board's Application Date as a date, the way Airtable
-- serves its date-only field ("2025-01-02"), not a timestamp. Shadow reads
-- in preview found every row differing. The column stays a timestamptz
-- (imported dates are midnight UTC); the view shows its Hong Kong date,
-- which is also right for a date an Eddy screen stores as a real time.
-- Otherwise the view is unchanged.

create or replace view public.api_people_crm with (security_invoker = true) as
  select b.api_id as id,
         p.preferred_name as "preferredName", p.given_names as "givenNames", p.surname,
         public.file_refs(p.id, 'photo') as photo,
         p.status, p.applicant_stage as "applicantStage",
         public.airtable_ts(p.stage_updated_at) as "stageUpdatedAt",
         to_char(p.application_date at time zone 'Asia/Hong_Kong', 'YYYY-MM-DD') as "applicationDate",
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
