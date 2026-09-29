-- Values Airtable computed with formulas, computed here when read. Each
-- follows the Airtable formula it replaces, including its clock: Airtable
-- evaluates formulas in UTC unless told otherwise, and so do these, so the
-- import's parity check can compare them value for value.
-- security_invoker: a view runs with the caller's rights, so RLS still applies.

-- Matches."Competition Type": the division name folded to LEAGUE,
-- KNOCKOUT or FRIENDLY; anything unlisted stays blank, as in Airtable.
create function public.competition_type(division text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case upper(division)
    when 'SUPER LEAGUE' then 'LEAGUE' when 'P' then 'LEAGUE' when 'PA' then 'LEAGUE' when 'PB' then 'LEAGUE'
    when '1' then 'LEAGUE' when '2' then 'LEAGUE' when '3' then 'LEAGUE' when '4' then 'LEAGUE'
    when '5' then 'LEAGUE' when '6' then 'LEAGUE' when '1A' then 'LEAGUE' when '1B' then 'LEAGUE'
    when '2A' then 'LEAGUE' when '3 PLAYOFF' then 'LEAGUE' when '3A' then 'LEAGUE' when '3B' then 'LEAGUE'
    when '5 PLAYOFF' then 'LEAGUE' when '5A' then 'LEAGUE' when '5B' then 'LEAGUE' when '5Z' then 'LEAGUE'
    when 'GUV CUP' then 'KNOCKOUT' when 'GUV DILLON CUP' then 'KNOCKOUT' when 'GUV DILLON CUP SEMI' then 'KNOCKOUT'
    when 'GUV DILLON FINAL' then 'KNOCKOUT' when 'HKHA BOWL' then 'KNOCKOUT' when 'HKHA BOWL Q-FINAL' then 'KNOCKOUT'
    when 'HKHA BOWL SEMI' then 'KNOCKOUT' when 'HKHA CUP' then 'KNOCKOUT' when 'HKHA CUP FINAL' then 'KNOCKOUT'
    when 'HKHA CUP Q-FINAL' then 'KNOCKOUT' when 'HKHA CUP SEMI' then 'KNOCKOUT' when 'HKHA PLATE' then 'KNOCKOUT'
    when 'HKHA PLATE SEMI' then 'KNOCKOUT' when 'HOCKEYHK BOWL' then 'KNOCKOUT' when 'HOCKEYHK BOWL QF' then 'KNOCKOUT'
    when 'HOCKEYHK CUP' then 'KNOCKOUT' when 'HOCKEYHK CUP FINAL' then 'KNOCKOUT' when 'HOCKEYHK CUP Q-FINAL' then 'KNOCKOUT'
    when 'HOCKEYHK CUP SEMI' then 'KNOCKOUT' when 'HOCKEYHK PLATE' then 'KNOCKOUT' when 'HOCKEYHK PLATE QF' then 'KNOCKOUT'
    when 'HOCKEYHK PLATE SEMI' then 'KNOCKOUT' when 'HOLLAND' then 'KNOCKOUT' when 'HOLLAND SEMI' then 'KNOCKOUT'
    when 'P FDLY' then 'FRIENDLY' when 'WARM-UP' then 'FRIENDLY' when 'FRIENDLY' then 'FRIENDLY'
  end
$$;

-- Matches."Season": YEAR(Date - 6 months) & "-" & YEAR(Date + 6 months), in UTC.
create function public.season_of(match_date timestamptz) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select extract(year from (match_date at time zone 'UTC') - interval '6 months')::int
    || '-' || extract(year from (match_date at time zone 'UTC') + interval '6 months')::int
$$;

create index matches_season_idx on public.matches (public.season_of(match_date));

create view public.matches_v with (security_invoker = true) as
  select m.*,
         public.season_of(m.match_date) as season,
         public.competition_type(m.division) as competition_type
  from public.matches m;

-- Match Cards."Play Up?": the card's team outranks the player's team, by
-- the fixed HKFC A=8 ... H=1 scale the Airtable formula used.
create function public.hkfc_team_level(team text) returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select case team when 'HKFC A' then 8 when 'HKFC B' then 7 when 'HKFC C' then 6 when 'HKFC D' then 5
                   when 'HKFC E' then 4 when 'HKFC F' then 3 when 'HKFC G' then 2 when 'HKFC H' then 1 end
$$;

create view public.match_cards_v with (security_invoker = true) as
  select c.*,
         public.season_of(m.match_date) as season,
         coalesce(public.hkfc_team_level(c.team) > public.hkfc_team_level(c.player_team), false) as play_up
  from public.match_cards c
  left join public.matches m on m.id = c.match_id;

-- The People formulas that depend on today's date or on other fields.
create view public.people_v with (security_invoker = true) as
  select p.*,
         nullif(trim(concat_ws(' ', coalesce(p.preferred_name, p.given_names), p.surname)), '') as name,
         nullif(trim(concat_ws(' ', p.given_names, p.surname)), '') as full_name,
         split_part(p.given_names, ' ', 1) as first_name,
         extract(year from age(current_date, p.date_of_birth))::int as age,
         case
           when p.date_of_birth is null then null
           when extract(year from age(current_date, p.date_of_birth)) < 16 then '15 or under'
           when extract(year from age(current_date, p.date_of_birth)) <= 20 then '16-20'
           when extract(year from age(current_date, p.date_of_birth)) <= 25 then '21-25'
           when extract(year from age(current_date, p.date_of_birth)) <= 30 then '26-30'
           when extract(year from age(current_date, p.date_of_birth)) <= 35 then '31-35'
           when extract(year from age(current_date, p.date_of_birth)) <= 40 then '36-40'
           when extract(year from age(current_date, p.date_of_birth)) <= 45 then '41-45'
           when extract(year from age(current_date, p.date_of_birth)) <= 50 then '46-50'
           when extract(year from age(current_date, p.date_of_birth)) <= 55 then '51-55'
           when extract(year from age(current_date, p.date_of_birth)) <= 60 then '56-60'
           when extract(year from age(current_date, p.date_of_birth)) <= 65 then '61-65'
           else '65+'
         end as age_band,
         -- Under 21 on the most recent 1 September (U21 Eligible).
         coalesce(extract(year from age(ls.sep1, p.date_of_birth)) < 21, false) as u21_eligible,
         -- The HockeyHK U18 form is needed for anyone under 18 on the most recent 1 September.
         coalesce(extract(year from age(ls.sep1, p.date_of_birth)) < 18, false) as needs_u18_form,
         p.registered_team = 'HKFC A' as ever_registered_to_premier,
         -- Days to the next anniversary of the Commitment End Date that is
         -- after today (0 when there is none, or it has passed).
         case
           when p.commitment_end_date is null or p.commitment_end_date < current_date then 0
           when ann.this_year > current_date then ann.this_year - current_date
           else ann.next_year - current_date
         end as next_period_end_days
  from public.people p
  cross join lateral (
    select make_date(
      case when current_date >= make_date(extract(year from current_date)::int, 9, 1)
           then extract(year from current_date)::int
           else extract(year from current_date)::int - 1 end, 9, 1) as sep1
  ) ls
  cross join lateral (
    select (p.commitment_end_date + make_interval(years => extract(year from current_date)::int
                                                    - extract(year from p.commitment_end_date)::int))::date as this_year,
           (p.commitment_end_date + make_interval(years => extract(year from current_date)::int + 1
                                                    - extract(year from p.commitment_end_date)::int))::date as next_year
  ) ann;

create view public.commitments_v with (security_invoker = true) as
  select c.*,
         case when c.period_start is null or c.period_end is null then null
              else to_char(c.period_start, 'YYYY-MM-DD') || ' to ' || to_char(c.period_end, 'YYYY-MM-DD') end as period
  from public.commitments c;

-- Shirt Numbers."Allocation Status", from whoever holds the number.
create view public.shirt_numbers_v with (security_invoker = true) as
  select s.*,
         p.id as person_id,
         case when p.status = 'Member' or p.applicant_stage = 'Temporary' then 'Allocated'
              when p.status = 'Applicant' then 'Pending'
              else 'Available' end as allocation_status
  from public.shirt_numbers s
  left join public.people p on p.shirt_number_id = s.id;

revoke all on function public.competition_type(text) from public, anon, authenticated;
revoke all on function public.season_of(timestamptz) from public, anon, authenticated;
revoke all on function public.hkfc_team_level(text) from public, anon, authenticated;
grant execute on function public.competition_type(text) to service_role;
grant execute on function public.season_of(timestamptz) to service_role;
grant execute on function public.hkfc_team_level(text) to service_role;
