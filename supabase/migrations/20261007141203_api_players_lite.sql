-- api_players_lite (Track C, C2, 7 Oct 2026): the squad screens' view of a
-- player.
--
-- getReferenceData (the "club-reference" cache behind the dashboard, the
-- coach screens, eligibility, recommendations and the calendar) read
-- api_players select=*: every column, a photo-file lookup per row, and a
-- signed photo link the Worker minted per row. About 0.9 KB a player on
-- preview (147 KB for the Active list) and ~1.26 KB in production. None of
-- those screens shows another player's photo, sports background, selection
-- comments, Player/Coach or rank date.
--
-- This has only what reference-data readers use (checked against every
-- ref.players consumer: fixtures, squad, recommendations, eligibility,
-- seasonContext, calendar, reviews, rankingEvents, membership insights).
-- The birthday is "MM-DD", as shared/birthday.ts keeps it, so no year leaves
-- the database. u21_eligible and ever_registered_to_premier come from
-- people_v, so their formulas stay in one place.
--
-- api_players stays as it is for the ranking pool, getById, sign-in's
-- lookups and the screens that need the full record.
create view public.api_players_lite with (security_invoker = true) as
  select b.api_id as id,
         p.preferred_name, p.given_names, p.surname,
         s.shirt_no::text as shirt_no_value,
         p.email, p.mobile_no, p.active,
         p.registered_team, p.selected_team_sos, p.selected_team_eos, p.playing_position, p.playing_ability,
         p.is_visiting_player, p.is_suspended, p.matches_to_serve, p.ever_registered_to_premier, p.u21_eligible,
         p.section_rank, p.status, p.applicant_stage, p.opt_in_only,
         to_char(p.date_of_birth, 'MM-DD') as birthday
  from public.people_v p
  join public.people b on b.id = p.id
  left join public.shirt_numbers s on s.id = p.shirt_number_id;

revoke all on public.api_players_lite from public, anon, authenticated;
grant select on public.api_players_lite to service_role;
