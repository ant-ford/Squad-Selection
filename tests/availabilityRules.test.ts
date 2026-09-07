import { describe, it, expect } from "vitest";
import {
  effectiveAvailability,
  indexRulesByPlayer,
  resolveRuleStatus,
  type RuleFixtureContext,
} from "../worker/src/availabilityRules";
import type { AvailabilityRule } from "../shared/schema/domainTypes";

function rule(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    id: "recR1",
    player: ["recP1"],
    ruleType: "All future",
    availability: "Unavailable",
    active: true,
    startDate: "",
    endDate: "",
    notes: "",
    lastModified: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

// 2026-09-12 is a Saturday; 2026-09-16 a Wednesday.
const SATURDAY = "2026-09-12";
const WEDNESDAY = "2026-09-16";

function fixture(overrides: Partial<RuleFixtureContext> = {}): RuleFixtureContext {
  return { date: SATURDAY, isPlayUp: false, isSupport: false, ...overrides };
}

describe("rule matching", () => {
  it("applies a play-up rule only to play-up fixtures", () => {
    const rules = [rule({ ruleType: "Play-ups", availability: "Unavailable" })];
    expect(resolveRuleStatus(rules, fixture({ isPlayUp: true }))).toBe("Unavailable");
    expect(resolveRuleStatus(rules, fixture())).toBeNull();
  });

  it("applies a support rule only to support fixtures", () => {
    const rules = [rule({ ruleType: "Support games", availability: "Maybe" })];
    expect(resolveRuleStatus(rules, fixture({ isSupport: true }))).toBe("Maybe");
    expect(resolveRuleStatus(rules, fixture({ isPlayUp: true }))).toBeNull();
  });

  it("treats Monday to Friday as midweek", () => {
    const rules = [rule({ ruleType: "Midweek", availability: "Unavailable" })];
    expect(resolveRuleStatus(rules, fixture({ date: WEDNESDAY }))).toBe("Unavailable");
    expect(resolveRuleStatus(rules, fixture({ date: SATURDAY }))).toBeNull();
    expect(resolveRuleStatus(rules, fixture({ date: "2026-09-13" }))).toBeNull(); // Sunday
  });

  it("bounds a date range inclusively at both ends", () => {
    const rules = [
      rule({ ruleType: "Date range", startDate: "2026-09-10", endDate: "2026-09-12", availability: "Unavailable" }),
    ];
    expect(resolveRuleStatus(rules, fixture({ date: "2026-09-10" }))).toBe("Unavailable");
    expect(resolveRuleStatus(rules, fixture({ date: "2026-09-12" }))).toBe("Unavailable");
    expect(resolveRuleStatus(rules, fixture({ date: "2026-09-09" }))).toBeNull();
    expect(resolveRuleStatus(rules, fixture({ date: "2026-09-13" }))).toBeNull();
  });

  it("supports open-ended date ranges in both directions", () => {
    const from = [rule({ ruleType: "Date range", startDate: "2026-09-10", availability: "Unavailable" })];
    expect(resolveRuleStatus(from, fixture({ date: "2026-12-01" }))).toBe("Unavailable");
    expect(resolveRuleStatus(from, fixture({ date: "2026-09-01" }))).toBeNull();

    const until = [rule({ ruleType: "Date range", endDate: "2026-09-10", availability: "Unavailable" })];
    expect(resolveRuleStatus(until, fixture({ date: "2026-09-01" }))).toBe("Unavailable");
    expect(resolveRuleStatus(until, fixture({ date: "2026-12-01" }))).toBeNull();
  });

  it("ignores a date range with no bounds at all", () => {
    const rules = [rule({ ruleType: "Date range" })];
    expect(resolveRuleStatus(rules, fixture())).toBeNull();
  });

  it("honours an optional start date on an All future rule", () => {
    const rules = [rule({ ruleType: "All future", startDate: "2026-10-01", availability: "Unavailable" })];
    expect(resolveRuleStatus(rules, fixture({ date: "2026-10-02" }))).toBe("Unavailable");
    expect(resolveRuleStatus(rules, fixture({ date: "2026-09-30" }))).toBeNull();
  });

  it("ignores inactive rules and rules with no availability set", () => {
    expect(resolveRuleStatus([rule({ active: false })], fixture())).toBeNull();
    expect(resolveRuleStatus([rule({ availability: "" })], fixture())).toBeNull();
  });

  it("ignores an unrecognised rule type rather than guessing", () => {
    expect(resolveRuleStatus([rule({ ruleType: "" })], fixture())).toBeNull();
  });
});

describe("precedence", () => {
  it("lets the more specific rule win", () => {
    // "Out for everything" but "around midweek" -> midweek wins.
    const rules = [
      rule({ id: "a", ruleType: "All future", availability: "Unavailable" }),
      rule({ id: "b", ruleType: "Midweek", availability: "Available" }),
    ];
    expect(resolveRuleStatus(rules, fixture({ date: WEDNESDAY }))).toBe("Available");
    expect(resolveRuleStatus(rules, fixture({ date: SATURDAY }))).toBe("Unavailable");
  });

  it("puts a date range above everything else", () => {
    const rules = [
      rule({ id: "a", ruleType: "Midweek", availability: "Available" }),
      rule({ id: "b", ruleType: "Date range", startDate: WEDNESDAY, endDate: WEDNESDAY, availability: "Unavailable" }),
    ];
    expect(resolveRuleStatus(rules, fixture({ date: WEDNESDAY }))).toBe("Unavailable");
  });

  it("breaks ties on the same specificity by most recently modified", () => {
    const rules = [
      rule({ id: "old", ruleType: "Play-ups", availability: "Unavailable", lastModified: "2026-09-01T00:00:00.000Z" }),
      rule({ id: "new", ruleType: "Play-ups", availability: "Available", lastModified: "2026-09-05T00:00:00.000Z" }),
    ];
    expect(resolveRuleStatus(rules, fixture({ isPlayUp: true }))).toBe("Available");
  });
});

describe("effectiveAvailability", () => {
  const outEverywhere = [rule({ ruleType: "All future", availability: "Unavailable" })];

  it("lets an explicit answer beat any rule", () => {
    const result = effectiveAvailability("Available", outEverywhere, fixture());
    expect(result).toEqual({ status: "Available", fromRule: false });
  });

  it("falls back to the rule when the player has not answered", () => {
    expect(effectiveAvailability("", outEverywhere, fixture())).toEqual({
      status: "Unavailable",
      fromRule: true,
    });
  });

  it("defaults to Available when nothing applies", () => {
    expect(effectiveAvailability("", [], fixture())).toEqual({
      status: "Available",
      fromRule: false,
    });
  });
});

describe("indexRulesByPlayer", () => {
  it("groups rules by their linked player and skips unlinked ones", () => {
    const index = indexRulesByPlayer([
      rule({ id: "1", player: ["recP1"] }),
      rule({ id: "2", player: ["recP1"] }),
      rule({ id: "3", player: ["recP2"] }),
      rule({ id: "4", player: [] }),
    ]);
    expect(index.get("recP1")).toHaveLength(2);
    expect(index.get("recP2")).toHaveLength(1);
    expect(index.size).toBe(2);
  });
});
