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
