import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The "Available for X on same day" chip on the coach's player list, end to
// end through getPlayersForMatch, with a standing preference in play.
//
// The pure engine tests cover explicit exceptions; this covers the piece the
// engine cannot see on its own - a player whose "no" comes from an
// availability preference rather than a tap. buildEvaluationContext resolves
// those for the day's other fixtures and feeds them in.
// ---------------------------------------------------------------------------

import { getPlayersForMatch } from "../worker/src/squad";
import { invalidateAll } from "../worker/src/cache";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { exception, match, person, recId, rule, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

// A Saturday a week out. B and C are both non-Premier, so the Premier
// movement restriction is not in play and the only questions are the
// players' answers.
const DAY = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

const PLAIN = recId("Plain");
const RULE = recId("Rule");
const EXPLICIT = recId("Explicit");
const MAYBE = recId("Maybe");
const OVERRIDE = recId("Override");
const MC = recId("MC");
const MB = recId("MB");

const player = (id: string, name: string, position = "Defender") =>
  person({
    id,
    preferredName: name,
    email: `${name}@hkfc.com`,
    active: true,
    registeredTeam: "HKFC C",
    playingPosition: position,
    playingAbility: "C",
  });

const fixture = (id: string, homeTeam: string, hour: string) =>
  match({ id, matchDate: `${DAY}T${hour}:00:00.000Z`, season: "2026-2027", homeTeam, awayTeam: "Valley", matchStatus: "Scheduled" });

const answer = (id: string, playerId: string, status: string) =>
  exception({ id, player: [playerId], match: [MB], availabilityStatus: status, season: "2026-2027" });

useFakeRepos(() => ({
  people: [
    player(PLAIN, "Plain"),
    player(RULE, "Rule", "Goalkeeper"),
    player(EXPLICIT, "Explicit"),
    player(MAYBE, "Maybe"),
    player(OVERRIDE, "Override"),
  ],
  teams: [
    team({ id: recId("TB"), teamName: "HKFC B", teamRank: 2, active: true }),
    team({ id: recId("TC"), teamName: "HKFC C", teamRank: 3, active: true }),
  ],
  matches: [fixture(MC, "HKFC C", "05"), fixture(MB, "HKFC B", "07")],
  availabilityExceptions: [
    // Explicit: said no to the B game.
    answer(recId("X1"), EXPLICIT, "Unavailable"),
    // Maybe: only a maybe for the B game.
    answer(recId("X2"), MAYBE, "Maybe"),
    // Override: a preference says no to play-ups, but they answered Maybe
    // for this one, and an explicit answer beats the preference.
    answer(recId("X3"), OVERRIDE, "Maybe"),
  ],
  matchCards: [],
  availabilityRules: [
    rule({ id: recId("R1"), player: [RULE], ruleType: "Play-ups", availability: "Unavailable", active: true }),
    rule({ id: recId("R2"), player: [OVERRIDE], ruleType: "Play-ups", availability: "Unavailable", active: true }),
  ],
}));

beforeEach(() => {
  invalidateAll();
  // Nothing here should reach Supabase directly; any request fails the test.
  fakePostgrest({ tables: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function rows() {
  const { players } = await getPlayersForMatch(ENV, MC);
  return new Map(players.map((p) => [p.id, p]));
}

describe("the same-day availability chip on the C team's list", () => {
  it("names B for a player who has said nothing about the B game", async () => {
    const plain = (await rows()).get(PLAIN)!;
    expect(plain.warnings).toContain("Available for HKFC B on same day");
    expect(plain.sameDayHigherTeam).toBe("HKFC B");
  });

  it("is silent for a player whose preference says no to play-ups", async () => {
    const keeper = (await rows()).get(RULE)!;
    expect(keeper.warnings).toEqual([]);
    expect(keeper.sameDayHigherTeam).toBeNull();
    expect(keeper.conflicts.filter((c) => c.type === "available")).toEqual([]);
    // Their own fixture is unaffected by that preference.
    expect(keeper.availabilityStatus).toBe("Available");
    expect(keeper.eligibilityStatus).toBe("eligible");
  });

  it("is silent for a player who answered Unavailable for the B game", async () => {
    const explicit = (await rows()).get(EXPLICIT)!;
    expect(explicit.warnings).toEqual([]);
    expect(explicit.sameDayHigherTeam).toBeNull();
  });

  it("still names B for a Maybe", async () => {
    expect((await rows()).get(MAYBE)!.warnings).toContain("Available for HKFC B on same day");
  });

  it("lets an explicit Maybe for the B game beat a no-play-ups preference", async () => {
    expect((await rows()).get(OVERRIDE)!.warnings).toContain("Available for HKFC B on same day");
  });
});
