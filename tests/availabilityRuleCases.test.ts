import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// One table of availability-rule cases, two engines.
//
// The rules live in TypeScript (availabilityRules.ts: the read path, every
// coach sheet and the player's own cards) and in SQL (set_availability,
// migration 20261007021003: the write path, which decides whether an
// Available answer is stored or the row deleted). The cases in
// tests/fixtures/availabilityRuleCases.json are the single statement of what
// both must do:
//
//   - here, the TypeScript side: resolveRuleStatus, needsExplicitAvailable,
//     and the whole write through setAvailability (fake repositories);
//   - on the database, the SQL side: `node scripts/availability-rule-checks.mjs`
//     writes checks that run every case through availability_rule_status and
//     set_availability on preview, inside a transaction that is rolled back.
//
// A change to either engine changes this table first.
// ---------------------------------------------------------------------------

import cases from "./fixtures/availabilityRuleCases.json";
import { needsExplicitAvailable, resolveRuleStatus } from "../worker/src/availabilityRules";
import { setAvailability } from "../worker/src/availability";
import { invalidateAll } from "../worker/src/cache";
import type { AvailabilityRule } from "../shared/schema/domainTypes";
import { useFakeRepos } from "./helpers/fakeRepos";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, person, recId, team } from "./helpers/factories";

interface CaseRule {
  ruleType: string;
  availability: string;
  active?: boolean;
  startDate?: string;
  endDate?: string;
  lastModified?: string;
}
interface RuleCase {
  name: string;
  optInOnly?: boolean;
  rules: CaseRule[];
  fixture: { date: string; isPlayUp?: boolean; isSupport?: boolean };
  ruleStatus: string | null;
  storeAvailable: boolean;
}

const CASES = (cases as { cases: RuleCase[] }).cases;
/** The SQL checks use the same default (scripts/availability-rule-checks.mjs). */
const DEFAULT_LAST_MODIFIED = "2026-09-01T00:00:00.000Z";

const PLAYER = recId("Player");

/** The case's rules as the app reads them, in api_id order (the ids sort as listed). */
function rulesOf(c: RuleCase, n: number): AvailabilityRule[] {
  return c.rules.map((r, i) => ({
    id: `recCase${String(n).padStart(3, "0")}Rule${String(i).padStart(2, "0")}`,
    player: [PLAYER],
    ruleType: r.ruleType as AvailabilityRule["ruleType"],
    availability: r.availability as AvailabilityRule["availability"],
    active: r.active ?? true,
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
    notes: "",
    lastModified: r.lastModified ?? DEFAULT_LAST_MODIFIED,
  }));
}

const fixtureOf = (c: RuleCase) => ({
  date: c.fixture.date,
  isPlayUp: c.fixture.isPlayUp === true,
  isSupport: c.fixture.isSupport === true,
});

describe("availability rule cases: the TypeScript engine", () => {
  it("has a real table to check", () => {
    expect(CASES.length).toBeGreaterThan(40);
  });

  it.each(CASES.map((c, n) => [c.name, c, n] as const))("%s", (_name, c, n) => {
    const rules = rulesOf(c, n);
    expect(resolveRuleStatus(rules, fixtureOf(c))).toBe(c.ruleStatus);
    expect(needsExplicitAvailable(rules, fixtureOf(c), { optInOnly: c.optInOnly === true })).toBe(c.storeAvailable);
  });
});

// The same cases through the write: a player of HKFC D (rank 4) answers
// Available for a Scheduled match against HKFC A (a play-up), HKFC H (a
// support game) or HKFC D - exactly how the SQL checks build each case.
describe("availability rule cases: setAvailability stores or deletes", () => {
  const ENV = { ...SUPABASE_TEST_ENV } as any;
  const MATCH = recId("CaseMatch");
  const db = useFakeRepos();

  beforeEach(() => invalidateAll());

  const writable = CASES.map((c, n) => [c.name, c, n] as const).filter(([, c]) => !(c.fixture.isPlayUp && c.fixture.isSupport));

  it.each(writable)("%s", async (_name, c, n) => {
    const side = c.fixture.isPlayUp ? "HKFC A" : c.fixture.isSupport ? "HKFC H" : "HKFC D";
    db.reset({
      teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((l, i) =>
        team({ id: recId(`Team${l}`), teamName: `HKFC ${l}`, teamRank: i + 1, active: true }),
      ),
      people: [person({ id: PLAYER, active: true, registeredTeam: "HKFC D", optInOnly: c.optInOnly === true })],
      matches: [
        match({
          id: MATCH,
          // Noon in Hong Kong on the case's day; no date at all for "".
          matchDate: c.fixture.date ? `${c.fixture.date}T04:00:00.000Z` : "",
          season: "2026-2027",
          homeTeam: side,
          awayTeam: "Case Opponent",
          matchStatus: "Scheduled",
        }),
      ],
      availabilityRules: rulesOf(c, n),
    });
    const out = await setAvailability(ENV, { playerId: PLAYER, matchIds: [MATCH], status: "Available" });
    expect(db.state.availabilityExceptions.length > 0).toBe(c.storeAvailable);
    expect(out.results[0].exceptionId !== null).toBe(c.storeAvailable);
  });
});
