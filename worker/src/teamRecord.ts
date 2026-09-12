import type { Match } from "../../shared/schema/domainTypes";
import { isFriendly } from "./playUp";

export type Outcome = "win" | "draw" | "loss";

export interface LastMeeting {
  date: string;
  venue: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  outcome: Outcome;
  /** Which season it fell in, so a meeting from years ago reads as one. */
  season: string;
}

export interface TeamRecord {
  season: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** The last completed meeting with this opponent, any season. */
  lastMeeting: LastMeeting | null;
}

export function outcomeOf(goalsFor: number, goalsAgainst: number): Outcome {
  if (goalsFor > goalsAgainst) return "win";
  if (goalsFor < goalsAgainst) return "loss";
  return "draw";
}

/** The match seen from one team's side, or null when they did not play in it. */
function sideOf(match: Match, team: string) {
  const isHome = match.homeTeam === team;
  if (!isHome && match.awayTeam !== team) return null;
  return {
    isHome,
    opponent: isHome ? match.awayTeam : match.homeTeam,
    goalsFor: isHome ? match.homeTeamScore : match.awayTeamScore,
    goalsAgainst: isHome ? match.awayTeamScore : match.homeTeamScore,
  };
}

/**
 * A team's record for one season, plus the last time they met this opponent.
 *
 * Friendlies are left out of both. A warm-up game is not part of the season's
 * story, and a coach asking "how did we do against these last time" means the
 * last time it counted.
 *
 * The last meeting deliberately ignores the season filter: the useful answer
 * is the most recent one there is, and for an opponent a team meets twice a
 * year that is often last season.
 */
export function buildTeamRecord(
  playedMatches: Match[],
  team: string,
  opponent: string | undefined,
  season: string,
): TeamRecord {
  const record: TeamRecord = { season, played: 0, won: 0, drawn: 0, lost: 0, lastMeeting: null };
  let latest: { match: Match; side: NonNullable<ReturnType<typeof sideOf>> } | null = null;

  for (const match of playedMatches) {
    if (isFriendly(match)) continue;
    const side = sideOf(match, team);
    if (!side) continue;

    if ((match.season || "") === season) {
      record.played++;
      const outcome = outcomeOf(side.goalsFor, side.goalsAgainst);
      if (outcome === "win") record.won++;
      else if (outcome === "draw") record.drawn++;
      else record.lost++;
    }

    if (opponent && side.opponent === opponent) {
      if (!latest || (match.matchDate || "") > (latest.match.matchDate || "")) {
        latest = { match, side };
      }
    }
  }

  if (latest) {
    record.lastMeeting = {
      date: latest.match.matchDate || "",
      venue: latest.match.venue || "",
      isHome: latest.side.isHome,
      goalsFor: latest.side.goalsFor,
      goalsAgainst: latest.side.goalsAgainst,
      outcome: outcomeOf(latest.side.goalsFor, latest.side.goalsAgainst),
      season: latest.match.season || "",
    };
  }
  return record;
}
