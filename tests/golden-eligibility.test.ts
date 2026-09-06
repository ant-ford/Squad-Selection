import { describe, it, expect, vi } from "vitest";

vi.mock("../worker/src/airtable", () => ({
  linkId: (value: unknown): string | undefined => {
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  },
  escapeFormulaValue: (v: string) => v,
}));

import {
  evaluatePlayerEligibility,
  computeCompletedLeagueMatchCounts,
  RULE_IDS,
  type EvaluationContext,
  type VirtualSelection,
} from "../worker/src/eligibility";
import { linkId } from "../worker/src/airtable";
import { computeSuspensionStates } from "../worker/src/suspension";
import type { Match, MatchCard, Player, Team } from "../shared/schema/domainTypes";

// ── Factories ────────────────────────────────────────────────────────────
function t(name: string, rank: number, isPremier = false): Team {
  return { id: `team_${name.toLowerCase()}`, teamName: name, teamRank: rank, isPremier, active: true };
}
function p(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1", active: true, registeredTeam: "HKFC C", playingPosition: "Defender",
    playingAbility: "B", isVisitingPlayer: false, isSuspended: false, matchesToServe: 0,
    everRegisteredToPremier: false, u21Eligible: false, preferredName: "Test Player",
    ...overrides,
  };
}
function m(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1", matchDate: "2026-07-05", season: "2025-2026", homeTeam: "HKFC C",
    awayTeam: "Opponent C", homeTeamScore: 0, awayTeamScore: 0, division: "Division 2",
    competitionType: "League", matchStatus: "Scheduled", ...overrides,
  };
}
function mc(overrides: Partial<MatchCard> = {}): MatchCard {
  return {
    id: "mc1", player: ["p1"], match: ["m1"], team: "HKFC C", playerTeam: "HKFC C",
    playUp: false, goalkeeper: false, season: "2025-2026", ...overrides,
  };
}
function sel(overrides: Partial<VirtualSelection> = {}) {
  return { player: ["p1"], match: ["m1"], ...overrides } as VirtualSelection;
}

type CtxOverrides = Partial<EvaluationContext> & {
  matches?: Match[];
  sameDayMatches?: Match[];
  allSelections?: VirtualSelection[];
  allExceptions?: { playerId: string; matchId: string; status: string }[];
};

function ctx(overrides: CtxOverrides = {}): EvaluationContext {
  const teams = overrides.teamMap
    ? [...overrides.teamMap.values()]
    : [t("HKFC A", 1, true), t("HKFC B", 2), t("HKFC C", 3), t("HKFC D", 4), t("HKFC E", 5)];
  const rankMap = overrides.rankMap ?? Object.fromEntries(teams.map((tm) => [tm.teamName!, tm.teamRank ?? 99]));
  const teamMap = overrides.teamMap ?? new Map(teams.map((tm) => [tm.teamName!, tm]));
  const sameDayMatches = overrides.sameDayMatches ?? [];
  const allSelections = overrides.allSelections ?? [];
  const matchCards = overrides.matchCards ?? [];
  const matchesById = new Map<string, Match>((overrides.matches ?? []).map((mm) => [mm.id, mm]));

  const sameDayFixtures = sameDayMatches.flatMap((item) => {
    const out: { matchId: string; teamName: string }[] = [];
    if (rankMap[item.homeTeam || ""] !== undefined) out.push({ matchId: item.id, teamName: item.homeTeam });
    if (rankMap[item.awayTeam || ""] !== undefined) out.push({ matchId: item.id, teamName: item.awayTeam });
    return out;
  });

  const resolveTeam = (s: VirtualSelection): string | undefined => {
    if (s.team) return s.team;
    const mm = sameDayMatches.find((x) => x.id === linkId(s.match));
    if (!mm) return undefined;
    return rankMap[mm.homeTeam || ""] !== undefined ? mm.homeTeam : rankMap[mm.awayTeam || ""] !== undefined ? mm.awayTeam : undefined;
  };

  const selectionsByPlayer = new Map<string, Set<string>>();
  const sameDaySelectionsByTeam = new Map<string, Set<string>>();
  const sameDayIds = new Set(sameDayMatches.map((x) => x.id));
  for (const s of allSelections) {
    const pid = linkId(s.player); const mid = linkId(s.match); const team = resolveTeam(s);
    if (!pid || !mid || !team) continue;
    const set = selectionsByPlayer.get(pid) ?? new Set<string>();
    set.add(`${mid}:${team}`);
    selectionsByPlayer.set(pid, set);
    if (sameDayIds.has(mid)) {
      const tset = sameDaySelectionsByTeam.get(team) ?? new Set<string>();
      tset.add(pid);
      sameDaySelectionsByTeam.set(team, tset);
    }
  }

  const allExceptions = (overrides.allExceptions ?? []) as { playerId: string; matchId: string; status: string }[];
  const matchCardsByPlayer = new Map<string, MatchCard[]>();
  for (const card of matchCards) {
    const pid = linkId(card.player);
    if (!pid) continue;
    matchCardsByPlayer.set(pid, [...(matchCardsByPlayer.get(pid) ?? []), card]);
  }

  // Automatic card suspension: run the real engine so golden tests protect the
  // full pipeline (cards -> points -> events -> suspensionByPlayer -> Step 2).
  const registeredTeamByPlayer = new Map<string, string>();
  for (const card of matchCards) {
    const pid = linkId(card.player);
    if (pid && card.playerTeam) registeredTeamByPlayer.set(pid, card.playerTeam);
  }
  if (overrides.playersById) {
    for (const [pid, player] of overrides.playersById) {
      if (player.registeredTeam) registeredTeamByPlayer.set(pid, player.registeredTeam);
    }
  }
  const suspensionByPlayer = computeSuspensionStates({
    currentCards: matchCards,
    previousCards: [],
    matchesById,
    currentSeason: overrides.currentSeason ?? "2025-2026",
    previousSeason: null,
    registeredTeamByPlayer,
  });

  return {
    teamMap, rankMap, sameDayMatches, sameDayFixtures, allSelections,
    selectionsByPlayer, sameDaySelectionsByTeam, allExceptions,
    unavailablePlayerMatchKeys: new Set(
      allExceptions.filter((e) => e.status === "Unavailable").map((e) => `${e.playerId}:${e.matchId}`),
    ),
    matchCards, matchCardsByPlayer, matchesById, suspensionByPlayer,
    currentSeason: overrides.currentSeason ?? "2025-2026",
    playersById: overrides.playersById ?? new Map(),
    completedLeagueMatchesByTeam: overrides.completedLeagueMatchesByTeam ??
      computeCompletedLeagueMatchCounts({ matchCards, matchesById }),
  } as EvaluationContext;
}

// ── Golden block matrix: exact string + rule ID per Spec §16 ─────────────
describe("Golden: every blocked reason string and rule ID", () => {
  it("ADMIN_DATA_INCOMPLETE", () => {
    const r = evaluatePlayerEligibility(p({ active: false }), m(), ctx());
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Admin data incomplete");
    expect(r.ruleId).toBe(RULE_IDS.ADMIN_DATA_INCOMPLETE);
  });
  it("SUSPENSION (flag and matches-to-serve)", () => {
    const a = evaluatePlayerEligibility(p({ isSuspended: true }), m(), ctx());
    const b = evaluatePlayerEligibility(p({ matchesToServe: 2 }), m(), ctx());
    for (const r of [a, b]) {
      expect(r.reason).toBe("Suspended");
      expect(r.ruleId).toBe(RULE_IDS.SUSPENSION);
    }
  });
  it("SUSPENSION (automatic card accumulation)", () => {
    // 5 yellow points purely from Match Cards (no manual isSuspended flag).
    const cards = [
      mc({ id: "mc-a", match: ["m1"], cards: ["Y2"] }), // 3 points
      mc({ id: "mc-b", match: ["m2"], cards: ["Y1"] }), // +2 = 5 points
    ];
    const r = evaluatePlayerEligibility(
      p(),
      m(),
      ctx({
        matchCards: cards,
        matches: [
          m({ id: "m1", matchDate: "2026-07-05", matchStatus: "Played" }),
          m({ id: "m2", matchDate: "2026-07-12", matchStatus: "Played" }),
        ],
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
    expect(r.ruleId).toBe(RULE_IDS.SUSPENSION);
  });
  it("VISITING_FIXED_TEAM", () => {
    const r = evaluatePlayerEligibility(p({ isVisitingPlayer: true }), m({ homeTeam: "HKFC B" }), ctx());
    expect(r.reason).toBe("Visiting player — fixed to registered team");
    expect(r.ruleId).toBe(RULE_IDS.VISITING_FIXED_TEAM);
  });
  it("VISITING_CUP_APPEARANCES", () => {
    const cards = [1, 2, 3].map((i) => mc({ id: `mc${i}` }));
    const r = evaluatePlayerEligibility(
      p({ isVisitingPlayer: true }), m({ competitionType: "Cup" }), ctx({ matchCards: cards }),
    );
    expect(r.reason).toBe("Visiting player — fewer than 5 appearances for registered team");
    expect(r.ruleId).toBe(RULE_IDS.VISITING_CUP_APPEARANCES);
  });
  it("VISITING_CUP counts registered-team appearances only", () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      mc({ id: `mc${i}`, team: "HKFC B", playerTeam: "HKFC B" }),
    );
    const r = evaluatePlayerEligibility(
      p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
      m({ homeTeam: "HKFC C", competitionType: "Cup" }),
      ctx({ matchCards: cards }),
    );
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Visiting player — fewer than 5 appearances for registered team");
    expect(r.ruleId).toBe(RULE_IDS.VISITING_CUP_APPEARANCES);
  });
  it("SAME_DAY_AVAILABLE (availability surfaced as a warning, calendar-day)", () => {
    const r = evaluatePlayerEligibility(
      p(), m({ homeTeam: "HKFC C" }),
      ctx({ sameDayMatches: [m({ id: "m2", homeTeam: "HKFC A" })] }),
    );
    expect(r.status).toBe("warning");
    expect(r.warnings).toContain("Available for HKFC A on same day");
    expect(r.sameDayHigherTeam).toBe("HKFC A");
  });
  it("SAME_DAY_SELECTED", () => {
    const r = evaluatePlayerEligibility(
      p(), m({ homeTeam: "HKFC C" }),
      ctx({
        sameDayMatches: [m({ id: "m2", homeTeam: "HKFC A" })],
        allSelections: [sel({ player: ["p1"], match: ["m2"] })],
        allExceptions: [{ playerId: "p1", matchId: "m2", status: "Unavailable" }],
      }),
    );
    expect(r.reason).toBe("Selected for HKFC A on same day");
    expect(r.ruleId).toBe(RULE_IDS.SAME_DAY_SELECTED);
  });
  it("HIGHER_TO_LOWER (non-Premier)", () => {
    const r = evaluatePlayerEligibility(p({ registeredTeam: "HKFC B" }), m({ homeTeam: "HKFC D" }), ctx());
    expect(r.reason).toBe("Higher-to-lower movement requires Committee approval");
    expect(r.ruleId).toBe(RULE_IDS.HIGHER_TO_LOWER);
  });
  it("PREMIER_MOVEMENT (fires before play-up rules, any direction)", () => {
    const down = evaluatePlayerEligibility(p({ registeredTeam: "HKFC A" }), m({ homeTeam: "HKFC B" }), ctx());
    const jump = evaluatePlayerEligibility(p({ registeredTeam: "HKFC A" }), m({ homeTeam: "HKFC D" }), ctx());
    for (const r of [down, jump]) {
      expect(r.reason).toBe("Premier movement restriction — team has not completed 3 matches");
      expect(r.ruleId).toBe(RULE_IDS.PREMIER_MOVEMENT);
    }
  });
  it("PLAYUP_LIMIT (4th appearance, GK excluded)", () => {
    const cards = [1, 2, 3, 4].map((i) =>
      mc({ id: `mc${i}`, team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
    );
    const r = evaluatePlayerEligibility(p(), m({ homeTeam: "HKFC B" }), ctx({ matchCards: cards }));
    expect(r.reason).toBe("Play-up limit reached — re-registration required");
    expect(r.ruleId).toBe(RULE_IDS.PLAYUP_LIMIT);
    expect(r.playUpCount).toBe(4);
  });
  it("CUP_BAN_PREMIER", () => {
    const r = evaluatePlayerEligibility(
      p({ everRegisteredToPremier: true, registeredTeam: "HKFC B" }),
      m({ homeTeam: "HKFC B", competitionType: "Cup" }), ctx(),
    );
    expect(r.reason).toBe("Cup ban — ever registered to Premier Division");
    expect(r.ruleId).toBe(RULE_IDS.CUP_BAN_PREMIER);
  });
  it("CUP_MIN_LEAGUE_APPEARANCES", () => {
    const r = evaluatePlayerEligibility(p(), m({ competitionType: "Cup" }), ctx({ matchCards: [mc()] }));
    expect(r.reason).toBe("Fewer than 2 league appearances — ineligible for Cup");
    expect(r.ruleId).toBe(RULE_IDS.CUP_MIN_LEAGUE_APPEARANCES);
  });
  it("CROSS_CUP (dynamic team name)", () => {
    const cards = [
      mc({ id: "mc1" }), mc({ id: "mc2" }),
      mc({ id: "mc3", team: "HKFC D", match: ["cup-d"] }),
    ];
    const r = evaluatePlayerEligibility(
      p(), m({ competitionType: "Cup" }),
      ctx({ matchCards: cards, matches: [m({ id: "m1" }), m({ id: "cup-d", competitionType: "Cup" })] }),
    );
    expect(r.reason).toBe("Already played in a Cup for HKFC D this season");
    expect(r.ruleId).toBe(RULE_IDS.CROSS_CUP);
  });
  it("U21_DOUBLE_GAME_LIMIT", () => {
    const sameDayMatches = [
      m({ id: "m1", homeTeam: "HKFC B" }), m({ id: "m2", homeTeam: "HKFC D" }), m({ id: "m3", homeTeam: "HKFC E" }),
    ];
    const allSelections = [
      sel({ player: ["u1"], match: ["m1"] }), sel({ player: ["u1"], match: ["m2"] }),
      sel({ player: ["u2"], match: ["m1"] }), sel({ player: ["u2"], match: ["m3"] }),
      sel({ player: ["u3"], match: ["m1"] }), sel({ player: ["u3"], match: ["m2"] }),
    ];
    const playersById = new Map([
      ["u1", p({ id: "u1", u21Eligible: true, registeredTeam: "HKFC D" })],
      ["u2", p({ id: "u2", u21Eligible: true, registeredTeam: "HKFC E" })],
      ["u3", p({ id: "u3", u21Eligible: true, registeredTeam: "HKFC D" })],
    ]);
    const r = evaluatePlayerEligibility(
      p({ u21Eligible: true, registeredTeam: "HKFC E" }),
      m({ id: "m1", homeTeam: "HKFC B" }),
      ctx({ sameDayMatches, allSelections, playersById }),
    );
    expect(r.reason).toBe("U21 double-game limit reached");
    expect(r.ruleId).toBe(RULE_IDS.U21_DOUBLE_GAME_LIMIT);
  });
});

// ── Golden warning matrix ─────────────────────────────────────────────────
describe("Golden: every warning string and rule ID", () => {
  it("WARN_PLAYUP_SECOND / THIRD", () => {
    const two = [1, 2].map((i) => mc({ id: `mc${i}`, team: "HKFC B", playerTeam: "HKFC C", playUp: true }));
    const three = [...two, mc({ id: "mc3", team: "HKFC B", playerTeam: "HKFC C", playUp: true })];
    const r2 = evaluatePlayerEligibility(p(), m({ homeTeam: "HKFC B" }), ctx({ matchCards: two }));
    const r3 = evaluatePlayerEligibility(p(), m({ homeTeam: "HKFC B" }), ctx({ matchCards: three }));
    expect(r2.status).toBe("warning");
    expect(r2.warnings).toContain("Second play-up appearance");
    expect(r3.warnings).toContain("Third play-up appearance");
  });
  it("WARN_VISITING_EARLY_SEASON", () => {
    const r = evaluatePlayerEligibility(
      p({ isVisitingPlayer: true }), m(), ctx({ matchCards: [mc()] }),
    );
    expect(r.warnings).toContain("Visiting player early-season requirement at risk");
  });
  it("WARN_U21_APPROACHING", () => {
    const sameDayMatches = [m({ id: "m1", homeTeam: "HKFC B" }), m({ id: "m2", homeTeam: "HKFC D" }), m({ id: "m3", homeTeam: "HKFC E" })];
    const allSelections = [
      sel({ player: ["u1"], match: ["m1"] }), sel({ player: ["u1"], match: ["m2"] }),
      sel({ player: ["u2"], match: ["m1"] }), sel({ player: ["u2"], match: ["m3"] }),
    ];
    const playersById = new Map([
      ["u1", p({ id: "u1", u21Eligible: true, registeredTeam: "HKFC D" })],
      ["u2", p({ id: "u2", u21Eligible: true, registeredTeam: "HKFC E" })],
    ]);
    const r = evaluatePlayerEligibility(
      p({ u21Eligible: true, registeredTeam: "HKFC E" }),
      m({ id: "m1", homeTeam: "HKFC B" }),
      ctx({ sameDayMatches, allSelections, playersById }),
    );
    expect(r.status).toBe("warning");
    expect(r.warnings).toContain("U21 double-game limit approaching");
  });
  it("reason and ruleId are null when not blocked", () => {
    const r = evaluatePlayerEligibility(p(), m(), ctx());
    expect(r.status).toBe("eligible");
    expect(r.reason).toBeNull();
    expect(r.ruleId).toBeNull();
  });
});

// ── Golden: frozen evaluation order (Spec §4) ────────────────────────────
describe("Golden: evaluation order never changes", () => {
  it("Step 1 before Step 2", () => {
    const r = evaluatePlayerEligibility(p({ active: false, isSuspended: true }), m(), ctx());
    expect(r.reason).toBe("Admin data incomplete");
  });
  it("Step 2 before Step 3", () => {
    const r = evaluatePlayerEligibility(
      p({ isSuspended: true, isVisitingPlayer: true }), m({ homeTeam: "HKFC B" }), ctx(),
    );
    expect(r.reason).toBe("Suspended");
  });
  it("Step 3 before Step 4", () => {
    const r = evaluatePlayerEligibility(
      p({ isVisitingPlayer: true }), m({ homeTeam: "HKFC B" }),
      ctx({ sameDayMatches: [m({ id: "m2", homeTeam: "HKFC A" })] }),
    );
    expect(r.reason).toBe("Visiting player — fixed to registered team");
  });
  it("Step 5 before Step 6 when Premier boundary crossed", () => {
    const r = evaluatePlayerEligibility(p({ registeredTeam: "HKFC A" }), m({ homeTeam: "HKFC D" }), ctx());
    expect(r.reason).toBe("Premier movement restriction — team has not completed 3 matches");
  });
});