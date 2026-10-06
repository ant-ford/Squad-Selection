import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// What the shared reads ask the repositories for, and the per-request
// instrumentation. Ported from airtableAccess.test.ts when the Airtable code
// went: these are the rules from it that still hold on Supabase (the field
// projections, KV sharing and missing-field retries went with Airtable).
// ---------------------------------------------------------------------------

import { invalidateAll } from "../worker/src/cache";
import { getSeasonContext } from "../worker/src/seasonContext";
import worker from "../worker/src/index";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, matchCard, office, person, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

const THIS_SEASON = "2026-2027";
const LAST_SEASON = "2025-2026";
const ANN = recId("P1");
const CY = recId("Coach");

const db = useFakeRepos(() => ({
  teams: [team({ id: recId("TA"), teamName: "A", teamRank: 1, active: true, coach: [CY] })],
  people: [
    person({ id: ANN, preferredName: "Ann", email: "ann@hkfc.com", registeredTeam: "A" }),
    person({ id: CY, preferredName: "Cy", email: "cy@hkfc.com", registeredTeam: "A" }),
  ],
  officers: [
    office("membershipOfficer", ANN, { designation: "Men's Membership Officer" }),
    office("membershipOfficer", CY, { designation: "Men's Membership Officer", status: "Retired" }),
    office("sectionChair", CY, { designation: "Chairman" }),
    office("sectionCaptain", CY, { designation: "Men's Captain" }),
    office("sectionCaptain", ANN, { designation: "Men's Captain", status: "Retired" }),
  ],
  matches: [
    match({ id: recId("M1"), matchDate: "2026-09-12T09:00:00.000Z", season: THIS_SEASON, homeTeam: "A", awayTeam: "Valley", matchStatus: "Played" }),
    match({ id: recId("M0"), matchDate: "2026-03-07T09:00:00.000Z", season: LAST_SEASON, homeTeam: "A", awayTeam: "Valley", matchStatus: "Played" }),
  ],
  matchCards: [
    matchCard({ id: recId("C1"), player: [ANN], match: [recId("M1")], team: "A", playerTeam: "A", season: THIS_SEASON }),
    matchCard({ id: recId("C0"), player: [ANN], match: [recId("M0")], team: "A", playerTeam: "A", season: LAST_SEASON, cards: ["Y1"] }),
    matchCard({ id: recId("C0b"), player: [ANN], match: [recId("M0")], team: "A", playerTeam: "A", season: LAST_SEASON }),
  ],
}));

beforeEach(() => invalidateAll());
afterEach(() => vi.unstubAllGlobals());

describe("season scans", () => {
  it("reads only carded appearances from the previous season", async () => {
    const ctx = await getSeasonContext(ENV, THIS_SEASON);
    const previous = db.callsTo("matchCards", "listForSeason").filter((c) => c.args[0] === LAST_SEASON);
    expect(previous).toHaveLength(1);
    expect(previous[0].args[1]).toEqual({ cardedOnly: true });
    // The uncarded appearance is gone while the suspension input survives.
    expect(ctx.previousCards.map((c) => c.id)).toEqual([recId("C0")]);
    expect(ctx.matchCards.map((c) => c.id)).toEqual([recId("C1")]);
  });
});

describe("instrumentation", () => {
  it("reports data and cache work on every response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const res = await worker.fetch(new Request("https://api.test/health?deep=1"), ENV);
    expect(res.status).toBe(200);
    const timing = res.headers.get("Server-Timing") || "";
    expect(timing).toMatch(/db;dur=\d+;desc="calls=1 bytes=2"/);
    expect(timing).toMatch(/cache;desc="hits=0 misses=1 kv=0"/);
    expect(timing).toMatch(/total;dur=\d+/);
    expect(timing).not.toContain("airtable");
    expect(res.headers.get("Timing-Allow-Origin")).toBe("https://app.test");
  });
});
