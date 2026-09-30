-- The season plan in Eddy: asked at the start of each season (the member
-- details update) and when someone joins (the new joiner form), to help
-- allocate players to teams. Owner decisions, 2026-10-01:
--  - playing availability is split into how much of the season (all, most,
--    some, none) and, optionally, only its first or second half;
--  - playing preference and captaincy interest stay as they are;
--  - trials, tours and tournaments leave the season plan for an events
--    schedule (built later), so their columns are left alone here;
--  - players don't change their plan during the season.

alter table public.season_plans
  add column availability_level text check (availability_level in ('all', 'most', 'some', 'none')),
  add column availability_half text check (availability_half in ('first', 'second')),
  add constraint season_plans_half_needs_play check (availability_half is null or availability_level is distinct from 'none');

-- Each plan with the availability as the two answers. Plans made in Eddy
-- (submitted_at set) use them directly; plans from Airtable are read from
-- its multiple-choice answer, so a re-import needs no conversion.
create view public.season_plans_v with (security_invoker = true) as
  select s.id, s.person_id, s.season,
         case when s.submitted_at is not null then s.availability_level
              when 'Available for all matches (90%+)' = any (s.playing_availability) then 'all'
              when 'Available for most matches (50-90%)' = any (s.playing_availability) then 'most'
              when 'Available for some matches (10-50%)' = any (s.playing_availability) then 'some'
              when 'Not Available' = any (s.playing_availability) then 'none' end as availability_level,
         case when s.submitted_at is not null then s.availability_half
              when 'Available first half of the season only' = any (s.playing_availability) then 'first'
              when 'Available second half of the season only' = any (s.playing_availability) then 'second' end as availability_half,
         s.playing_preference, s.captaincy_interest, s.submitted_at, s.updated_at
  from public.season_plans s;

-- Records the person's plan for the current season (one per season; a
-- second answer replaces the first). Errors: P0002 not found, 22023 invalid.
create function public.submit_season_plan(p_actor text, p jsonb)
returns public.season_plans
language plpgsql
set search_path = ''
as $$
declare
  person uuid;
  level text := nullif(btrim(p->>'availabilityLevel'), '');
  half text := nullif(btrim(p->>'availabilityHalf'), '');
  pref text := nullif(btrim(p->>'playingPreference'), '');
  capt text := nullif(btrim(p->>'captaincyInterest'), '');
  saved public.season_plans;
begin
  select id into person from public.people where api_id = p_actor;
  if person is null then raise exception 'Your People record was not found' using errcode = 'P0002'; end if;
  if level is null or level not in ('all', 'most', 'some', 'none') then
    raise exception 'Say how much of the season you can play' using errcode = '22023';
  end if;
  if half is not null and (half not in ('first', 'second') or level = 'none') then
    raise exception 'Choose the first or second half, or neither' using errcode = '22023';
  end if;
  if level <> 'none' and pref is null then raise exception 'Choose a playing preference' using errcode = '22023'; end if;
  if capt is null or capt not in ('Yes', 'Maybe', 'No') then
    raise exception 'Say whether you would like to captain' using errcode = '22023';
  end if;

  insert into public.season_plans as s (person_id, season, availability_level, availability_half, playing_preference, captaincy_interest, submitted_at)
  values (person, public.current_season(), level, half, case when level = 'none' then null else pref end, capt, now())
  on conflict (person_id, season) do update set
    availability_level = excluded.availability_level,
    availability_half = excluded.availability_half,
    playing_preference = excluded.playing_preference,
    captaincy_interest = excluded.captaincy_interest,
    submitted_at = excluded.submitted_at
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.submit_season_plan(text, jsonb) from public, anon, authenticated;
