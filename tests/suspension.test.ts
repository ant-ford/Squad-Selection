import { describe, it, expect, vi } from "vitest";

vi.mock("../worker/src/airtable", () => ({
  linkId: (value: unknown): string | undefined => {
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  },
  escapeFormulaValue: (v: string) => v,
}));

import {
  computeSuspensionState,
  computeSuspensionStates,
  parseCardValue,
  yellowPointsFor,
  YELLOW_POINTS,
  type CardSuspensionState,
} from "../worker/src/suspension";
import { evaluatePlayerEligibility, type EvaluationContext } from "../worker/src/eligibility";
import type { Match, MatchCard, Player, Team } from "../src/generated/domainTypes";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function p(overrides: Partial<Player> = {}): Player {
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

function m(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    matchDate: "2026-07-05",
    season: "2025-2026",
    homeTeam: "HKFC C",
    awayTeam: "Opponent",
    homeTeamScore: 0,
    awayTeamScore: 0,
    division: "Division 2",
    competitionType: "League",
    matchStatus: "Scheduled",
    ...overrides,
  };
}

function mc(overrides: Partial<MatchCard> = {}): MatchCard {
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

function stateFor(
  cards: MatchCard[],
  matches: Match[],
  opts: { currentSeason?: string; previousSeason?: string | null; playerId?: string; registeredTeam?: string } = {},
): CardSuspensionState {
  const matchesById = new Map(matches.map((mm) => [mm.id, mm]));
  return computeSuspensionState({
    cards,
    matchesById,
    currentSeason: opts.currentSeason ?? "2025-2026",
    previousSeason: opts.previousSeason ?? "2024-2025",
    playerId: opts.playerId ?? "p1",
    registeredTeam: opts.registeredTeam ?? "HKFC C",
  });
}

/** A card in its own match (played on its date). `team` = team played FOR. */
function cardWith(opts: {
  cards: string[];
  matchId: string;
  date: string;
  team?: string;
  playerId?: string;
  season?: string;
}): { card: MatchCard; match: Match } {
  const team = opts.team ?? "HKFC C";
  return {
    card: mc({
      id: `mc-${opts.matchId}`,
      player: [opts.playerId ?? "p1"],
      match: [opts.matchId],
      team,
      playerTeam: team,
      cards: opts.cards,
      season: opts.season ?? "2025-2026",
    }),
    match: m({ id: opts.matchId, matchDate: opts.date, homeTeam: team, matchStatus: "Played", season: opts.season ?? "2025-2026" }),
  };
}

/** A completed fixture of the given team (used for serving assertions). */
function fixture(opts: { id: string; date: string; team?: string }): Match {
  return m({ id: opts.id, matchDate: opts.date, homeTeam: opts.team ?? "HKFC C", matchStatus: "Played" });
}

function suspensionCtx(suspensionByPlayer: Map<string, CardSuspensionState>): EvaluationContext {
  const teamMap = new Map<string, Team>([["HKFC C", { id: "t1", teamName: "HKFC C", teamRank: 3 }]]);
  const rankMap: Record<string, number> = { "HKFC C": 3 };
  return {
    teamMap,
    rankMap,
    sameDayMatches: [],
    sameDayFixtures: [],
    allSelections: [],
    selectionsByPlayer: new Map(),
    sameDaySelectionsByTeam: new Map(),
    allExceptions: [],
    unavailablePlayerMatchKeys: new Set(),
    matchCards: [],
    matchCardsByPlayer: new Map(),
    matchesById: new Map(),
    currentSeason: "2025-2026",
    playersById: new Map(),
    completedLeagueMatchesByTeam: new Map(),
    suspensionByPlayer,
  };
}

// ---------------------------------------------------------------------------
// Card value parsing (quantity suffixes)
// ---------------------------------------------------------------------------

describe("parseCardValue", () => {
  it("parses clean codes with quantity 1", () => {
    expect(parseCardValue("Y2")).toEqual({ kind: "yellow", code: "Y2", quantity: 1 });
    expect(parseCardValue("R3")).toEqual({ kind: "red", code: "R3", quantity: 1 });
    expect(parseCardValue("y2")).toEqual({ kind: "yellow", code: "Y2", quantity: 1 });
  });

  it("parses quantity suffixes", () => {
    expect(parseCardValue("Y2 (2)")).toEqual({ kind: "yellow", code: "Y2", quantity: 2 });
    expect(parseCardValue("Y2 (3)")).toEqual({ kind: "yellow", code: "Y2", quantity: 3 });
    expect(parseCardValue("Y1(2)")).toEqual({ kind: "yellow", code: "Y1", quantity: 2 });
  });

  it("parses HTML-embedded values", () => {
    expect(parseCardValue('<div class="team">122 - TSOI<div>Y5')).toEqual({ kind: "yellow", code: "Y5", quantity: 1 });
  });

  it("fails safe on malformed/unknown values", () => {
    expect(parseCardValue("[]")).toBeNull();
    expect(parseCardValue("")).toBeNull();
    expect(parseCardValue("WEIRD")).toBeNull();
    expect(parseCardValue("Y8")).toBeNull();
    expect(parseCardValue("Y2 (x)")).toBeNull();
    expect(parseCardValue("Y2 (0)")).toBeNull();
    expect(parseCardValue(undefined)).toBeNull();
    expect(parseCardValue(42 as unknown)).toBeNull();
  });
});

describe("yellowPointsFor", () => {
  it("maps every Y1-Y7 code to the authoritative base points", () => {
    expect(YELLOW_POINTS).toEqual({ Y1: 2, Y2: 3, Y3: 3, Y4: 2, Y5: 4, Y6: 3, Y7: 1 });
    expect(yellowPointsFor("Y1")).toBe(2);
    expect(yellowPointsFor("Y2")).toBe(3);
    expect(yellowPointsFor("Y3")).toBe(3);
    expect(yellowPointsFor("Y4")).toBe(2);
    expect(yellowPointsFor("Y5")).toBe(4);
    expect(yellowPointsFor("Y6")).toBe(3);
    expect(yellowPointsFor("Y7")).toBe(1);
  });

  it("applies quantity suffixes (base x quantity)", () => {
    expect(yellowPointsFor("Y1 (2)")).toBe(4);
    expect(yellowPointsFor("Y2 (2)")).toBe(6);
    expect(yellowPointsFor("Y2 (3)")).toBe(9);
    expect(yellowPointsFor("Y3 (2)")).toBe(6);
    expect(yellowPointsFor("Y4 (2)")).toBe(4);
    expect(yellowPointsFor("Y5 (2)")).toBe(8);
    expect(yellowPointsFor("Y6 (2)")).toBe(6);
    expect(yellowPointsFor("Y7 (2)")).toBe(2);
    expect(yellowPointsFor("Y7 (3)")).toBe(3);
  });

  it("ignores red cards, empty and unknown values", () => {
    expect(yellowPointsFor("R1")).toBe(0);
    expect(yellowPointsFor("[]")).toBe(0);
    expect(yellowPointsFor("")).toBe(0);
    expect(yellowPointsFor("NONSENSE")).toBe(0);
    expect(yellowPointsFor(undefined)).toBe(0);
    expect(yellowPointsFor(42 as unknown)).toBe(0);
  });
});

describe("card quantity sums", () => {
  it('["Y2 (2)"] = 6 points', () => {
    const s = stateFor([mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2 (2)"], season: "2025-2026" })], [m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" })]);
    expect(s.points).toBe(6);
    expect(s.active).toBe(true); // 6 points -> 1-match suspension
  });

  it('["Y2", "Y2"] = 6 points (same total as ["Y2 (2)"])', () => {
    const s = stateFor([mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2", "Y2"], season: "2025-2026" })], [m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" })]);
    expect(s.points).toBe(6);
  });

  it('["Y2 (2)", "Y1"] = 8 points', () => {
    const s = stateFor([mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2 (2)", "Y1"], season: "2025-2026" })], [m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" })]);
    expect(s.points).toBe(8);
  });

  it('["Y2 (2)"] equals two separate ["Y2"] cards', () => {
    const one = stateFor([mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2 (2)"], season: "2025-2026" })], [m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" })]);
    const two = stateFor(
      [
        mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2"], season: "2025-2026" }),
        mc({ id: "c2", player: ["p1"], match: ["m2"], cards: ["Y2"], season: "2025-2026" }),
      ],
      [
        m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" }),
        m({ id: "m2", matchDate: "2026-07-12", matchStatus: "Played" }),
      ],
    );
    expect(one.points).toBe(6);
    expect(two.points).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Accumulation and thresholds
// ---------------------------------------------------------------------------

describe("yellow-card accumulation", () => {
  it("no cards -> not suspended", () => {
    const s = stateFor([], []);
    expect(s.active).toBe(false);
    expect(s.points).toBe(0);
    expect(s.events).toHaveLength(0);
    expect(s.serviceStatus).toBe("served");
  });

  it("1-4 points -> no suspension", () => {
    const a = cardWith({ cards: ["Y1"], matchId: "a", date: "2026-07-05" }); // 2
    const b = cardWith({ cards: ["Y7"], matchId: "b", date: "2026-07-12" }); // +1 = 3
    const s = stateFor([a.card, b.card], [a.match, b.match]);
    expect(s.points).toBe(3);
    expect(s.active).toBe(false);
  });

  it("exactly 5 -> 1-match suspension", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y1"], matchId: "b", date: "2026-07-12" }); // +2 = 5
    const s = stateFor([a.card, b.card], [a.match, b.match]);
    expect(s.points).toBe(5);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].threshold).toBe(5);
    expect(s.events[0].length).toBe(1);
    expect(s.active).toBe(true);
    expect(s.serviceStatus).toBe("active");
  });

  it("6 points -> 1-match suspension, accumulation retained at 6", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" }); // 6
    const s = stateFor([a.card, b.card], [a.match, b.match]);
    expect(s.points).toBe(6);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].threshold).toBe(5);
    expect(s.active).toBe(true);
  });

  it("does not repeatedly trigger the 5-point threshold at 6/7 points", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" }); // 6
    const c = cardWith({ cards: ["Y7"], matchId: "c", date: "2026-07-19" }); // 7
    const s = stateFor([a.card, b.card, c.card], [a.match, b.match, c.match]);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].threshold).toBe(5);
  });

  it("6 + 4 = 10 -> second (2-match) suspension", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" }); // 6
    const c = cardWith({ cards: ["Y5"], matchId: "c", date: "2026-07-19" }); // 10
    const s = stateFor([a.card, b.card, c.card], [a.match, b.match, c.match]);
    expect(s.points).toBe(10);
    expect(s.events).toHaveLength(2);
    expect(s.events[1].threshold).toBe(10);
    expect(s.events[1].length).toBe(2);
  });

  it("15 points -> third (3-match) suspension + DC referral", () => {
    const a = cardWith({ cards: ["Y5"], matchId: "a", date: "2026-07-05" }); // 4
    const b = cardWith({ cards: ["Y5"], matchId: "b", date: "2026-07-12" }); // 8
    const c = cardWith({ cards: ["Y3"], matchId: "c", date: "2026-07-19" }); // 11
    const d = cardWith({ cards: ["Y1"], matchId: "d", date: "2026-07-26" }); // 13
    const e = cardWith({ cards: ["Y7"], matchId: "e", date: "2026-08-02" }); // 14
    const f = cardWith({ cards: ["Y7"], matchId: "f", date: "2026-08-09" }); // 15
    const s = stateFor(
      [a.card, b.card, c.card, d.card, e.card, f.card],
      [a.match, b.match, c.match, d.match, e.match, f.match],
    );
    expect(s.points).toBe(15);
    expect(s.events).toHaveLength(3);
    expect(s.events[2].threshold).toBe(15);
    expect(s.events[2].length).toBe(3);
    expect(s.events[2].dcReferral).toBe(true);
    expect(s.dcReferral).toBe(true);
  });

  it("15-point suspension does not repeatedly trigger at 15+ points", () => {
    const a = cardWith({ cards: ["Y5"], matchId: "a", date: "2026-07-05" }); // 4
    const b = cardWith({ cards: ["Y5"], matchId: "b", date: "2026-07-12" }); // 8
    const c = cardWith({ cards: ["Y3"], matchId: "c", date: "2026-07-19" }); // 11
    const d = cardWith({ cards: ["Y1"], matchId: "d", date: "2026-07-26" }); // 13
    const e = cardWith({ cards: ["Y7"], matchId: "e", date: "2026-08-02" }); // 14
    const f = cardWith({ cards: ["Y7"], matchId: "f", date: "2026-08-09" }); // 15
    const g = cardWith({ cards: ["Y1"], matchId: "g", date: "2026-08-16" }); // 17
    const s = stateFor(
      [a.card, b.card, c.card, d.card, e.card, f.card, g.card],
      [a.match, b.match, c.match, d.match, e.match, f.match, g.match],
    );
    expect(s.points).toBe(17);
    expect(s.events).toHaveLength(3);
    expect(s.events.filter((ev) => ev.threshold === 15)).toHaveLength(1);
  });

  it("duplicate match-card records do not double-count", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" });
    const dup = { ...a.card, id: "mc-dup" };
    const s = stateFor([a.card, dup], [a.match]);
    expect(s.points).toBe(3);
    expect(s.active).toBe(false);
  });

  it("unknown card codes are ignored", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" });
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" });
    const junk = cardWith({ cards: ["WEIRD", "[]", ""], matchId: "c", date: "2026-07-19" });
    const s = stateFor([a.card, b.card, junk.card], [a.match, b.match, junk.match]);
    expect(s.points).toBe(6);
  });

  it("red cards are not added to yellow-card accumulation", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" });
    const red = cardWith({ cards: ["R1"], matchId: "b", date: "2026-07-12" });
    const s = stateFor([a.card, red.card], [a.match, red.match]);
    expect(s.points).toBe(3);
    expect(s.events).toHaveLength(0);
    expect(s.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suffix end-to-end (the critical production failure guard)
// ---------------------------------------------------------------------------

describe("suffix end-to-end", () => {
  it('Y2 (2) = 6 points -> 1-match suspension -> blocked with "Suspended"', () => {
    const card = mc({ id: "mc-q", player: ["p1"], match: ["mq"], cards: ["Y2 (2)"], season: "2025-2026" });
    const match = m({ id: "mq", matchDate: "2026-07-05", matchStatus: "Played" });
    const states = computeSuspensionStates({
      currentCards: [card],
      previousCards: [],
      matchesById: new Map([[match.id, match]]),
      currentSeason: "2025-2026",
      previousSeason: "2024-2025",
      registeredTeamByPlayer: new Map([["p1", "HKFC C"]]),
    });
    expect(states.get("p1")?.points).toBe(6);
    expect(states.get("p1")?.active).toBe(true);
    const r = evaluatePlayerEligibility(p(), m(), suspensionCtx(states));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
    expect(r.ruleId).toBe("SUSPENSION");
  });
});

// ---------------------------------------------------------------------------
// Season filtering
// ---------------------------------------------------------------------------

describe("season filtering", () => {
  it("only current-season cards contribute to current-season accumulation", () => {
    const curr = cardWith({ cards: ["Y1"], matchId: "cm", date: "2026-07-05" }); // 2 pts
    const s = stateFor([curr.card], [curr.match], { currentSeason: "2025-2026", previousSeason: "2024-2025" });
    expect(s.points).toBe(2);
  });

  it("future-season cards do not contribute, do not trigger, do not alter eligibility", () => {
    const curr = cardWith({ cards: ["Y1"], matchId: "cm", date: "2026-07-05" }); // 2 pts
    const futureCard = mc({ id: "mc-f", player: ["p1"], match: ["fm"], team: "HKFC C", cards: ["Y2", "Y1"], season: "2026-2027" }); // 5 pts if current
    const futureMatch = m({ id: "fm", matchDate: "2026-09-01", homeTeam: "HKFC C", matchStatus: "Played", season: "2026-2027" });
    const s = stateFor([curr.card, futureCard], [curr.match, futureMatch], { currentSeason: "2025-2026", previousSeason: "2024-2025" });
    expect(s.points).toBe(2);
    expect(s.events).toHaveLength(0);
    expect(s.active).toBe(false);
  });

  it("previous-season cards carry an outstanding suspension but not points", () => {
    const prevA = mc({ id: "mc-pa", player: ["p1"], match: ["pa"], team: "HKFC C", cards: ["Y2"], season: "2024-2025" });
    const prevB = mc({ id: "mc-pb", player: ["p1"], match: ["pb"], team: "HKFC C", cards: ["Y2"], season: "2024-2025" });
    const ma = m({ id: "pa", matchDate: "2026-06-14", homeTeam: "HKFC C", matchStatus: "Played", season: "2024-2025" });
    const mb = m({ id: "pb", matchDate: "2026-06-21", homeTeam: "HKFC C", matchStatus: "Played", season: "2024-2025" });
    const s = stateFor([prevA, prevB], [ma, mb], { currentSeason: "2025-2026", previousSeason: "2024-2025" });
    expect(s.points).toBe(0);
    expect(s.active).toBe(true);
    expect(s.remainingMatches).toBe(1);
  });

  it("carried suspension is served by a current-season registered-team fixture", () => {
    const prevA = mc({ id: "mc-pa", player: ["p1"], match: ["pa"], team: "HKFC C", cards: ["Y2"], season: "2024-2025" });
    const prevB = mc({ id: "mc-pb", player: ["p1"], match: ["pb"], team: "HKFC C", cards: ["Y2"], season: "2024-2025" });
    const ma = m({ id: "pa", matchDate: "2026-06-14", homeTeam: "HKFC C", matchStatus: "Played", season: "2024-2025" });
    const mb = m({ id: "pb", matchDate: "2026-06-21", homeTeam: "HKFC C", matchStatus: "Played", season: "2024-2025" });
    const curr = fixture({ id: "c1", date: "2026-07-12" });
    const s = stateFor([prevA, prevB], [ma, mb, curr], { currentSeason: "2025-2026", previousSeason: "2024-2025" });
    expect(s.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registered Team serving
// ---------------------------------------------------------------------------

describe("registered team serving", () => {
  it("uses the registered team, not the team played for", () => {
    const card = mc({ id: "mc-x", player: ["p1"], match: ["mx"], team: "HKFC B", playerTeam: "HKFC C", cards: ["Y2", "Y1"], season: "2025-2026" });
    const trigger = m({ id: "mx", matchDate: "2026-07-05", homeTeam: "HKFC B", matchStatus: "Played" });

    const sB = stateFor([card], [trigger, fixture({ id: "fb", date: "2026-07-12", team: "HKFC B" })], { registeredTeam: "HKFC C" });
    expect(sB.active).toBe(true);

    const sC = stateFor([card], [trigger, fixture({ id: "fc", date: "2026-07-12", team: "HKFC C" })], { registeredTeam: "HKFC C" });
    expect(sC.active).toBe(false);
  });

  it("serving team metadata reflects the registered team", () => {
    const card = mc({ id: "mc-x", player: ["p1"], match: ["mx"], team: "HKFC B", cards: ["Y2", "Y1"], season: "2025-2026" });
    const trigger = m({ id: "mx", matchDate: "2026-07-05", homeTeam: "HKFC B", matchStatus: "Played" });
    const s = stateFor([card], [trigger], { registeredTeam: "HKFC C" });
    expect(s.events[0].servingTeam).toBe("HKFC C");
    expect(s.servingTeam).toBe("HKFC C");
  });

  it("snapshots the serving team at trigger time (registration change)", () => {
    // Card recorded while registered to HKFC C (playerTeam snapshot) even though
    // the player played for HKFC B; the player has since been re-registered to
    // HKFC B (current registeredTeam override). Serving must use the snapshot.
    const card = mc({ id: "mc-x", player: ["p1"], match: ["mx"], team: "HKFC B", playerTeam: "HKFC C", cards: ["Y2", "Y1"], season: "2025-2026" });
    const trigger = m({ id: "mx", matchDate: "2026-07-05", homeTeam: "HKFC B", matchStatus: "Played" });

    const sC = stateFor([card], [trigger, fixture({ id: "fc", date: "2026-07-12", team: "HKFC C" })], { registeredTeam: "HKFC B" });
    expect(sC.events[0].servingTeam).toBe("HKFC C");
    expect(sC.active).toBe(false); // served by the snapshot team HKFC C

    const sB = stateFor([card], [trigger, fixture({ id: "fb", date: "2026-07-12", team: "HKFC B" })], { registeredTeam: "HKFC B" });
    expect(sB.events[0].servingTeam).toBe("HKFC C");
    expect(sB.active).toBe(true); // current team HKFC B does not serve
  });
});

// ---------------------------------------------------------------------------
// Sequential servicing
// ---------------------------------------------------------------------------

describe("sequential servicing", () => {
  it("one fixture cannot serve two suspension events", () => {
    // A single match crosses both 5 (event 1) and 10 (event 2): Y2(3)+Y1(2)=5, +Y5(4)+Y7(1)=10.
    const t = cardWith({ cards: ["Y2", "Y1", "Y5", "Y7"], matchId: "t", date: "2026-07-05" });
    const cards = [t.card];
    const matches = [t.match];

    const s1 = stateFor(cards, [...matches, fixture({ id: "f1", date: "2026-07-12" })]);
    expect(s1.active).toBe(true);
    expect(s1.remainingMatches).toBe(2);

    const s2 = stateFor(cards, [...matches, fixture({ id: "f1", date: "2026-07-12" }), fixture({ id: "f2", date: "2026-07-19" })]);
    expect(s2.active).toBe(true);
    expect(s2.remainingMatches).toBe(1);

    const s3 = stateFor(cards, [...matches, fixture({ id: "f1", date: "2026-07-12" }), fixture({ id: "f2", date: "2026-07-19" }), fixture({ id: "f3", date: "2026-07-26" })]);
    expect(s3.active).toBe(false);
    expect(s3.remainingMatches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Escalation + service end-to-end
// ---------------------------------------------------------------------------

describe("escalation and service end-to-end", () => {
  it("3 + Y2 = 6 -> 1-match; served -> eligible; +4 -> 10 -> 2-match; served sequentially", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" }); // 6

    const s1 = stateFor([a.card, b.card], [a.match, b.match]);
    expect(s1.events).toHaveLength(1);
    expect(s1.active).toBe(true);
    expect(s1.remainingMatches).toBe(1);

    const f1 = fixture({ id: "f1", date: "2026-07-19" });
    const s2 = stateFor([a.card, b.card], [a.match, b.match, f1]);
    expect(s2.active).toBe(false);
    expect(s2.remainingMatches).toBe(0);

    const c = cardWith({ cards: ["Y5"], matchId: "c", date: "2026-07-26" }); // +4 = 10
    const s3 = stateFor([a.card, b.card, c.card], [a.match, b.match, c.match, f1]);
    expect(s3.events).toHaveLength(2);
    expect(s3.events[1].threshold).toBe(10);
    expect(s3.active).toBe(true);
    expect(s3.remainingMatches).toBe(2);

    const f2 = fixture({ id: "f2", date: "2026-08-02" });
    const s4 = stateFor([a.card, b.card, c.card], [a.match, b.match, c.match, f1, f2]);
    expect(s4.active).toBe(true);
    expect(s4.remainingMatches).toBe(1);

    const f3 = fixture({ id: "f3", date: "2026-08-09" });
    const s5 = stateFor([a.card, b.card, c.card], [a.match, b.match, c.match, f1, f2, f3]);
    expect(s5.active).toBe(false);
    expect(s5.remainingMatches).toBe(0);
  });

  it("points are retained after serving (not reset to zero)", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" }); // 6
    const f1 = fixture({ id: "f1", date: "2026-07-19" });
    const c = cardWith({ cards: ["Y5"], matchId: "c", date: "2026-07-26" }); // 10
    const s = stateFor([a.card, b.card, c.card], [a.match, b.match, c.match, f1]);
    expect(s.points).toBe(10);
    expect(s.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Completed match criteria
// ---------------------------------------------------------------------------

describe("completed match criteria", () => {
  function trigger(): { cards: MatchCard[]; matches: Match[] } {
    const t = cardWith({ cards: ["Y2", "Y1"], matchId: "trigger", date: "2026-07-05" });
    return { cards: [t.card], matches: [t.match] };
  }

  it("Scheduled does not serve", () => {
    const { cards, matches } = trigger();
    const s = stateFor(cards, [...matches, m({ id: "f1", homeTeam: "HKFC C", matchStatus: "Scheduled", matchDate: "2026-07-12" })]);
    expect(s.active).toBe(true);
  });

  it("Rescheduled does not serve", () => {
    const { cards, matches } = trigger();
    const s = stateFor(cards, [...matches, m({ id: "f1", homeTeam: "HKFC C", matchStatus: "Rescheduled", matchDate: "2026-07-12" })]);
    expect(s.active).toBe(true);
  });

  it("Played does serve", () => {
    const { cards, matches } = trigger();
    const s = stateFor(cards, [...matches, fixture({ id: "f1", date: "2026-07-12" })]);
    expect(s.active).toBe(false);
  });

  it("Cancelled does not serve", () => {
    const { cards, matches } = trigger();
    const s = stateFor(cards, [...matches, m({ id: "f1", homeTeam: "HKFC C", matchStatus: "Cancelled", matchDate: "2026-07-12" })]);
    expect(s.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suspended player needs no Match Card
// ---------------------------------------------------------------------------

describe("suspended player needs no Match Card", () => {
  it("a team fixture serves the suspension even with no player Match Card", () => {
    const t = cardWith({ cards: ["Y2", "Y1"], matchId: "trigger", date: "2026-07-05" });
    const serve = fixture({ id: "f1", date: "2026-07-12" });
    const s = stateFor([t.card], [t.match, serve]);
    expect(s.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Indeterminate service + diagnostics
// ---------------------------------------------------------------------------

describe("indeterminate service and diagnostics", () => {
  it("missing match link -> indeterminate + diagnostic, stays blocked", () => {
    const a = mc({ id: "c1", player: ["p1"], match: undefined, cards: ["Y2"], season: "2025-2026" });
    const b = mc({ id: "c2", player: ["p1"], match: undefined, cards: ["Y2"], season: "2025-2026" });
    const s = stateFor([a, b], []);
    expect(s.points).toBe(6);
    expect(s.active).toBe(true);
    expect(s.serviceStatus).toBe("indeterminate");
    expect(s.diagnostics).toHaveLength(1);
    expect(s.diagnostics[0]).toContain("no Match link");
  });

  it("missing match date -> indeterminate + diagnostic, stays blocked", () => {
    const a = mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2"], season: "2025-2026" });
    const b = mc({ id: "c2", player: ["p1"], match: ["m2"], cards: ["Y2"], season: "2025-2026" });
    const s = stateFor([a, b], [
      m({ id: "m1", matchDate: "", matchStatus: "Played" }),
      m({ id: "m2", matchDate: "", matchStatus: "Played" }),
    ]);
    expect(s.points).toBe(6);
    expect(s.active).toBe(true);
    expect(s.serviceStatus).toBe("indeterminate");
    expect(s.diagnostics[0]).toContain("no Match Date");
  });

  it("distinguishes served vs active vs indeterminate", () => {
    expect(stateFor([], []).serviceStatus).toBe("served");
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" });
    const b = cardWith({ cards: ["Y2"], matchId: "b", date: "2026-07-12" });
    expect(stateFor([a.card, b.card], [a.match, b.match]).serviceStatus).toBe("active");
  });

  it("unknown match status does not count as served", () => {
    const t = cardWith({ cards: ["Y2", "Y1"], matchId: "trigger", date: "2026-07-05" });
    const serve = m({ id: "f1", homeTeam: "HKFC C", matchStatus: "InProgress", matchDate: "2026-07-12" });
    const s = stateFor([t.card], [t.match, serve]);
    expect(s.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeSuspensionStates (bulk, per-player)
// ---------------------------------------------------------------------------

describe("computeSuspensionStates", () => {
  it("indexes every carded player once without N+1 queries", () => {
    const c1 = mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2"], season: "2025-2026" });
    const c2 = mc({ id: "c2", player: ["p2"], match: ["m2"], cards: ["Y1"], season: "2025-2026" });
    const c3 = mc({ id: "c3", player: ["p1"], match: ["m3"], cards: ["Y2"], season: "2025-2026" });
    const m1 = m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" });
    const m2 = m({ id: "m2", matchDate: "2026-07-05", matchStatus: "Played" });
    const m3 = m({ id: "m3", matchDate: "2026-07-12", matchStatus: "Played" });
    const states = computeSuspensionStates({
      currentCards: [c1, c2, c3],
      previousCards: [],
      matchesById: new Map([m1, m2, m3].map((x) => [x.id, x])),
      currentSeason: "2025-2026",
      previousSeason: "2024-2025",
      registeredTeamByPlayer: new Map([["p1", "HKFC C"], ["p2", "HKFC C"]]),
    });
    expect(states.get("p1")?.active).toBe(true);
    expect(states.get("p2")?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manual vs automatic coexistence (integration via eligibility Step 2)
// ---------------------------------------------------------------------------

function autoState(active: boolean, indeterminate = false): Map<string, CardSuspensionState> {
  return new Map([
    ["p1", {
      points: 6,
      events: [],
      active,
      remainingMatches: active ? 1 : 0,
      dcReferral: false,
      servingTeam: active ? "HKFC C" : null,
      serviceStatus: active ? (indeterminate ? "indeterminate" : "active") : "served",
      diagnostics: indeterminate ? ["test diagnostic"] : [],
    }],
  ]);
}

describe("manual and automatic suspension coexist (Step 2)", () => {
  it("manual suspension blocks the player", () => {
    const r = evaluatePlayerEligibility(p({ isSuspended: true }), m(), suspensionCtx(new Map()));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });

  it("automatic suspension blocks the player", () => {
    const r = evaluatePlayerEligibility(p(), m(), suspensionCtx(autoState(true)));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });

  it("both active -> blocked", () => {
    const r = evaluatePlayerEligibility(p({ isSuspended: true }), m(), suspensionCtx(autoState(true)));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });

  it("automatic ends but manual remains -> still blocked", () => {
    const r = evaluatePlayerEligibility(p({ isSuspended: true }), m(), suspensionCtx(autoState(false)));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });

  it("manual ends but automatic remains -> still blocked", () => {
    const r = evaluatePlayerEligibility(p({ isSuspended: false, matchesToServe: 0 }), m(), suspensionCtx(autoState(true)));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });

  it("both end -> player becomes eligible (passes Step 2)", () => {
    const r = evaluatePlayerEligibility(p({ isSuspended: false, matchesToServe: 0 }), m(), suspensionCtx(autoState(false)));
    expect(r.status).toBe("eligible");
  });

  it("automatic calculation never mutates the manual People fields", () => {
    const player = p({ isSuspended: false, matchesToServe: 0 });
    evaluatePlayerEligibility(player, m(), suspensionCtx(autoState(true)));
    expect(player.isSuspended).toBe(false);
    expect(player.matchesToServe).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Automatic return to eligibility (integration through the real engine)
// ---------------------------------------------------------------------------

describe("automatic return to eligibility (integration)", () => {
  it("blocked while active, eligible once served", () => {
    const a = cardWith({ cards: ["Y2"], matchId: "a", date: "2026-07-05" }); // 3
    const b = cardWith({ cards: ["Y1"], matchId: "b", date: "2026-07-12" }); // 5
    const registeredTeamByPlayer = new Map([["p1", "HKFC C"]]);

    const activeStates = computeSuspensionStates({
      currentCards: [a.card, b.card],
      previousCards: [],
      matchesById: new Map([a.match, b.match].map((x) => [x.id, x])),
      currentSeason: "2025-2026",
      previousSeason: "2024-2025",
      registeredTeamByPlayer,
    });
    const blocked = evaluatePlayerEligibility(p(), m(), suspensionCtx(activeStates));
    expect(blocked.status).toBe("blocked");
    expect(blocked.reason).toBe("Suspended");
    expect(blocked.ruleId).toBe("SUSPENSION");

    const f1 = fixture({ id: "f1", date: "2026-07-19" });
    const servedStates = computeSuspensionStates({
      currentCards: [a.card, b.card],
      previousCards: [],
      matchesById: new Map([a.match, b.match, f1].map((x) => [x.id, x])),
      currentSeason: "2025-2026",
      previousSeason: "2024-2025",
      registeredTeamByPlayer,
    });
    const eligible = evaluatePlayerEligibility(p(), m(), suspensionCtx(servedStates));
    expect(eligible.status).toBe("eligible");
  });
});

// ---------------------------------------------------------------------------
// Red cards (detected but not auto-calculated)
// ---------------------------------------------------------------------------

describe("red cards", () => {
  it("red cards are detected but do not create an automatic suspension", () => {
    const card = mc({ id: "mc-r", player: ["p1"], match: ["mr"], cards: ["R1"], season: "2025-2026" });
    const match = m({ id: "mr", matchDate: "2026-07-05", matchStatus: "Played" });
    const s = stateFor([card], [match]);
    expect(s.points).toBe(0);
    expect(s.events).toHaveLength(0);
    expect(s.active).toBe(false);
  });

  it("a red card does not clear an existing manual suspension", () => {
    const card = mc({ id: "mc-r", player: ["p1"], match: ["mr"], cards: ["R1"], season: "2025-2026" });
    const match = m({ id: "mr", matchDate: "2026-07-05", matchStatus: "Played" });
    const states = computeSuspensionStates({
      currentCards: [card],
      previousCards: [],
      matchesById: new Map([[match.id, match]]),
      currentSeason: "2025-2026",
      previousSeason: "2024-2025",
      registeredTeamByPlayer: new Map([["p1", "HKFC C"]]),
    });
    const r = evaluatePlayerEligibility(p({ isSuspended: true }), m(), suspensionCtx(states));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });
});

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

describe("data quality", () => {
  it("missing player link: card is ignored", () => {
    const card = mc({ id: "c1", player: undefined, cards: ["Y2"], season: "2025-2026" });
    const s = stateFor([card], []);
    expect(s.points).toBe(0);
    expect(s.active).toBe(false);
  });

  it("inconsistent season: card season wins over match season", () => {
    const card = mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2"], season: "2024-2025" });
    const match = m({ id: "m1", matchDate: "2026-05-10", season: "2025-2026", matchStatus: "Played" });
    const s = stateFor([card], [match], { currentSeason: "2025-2026", previousSeason: "2024-2025" });
    expect(s.points).toBe(0);
  });

  it("future match date still counts its card (the card was issued)", () => {
    const a = mc({ id: "c1", player: ["p1"], match: ["m1"], cards: ["Y2"], season: "2025-2026" });
    const b = mc({ id: "c2", player: ["p1"], match: ["m2"], cards: ["Y2"], season: "2025-2026" });
    const m1 = m({ id: "m1", matchDate: "2099-01-01", matchStatus: "Played" });
    const m2 = m({ id: "m2", matchDate: "2099-01-08", matchStatus: "Played" });
    const s = stateFor([a, b], [m1, m2]);
    expect(s.points).toBe(6);
    expect(s.active).toBe(true);
  });
});
