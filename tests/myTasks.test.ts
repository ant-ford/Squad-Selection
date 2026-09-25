import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The player-page banner: the person's own forms (Player Statement,
// Waivers & Declarations) and whatever the New Joiner and Statements
// processes are waiting on them for. Driven through the real router.
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
const SIGNED = "2026-07-03T02:00:00.000Z"; // this season's waivers

const ID = {
  pat: "recPlayerPat00001", // member emailed for their statement
  sue: "recPlayerSue00001", // has done everything
  chris: "recSponsorChris01", // a sponsor
  charles: "recChairman000001",
  olive: "recOfficer0000001",
  cap: "recCaptain0000001",
  tim: "recTrialist000001", // stage 1
  ivy: "recInvitedIvy0001", // stage 2, can sign in
  sam: "recApplicantSam01", // stage 3
  cara: "recApplicantCara1", // stage 4
  otto: "recApplicantOtto1", // stage 5
};

const WAIVER_URL = `https://hkfchockey.fillout.com/t/nLjY8qQTaJus?id=${ID.pat}`;
const REVIEW_URL = `https://hkfchockey.fillout.com/t/6fPWtBzqUGus?id=${ID.pat}`;
const url = (form: string, id: string) => `https://hkfchockey.fillout.com/${form}?id=${id}`;

function tables(): FakeTables {
  const person = (id: string, email: string, first: string, fields: Record<string, unknown> = {}) => ({
    id,
    fields: {
      "Preferred Name": first, Surname: "Test", Email: email, Active: true, Status: "Member",
      "Last Submission: Waivers & Declarations": SIGNED,
      ...fields,
    },
  });
  const applicant = (id: string, first: string, stage: string, fields: Record<string, unknown> = {}) => ({
    id,
    fields: {
      "Preferred Name": first, Surname: "Applicant", Status: "Applicant", "Applicant Stage": stage,
      "Fillout - Section Captain Dashboard (Update)": url("applicant_update", id),
      "Fillout - Applicant (New Joiner Form)": url("application", id),
      "Fillout - Sponsor (Page 7)": url("sponsor_support", id),
      "Fillout - Chairman (Page 7 Signature)": url("signatures-chairman", id),
      "Fillout - Membership Officer (Page 7 Signature)": url("signatures-officer", id),
      ...fields,
    },
  });
  const review = (id: string, stage: string, fields: Record<string, unknown>) => ({
    id,
    fields: {
      "Review Progress": stage, "Period End": ["2026-11-30"],
      "Fillout - Sponsor (Commitment Review Form)": url("t/tFFoChrXr2us", id),
      "Fillout - Membership Officer (Commitment Review Form)": url("t/51wrEkwujVus", id),
      ...fields,
    },
  });
  return {
    People: [
      person(ID.pat, "pat@hkfc.com", "Pat", {
        "Fillout - Member Waivers & Declarations": WAIVER_URL,
        // Last season's: this season still needs one.
        "Last Submission: Waivers & Declarations": "2026-05-20T02:00:00.000Z",
        "HKID No.": "A123456(7)",
      }),
      person(ID.sue, "sue@hkfc.com", "Sue"),
      person(ID.chris, "chris@hkfc.com", "Chris"),
      person(ID.charles, "charles@hkfc.com", "Charles"),
      person(ID.olive, "olive@hkfc.com", "Olive"),
      person(ID.cap, "cap@hkfc.com", "Cap"),
      applicant(ID.tim, "Tim", "1. Trial Application"),
      applicant(ID.ivy, "Ivy", "2. Section Captain Invitation", {
        Email: "ivy@hkfc.com", Active: true, "Last Submission: Waivers & Declarations": SIGNED,
      }),
      applicant(ID.sam, "Sam", "3. Club Application (Signed)", { "Sponsored By Sponsor": ["recSponsorRow0001"] }),
      applicant(ID.cara, "Cara", "4. Sponsor (Signed)", { "Sponsored By Chair": ["recChairRow000001"] }),
      applicant(ID.otto, "Otto", "5. Chairman (Signed)", { "Sponsored By Membership Officer": ["recOfficerRow0001"] }),
    ],
    Teams: [],
    Sponsors: [{ id: "recSponsorRow0001", fields: { Status: "Active", Member: [ID.chris] } }],
    "Section Chairs": [{ id: "recChairRow000001", fields: { Status: "Active", Designation: "Chairman", Member: [ID.charles] } }],
    "Membership Officers": [{ id: "recOfficerRow0001", fields: { Status: "Active", Member: [ID.olive] } }],
    "Section Captains": [{ id: "recCaptainRow0001", fields: { Status: "Active", Designation: "Men's Captain", Member: [ID.cap] } }],
    Commitments: [
      review("recCmtPat00000001", "Notified Member", {
        People: [ID.pat], "Full Name": ["Pat Test"], "Fillout - Member (Commitment Record Picker)": [REVIEW_URL],
      }),
      review("recCmtSue00000001", "Member Submitted (with Sponsor)", {
        People: [ID.sue], "Full Name": ["Sue Test"], Sponsor: ["recSponsorRow0001"],
      }),
      review("recCmtLou00000001", "Sponsor Submitted (with Membership Officer)", {
        People: ["recMemberLou00001"], "Full Name": ["Lou Test"], "Membership Officers": ["recOfficerRow0001"],
      }),
      // Before the Statements cut-off (1 July 2026): history, not a task.
      review("recCmtOld00000001", "Member Submitted (with Sponsor)", {
        People: [ID.sue], "Full Name": ["Sue Test"], Sponsor: ["recSponsorRow0001"], "Period End": ["2025-11-30"],
      }),
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
  vi.stubGlobal("fetch", vi.fn((u: any, opts?: any) => {
    if (String(u).startsWith(ENV.SUPABASE_URL)) {
      return Promise.resolve(new Response(JSON.stringify({ email }), { status: 200 }));
    }
    return airtable(u, opts);
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

describe("the person's own forms", () => {
  it("asks for the Player Statement once the review email has gone, and this season's waivers", async () => {
    expect(await tasksFor("pat@hkfc.com")).toEqual([
      { id: "statement:recCmtPat00000001", key: "statement", url: REVIEW_URL },
      { id: "waivers", key: "waivers", url: WAIVER_URL },
    ]);
  });

  it("asks nothing of someone who has done both", async () => {
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
});

describe("what the processes are waiting on someone for", () => {
  it("asks each New Joiner signer for their part, with their form", async () => {
    expect(await tasksFor("chris@hkfc.com")).toEqual([
      { id: `application:${ID.sam}`, key: "application", subject: "Sam Applicant", role: "Sponsor", url: url("sponsor_support", ID.sam) },
      // Sue's review waits on Chris too; the pre-cut-off one does not appear.
      { id: "review:recCmtSue00000001", key: "review", subject: "Sue Test", role: "Sponsor", url: url("t/tFFoChrXr2us", "recCmtSue00000001") },
    ]);
    expect(await tasksFor("charles@hkfc.com")).toEqual([
      { id: `application:${ID.cara}`, key: "application", subject: "Cara Applicant", role: "Chairman", url: url("signatures-chairman", ID.cara) },
    ]);
    expect(await tasksFor("olive@hkfc.com")).toEqual([
      { id: `application:${ID.otto}`, key: "application", subject: "Otto Applicant", role: "Membership Officer", url: url("signatures-officer", ID.otto) },
      { id: "review:recCmtLou00000001", key: "review", subject: "Lou Test", role: "Membership Officer", url: url("t/51wrEkwujVus", "recCmtLou00000001") },
    ]);
  });

  it("asks an invited applicant for their New Joiner Form", async () => {
    expect(await tasksFor("ivy@hkfc.com")).toEqual([
      { id: `joiner:${ID.ivy}`, key: "joiner", url: url("application", ID.ivy) },
    ]);
  });

  it("asks nothing of the Section Captains about trialists (owner decision)", async () => {
    expect(await tasksFor("cap@hkfc.com")).toEqual([]);
  });

  it("moves the line on with the application", async () => {
    await tasksFor("chris@hkfc.com");
    // Chris signs: stage 4 now waits on the chairman.
    data.People.find((r) => r.id === ID.sam)!.fields["Applicant Stage"] = "4. Sponsor (Signed)";
    data.People.find((r) => r.id === ID.sam)!.fields["Sponsored By Chair"] = ["recChairRow000001"];
    await invalidateForTables(ENV, ["People"]);
    expect((await tasksFor("chris@hkfc.com")).map((t: any) => t.key)).toEqual(["review"]);
    expect((await tasksFor("charles@hkfc.com")).map((t: any) => t.subject)).toEqual(["Cara Applicant", "Sam Applicant"]);
  });

  it("reads only what the lines need, and the person's own record by id", async () => {
    const res = await as("pat@hkfc.com", "/api/my-tasks");
    const formulaOf = (u: string) => new URLSearchParams(u.split("?")[1] ?? "").get("filterByFormula") ?? "";
    const own = handle.calls.filter((c) => c.url.includes("/People?") && formulaOf(c.url) === `RECORD_ID()="${ID.pat}"`);
    expect(own).toHaveLength(1);
    expect(requestedFields(own[0].url)).toEqual(["Last Submission: Waivers & Declarations", "Fillout - Member Waivers & Declarations"]);
    const applicants = handle.calls.find((c) => c.url.includes("/People?") && formulaOf(c.url).startsWith("OR({Applicant Stage}"));
    expect(requestedFields(applicants!.url)).not.toContain("HKID No.");
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
