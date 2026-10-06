import { describe, expect, it } from "vitest";
import { ALL_TIME_CONCURRENCY, allTimePlan } from "../src/lib/allTimeStats";

// ---------------------------------------------------------------------------
// "All time" on the Stats page: which seasons to request, how many at once,
// and when history has ended (src/lib/allTimeStats.ts, used by
// useAllSeasonStats in src/lib/queries.ts).
// ---------------------------------------------------------------------------

const U = undefined;

/**
 * Plays the hook's loop: each round, every season the plan allows and not
 * yet asked for is requested, and all of them answer before the next round.
 * Returns how many rounds and requests it took, and what was counted.
 */
function simulate(matchesBySeason: number[], concurrency = ALL_TIME_CONCURRENCY) {
  const loaded: (number | undefined)[] = matchesBySeason.map(() => U);
  let rounds = 0;
  let requests = 0;
  for (;;) {
    const plan = allTimePlan(loaded, concurrency);
    if (plan.done) return { rounds, requests, counted: plan.counted };
    const ask = [];
    for (let i = 0; i < plan.fetchUpTo; i++) if (loaded[i] === U) ask.push(i);
    if (!ask.length) throw new Error("stuck");
    rounds++;
    requests += ask.length;
    for (const i of ask) loaded[i] = matchesBySeason[i];
  }
}

describe("All time stats", () => {
  it("asks for the four newest seasons at once to start with", () => {
    expect(allTimePlan([U, U, U, U, U, U, U, U])).toEqual({ fetchUpTo: 4, counted: 0, done: false });
  });

  it("keeps four ahead of the newest-first run already loaded, and counts only that run", () => {
    // Season 1 is still loading; 2 came back early.
    expect(allTimePlan([90, U, 80, U, U, U, U, U])).toEqual({ fetchUpTo: 5, counted: 1, done: false });
    expect(allTimePlan([90, 85, 80, U, U, U, U, U])).toEqual({ fetchUpTo: 7, counted: 3, done: false });
  });

  it("ends after two empty seasons in a row once a season had games", () => {
    expect(allTimePlan([90, 80, 0, 0, U, U])).toEqual({ fetchUpTo: 4, counted: 4, done: true });
    // One empty season is a gap, not the end.
    expect(allTimePlan([90, 0, 80, U, U, U]).done).toBe(false);
  });

  it("doesn't end on empty seasons before any games (a season not started yet)", () => {
    expect(allTimePlan([0, 0, 90, U, U, U, U]).done).toBe(false);
    expect(allTimePlan([0, 0, 0])).toEqual({ fetchUpTo: 3, counted: 3, done: true });
  });

  it("ends at the last season", () => {
    expect(allTimePlan([90, 80, 70])).toEqual({ fetchUpTo: 3, counted: 3, done: true });
    expect(allTimePlan([])).toEqual({ fetchUpTo: 0, counted: 0, done: true });
  });

  it("takes four rounds instead of fourteen for preview's history (12 seasons with games, 15 listed)", () => {
    const preview = [87, 195, 142, 142, 140, 90, 82, 95, 170, 179, 149, 25, 0, 0, 0];
    expect(simulate(preview, 1)).toEqual({ rounds: 14, requests: 14, counted: 14 });
    const parallel = simulate(preview);
    expect(parallel.counted).toBe(14);
    expect(parallel.rounds).toBe(4);
    // At most the one season past the end is asked for needlessly.
    expect(parallel.requests).toBeLessThanOrEqual(15);
  });
});
