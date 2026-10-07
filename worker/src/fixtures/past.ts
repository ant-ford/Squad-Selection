import { linkId } from "../../../shared/airtableValueUtils";
import type { Match, MatchCard } from "../../../shared/schema/domainTypes";
import { hkDateKey } from "../../../shared/hkDateKey";
import { PAST_FIXTURE_WINDOW_DAYS } from "./matchReads";
import { outcomeOf } from "../teamRecord";

// ---------------------------------------------------------------------------
// Recently played fixtures for a player
// ---------------------------------------------------------------------------

/** A goal or card entry on a played fixture, attributed to a named player. */
export interface PastContribution {
  name: string;
  /** Goals scored in this match. Present on scorers only. */
  goals?: number;
  /** Card values exactly as recorded on the Match Card. */
  cards?: string[];
}

export interface PastFixture {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  division: string;
  /** Null when no score has been entered yet, so the UI can stay quiet. */
  goalsFor: number | null;
  goalsAgainst: number | null;
  outcome: "win" | "draw" | "loss" | null;
  /** True when this player has a Match Card - the record that they played. */
  played: boolean;
  /** This player's own contribution, for a personal line on the tile. */
  myGoals: number;
  myCards: string[];
  /** Everyone who scored or was carded for the HKFC side. */
  scorers: PastContribution[];
  cards: PastContribution[];
}

/**
 * Fixtures the player's team has already played, most recent first.
 *
 * Built entirely from the cached season context, so it adds no Airtable
 * calls: that context already holds every match and every Match Card for
 * the season. Bounded by the same window as the coach list.
 *
 * A Match Card is the appearance record - it is what "played" means here,
 * rather than whether the player was selected.
 */
export function buildPastFixtures(opts: {
  playerId: string;
  teams: string[];
  matches: Match[];
  matchCards: MatchCard[];
  playerNameById: Map<string, string>;
  windowDays?: number;
  now?: Date;
}): PastFixture[] {
  const { playerId, teams, matches, matchCards, playerNameById } = opts;
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? PAST_FIXTURE_WINDOW_DAYS;
  const todayKey = hkDateKey(now.toISOString());
  const cutoffKey = hkDateKey(new Date(now.getTime() - windowDays * 86_400_000).toISOString());
  const teamSet = new Set(teams.filter(Boolean));

  const cardsByMatch = new Map<string, MatchCard[]>();
  for (const card of matchCards) {
    const matchId = linkId(card.match);
    if (!matchId) continue;
    const list = cardsByMatch.get(matchId);
    if (list) list.push(card);
    else cardsByMatch.set(matchId, [card]);
  }

  const out: PastFixture[] = [];
  for (const m of matches) {
    if ((m.matchStatus || "") !== "Played") continue;
    if (!m.matchDate) continue;
    const key = hkDateKey(m.matchDate);
    if (!key || key >= todayKey || key < cutoffKey) continue;

    const home = m.homeTeam || "";
    const away = m.awayTeam || "";
    const cards = cardsByMatch.get(m.id) ?? [];
    const mine = cards.find((c) => linkId(c.player) === playerId);

    // The player's own team is the anchor. A play-up or support appearance
    // counts too: they were there, so the result is theirs to see.
    const isHome = teamSet.has(home) || (!!mine && mine.team === home);
    const isAway = teamSet.has(away) || (!!mine && mine.team === away);
    if (!isHome && !isAway) continue;

    const hkfcTeam = isHome ? home : away;
    const hasScore = m.matchStatus === "Played";
    const goalsFor = hasScore ? (isHome ? m.homeTeamScore : m.awayTeamScore) : null;
    const goalsAgainst = hasScore ? (isHome ? m.awayTeamScore : m.homeTeamScore) : null;

    // Only the HKFC side's cards are ours to report; the opposition's
    // scorers are not recorded in this base at all.
    const ourCards = cards.filter((c) => (c.team || "") === hkfcTeam || linkId(c.player) === playerId);
    const nameFor = (c: MatchCard) =>
      playerNameById.get(linkId(c.player) || "") || c.rawPlayerName || "Unknown";

    out.push({
      id: m.id,
      date: m.matchDate,
      homeTeam: home,
      awayTeam: away,
      hkfcTeam,
      opponent: isHome ? away : home,
      isHome,
      venue: m.venue || "",
      division: m.division || "",
      goalsFor,
      goalsAgainst,
      outcome: goalsFor === null || goalsAgainst === null ? null : outcomeOf(goalsFor, goalsAgainst),
      played: !!mine,
      myGoals: mine?.goals ?? 0,
      myCards: (mine?.cards ?? []).filter((c): c is string => typeof c === "string"),
      scorers: ourCards
        .filter((c) => (c.goals ?? 0) > 0)
        .map((c) => ({ name: nameFor(c), goals: c.goals ?? 0 }))
        .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)),
      cards: ourCards
        .filter((c) => Array.isArray(c.cards) && c.cards.length > 0)
        .map((c) => ({ name: nameFor(c), cards: (c.cards ?? []).filter((x): x is string => typeof x === "string") }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // Most recent first: the game someone just played is the one they want.
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
