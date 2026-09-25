import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The player-page banner: Player Statement and Waivers & Declarations,
// shown until the base shows them done. Driven through the real router.
// ---------------------------------------------------------------------------

import { fakeAirtable, requestedFields, type FakeTables } from "./helpers/airtable";
import { invalidateAll } from "../worker/src/cache";
import { resetMissingFieldCache } from "../worker/src/airtable";
import { invalidateForTables } from "../worker/src/airtableWebhook";
import { waiversDoneThisSeason } from "../worker/src/myTasks";
import worker from "../worker/src/index";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "appTest",
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

// 12:00 on 26 September 2026 in Hong Kong: the 2026-27 season began 1 July.
const NOW = new Date("2026-09-26T04:00:00Z");

const ID = {
  pat: "recPlayerPat00001",
  sue: "recPlayerSue00001",
};

const WAIVER_URL = "https://hkfchockey.fillout.com/t/nLjY8qQTaJus?id=" + ID.pat;
const REVIEW_URL = "https://hkfchockey.fillout.com/t/6fPWtBzqUGus?id=" + ID.pat;

function tables(): FakeTables {
  return {
    People: [
      {
        id: ID.pat,
        fields: {
          "Preferred Name": "Pat", Surname: "Player", Email: "pat@hkfc.com", Active: true, Status: "Member",
          "Fillout - Member Waivers & Declarations": WAIVER_URL,
          "Fillout - Member (Commitment Record Picker)": REVIEW_URL,
          // Last season's: this season still needs one.
          "Last Submission: Waivers & Declarations": "2026-05-20T02:00:00.000Z",
          "HKID No.": "A123456(7)",
        },
      },
      {
        id: ID.sue,
        fields: {
          "Preferred Name": "Sue", Surname: "Signed", Email: "sue@hkfc.com", Active: true, Status: "Member",
          "Last Submission: Waivers & Declarations": "2026-07-03T02:00:00.000Z",
        },
      },
    ],
    Teams: [],
    Commitments: [
      { id: "recCmtPat00000001", fields: { People: [ID.pat], "Review Progress": "Notified Member" } },
      { id: "recCmtSue00000001", fields: { People: [ID.sue], "Review Progress": "Member Submitted (with Sponsor)" } },
    ],
  };
}

let data: FakeTables;
let handle: ReturnType<typeof fakeAirtable>;

beforeEach(() => {
  invalidateAll();
  resetMissingFieldCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  data = tables();
  handle = fakeAirtable(data);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function as(email: string | null, path: string): Promise<Response> {
  const airtable = handle.fetchMock as unknown as typeof fetch;
  vi.stubGlobal("fetch", vi.fn((url: any, opts?: any) => {
    if (String(url).startsWith(ENV.SUPABASE_URL)) {
      return Promise.resolve(new Response(JSON.stringify({ email }), { status: 200 }));
    }
    return airtable(url, opts);
  }));
  const headers: Record<string, string> = { Origin: "https://app.test" };
  if (email) headers.Authorization = `Bearer token-for-${email}`;
  return worker.fetch(new Request(`https://api.test${path}`, { headers }), ENV, { waitUntil: () => {} } as any);
}

const tasksFor = async (email: string) => {
  const res = await as(email, "/api/my-tasks");
  expect(res.status).toBe(200);
  return ((await res.json()) as any).tasks;
};

describe("the player-page banner", () => {
  it("asks for the Player Statement once the review email has gone, and this season's waivers", async () => {
    expect(await tasksFor("pat@hkfc.com")).toEqual([
      { key: "statement", url: REVIEW_URL },
      { key: "waivers", url: WAIVER_URL },
    ]);
  });

  it("asks nothing of someone who has done both", async () => {
    // Sue submitted her form (Member Submitted) and signed on 3 July.
    expect(await tasksFor("sue@hkfc.com")).toEqual([]);
  });

  it("needs a sign-in", async () => {
    expect((await as(null, "/api/my-tasks")).status).toBe(401);
  });

  it("goes as soon as the base shows the statement submitted", async () => {
    await tasksFor("pat@hkfc.com"); // warm the caches
    data.Commitments[0].fields["Review Progress"] = "Member Submitted (with Sponsor)";
    await invalidateForTables(ENV, ["Commitments"]); // what the webhook does
    expect((await tasksFor("pat@hkfc.com")).map((t: any) => t.key)).toEqual(["waivers"]);
  });

  it("goes as soon as the base shows this season's waivers", async () => {
    await tasksFor("pat@hkfc.com");
    data.People[0].fields["Last Submission: Waivers & Declarations"] = "2026-09-26T03:00:00.000Z";
    await invalidateForTables(ENV, ["People"]);
    expect((await tasksFor("pat@hkfc.com")).map((t: any) => t.key)).toEqual(["statement"]);
  });

  it("reads only the member's own record, for the three fields it needs", async () => {
    const res = await as("pat@hkfc.com", "/api/my-tasks");
    const formulaOf = (url: string) => new URLSearchParams(url.split("?")[1] ?? "").get("filterByFormula") ?? "";
    const own = handle.calls.filter((c) => c.url.includes("/People?") && formulaOf(c.url) === `RECORD_ID()="${ID.pat}"`);
    expect(own).toHaveLength(1);
    expect(requestedFields(own[0].url)).toEqual([
      "Last Submission: Waivers & Declarations",
      "Fillout - Member Waivers & Declarations",
      "Fillout - Member (Commitment Record Picker)",
    ]);
    const reviews = handle.calls.find((c) => c.url.includes("/Commitments?"));
    expect(requestedFields(reviews!.url)).toEqual(["Review Progress", "People"]);
    expect(await res.text()).not.toContain("A123456");
  });
});

describe("waivers count for the season they were signed in", () => {
  it.each([
    ["signed this season", "2026-07-01T00:00:00.000Z", "2026-09-26", true],
    // 23:30 on 30 June in UTC is already 1 July in Hong Kong.
    ["signed on the first Hong Kong day of the season", "2026-06-30T16:30:00.000Z", "2026-09-26", true],
    ["signed last season", "2026-06-30T10:00:00.000Z", "2026-09-26", false],
    ["signed last July, asked again after the new season starts", "2025-07-02T02:00:00.000Z", "2026-07-01", false],
    ["signed last July, still good in June", "2025-07-02T02:00:00.000Z", "2026-06-30", true],
    ["never signed", undefined, "2026-09-26", false],
  ])("%s", (_label, at, today, done) => {
    expect(waiversDoneThisSeason(at, today)).toBe(done);
  });
});
