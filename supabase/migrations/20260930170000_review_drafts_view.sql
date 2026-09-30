-- The review screen also reads the AI draft suggestions, written by the
-- Worker (src/reviewDrafts.ts) when the previous person submits: the
-- sponsor's three when the member submits, the Membership Officer's three
-- when the sponsor does. The Worker gives each person only their own step's
-- drafts. The view is unchanged apart from the columns added at the end.

create or replace view public.api_reviews with (security_invoker = true) as
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
         c.officer_signature_file_id as officer_signature_file,
         c.section_service_draft, c.hkfc_service_draft, c.recommendation_draft,
         c.is_player_needed_draft, c.other_comments_draft, c.other_information_draft,
         public.airtable_ts(c.drafts_generated_at) as drafts_generated_at
  from public.commitments c
  left join lateral public.review_attendance(c.id) a on true
  left join public.people per on per.id = c.person_id
  left join public.people_v pv on pv.id = c.person_id
  left join public.offices so on so.id = c.sponsor_office_id
  left join public.people sp on sp.id = so.person_id
  left join public.offices mo on mo.id = c.membership_officer_office_id
  left join public.people mp on mp.id = mo.person_id;
