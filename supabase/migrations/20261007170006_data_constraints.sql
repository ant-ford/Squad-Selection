-- Data constraints, now that Data checks exist (6 Oct 2026 review).
--
-- The Worker already validates these values before it writes them, so these
-- are a backstop for the Table Editor and for any future code path. Each one
-- validates the existing rows: if this migration fails, run the conformance
-- query from the PR that added it and fix the rows it lists first.

-- People: Status and Applicant Stage take only the values Eddy knows
-- (shared/membershipStages.ts). The retired Airtable stages Pending, On Hold
-- and "undefined" are not allowed back. Null stays allowed for both.
alter table public.people
  add constraint people_status_check
    check (status in ('Member', 'Applicant', 'Resigned')),
  add constraint people_applicant_stage_check
    check (applicant_stage in (
      '1. Trial Application',
      '2. Section Captain Invitation',
      '3. Club Application (Signed)',
      '4. Sponsor (Signed)',
      '5. Chairman (Signed)',
      '6. Membership Officer (Signed)',
      'Accepted',
      'Rejected',
      'Temporary'
    ));

-- Team names on the columns Eddy writes point at teams.team_name, as
-- suspensions.serving_team already does. A team rename carries through;
-- a team that is in use can't be deleted (teams are made inactive instead).
--
-- Left as free text on purpose, so a sync can never fail on a name:
--   - hkha-sync's columns: matches and umpire_duties home_team / away_team
--     (opponents), umpire_duties.duty_team, match_cards.team / player_team;
--   - registration_events.previous_team / new_team, which the match-card
--     trigger fills while hkha-sync writes;
--   - commitments.teams_played (an array).
--
-- Renaming a team also needs public.hkfc_team_level() (it names HKFC A-H, for
-- the play-up flag in match_cards_v) and hkha-sync's team names changed.
alter table public.people
  add constraint people_registered_team_fkey
    foreign key (registered_team) references public.teams (team_name) on update cascade on delete restrict,
  add constraint people_selected_team_sos_fkey
    foreign key (selected_team_sos) references public.teams (team_name) on update cascade on delete restrict,
  add constraint people_selected_team_eos_fkey
    foreign key (selected_team_eos) references public.teams (team_name) on update cascade on delete restrict;

alter table public.hkha_registrations
  add constraint hkha_registrations_team_fkey
    foreign key (team) references public.teams (team_name) on update cascade on delete restrict;

alter table public.season_rollover_people
  add constraint season_rollover_people_selected_team_sos_fkey
    foreign key (selected_team_sos) references public.teams (team_name) on update cascade on delete restrict,
  add constraint season_rollover_people_selected_team_eos_fkey
    foreign key (selected_team_eos) references public.teams (team_name) on update cascade on delete restrict;

alter table public.shirt_numbers
  add constraint shirt_numbers_team_range_fkey
    foreign key (team_range) references public.teams (team_name) on update cascade on delete restrict;
