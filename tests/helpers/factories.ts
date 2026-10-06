import type { AbilityGroupConfiguration, AvailabilityRule, Match, MatchCard, Player, Team } from "../../shared/schema/domainTypes";
import type { FakeCommitment, FakeException, FakeOffice, FakePerson } from "./fakeRepos";

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

// ---------------------------------------------------------------------------
// Rows for the in-memory repositories (tests/helpers/fakeRepos.ts).
//
// Each default is what the Supabase mapper (worker/src/data/supabase/
// mappers.ts) produces for a row with that column empty, so a seeded row
// reads as production would return it. Ids default to valid Airtable-style
// ids: on Supabase, isRowId() refuses anything that is not "rec" + 14
// characters or a uuid, so ids like "recA" or "p1" quietly fail its checks.
// ---------------------------------------------------------------------------

let idSeq = 0;

/** A valid row id from a short label: recId("Alice") -> "recAlice000000000". Same label, same id. */
export function recId(label: string): string {
  const body = label.replace(/[^A-Za-z0-9]/g, "").slice(0, 14);
  return `rec${body.padEnd(14, "0")}`;
}

const nextId = (kind: string) => recId(`${kind}${++idSeq}`);

/** One People row. Officer-section columns (membershipNo, joinDate, waivers...) go under `crm`. */
export function person(overrides: Partial<FakePerson> = {}): FakePerson {
  return {
    id: nextId("Person"),
    preferredName: "Test",
    active: true,
    isVisitingPlayer: false,
    isSuspended: false,
    everRegisteredToPremier: false,
    u21Eligible: false,
    playerCoach: [],
    optInOnly: false,
    ...overrides,
  };
}

export function team(overrides: Partial<Team> = {}): Team {
  return {
    id: nextId("Team"),
    teamName: "",
    teamRank: 99,
    isPremier: false,
    targetSquadSize: 16,
    active: true,
    coach: [],
    teamCaptain: [],
    sectionCaptain: [],
    autoSelectPlayers: [],
    ...overrides,
  };
}

export function match(overrides: Partial<Match> = {}): Match {
  return {
    id: nextId("Match"),
    matchDate: "",
    season: "",
    division: "",
    competitionType: "",
    homeTeam: "",
    homeTeamScore: 0,
    awayTeam: "",
    awayTeamScore: 0,
    matchStatus: "Scheduled",
    venue: "",
    fixtureId: "",
    selectedPlayersHome: [],
    selectedPlayersAway: [],
    autoSelectEnabled: false,
    homeKit: "",
    awayKit: "",
    ump1: "",
    ump2: "",
    ...overrides,
  };
}

/** A Match Cards row. Like the mapper, unticked boxes and empty fields are left out. */
export function matchCard(overrides: Partial<MatchCard> = {}): MatchCard {
  return { id: nextId("Card"), ...overrides };
}

/** A stored availability answer (no row means Available). `season` is the match's season. */
export function exception(overrides: Partial<FakeException> & { player: string[]; match: string[] }): FakeException {
  return {
    id: nextId("Exception"),
    availabilityStatus: "Unavailable",
    note: "",
    season: "",
    updatedAt: "",
    ...overrides,
  };
}

export function rule(overrides: Partial<AvailabilityRule> & { player: string[] }): AvailabilityRule {
  return {
    id: nextId("Rule"),
    ruleType: "All future",
    availability: "Unavailable",
    active: true,
    startDate: "",
    endDate: "",
    notes: "",
    lastModified: "",
    ...overrides,
  };
}

export function abilityGroup(group: AbilityGroupConfiguration["group"], capacity: number, isResidual = false): AbilityGroupConfiguration {
  return { id: nextId(`Group${group}`), group, capacity, isResidual };
}

/** An office row and who holds it. */
export function office(kind: FakeOffice["office"], member: string | null, overrides: Partial<FakeOffice> = {}): FakeOffice {
  return { id: nextId("Office"), office: kind, designation: null, status: "Active", member, ...overrides };
}

/** A Commitments row, keyed by COMMITMENT_FIELDS / REVIEW_TASK_FIELDS keys. */
export function commitment(overrides: Partial<FakeCommitment> = {}): FakeCommitment {
  return { id: nextId("Commitment"), ...overrides };
}
