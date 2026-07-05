import { describe, it, expect, vi } from "vitest";

// Mock the airtable module so linkId just passes strings through
vi.mock("../worker/src/airtable", () => ({
  linkId: (value: unknown): string | undefined => {
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  },
  escapeFormulaValue: (v: string) => v,
}));

import { evaluatePlayerEligibility, type EvaluationContext, type EligibilityReasonTag } from "../worker/src/eligibility";
import type { Match, MatchCard, Player, SquadSelection, Team } from "../src/generated/domainTypes";

// ── Test Data Factory ───────────────────────────────────────────────────

type TeamMap = Map<string, Team>;
type RankMap = Record<string, number>;

function t(name: string, rank: number, isPremier = false): Team {
  return { id: `team_${name.toLowerCase()}`, teamName: name, teamRank: rank, isPremier, active: true };
}

function buildMaps(teams: Team[]): { teamMap: TeamMap; rankMap: RankMap } {
  const teamMap = new Map<string, Team>();
  const rankMap: RankMap = {};
  for (const t of teams) {
    if (t.teamName) {
      teamMap.set(t.teamName, t);
      rankMap[t.teamName] = t.teamRank ?? 99;
    }
  }
  return { teamMap, rankMap };
}

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
    awayTeam: "Opponent C",
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

function sel(overrides: Partial<SquadSelection> = {}): SquadSelection {
  return {
    id: "s1",
    player: ["p1"],
    match: ["m1"],
    selectionStatus: "Selected",
    ...overrides,
  };
}

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  const { teamMap, rankMap } = buildMaps([
    t("HKFC A", 1, true),
    t("HKFC B", 2),
    t("HKFC C", 3),
    t("HKFC D", 4),
    t("HKFC E", 5),
  ]);
  return {
    teamMap,
    rankMap,
    sameDayMatches: [],
    allSelections: [],
    allExceptions: [],
    matchCards: [],
    currentSeason: "2025-2026",
    playersById: new Map(),
    ...overrides,
  };
}

function resultProps(r: ReturnType<typeof evaluatePlayerEligibility>) {
  return {
    status: r.status,
    reason: r.reason,
    warnings: r.warnings,
    playUpCount: r.playUpCount,
    selectedByTeam: r.selectedByTeam,
    sameDayHigherTeam: r.sameDayHigherTeam,
    hasReasonTag: r.reasonTag !== null,
    reasonTagSource: r.reasonTag?.source ?? null,
    reasonTagIsOverride: r.reasonTag?.isHkfcOverride ?? null,
    warningTagCount: r.warningTags.length,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("evaluatePlayerEligibility", () => {
  // ─── Step 1: Admin Data Validation ────────────────────────────────

  describe("Step 1: Admin Data Validation (§2.2)", () => {
    it("allows player with complete admin data", () => {
      const r = evaluatePlayerEligibility(p(), m(), ctx());
      expect(r.status).toBe("eligible");
    });

    it("blocks inactive player", () => {
      const r = evaluatePlayerEligibility(p({ active: false }), m(), ctx());
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Admin data incomplete");
    });

    it("blocks player missing Registered Team", () => {
      const r = evaluatePlayerEligibility(p({ registeredTeam: "" }), m(), ctx());
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Admin data incomplete");
    });

    it("blocks player missing Playing Position", () => {
      const r = evaluatePlayerEligibility(p({ playingPosition: "" }), m(), ctx());
      expect(r.status).toBe("blocked");
    });

    it("blocks player missing Playing Ability", () => {
      const r = evaluatePlayerEligibility(p({ playingAbility: "" }), m(), ctx());
      expect(r.status).toBe("blocked");
    });
  });

  // ─── Step 2: Suspension ───────────────────────────────────────────

  describe("Step 2: Suspension (§5)", () => {
    it("blocks suspended player", () => {
      const r = evaluatePlayerEligibility(p({ isSuspended: true }), m(), ctx());
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Suspended");
      expect(r.reasonTag?.source).toBe("Bye-Law 16.3–16.10");
    });

    it("blocks player with matches to serve", () => {
      const r = evaluatePlayerEligibility(p({ matchesToServe: 2 }), m(), ctx());
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Suspended");
    });

    it("allows player not suspended", () => {
      const r = evaluatePlayerEligibility(p({ isSuspended: false, matchesToServe: 0 }), m(), ctx());
      expect(r.status).not.toBe("blocked");
    });
  });

  // ─── Step 3: Visiting Player ──────────────────────────────────────

  describe("Step 3: Visiting Player Restrictions (§6)", () => {
    it("allows visiting player on their registered team (league match)", () => {
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "League" }),
        ctx()
      );
      expect(r.status).not.toBe("blocked");
    });

    it("blocks visiting player on a different team", () => {
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx()
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Visiting player — fixed to registered team");
      expect(r.reasonTag?.source).toBe("Bye-Law 6.1–6.2 & HKFC Spec §6.2");
    });

    it("blocks visiting player in cup with fewer than 5 league appearances", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" }), // 4 apps
      ];
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Visiting player — fewer than 5 appearances for registered team");
    });

    it("allows visiting player in cup with 5+ league appearances", () => {
      const matchCards = Array.from({ length: 5 }, (_, i) =>
        mc({ id: `mc${i}`, player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" })
      );
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      // Not blocked by visiting player (may still be blocked by other rules)
      expect(r.reason).not.toBe("Visiting player — fewer than 5 appearances for registered team");
    });

    it("only counts appearances for registered team (not other teams)", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC B", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC B", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC B", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC B", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC B", season: "2025-2026" }),
      ];
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      // Registered team is HKFC C but all 5 appearances are for HKFC B
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Visiting player — fewer than 5 appearances for registered team");
    });

    it("handles match cards without competition type info gracefully", () => {
      const matchCards = Array.from({ length: 5 }, (_, i) => mc({
        id: `mc${i}`,
        player: ["p1"],
        team: "HKFC C",
        playerTeam: "HKFC C",
        season: "2025-2026",
        match: undefined, // no match link
      }));
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      expect(r.reason).not.toBe("Visiting player — fewer than 5 appearances for registered team");
    });
  });

  // ─── Step 4: Same-Day Movement ────────────────────────────────────

  describe("Step 4: Same-Day Movement (§7)", () => {
    it("blocks lower team when player is available for higher team same day", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC A", matchDate: "2026-07-05" }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Available for HKFC A on same day");
      expect(r.sameDayHigherTeam).toBe("HKFC A");
      expect(r.reasonTag?.source).toBe("Bye-Law 7.1 & HKFC Spec §7.2");
    });

    it("allows lower team when player has Unavailable exception for higher team", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC A", matchDate: "2026-07-05" }),
      ];
      const allExceptions = [
        { playerId: "p1", matchId: "m2", status: "Unavailable" },
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allExceptions })
      );
      expect(r.status).not.toBe("blocked");
    });

    it("blocks when already selected by higher team same day", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC A", matchDate: "2026-07-05" }),
      ];
      const allSelections = [
        sel({ id: "s2", player: ["p1"], match: ["m2"], selectionStatus: "Selected" }),
      ];
      const allExceptions = [
        { playerId: "p1", matchId: "m2", status: "Unavailable" },
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allSelections, allExceptions })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Selected for HKFC A on same day");
    });

    it("shows selectedByTeam when player is selected by other team (non-blocking)", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC D", matchDate: "2026-07-05" }), // lower-ranked, not blocking
      ];
      const allSelections = [
        sel({ id: "s2", player: ["p1"], match: ["m2"], selectionStatus: "Selected" }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allSelections })
      );
      expect(r.selectedByTeam).toBe("HKFC D");
      expect(r.status).not.toBe("blocked"); // D is lower-ranked than B
    });

    it("ignores same-day matches on different dates", () => {
      const sameDayMatches: Match[] = []; // different date, shouldn't appear
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches })
      );
      expect(r.status).not.toBe("blocked");
    });
  });

  // ─── Step 5: Premier Restriction ──────────────────────────────────

  describe("Step 5: Premier Division Restriction (§8)", () => {
    it("blocks movement between Premier and lower division when fewer than 3 matches", () => {
      const premTeams = [t("HKFC A", 1, true), t("HKFC B", 2), t("HKFC C", 3)];
      const { teamMap, rankMap } = buildMaps(premTeams);
      // Player registered to HKFC A (Premier), trying to play for HKFC B
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC A" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ teamMap, rankMap, matchCards: [] })
      );
      // 0 completed matches for either team → blocked
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Premier movement restriction — team has not completed 3 matches");
      expect(r.reasonTag?.source).toBe("Bye-Law 7.4");
    });

    it("allows Premier movement when both teams have 3+ completed matches", () => {
      const premTeams = [t("HKFC A", 1, true), t("HKFC B", 2)];
      const { teamMap, rankMap } = buildMaps(premTeams);
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC A", season: "2025-2026", match: ["ma1"] }),
        mc({ player: ["p1"], team: "HKFC A", season: "2025-2026", match: ["ma2"] }),
        mc({ player: ["p1"], team: "HKFC A", season: "2025-2026", match: ["ma3"] }),
        mc({ player: ["p1"], team: "HKFC B", season: "2025-2026", match: ["mb1"] }),
        mc({ player: ["p1"], team: "HKFC B", season: "2025-2026", match: ["mb2"] }),
        mc({ player: ["p1"], team: "HKFC B", season: "2025-2026", match: ["mb3"] }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC A" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ teamMap, rankMap, matchCards })
      );
      // Should not be blocked by Premier restriction (may be blocked by other rules)
      expect(r.reason).not.toBe("Premier movement restriction — team has not completed 3 matches");
    });

    it("does not apply when no Premier team is involved", () => {
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx()
      );
      expect(r.reason).not.toBe("Premier movement restriction — team has not completed 3 matches");
    });
  });

  // ─── Step 6: Play-Up Rules ────────────────────────────────────────

  describe("Step 6: Play-Up Rules & Count (§9-11, §13)", () => {
    it("blocks higher-to-lower movement (non-Premier)", () => {
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC B" }),
        m({ homeTeam: "HKFC D" }),
        ctx()
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Higher-to-lower movement requires Committee approval");
      expect(r.reasonTag?.source).toBe("Bye-Law 7.2(a) & HKFC Spec §9.1");
      expect(r.reasonTag?.isHkfcOverride).toBe(false);
    });

    it("Premier restriction fires before higher-to-lower when Premier involved", () => {
      // Player registered to HKFC A (Premier), trying to play for HKFC D (lower, non-Premier)
      // Both Premier restriction and higher-to-lower apply.
      // Per spec §4, Step 5 (Premier) evaluates before Step 6 (play-up/higher-to-lower)
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC A" }),
        m({ homeTeam: "HKFC D" }),
        ctx()
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Premier movement restriction — team has not completed 3 matches");
    });

    it("allows lower-to-higher with fewer than 4 play-ups", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
      ]; // 2 play-ups
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.status).not.toBe("blocked");
      expect(r.playUpCount).toBe(2);
    });

    it("blocks at 4th play-up (re-registration required)", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
      ]; // 4 play-ups
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Play-up limit reached — re-registration required");
      expect(r.playUpCount).toBe(4);
      expect(r.reasonTag?.isHkfcOverride).toBe(true);
    });

    it("excludes goalkeeper appearances from play-up count", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
      ]; // 4 GK play-ups, all excluded
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.playUpCount).toBe(0);
      expect(r.status).not.toBe("blocked");
    });

    it("counts field-player appearances even if player is normally a GK", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: true }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
      ]; // 3 GK (excluded) + 1 field = 1
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C", playingPosition: "Goalkeeper" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.playUpCount).toBe(1);
    });

    it("ignores play-ups from previous seasons", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false, season: "2024-2025" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false, season: "2024-2025" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false, season: "2024-2025" }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false, season: "2024-2025" }),
      ]; // All from last season
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards, currentSeason: "2025-2026" })
      );
      expect(r.playUpCount).toBe(0);
    });

    it("same-team selection has playUpCount 0 (not a play-up)", () => {
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C" }),
        ctx()
      );
      // Same team — not higher-to-lower, not a play-up
      expect(r.playUpCount).toBe(0);
      expect(r.status).not.toBe("blocked");
    });
  });

  // ─── Step 7: Cup Eligibility ──────────────────────────────────────

  describe("Step 7: Cup Eligibility (§14)", () => {
    it("skips cup checks for league matches", () => {
      const r = evaluatePlayerEligibility(
        p({ everRegisteredToPremier: true }),
        m({ homeTeam: "HKFC B", competitionType: "League" }),
        ctx()
      );
      // Should NOT be blocked by cup ban (it's a league match)
      expect(r.reason).not.toBe("Cup ban — ever registered to Premier Division");
    });

    it("blocks cup for player ever registered to Premier", () => {
      const r = evaluatePlayerEligibility(
        p({ everRegisteredToPremier: true, registeredTeam: "HKFC B" }),
        m({ homeTeam: "HKFC B", competitionType: "Cup" }),
        ctx()
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Cup ban — ever registered to Premier Division");
      expect(r.reasonTag?.source).toBe("Bye-Law 7.7 & HKFC Spec §14.1");
    });

    it("blocks cup with fewer than 2 league appearances", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC C", season: "2025-2026" }), // 1 appearance
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Fewer than 2 league appearances — ineligible for Cup");
    });

    it("allows cup with 2+ league appearances", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC C", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC C", season: "2025-2026" }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      expect(r.reason).not.toBe("Fewer than 2 league appearances — ineligible for Cup");
    });

    it("blocks cross-cup: already played cup for another team", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC C", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC C", season: "2025-2026" }),
        mc({ player: ["p1"], team: "HKFC D", season: "2025-2026" }), // played for D in cup
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "Cup" }),
        ctx({ matchCards })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toContain("Already played in a Cup for");
    });

    it("detects cup match from division field", () => {
      const r = evaluatePlayerEligibility(
        p({ everRegisteredToPremier: true, registeredTeam: "HKFC B" }),
        m({ homeTeam: "HKFC B", competitionType: "", division: "Plate" }),
        ctx()
      );
      expect(r.reason).toBe("Cup ban — ever registered to Premier Division");
    });
  });

  // ─── Step 8: U21 Double-Game ──────────────────────────────────────

  describe("Step 8: U21 Double-Game Limits (§12.3)", () => {
    it("skips check for non-U21 players", () => {
      const r = evaluatePlayerEligibility(
        p({ u21Eligible: false, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx()
      );
      expect(r.reason).not.toBe("U21 double-game limit reached");
    });

    it("skips check when playing for registered team", () => {
      const r = evaluatePlayerEligibility(
        p({ u21Eligible: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C" }),
        ctx()
      );
      expect(r.reason).not.toBe("U21 double-game limit reached");
    });

    it("blocks when 3 U21 double-game players already exist for target team", () => {
      const sameDayMatches = [
        m({ id: "m1", homeTeam: "HKFC B", matchDate: "2026-07-05" }),
        m({ id: "m2", homeTeam: "HKFC D", matchDate: "2026-07-05" }),
        m({ id: "m3", homeTeam: "HKFC E", matchDate: "2026-07-05" }),
      ];
      const allSelections = [
        // 3 U21 players already double-gaming for HKFC B
        sel({ id: "s1", player: ["u21a"], match: ["m1"], selectionStatus: "Selected" }),
        sel({ id: "s2", player: ["u21a"], match: ["m2"], selectionStatus: "Selected" }),
        sel({ id: "s3", player: ["u21b"], match: ["m1"], selectionStatus: "Selected" }),
        sel({ id: "s4", player: ["u21b"], match: ["m3"], selectionStatus: "Selected" }),
        sel({ id: "s5", player: ["u21c"], match: ["m1"], selectionStatus: "Selected" }),
        sel({ id: "s6", player: ["u21c"], match: ["m2"], selectionStatus: "Selected" }),
      ];
      const playersById = new Map([
        ["u21a", p({ id: "u21a", u21Eligible: true, registeredTeam: "HKFC D" })],
        ["u21b", p({ id: "u21b", u21Eligible: true, registeredTeam: "HKFC E" })],
        ["u21c", p({ id: "u21c", u21Eligible: true, registeredTeam: "HKFC D" })],
        ["p1", p({ id: "p1", u21Eligible: true, registeredTeam: "HKFC E" })],
      ]);
      const r = evaluatePlayerEligibility(
        p({ id: "p1", u21Eligible: true, registeredTeam: "HKFC E" }),
        m({ id: "m1", homeTeam: "HKFC B", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allSelections, playersById })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("U21 double-game limit reached");
      expect(r.reasonTag?.isHkfcOverride).toBe(true);
    });

    it("does not count U21 playing only one match (not double-gaming)", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC D", matchDate: "2026-07-05" }),
      ];
      const allSelections = [
        sel({ id: "s1", player: ["u21a"], match: ["m1"], selectionStatus: "Selected" }),
        // u21a only selected for m1 (HKFC B), no double-game
      ];
      const playersById = new Map([
        ["u21a", p({ id: "u21a", u21Eligible: true, registeredTeam: "HKFC C" })],
        ["p1", p({ id: "p1", u21Eligible: true, registeredTeam: "HKFC E" })],
      ]);
      const r = evaluatePlayerEligibility(
        p({ id: "p1", u21Eligible: true, registeredTeam: "HKFC E" }),
        m({ id: "m1", homeTeam: "HKFC B", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allSelections, playersById })
      );
      // 0 U21 double-game players for HKFC B
      expect(r.status).not.toBe("blocked");
    });
  });

  // ─── Warnings ─────────────────────────────────────────────────────

  describe("Warnings (§16)", () => {
    it("generates warning at 2nd play-up", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.status).toBe("warning");
      expect(r.warnings).toContain("Second play-up appearance");
      expect(r.warningTags).toHaveLength(1);
      expect(r.warningTags[0]?.source).toBe("Bye-Law 7.2 & HKFC Spec §10");
    });

    it("generates warning at 3rd play-up", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.status).toBe("warning");
      expect(r.warnings).toContain("Third play-up appearance");
    });

    it("generates visiting player early-season warning", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" }),
      ]; // Only 1 appearance, below threshold
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "League" }),
        ctx({ matchCards })
      );
      expect(r.warnings).toContain("Visiting player early-season requirement at risk");
    });

    it("does not include visiting player warning when 5+ appearances", () => {
      const matchCards = Array.from({ length: 5 }, (_, i) =>
        mc({ id: `mc${i}`, player: ["p1"], team: "HKFC C", playerTeam: "HKFC C", season: "2025-2026" })
      );
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", competitionType: "League" }),
        ctx({ matchCards })
      );
      expect(r.warnings).not.toContain("Visiting player early-season requirement at risk");
    });

    it("generates U21 double-game approaching warning at 2", () => {
      const sameDayMatches = [
        m({ id: "m1", homeTeam: "HKFC B", matchDate: "2026-07-05" }),
        m({ id: "m2", homeTeam: "HKFC D", matchDate: "2026-07-05" }),
        m({ id: "m3", homeTeam: "HKFC E", matchDate: "2026-07-05" }),
      ];
      const allSelections = [
        sel({ id: "s1", player: ["u21a"], match: ["m1"], selectionStatus: "Selected" }),
        sel({ id: "s2", player: ["u21a"], match: ["m2"], selectionStatus: "Selected" }),
        sel({ id: "s3", player: ["u21b"], match: ["m1"], selectionStatus: "Selected" }),
        sel({ id: "s4", player: ["u21b"], match: ["m3"], selectionStatus: "Selected" }),
      ];
      const playersById = new Map([
        ["u21a", p({ id: "u21a", u21Eligible: true, registeredTeam: "HKFC D" })],
        ["u21b", p({ id: "u21b", u21Eligible: true, registeredTeam: "HKFC E" })],
        ["p1", p({ id: "p1", u21Eligible: true, registeredTeam: "HKFC E" })],
      ]);
      const r = evaluatePlayerEligibility(
        p({ id: "p1", u21Eligible: true, registeredTeam: "HKFC E" }),
        m({ id: "m1", homeTeam: "HKFC B", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allSelections, playersById })
      );
      // 2 U21 double-game players for HKFC B → warning
      expect(r.status).toBe("warning");
      expect(r.warnings).toContain("U21 double-game limit approaching");
    });

    it("reason is null for non-blocked results", () => {
      const matchCards = [
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
        mc({ player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false }),
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.reason).toBeNull();
      expect(r.reasonTag).toBeNull();
    });
  });

  // ─── Reason Tags ──────────────────────────────────────────────────

  describe("Reason Tags", () => {
    it("attaches reason tag to every blocked result", () => {
      const r = evaluatePlayerEligibility(
        p({ isSuspended: true }),
        m(),
        ctx()
      );
      expect(r.reasonTag).not.toBeNull();
      expect(r.reasonTag!.source).toBe("Bye-Law 16.3–16.10");
      expect(typeof r.reasonTag!.text).toBe("string");
      expect(r.reasonTag!.text.length).toBeGreaterThan(10);
    });

    it("marks HKFC overrides correctly", () => {
      // Re-registration is an HKFC override
      const matchCards = Array.from({ length: 4 }, (_, i) =>
        mc({ id: `mc${i}`, player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false })
      );
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.reasonTag!.isHkfcOverride).toBe(true);

      // Higher-to-lower is standard bye-law, not override
      const r2 = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC A" }),
        m({ homeTeam: "HKFC D" }),
        ctx()
      );
      expect(r2.reasonTag!.isHkfcOverride).toBe(false);
    });

    it("resolves dynamic reason strings with team names", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC A", matchDate: "2026-07-05" }),
      ];
      const allSelections = [
        sel({ id: "s2", player: ["p1"], match: ["m2"], selectionStatus: "Selected" }),
      ];
      const allExceptions = [
        { playerId: "p1", matchId: "m2", status: "Unavailable" },
      ];
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches, allSelections, allExceptions })
      );
      expect(r.reason).toBe("Selected for HKFC A on same day");
      expect(r.reasonTag).not.toBeNull();
      expect(r.reasonTag!.source).toBe("Bye-Law 7.1 & HKFC Spec §7.2");
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("handles match where neither team is in rankMap", () => {
      const { teamMap, rankMap } = buildMaps([]);
      const r = evaluatePlayerEligibility(
        p(),
        m({ homeTeam: "Unknown Team", awayTeam: "Other Team" }),
        ctx({ teamMap, rankMap })
      );
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Admin data incomplete");
    });

    it("blocks admin data before checking other rules (evaluation order)", () => {
      // Player is suspended AND has incomplete data
      // Should be blocked by admin data (step 1), not suspension (step 2)
      const r = evaluatePlayerEligibility(
        p({ active: false, isSuspended: true }),
        m(),
        ctx()
      );
      expect(r.reason).toBe("Admin data incomplete");
    });

    it("suspension checked before same-day movement", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC A", matchDate: "2026-07-05" }),
      ];
      const r = evaluatePlayerEligibility(
        p({ isSuspended: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC C", matchDate: "2026-07-05" }),
        ctx({ sameDayMatches })
      );
      expect(r.reason).toBe("Suspended"); // Step 2 blocks, not Step 4
    });

    it("returns playUpCount even when blocked by other rules", () => {
      const matchCards = Array.from({ length: 4 }, (_, i) =>
        mc({ id: `mc${i}`, player: ["p1"], team: "HKFC B", playerTeam: "HKFC C", playUp: true, goalkeeper: false })
      );
      // Blocked by play-up limit (Step 6), not Steps 1-5
      const r = evaluatePlayerEligibility(
        p({ registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }),
        ctx({ matchCards })
      );
      expect(r.playUpCount).toBe(4);
    });
  });

  // ─── Evaluation Order ─────────────────────────────────────────────

  describe("Evaluation Order (short-circuit on first block)", () => {
    it("Step 1 (admin) blocks before Step 2 (suspension)", () => {
      const r = evaluatePlayerEligibility(
        p({ active: false, isSuspended: true }),
        m(),
        ctx()
      );
      expect(r.reason).toBe("Admin data incomplete");
    });

    it("Step 2 (suspension) blocks before Step 3 (visiting)", () => {
      const r = evaluatePlayerEligibility(
        p({ isSuspended: true, isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B" }), // different team
        ctx()
      );
      expect(r.reason).toBe("Suspended");
    });

    it("Step 3 (visiting) blocks before Step 4 (same-day)", () => {
      const sameDayMatches = [
        m({ id: "m2", homeTeam: "HKFC A", matchDate: "2026-07-05" }),
      ];
      const r = evaluatePlayerEligibility(
        p({ isVisitingPlayer: true, registeredTeam: "HKFC C" }),
        m({ homeTeam: "HKFC B", matchDate: "2026-07-05" }), // visiting but different team
        ctx({ sameDayMatches })
      );
      expect(r.reason).toBe("Visiting player — fixed to registered team");
    });
  });
});
