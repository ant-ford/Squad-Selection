import type { Match, MatchCard, Player, Team } from "../../shared/schema/domainTypes";

// ---------------------------------------------------------------------------
// Shared eligibility-engine test factories.
//
// Used by tests/eligibility.test.ts, tests/golden-eligibility.test.ts and
// tests/suspension.test.ts. Each file's own `ctx()` builder stays local -
// golden-eligibility.test.ts's runs the real suspension engine to protect
// the full pipeline, eligibility.test.ts's does not, and forcing them onto
// one implementation would risk changing which tests exercise which code
// path. Only the plain, byte-identical record builders live here.
// ---------------------------------------------------------------------------

export function t(name: string, rank: number, isPremier = false): Team {
  return { id: `team_${name.toLowerCase()}`, teamName: name, teamRank: rank, isPremier, active: true };
}

export function p(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    active: true,
    registeredTeam: "HKFC C",
    playingPosition: "Defender",
    playingAbility: "B",
    isVisitingPlayer: false,
    isSuspended: false,
    matchesToServe: 0,
    everRegisteredToPremier: false,
    u21Eligible: false,
    preferredName: "Test Player",
    ...overrides,
  };
}

export function m(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    matchDate: "2026-07-05",
    season: "2025-2026",
    homeTeam: "HKFC C",
    awayTeam: "Opponent C",
    homeTeamScore: 0,
    awayTeamScore: 0,
    division: "Division 2",
    competitionType: "League",
    matchStatus: "Scheduled",
    ...overrides,
  };
}

export function mc(overrides: Partial<MatchCard> = {}): MatchCard {
  return {
    id: "mc1",
    player: ["p1"],
    match: ["m1"],
    team: "HKFC C",
    playerTeam: "HKFC C",
    playUp: false,
    goalkeeper: false,
    season: "2025-2026",
    ...overrides,
  };
}
