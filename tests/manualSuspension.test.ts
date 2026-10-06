import { describe, it, expect } from "vitest";
import {
  manualSuspensionProgress,
  manualSuspensionStates,
  servingFixtureDatesByTeam,
  type ManualSuspension,
} from "../worker/src/suspension";
import { evaluatePlayerEligibility, type EvaluationContext } from "../worker/src/eligibility";
import type { Match, Team } from "../shared/schema/domainTypes";
import { p, m } from "./helpers/factories";

// The Men's Convenor's suspensions: served by the serving team's Played
// league and cup fixtures whose Hong Kong date is strictly after the from
// date (owner, 6 Oct 2026). Friendlies never count.

let n = 0;
/** A Played league fixture of HKFC C on a Hong Kong date (kick-off 15:00 HKT). */
function played(date: string, overrides: Partial<Match> = {}): Match {
  n++;
  return m({ id: `m${n}`, matchDate: `${date}T07:00:00.000Z`, matchStatus: "Played", competitionType: "LEAGUE", ...overrides });
}

function suspension(overrides: Partial<ManualSuspension> = {}): ManualSuspension {
  return { id: "s1", player: "p1", matches: 2, fromDate: "2026-09-12", servingTeam: "HKFC C", ...overrides };
}

const progress = (s: ManualSuspension, matches: Match[]) =>
  manualSuspensionProgress(s, servingFixtureDatesByTeam(matches));

describe("manual suspension serving", () => {
  it("serves N matches counted from the from date", () => {
    const s = suspension({ matches: 2 });
    expect(progress(s, [])).toEqual({ served: 0, remaining: 2, active: true });
    expect(progress(s, [played("2026-09-19")])).toEqual({ served: 1, remaining: 1, active: true });
    expect(progress(s, [played("2026-09-19"), played("2026-09-26")])).toEqual({ served: 2, remaining: 0, active: false });
    // More fixtures than needed: capped, still served.
    expect(progress(s, [played("2026-09-19"), played("2026-09-26"), played("2026-10-03")])).toEqual({
      served: 2,
      remaining: 0,
      active: false,
    });
  });

  it("does not count a fixture ON the from date, or before it", () => {
    const s = suspension({ matches: 1, fromDate: "2026-09-12" });
    expect(progress(s, [played("2026-09-12"), played("2026-09-05")]).active).toBe(true);
    expect(progress(s, [played("2026-09-13")]).active).toBe(false);
  });

  it("uses the Hong Kong date, not the UTC one", () => {
    const s = suspension({ matches: 1, fromDate: "2026-09-12" });
    // 01:00 HKT on the 13th is still the 12th in UTC: it counts.
    expect(progress(s, [m({ id: "late", matchDate: "2026-09-12T17:00:00.000Z", matchStatus: "Played" })]).active).toBe(false);
    // 07:00 HKT on the 12th is still the 11th in UTC: the from date itself, so it does not.
    expect(progress(s, [m({ id: "early", matchDate: "2026-09-11T23:00:00.000Z", matchStatus: "Played" })]).active).toBe(true);
  });

  it("until cleared never ends on its own", () => {
    const s = suspension({ matches: null });
    const many = Array.from({ length: 20 }, (_, i) => played(`2026-10-${String(i + 1).padStart(2, "0")}`));
    expect(progress(s, many)).toEqual({ served: 0, remaining: null, active: true });
  });

  it("counts across the season boundary (1 July)", () => {
    const s = suspension({ matches: 2, fromDate: "2026-06-20" });
    const lastSeason = played("2026-06-27", { season: "2025-2026" });
    const thisSeason = played("2026-09-12", { season: "2026-2027" });
    expect(progress(s, [lastSeason]).remaining).toBe(1);
    expect(progress(s, [lastSeason, thisSeason])).toEqual({ served: 2, remaining: 0, active: false });
  });

  it("never counts friendlies or warm-ups", () => {
    const s = suspension({ matches: 1 });
    expect(progress(s, [played("2026-09-19", { competitionType: "FRIENDLY", division: "P FDLY" })]).active).toBe(true);
    expect(progress(s, [played("2026-09-19", { competitionType: "Friendly" })]).active).toBe(true);
  });

  it("counts cup (knockout) fixtures", () => {
    expect(progress(suspension({ matches: 1 }), [played("2026-09-19", { competitionType: "KNOCKOUT" })]).active).toBe(false);
  });

  it("fails closed on a blank competition type, a fixture not yet played, or a bad from date", () => {
    const s = suspension({ matches: 1 });
    expect(progress(s, [played("2026-09-19", { competitionType: "" })]).active).toBe(true);
    expect(progress(s, [played("2026-09-19", { competitionType: undefined })]).active).toBe(true);
    for (const status of ["Scheduled", "Rescheduled", "Cancelled"]) {
      expect(progress(s, [played("2026-09-19", { matchStatus: status })]).active).toBe(true);
    }
    expect(progress(suspension({ matches: 1, fromDate: "12/09/2026" }), [played("2026-09-19")]).active).toBe(true);
  });

  it("ignores other teams' fixtures, including the team he played for", () => {
    const s = suspension({ matches: 1, servingTeam: "HKFC C" });
    const other = played("2026-09-19", { homeTeam: "HKFC B", awayTeam: "Opponent B" });
    expect(progress(s, [other]).active).toBe(true);
    // Away fixtures of the serving team count.
    expect(progress(s, [played("2026-09-19", { homeTeam: "Opponent C", awayTeam: "HKFC C" })]).active).toBe(false);
  });

  it("counts an HKFC derby once", () => {
    const s = suspension({ matches: 2, servingTeam: "HKFC C" });
    expect(progress(s, [played("2026-09-19", { homeTeam: "HKFC C", awayTeam: "HKFC C" })]).served).toBe(1);
  });

  it("an unknown serving team never serves", () => {
    expect(progress(suspension({ matches: 1, servingTeam: "HKFC Z" }), [played("2026-09-19")]).active).toBe(true);
  });
});

describe("manualSuspensionStates", () => {
  it("blocks while any of a player's suspensions has matches left", () => {
    const matches = [played("2026-09-19")];
    const states = manualSuspensionStates(
      [
        suspension({ id: "a", matches: 1 }),
        suspension({ id: "b", matches: 3 }),
        suspension({ id: "c", player: "p2", matches: 1 }),
      ],
      matches,
    );
    expect(states.get("p1")?.active).toBe(true);
    expect(states.get("p2")?.active).toBe(false);
    expect(states.has("p3")).toBe(false);
  });

  it("order does not matter", () => {
    const matches = [played("2026-09-19")];
    const states = manualSuspensionStates([suspension({ id: "b", matches: 3 }), suspension({ id: "a", matches: 1 })], matches);
    expect(states.get("p1")?.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Eligibility Step 2: same block, same reason, frozen order.
// ---------------------------------------------------------------------------

function ctx(manualSuspensionByPlayer?: EvaluationContext["manualSuspensionByPlayer"]): EvaluationContext {
  const teamMap = new Map<string, Team>([["HKFC C", { id: "t1", teamName: "HKFC C", teamRank: 3 }]]);
  return {
    teamMap,
    rankMap: { "HKFC C": 3 },
    sameDayFixtures: [],
    selectionsByPlayer: new Map(),
    sameDaySelectionsByTeam: new Map(),
    unavailablePlayerMatchKeys: new Set(),
    matchCards: [],
    matchCardsByPlayer: new Map(),
    matchesById: new Map(),
    currentSeason: "2025-2026",
    playersById: new Map(),
    completedLeagueMatchesByTeam: new Map(),
    suspensionByPlayer: new Map(),
    manualSuspensionByPlayer,
  };
}

describe("eligibility with a manual suspension", () => {
  it("an active one blocks as Suspended", () => {
    const r = evaluatePlayerEligibility(p(), m(), ctx(new Map([["p1", { active: true }]])));
    expect(r.status).toBe("blocked");
    expect(r.reason).toBe("Suspended");
  });

  it("a served one does not", () => {
    expect(evaluatePlayerEligibility(p(), m(), ctx(new Map([["p1", { active: false }]]))).status).toBe("eligible");
    expect(evaluatePlayerEligibility(p(), m(), ctx()).status).toBe("eligible");
  });

  it("admin data is still checked first (frozen order)", () => {
    const r = evaluatePlayerEligibility(p({ active: false }), m(), ctx(new Map([["p1", { active: true }]])));
    expect(r.reason).not.toBe("Suspended");
  });

  it("the old hand-set flags still block on their own", () => {
    expect(evaluatePlayerEligibility(p({ isSuspended: true }), m(), ctx(new Map())).reason).toBe("Suspended");
    expect(evaluatePlayerEligibility(p({ matchesToServe: 1 }), m(), ctx(new Map())).reason).toBe("Suspended");
  });
});
