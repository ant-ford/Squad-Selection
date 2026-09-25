import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The membership section's Statements board: yearly commitment reviews by
// Review Progress, and Notify now. Driven through the real router and auth
// path, like membership.test.ts.
// ---------------------------------------------------------------------------

import { fakeAirtable, requestedFields, type FakeTables } from "./helpers/airtable";
import { invalidateAll } from "../worker/src/cache";
import { resetMissingFieldCache } from "../worker/src/airtable";
import { COMMITMENT_FIELDS } from "../shared/schema/fieldMaps";
import worker from "../worker/src/index";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "appTest",
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

// 12:00 on 25 September 2026 in Hong Kong. The automation's 60-day window
// runs to 24 November 2026.
const NOW = new Date("2026-09-25T04:00:00Z");

const ID = {
  officer: "recOfficer0000001",
  chair: "recChair000000001",
  captain: "recCaptain0000001",
  player: "recPlayer00000001",
  resigned: "recResigned000001",
  // Commitments rows.
  due: "recCmtDue00000001", // Not Started, period ends after the window
  inWindow: "recCmtWindow00001", // Not Started, period ends inside the window
  requested: "recCmtAsked000001", // Not Started, Notify Now already ticked
  overdue: "recCmtOverdue0001", // Not Started, period ended in August 2026
  ancient: "recCmtAncient0001", // Not Started, period ended in 2023: before the cut-off
  notified: "recCmtNotified001",
  memberIn: "recCmtMemberIn001",
  completeRecent: "recCmtDoneNew0001",
  completeOld: "recCmtDoneOld0001",
  completeJune: "recCmtDoneJune001", // ended 30 June 2026, the day before the cut-off
  future: "recCmtFuture00001", // next year's row, created with the rest
  orphan: "recCmtOrphan00001", // People link wiped
  ofResigned: "recCmtResigned001",
  blank: "recCmtBlank000001",
};

function tables(): FakeTables {
  const person = (id: string, fields: Record<string, unknown>) => ({ id, fields: { Active: false, ...fields } });
  const cmt = (id: string, fields: Record<string, unknown>) => ({
    id,
    fields: { People: [ID.player], "Full Name": ["Pat Player"], "Membership No.": ["1001"], ...fields },
  });
  return {
    People: [
      person(ID.officer, { "Preferred Name": "Olive", Surname: "Officer", Email: "olive@personal.com" }),
      person(ID.chair, { "Preferred Name": "Charles", Surname: "Chair", Email: "charles@personal.com" }),
      person(ID.captain, { "Preferred Name": "Cap", Surname: "Tain", Email: "cap@personal.com" }),
      person(ID.player, { "Preferred Name": "Pat", Surname: "Player", Email: "pat@hkfc.com", Active: true, Status: "Member" }),
      person(ID.resigned, { "Preferred Name": "Ray", Surname: "Resigned", Status: "Resigned" }),
    ],
    Teams: [],
    "Membership Officers": [{ id: "recMO", fields: { Status: "Active", Designation: "Men's Membership Officer", Member: [ID.officer] } }],
    "Section Chairs": [{ id: "recSC", fields: { Status: "Active", Designation: "Chairman", Member: [ID.chair] } }],
    "Section Captains": [{ id: "recCP", fields: { Status: "Active", Designation: "Men's Captain", Member: [ID.captain] } }],
    Commitments: [
      cmt(ID.due, {
        "Review Progress": "Not Started", "Year #": 1, "Period Start": "2025-12-01", "Period End": "2026-11-30",
        Period: "2025-12-01 to 2026-11-30", "Sponsor Preferred Name": ["Chris"], "Selected Team EOS": ["HKFC C"],
        // Never requested, so never on the board.
        "Combined Context": "=== MEMBER INPUTS ===", "Recommendation (AI)": { state: "generated", value: "x" },
      }),
      cmt(ID.inWindow, { "Review Progress": "Not Started", "Year #": 2, "Period Start": "2025-11-01", "Period End": "2026-10-31" }),
      cmt(ID.requested, { "Review Progress": "Not Started", "Notify Now": true, "Period Start": "2026-01-01", "Period End": "2026-12-31" }),
      cmt(ID.overdue, { "Review Progress": "Not Started", "Year #": 1, "Period Start": "2025-09-01", "Period End": "2026-08-31" }),
      cmt(ID.ancient, { "Review Progress": "Not Started", "Year #": 1, "Period Start": "2022-07-01", "Period End": "2023-06-30" }),
      cmt(ID.notified, { "Review Progress": "Notified Member", "Period Start": "2025-10-15", "Period End": "2026-10-14" }),
      cmt(ID.memberIn, {
        "Review Progress": "Member Submitted (with Sponsor)", "Period Start": "2025-10-01", "Period End": "2026-09-30",
        "Member Submission Date": "2026-09-10T03:00:00.000Z", "Sponsor Preferred Name": ["Chris"],
        "Matches: Played": 14, "Player: Teams Played": ["HKFC C", "HKFC D"], Practices: "Moderate 50-70%",
        "Player Statement": [{ url: "https://dl.airtable.com/statement.pdf", filename: "statement.pdf" }],
      }),
      cmt(ID.completeRecent, {
        "Review Progress": "Complete", "Period Start": "2025-08-01", "Period End": "2026-07-31",
        "Membership Officer Submission Date": "2026-07-20T03:00:00.000Z",
      }),
      cmt(ID.completeJune, { "Review Progress": "Complete", "Period Start": "2025-07-01", "Period End": "2026-06-30" }),
      cmt(ID.completeOld, { "Review Progress": "Complete", "Period Start": "2023-04-01", "Period End": "2024-03-31" }),
      cmt(ID.future, { "Review Progress": "Not Started", "Year #": 2, "Period Start": "2026-12-01", "Period End": "2027-11-30" }),
      { id: ID.orphan, fields: { "Review Progress": "Not Started", "Period Start": "2026-01-01", "Period End": "2026-12-31" } },
      cmt(ID.ofResigned, { People: [ID.resigned], "Review Progress": "Notified Member", "Period Start": "2025-10-01", "Period End": "2026-09-30" }),
      cmt(ID.blank, { "Period Start": "2025-11-15", "Period End": "2026-11-14" }),
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

async function as(email: string, path: string, init: RequestInit = {}): Promise<Response> {
  const airtable = handle.fetchMock as unknown as typeof fetch;
  vi.stubGlobal("fetch", vi.fn((url: any, opts?: any) => {
    if (String(url).startsWith(ENV.SUPABASE_URL)) {
      return Promise.resolve(new Response(JSON.stringify({ email }), { status: 200 }));
    }
    return airtable(url, opts);
  }));
  const headers = { Authorization: `Bearer token-for-${email}`, "Content-Type": "application/json", Origin: "https://app.test" };
  return worker.fetch(new Request(`https://api.test${path}`, { ...init, headers }), ENV, { waitUntil: () => {} } as any);
}

const body = async (res: Response): Promise<any> => res.json();

const board = async () => {
  const res = await as("olive@personal.com", "/api/membership/statements");
  expect(res.status).toBe(200);
  return body(res);
};

const notify = (email: string, commitmentId: string) =>
  as(email, "/api/membership/statements/notify", { method: "POST", body: JSON.stringify({ commitmentId }) });

const patches = () =>
  handle.fetchMock.mock.calls
    .filter(([, init]: any[]) => init?.method === "PATCH")
    .map(([url, init]: any[]) => ({ url: String(url), fields: JSON.parse(init.body).fields }));

describe("who can open the Statements board", () => {
  it.each([
    ["a membership officer", "olive@personal.com", 200],
    ["a Section Captains row", "cap@personal.com", 200],
    ["a section chair", "charles@personal.com", 403],
    ["an ordinary player", "pat@hkfc.com", 403],
  ])("%s gets %i", async (_label, email, status) => {
    expect((await as(email, "/api/membership/statements")).status).toBe(status);
  });

  it("gates Notify now the same way", async () => {
    expect((await notify("charles@personal.com", ID.due)).status).toBe(403);
    expect((await notify("pat@hkfc.com", ID.due)).status).toBe(403);
    expect(patches()).toHaveLength(0);
  });
});

describe("the board", () => {
  it("shows the period in progress and any unfinished earlier year, and recent completions", async () => {
    const { cards, unlinked } = await board();
    expect(Object.fromEntries(cards.map((c: any) => [c.id, c.column]))).toEqual({
      [ID.due]: "Not Started",
      [ID.inWindow]: "Not Started",
      [ID.requested]: "Not Started",
      [ID.overdue]: "Not Started", // unfinished, from an earlier period
      [ID.notified]: "Notified Member",
      [ID.memberIn]: "Member Submitted (with Sponsor)",
      [ID.completeRecent]: "Complete",
      [ID.blank]: "Needs fixing", // the automation only fires on Not Started
      // Not shown: anything whose period ended before 1 July 2026 (the 2023
      // row, and Complete ones from 2024 and June 2026), next year's row, a
      // resigned member's review, and the row with no member linked (counted
      // instead).
    });
    expect(unlinked).toBe(1);
  });

  it("says when the automatic email goes, and offers Notify now only where it would work", async () => {
    const { cards } = await board();
    const byId = (id: string) => cards.find((c: any) => c.id === id);
    expect(byId(ID.due)).toMatchObject({
      name: "Pat Player",
      yearNo: 1,
      period: "2025-12-01 to 2026-11-30",
      autoNoticeOn: "2026-10-01",
      inAutoWindow: false,
      canNotify: true,
      team: "HKFC C",
      waitingOn: "The review email",
    });
    // Already matches the automation, so ticking Notify Now would not trigger it.
    expect(byId(ID.inWindow)).toMatchObject({ inAutoWindow: true, canNotify: false });
    expect(byId(ID.requested)).toMatchObject({ notifyRequested: true, canNotify: false });
    // Past its period: outside the automation's window, so the button is the only way.
    expect(byId(ID.overdue)).toMatchObject({ inAutoWindow: false, canNotify: true });
    expect(byId(ID.notified)).toMatchObject({ canNotify: false, waitingOn: "The member's Commitment Form" });
  });

  it("counts days in stage from the submission that moved it there", async () => {
    const { cards, hasStageDates } = await board();
    expect(hasStageDates).toBe(false);
    expect(cards.find((c: any) => c.id === ID.memberIn)).toMatchObject({
      stageSince: "2026-09-10",
      days: 15,
      waitingOn: "Sponsor (Chris)",
      matchesPlayed: 14,
      teamsPlayed: ["HKFC C", "HKFC D"],
      practices: "Moderate 50-70%",
      playerStatement: [{ url: "https://dl.airtable.com/statement.pdf", filename: "statement.pdf" }],
    });
  });

  it("asks Commitments for the board's fields only, never the AI or combined context", async () => {
    const res = await board();
    const read = handle.calls.find((c) => c.url.includes("/Commitments?"));
    expect(requestedFields(read!.url)).toEqual(Object.values(COMMITMENT_FIELDS));
    expect(JSON.stringify(res)).not.toMatch(/MEMBER INPUTS|"state"/);
  });
});

describe("Notify now", () => {
  it("ticks Notify Now and nothing else, leaving Review Progress to the automation", async () => {
    const res = await notify("olive@personal.com", ID.due);
    expect(res.status).toBe(200);
    expect(patches()).toEqual([
      { url: expect.stringContaining(`/Commitments/${ID.due}`), fields: { "Notify Now": true } },
    ]);
    const row = data.Commitments.find((r) => r.id === ID.due)!;
    expect(row.fields["Review Progress"]).toBe("Not Started");
    expect(row.fields.People).toEqual([ID.player]); // the link was never sent
  });

  it("records the request in Membership Events", async () => {
    await notify("cap@personal.com", ID.due);
    expect(data["Membership Events"]?.map((r) => r.fields)).toEqual([
      {
        "Event Type": "Notified",
        Person: [ID.player],
        Notes: "Commitment review email requested early for Year 1 (2025-12-01 to 2026-11-30).",
        Actor: [ID.captain],
        "Actor Email": "cap@personal.com",
        Timestamp: NOW.toISOString(),
      },
    ]);
  });

  it("shows the request on the board straight away", async () => {
    await board(); // warm the cache
    await notify("olive@personal.com", ID.due);
    const { cards } = await board();
    expect(cards.find((c: any) => c.id === ID.due)).toMatchObject({ notifyRequested: true, canNotify: false });
  });

  it.each([
    ["a review already under way", ID.notified, "NOT_NOTIFIABLE"],
    ["one inside the automation's window", ID.inWindow, "IN_AUTOMATION_WINDOW"],
    ["one already requested", ID.requested, "ALREADY_REQUESTED"],
    ["a row with no member linked", ID.orphan, "NOT_LINKED"],
  ])("refuses %s", async (_label, id, code) => {
    const res = await notify("olive@personal.com", id);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe(code);
    expect(patches()).toHaveLength(0);
  });

  it("refuses an id that is not a record id, and one that does not exist", async () => {
    expect((await notify("olive@personal.com", "not-a-record")).status).toBe(400);
    expect((await notify("olive@personal.com", "recNoSuchRow00001")).status).toBe(404);
  });

  it("says plainly when the checkbox is missing from the base", async () => {
    const airtable = handle.fetchMock as unknown as typeof fetch;
    handle.fetchMock = vi.fn((url: any, init?: any) =>
      init?.method === "PATCH"
        ? Promise.resolve(
            new Response('{"error":{"type":"UNKNOWN_FIELD_NAME","message":"Unknown field name: \\"Notify Now\\""}}', {
              status: 422,
            }),
          )
        : airtable(url, init),
    ) as any;
    const res = await notify("olive@personal.com", ID.overdue);
    expect(res.status).toBe(409);
    expect(await body(res)).toMatchObject({ error: "SETUP_REQUIRED" });
    expect(data["Membership Events"] ?? []).toHaveLength(0);
  });
});
