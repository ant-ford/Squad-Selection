import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Regression for bug B6: an Airtable failure during the player-portal
// play-up eligibility gate (worker/src/fixtures.ts :: isEligibleFor) used to
// be swallowed and silently treated as "not eligible" - an outage would just
// make play-up opportunities vanish instead of surfacing as an error.
// ---------------------------------------------------------------------------

import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import { AirtableError } from "../worker/src/airtable";
import type { AuthorizedUser } from "../worker/src/auth";

function authUser(email: string): AuthorizedUser {
  return { email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false };
}

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "test-base",
  CALENDAR_SECRET: "***",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// Ranks 2 and 3 - deliberately not rank 1, which the eligibility engine
// always treats as Premier Division regardless of the Is Premier flag and
// would trip the (unrelated) Premier-movement block instead of exercising
// the play-up gate this test targets.
const TEAMS = [
  { id: "recTB", fields: { "Team Name": "B", "Team Rank": 2, Active: true, "Target Squad Size": 14 } },
  { id: "recTC", fields: { "Team Name": "C", "Team Rank": 3, Active: true, "Target Squad Size": 14 } },
];

const PEOPLE = [
  { id: "recP1", fields: { "Preferred Name": "Dave", Email: "dave@hkfc.com", Active: true, "Registered Team": "C", "Playing Position": "Defender", "Playing Ability": "B" } },
];

// Team B (rank 2, above Dave's team C) has an upcoming fixture: a play-up
// opportunity candidate that must be run through the eligibility engine.
const MATCHES = [
  { id: "recM1", fields: { Date: futureIso(3), Season: "2026-2027", "Home Team": "B", "Away Team": "Valley A", "Match Status": "Scheduled", "Selected Players Home": [], "Selected Players Away": [] } },
];

function installFakeAirtable(opts: { failMatchCards?: boolean }) {
  const fetchMock = vi.fn((url: any) => {
    const u = String(url);
    if (!u.includes("api.airtable.com")) return Promise.resolve(new Response("{}", { status: 404 }));
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");

    if (table === "Match Cards" && opts.failMatchCards) {
      return Promise.resolve(new Response("Internal error", { status: 500 }));
    }

    let records: any[] = [];
    if (table === "People") {
      const q = new URLSearchParams(u.split("?")[1] ?? "");
      const formula = decodeURIComponent(q.get("filterByFormula") || "");
      const m = formula.match(/"([^"]+)"/);
      records = m
        ? PEOPLE.filter((r) => (r.fields.Email || "").toLowerCase() === m[1].toLowerCase())
        : PEOPLE;
    } else if (table === "Teams") records = TEAMS;
    else if (table === "Matches") records = MATCHES;
    else records = []; // Availability Exceptions, Match Cards (when not failing), Availability Rules

    const byId = u.match(/\/rec[A-Za-z0-9]+$/);
    if (byId) {
      const found = records.find((r) => r.id === byId[0].slice(1));
      return Promise.resolve(new Response(JSON.stringify(found ?? {}), { status: found ? 200 : 404 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ records }), { status: 200 }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  invalidateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMyFixtures play-up eligibility gate", () => {
  it("includes the play-up candidate when Airtable is healthy", async () => {
    installFakeAirtable({ failMatchCards: false });
    const out = await getMyFixtures(ENV, authUser("dave@hkfc.com"));
    expect(out.playUpOpportunities.some((f: any) => f.id === "recM1")).toBe(true);
  });

  it("propagates an Airtable failure during eligibility gating instead of silently dropping the candidate", async () => {
    installFakeAirtable({ failMatchCards: true });
    await expect(getMyFixtures(ENV, authUser("dave@hkfc.com"))).rejects.toBeInstanceOf(AirtableError);
  });
});
