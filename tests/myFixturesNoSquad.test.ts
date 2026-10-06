import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// The squad list on each fixture is for the calendar feed (its SQUAD block).
// The dashboard never shows it, so /api/my-fixtures leaves it out: it was
// most of the response for a player who sees a lot of play-ups.
// ---------------------------------------------------------------------------

import { getMyFixtures, getPlayerFixtures } from "../worker/src/fixtures";
import { handlePlayerCalendarFeed } from "../worker/src/calendar";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, person, recId, team } from "./helpers/factories";

const ENV = { ...SUPABASE_TEST_ENV, CALENDAR_SECRET: "test-calendar-secret" } as Env;

const JONNY = recId("P1");
const SAM = recId("P2");

/** Jonny signed in, as auth_context reads him from the seeded People. */
const authUser = (): AuthorizedUser => db.signedIn("jonny@hkfc.com");

const DAY = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];

function player(id: string, name: string, position: string) {
  return person({
    id, preferredName: name, email: `${name.toLowerCase()}@hkfc.com`, active: true,
    registeredTeam: "F", playingAbility: "B", playingPosition: position, status: "Player",
  });
}

const db = useFakeRepos(() => ({
  people: [player(JONNY, "Jonny", "Forward"), player(SAM, "Sam", "Goalkeeper")],
  teams: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => team({ teamName: n, teamRank: i + 1, active: true })),
  matches: [
    match({
      id: recId("M_F"), matchDate: `${DAY(2)}T09:00:00.000Z`, season: "2026-2027", homeTeam: "F", awayTeam: "Opponent",
      matchStatus: "Scheduled", selectedPlayersHome: [JONNY, SAM],
    }),
  ],
}));

beforeEach(() => {
  invalidateAll();
  // Read straight from Supabase: the dashboard's officer-screen checks
  // (volunteerAccess, eventAccess, umpiring) and the feed's special events.
  // Nobody here has any of them.
  fakePostgrest({
    tables: {
      api_offices: [], offices: [], team_people: [], matches: [], umpire_assignments: [],
      people: [{ id: "00000000-0000-4000-8000-000000000001", api_id: JONNY, active: true, qualified_umpire: null }],
      event_responses: [], events: [],
    },
  });
});

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(ENV.CALENDAR_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("squad on player fixtures", () => {
  it("is left out of the dashboard response", async () => {
    const out = await getMyFixtures(ENV, authUser());
    expect(out.fixtures).toHaveLength(1);
    expect(out.fixtures[0].selectedCount).toBe(2);
    expect(out.fixtures[0]).not.toHaveProperty("squad");
    expect(JSON.stringify(out)).not.toContain('"squad"');
  });

  it("is still there for the calendar feed", async () => {
    const { fixtures } = await getPlayerFixtures(ENV, JONNY);
    expect(fixtures[0].squad.map((p: { name: string }) => p.name)).toEqual(["Jonny", "Sam"]);

    const res = await handlePlayerCalendarFeed(ENV, JONNY, await sign(`player:${JONNY}`));
    const ics = (await res.text()).replace(/\r\n /g, "");
    expect(ics).toContain("SQUAD (2)");
    expect(ics).toMatch(/SQUAD \(2\)\\nSam\\nJonny/);
  });
});
