import type { Match } from "../../shared/schema/domainTypes";

export interface SideInfo {
  isHome: boolean;
  /** The HKFC team name for this side. */
  team: string;
  opponent: string;
  selectedIds: string[];
}

/**
 * Which side(s) of a match are HKFC teams. A derby (both home and away are
 * HKFC teams) returns both; a normal fixture returns just the one side.
 * Single authoritative HKFC-side resolver - every module that needs to know
 * "which side of this match is us" goes through this.
 */
export function hkfcSides(
  match: Match,
  hkfcTeamNames: ReadonlySet<string | undefined>,
): { home?: SideInfo; away?: SideInfo } {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  const result: { home?: SideInfo; away?: SideInfo } = {};
  if (home && hkfcTeamNames.has(home)) {
    result.home = { isHome: true, team: home, opponent: away, selectedIds: match.selectedPlayersHome || [] };
  }
  if (away && hkfcTeamNames.has(away)) {
    result.away = { isHome: false, team: away, opponent: home, selectedIds: match.selectedPlayersAway || [] };
  }
  return result;
}

/**
 * Which side of a match a coach's screen or write is about: the side asked
 * for when it is an HKFC team, else the HKFC one. In a derby with no side
 * given, home. Shared by the squad reads and writes (squad.ts) and the
 * coach access check (coachAccess.ts), so the two can never disagree.
 */
export function resolveHkfcSide(
  match: Match,
  hkfcTeamNames: ReadonlySet<string | undefined>,
  side?: "home" | "away",
): "home" | "away" {
  const sides = hkfcSides(match, hkfcTeamNames);
  if (side === "home" && sides.home) return "home";
  if (side === "away" && sides.away) return "away";
  if (sides.home && !sides.away) return "home";
  if (sides.away && !sides.home) return "away";
  if (sides.home && sides.away) return side ?? "home";
  // Fallback for derby/edge cases: trust the URL side or default home
  if (side) return side;
  return "home";
}
