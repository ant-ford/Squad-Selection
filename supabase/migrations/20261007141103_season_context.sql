-- season_context (Track C, 7 Oct 2026): a season's squad data in one call,
-- as positional arrays with only the columns worker/src/seasonContext.ts and
-- its readers use.
--
-- getSeasonContext read six things through the api_* views (select=*,
-- paged 1,000 rows at a time): the season's availability answers, match
-- cards and matches, last season's carded cards, every match of last season
-- and the open manual suspensions. On preview that was ~430 KB, and the
-- cards alone grow to ~0.8 MB by the end of a season. This returns the same
-- facts at a fraction of that, and decides nothing: eligibility stays in
-- TypeScript.
--
-- p_player null: the whole season, for the coach screens (players-for-match,
-- squad saves, recommendations) and the suspensions board.
-- p_player = a People api id: only what that player's own screens need
-- (their dashboard's eligibility gating and past results, season stats,
-- attendance, calendar feed):
--   cards       their own, plus every card with a goal or a card value
--               (scorers and cards on past results; card suspensions)
--   exceptions  their own answers, plus those of anyone selected for a match
--               (the squad on a fixture); notes only on their own
-- Matches, selections, last season and the suspensions are the same in both.
--
-- Shape ("v": 1). People and matches are referred to by index:
--   people      [api_id, ...]
--   matches     [[id, matchDate, division, competitionType, homeTeam, awayTeam,
--                 matchStatus, homeScore, awayScore, venue,
--                 [home selection, person idx in order], [away selection],
--                 [distinct teams on this match's cards], card count], ...]
--               The last two are all the Worker needs for "matches with
--               cards" and the completed-league counts, so other players'
--               cards need not be sent in player mode.
--   cards       [[person idx | null, match idx, team, playerTeam,
--                 flags (1 goalkeeper, 2 play-up), goals | null,
--                 cards[] | null, card api_id (carded only) | null,
--                 raw name (unlinked only) | null], ...]
--   exceptions  [[person idx, match idx, "A" | "M" | "U", note | null,
--                 answer api_id (the player's own, in player mode) | null], ...]
--   prevMatches last season's Played matches, and any with a carded card,
--               shaped like matches without the last four
--   prevCards   last season's carded cards (everyone's):
--               [[person idx | null, prevMatch idx, team, playerTeam, flags,
--                 cards[], card api_id], ...]
--   suspensions the open manual suspensions:
--               [[id, player api_id, matches | null, fromDate, servingTeam,
--                 createdAt], ...]
-- Matches and cards are in api_id order, as the views were read before.
-- Dates are in the api views' format (public.airtable_ts).
create function public.season_context(p_season text, p_player text default null) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_prev text;
  v_me uuid;
begin
  if p_season is null or p_season !~ '^\d{4}-\d{4}$' then
    raise exception 'season must be YYYY-YYYY' using errcode = '22023';
  end if;
  v_prev := (split_part(p_season, '-', 1)::int - 1) || '-' || split_part(p_season, '-', 1);
  if p_player is not null then
    select id into v_me from public.people where api_id = p_player;
    if v_me is null then
      raise exception 'No person %', p_player using errcode = 'P0002';
    end if;
  end if;

  return (
    with m as materialized (
      select m.id, m.api_id, m.match_date, m.division, m.home_team, m.away_team, m.match_status,
             m.home_score, m.away_score, m.venue,
             (row_number() over (order by m.api_id) - 1)::int as i
      from public.matches m
      where public.season_of(m.match_date) = p_season          -- matches_season_idx
    ),
    allc as materialized (
      select c.api_id, c.person_id, c.match_id, c.team, c.player_team, c.goalkeeper, c.goals_scored, c.cards,
             c.raw_player_name, m.i as mi
      from public.match_cards c
      join m on m.id = c.match_id
    ),
    c as (
      select * from allc
      where v_me is null or allc.person_id = v_me or coalesce(allc.goals_scored, 0) > 0 or allc.cards <> '{}'
    ),
    s as materialized (
      select s.match_id, s.side, s.person_id, s.ordinal
      from public.match_selections s
      join m on m.id = s.match_id
    ),
    e as (
      select e.api_id, e.person_id, e.status, e.player_notes, m.i as mi
      from public.availability_exceptions e
      join m on m.id = e.match_id
      where v_me is null or e.person_id = v_me
         or exists (select 1 from s where s.match_id = e.match_id and s.person_id = e.person_id)
    ),
    pm as materialized (
      select pm.id, pm.api_id, pm.match_date, pm.division, pm.home_team, pm.away_team, pm.match_status,
             pm.home_score, pm.away_score, pm.venue,
             (row_number() over (order by pm.api_id) - 1)::int as i
      from public.matches pm
      where public.season_of(pm.match_date) = v_prev
        and (lower(pm.match_status) = 'played'
             or exists (select 1 from public.match_cards x where x.match_id = pm.id and x.cards <> '{}'))
    ),
    pc as (
      select c.api_id, c.person_id, c.team, c.player_team, c.goalkeeper, c.cards, pm.i as mi
      from public.match_cards c
      join pm on pm.id = c.match_id
      where c.cards <> '{}'                                       -- match_cards_carded_idx
    ),
    ppl as materialized (
      select p.id, p.api_id, (row_number() over (order by p.api_id) - 1)::int as i
      from public.people p
      where p.id in (select person_id from c union select person_id from e
                     union select person_id from s union select person_id from pc)
    ),
    sel as (
      select s.match_id,
             jsonb_agg(pp.i order by s.ordinal) filter (where s.side = 'home') as home,
             jsonb_agg(pp.i order by s.ordinal) filter (where s.side = 'away') as away
      from s join ppl pp on pp.id = s.person_id
      group by s.match_id
    ),
    ct as (
      select match_id, jsonb_agg(distinct team) filter (where team is not null) as teams, count(*)::int as n
      from allc
      group by match_id
    )
    select jsonb_build_object(
      'v', 1,
      'season', p_season,
      'prev', v_prev,
      'player', p_player,
      'people', coalesce((select jsonb_agg(api_id order by i) from ppl), '[]'),
      'matches', coalesce((
          select jsonb_agg(jsonb_build_array(
                   m.api_id, public.airtable_ts(m.match_date), m.division, public.competition_type(m.division),
                   m.home_team, m.away_team, m.match_status, m.home_score, m.away_score, m.venue,
                   coalesce(sel.home, '[]'), coalesce(sel.away, '[]'), coalesce(ct.teams, '[]'), coalesce(ct.n, 0))
                 order by m.i)
          from m
          left join sel on sel.match_id = m.id
          left join ct on ct.match_id = m.id), '[]'),
      'cards', coalesce((
          select jsonb_agg(jsonb_build_array(
                   pp.i, c.mi, c.team, c.player_team,
                   c.goalkeeper::int
                     | (coalesce(public.hkfc_team_level(c.team) > public.hkfc_team_level(c.player_team), false)::int << 1),
                   c.goals_scored,
                   case when c.cards <> '{}' then to_jsonb(c.cards) end,
                   case when c.cards <> '{}' then c.api_id end,
                   case when c.person_id is null then c.raw_player_name end)
                 order by c.api_id)
          from c left join ppl pp on pp.id = c.person_id), '[]'),
      'exceptions', coalesce((
          select jsonb_agg(jsonb_build_array(pp.i, e.mi, left(e.status, 1),
                                             case when v_me is null or e.person_id = v_me then nullif(e.player_notes, '') end,
                                             case when e.person_id = v_me then e.api_id end)
                 order by e.mi, pp.i)
          from e join ppl pp on pp.id = e.person_id), '[]'),
      'prevMatches', coalesce((
          select jsonb_agg(jsonb_build_array(
                   pm.api_id, public.airtable_ts(pm.match_date), pm.division, public.competition_type(pm.division),
                   pm.home_team, pm.away_team, pm.match_status, pm.home_score, pm.away_score, pm.venue)
                 order by pm.i)
          from pm), '[]'),
      'prevCards', coalesce((
          select jsonb_agg(jsonb_build_array(
                   pp.i, pc.mi, pc.team, pc.player_team,
                   pc.goalkeeper::int
                     | (coalesce(public.hkfc_team_level(pc.team) > public.hkfc_team_level(pc.player_team), false)::int << 1),
                   to_jsonb(pc.cards), pc.api_id)
                 order by pc.api_id)
          from pc left join ppl pp on pp.id = pc.person_id), '[]'),
      'suspensions', coalesce((
          select jsonb_agg(jsonb_build_array(su.id::text, p.api_id, su.matches, su.from_date, su.serving_team,
                                             public.airtable_ts(su.created_at))
                 order by su.created_at, su.id)
          from public.suspensions su
          join public.people p on p.id = su.person_id
          where su.cleared_at is null), '[]')
    )
  );
end;
$$;

revoke all on function public.season_context(text, text) from public, anon, authenticated;
grant execute on function public.season_context(text, text) to service_role;
