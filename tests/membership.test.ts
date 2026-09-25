import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Membership section: the applicant board, the active-members export and
// Approve. Driven through the real router and the real auth path, with a
// stubbed Supabase session and the fake Airtable, so access is tested along
// with behaviour.
// ---------------------------------------------------------------------------

import { fakeAirtable, requestedFields, type FakeTables } from "./helpers/airtable";
import { invalidateAll } from "../worker/src/cache";
import { resetMissingFieldCache } from "../worker/src/airtable";
import { csvCell } from "../worker/src/membership";
import { MEMBERSHIP_FIELDS } from "../shared/schema/fieldMaps";
import worker from "../worker/src/index";

const ENV = {
  AIRTABLE_TOKEN: "***",
  AIRTABLE_BASE_ID: "appTest",
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as any;

// 12:00 on 25 September 2026 in Hong Kong.
const NOW = new Date("2026-09-25T04:00:00Z");

// Record ids are rec + 14 characters, as Airtable's are.
const ID = {
  officer: "recOfficer0000001",
  chair: "recChair000000001",
  captain: "recCaptain0000001",
  player: "recPlayer00000001",
  atSponsor: "recAtSponsor00001",
  atStage6: "recAtStage6000001",
  acceptedRecent: "recAcceptedNew001",
  acceptedOld: "recAcceptedOld001",
  pendingRecent: "recPendingNew0001",
  rejectedOld: "recRejectedOld001",
  resigned: "recResigned000001",
  longMember: "recLongMember0001",
  broken: "recBrokenStage001",
  visitor: "recVisitor0000001",
  sponsorPerson: "recSponsorChris01",
  atChair: "recAtChairman0001",
  atOfficer: "recAtOfficer00001",
};

function tables(): FakeTables {
  const person = (id: string, fields: Record<string, unknown>) => ({ id, fields: { Active: false, ...fields } });
  return {
    People: [
      person(ID.officer, { "Preferred Name": "Olive", Surname: "Officer", Email: "olive@personal.com", "Mobile No.": "6111 2222" }),
      person(ID.chair, { "Preferred Name": "Charles", Surname: "Chair", Email: "charles@personal.com", "Mobile No.": "6333 4444" }),
      person(ID.sponsorPerson, { "Preferred Name": "Chris", Surname: "Coach", "Mobile No.": "9876 5432", "HKID No.": "B765432(1)" }),
      person(ID.atChair, {
        "Preferred Name": "Cara", Surname: "Chairwait", "Applicant Stage": "4. Sponsor (Signed)", Status: "Applicant",
        "Application Date": "2026-08-01T02:00:00.000Z", "Sponsored By Chair": ["recSC"],
      }),
      person(ID.atOfficer, {
        "Preferred Name": "Otto", Surname: "Officerwait", "Applicant Stage": "5. Chairman (Signed)", Status: "Applicant",
        "Application Date": "2026-08-01T02:00:00.000Z", "Sponsored By Membership Officer": ["recMO"],
      }),
      person(ID.captain, { "Preferred Name": "Cap", Surname: "Tain", Email: "cap@personal.com" }),
      person(ID.player, { "Preferred Name": "Pat", Surname: "Player", Email: "pat@hkfc.com", Active: true, Status: "Member", "Membership No.": "1001", "Given Name(s)": "Patrick" }),
      person(ID.atSponsor, {
        "Preferred Name": "Sam", Surname: "Sponsorwait", "Given Name(s)": "Samuel",
        "Applicant Stage": "3. Club Application (Signed)", Status: "Applicant",
        "Application Date": "2026-08-26T02:00:00.000Z", "Sponsor Preferred Name": ["Chris"], "Sponsored By Sponsor": ["recSponsorRow0001"],
        "Mobile No.": "9123 4567", "Tour Interest": ["Bangkok 11s (5-6 Dec 2026)"], "Playing Level": ["Division 2"],
        Photo: [{ url: "https://dl.airtable.com/sam.jpg", filename: "sam.jpg" }],
        "Sports Associate Application Form": [{ url: "https://dl.airtable.com/form.pdf", filename: "form.pdf" }],
        // CRM-only fields the board must never carry.
        "HKID No.": "A123456(7)", "Bank Account No.": "000-111",
      }),
      person(ID.atStage6, {
        "Preferred Name": "Una", Surname: "Ready", "Given Name(s)": "Una",
        "Applicant Stage": "6. Membership Officer (Signed)", Status: "Applicant",
        "Application Date": "2026-06-01T02:00:00.000Z", "Stage Updated At": "2026-09-15T02:00:00.000Z",
        Commitments: ["recCommitment0001"],
      }),
      person(ID.acceptedRecent, { "Preferred Name": "New", Surname: "Joiner", "Applicant Stage": "Accepted", Status: "Member", "Join Date": "2026-07-01", Active: true, "Membership No.": "2001", "Given Name(s)": "Newton" }),
      person(ID.acceptedOld, { "Preferred Name": "Old", Surname: "Hand", "Applicant Stage": "Accepted", Status: "Member", "Join Date": "2023-01-10", Active: true, "Membership No.": "=HYPERLINK(\"x\")", "Given Name(s)": "Oliver, Jr" }),
      person(ID.pendingRecent, { "Preferred Name": "Penny", Surname: "Pending", "Applicant Stage": "Pending", Status: "Applicant", "Application Date": "2026-08-01T02:00:00.000Z" }),
      person(ID.rejectedOld, { "Preferred Name": "Rex", Surname: "Rejected", "Applicant Stage": "Rejected", Status: "Applicant", "Application Date": "2025-06-01T02:00:00.000Z" }),
      person(ID.resigned, { "Preferred Name": "Ray", Surname: "Resigned", "Applicant Stage": "2. Section Captain Invitation", Status: "Resigned" }),
      person(ID.longMember, { "Preferred Name": "Lou", Surname: "Longtime", Status: "Member", Active: true, "Membership No.": "0999", "Given Name(s)": "Louis" }),
      person(ID.broken, { "Preferred Name": "Bo", Surname: "Broken", "Applicant Stage": "undefined", Status: "Applicant" }),
      // Active, but registered without the membership process: not in the export.
      person(ID.visitor, { "Preferred Name": "Vic", Surname: "Visitor", "Applicant Stage": "Temporary", Status: "Applicant", Active: true, "Given Name(s)": "Victor", "Application Date": "2026-09-01T02:00:00.000Z" }),
    ],
    Teams: [],
    "Membership Officers": [{ id: "recMO", fields: { Status: "Active", Designation: "Men's Membership Officer", Member: [ID.officer] } }],
    "Section Chairs": [{ id: "recSC", fields: { Status: "Active", Designation: "Chairman", Member: [ID.chair] } }],
    "Section Captains": [{ id: "recCP", fields: { Status: "Active", Designation: "Men's Captain", Member: [ID.captain] } }],
    Sponsors: [{ id: "recSponsorRow0001", fields: { Status: "Active", Designation: "Team Captain", Member: [ID.sponsorPerson] } }],
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

/** Calls the router as whoever `email` is; Supabase vouches for any token. */
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

/** Response bodies are whatever the route sends; typed loosely for assertions. */
const body = async (res: Response): Promise<any> => res.json();

const approve = (email: string, input: Record<string, unknown>) =>
  as(email, "/api/membership/approve", { method: "POST", body: JSON.stringify(input) });

const patches = () =>
  handle.fetchMock.mock.calls
    .filter(([, init]: any[]) => init?.method === "PATCH")
    .map(([url, init]: any[]) => ({ url: String(url), fields: JSON.parse(init.body).fields }));

describe("who can open the membership section", () => {
  it.each([
    ["a membership officer", "olive@personal.com", 200],
    ["a Section Captains row", "cap@personal.com", 200],
    ["a section chair", "charles@personal.com", 403],
    ["an ordinary player", "pat@hkfc.com", 403],
  ])("%s gets %i from the board", async (_label, email, status) => {
    const res = await as(email, "/api/membership/board");
    expect(res.status).toBe(status);
    if (status === 403) expect((await body(res)).error).toBe("OFFICER_ACCESS_REQUIRED");
  });

  it("gates the export and Approve the same way", async () => {
    expect((await as("charles@personal.com", "/api/membership/active-members")).status).toBe(403);
    expect((await approve("pat@hkfc.com", { personId: ID.atStage6 })).status).toBe(403);
    expect(patches()).toHaveLength(0);
  });
});

describe("the board", () => {
  async function board() {
    const res = await as("olive@personal.com", "/api/membership/board");
    expect(res.status).toBe(200);
    return body(res);
  }

  it("shows the pipeline, recent outcomes and data problems, and nothing else", async () => {
    const { cards } = await board();
    const byId = Object.fromEntries(cards.map((c: any) => [c.id, c.column]));
    expect(byId).toEqual({
      [ID.atSponsor]: "3. Club Application (Signed)",
      [ID.atChair]: "4. Sponsor (Signed)",
      [ID.atOfficer]: "5. Chairman (Signed)",
      [ID.atStage6]: "6. Membership Officer (Signed)",
      [ID.acceptedRecent]: "Accepted", // joined within 12 months
      // Pending was retired from the base; a record still set to it is flagged.
      [ID.pendingRecent]: "Needs fixing",
      [ID.visitor]: "Temporary",
      [ID.broken]: "Needs fixing", // "undefined" should not be in use
      // Not shown: accepted in 2023, rejected over a year ago, resigned,
      // and long-standing members with no stage at all.
    });
  });

  it("says who each card is waiting on, and how long", async () => {
    const { cards } = await board();
    const sam = cards.find((c: any) => c.id === ID.atSponsor);
    expect(sam).toMatchObject({
      name: "Sam Sponsorwait",
      waitingOn: "Sponsor (Chris)",
      appliedOn: "2026-08-26",
      days: 30, // no stage date yet: counted from the application
      canApprove: false,
      photo: "https://dl.airtable.com/sam.jpg",
      applicationForm: [{ url: "https://dl.airtable.com/form.pdf", filename: "form.pdf" }],
      tourInterest: ["Bangkok 11s (5-6 Dec 2026)"],
      playingLevel: ["Division 2"],
    });
    const una = cards.find((c: any) => c.id === ID.atStage6);
    expect(una).toMatchObject({ stageSince: "2026-09-15", days: 10, canApprove: true });
  });

  it("names whoever each application is waiting on, with their mobile, for WhatsApp", async () => {
    const { cards } = await board();
    const chase = (id: string) => cards.find((c: any) => c.id === id)?.chase;
    expect(chase(ID.atSponsor)).toEqual({ role: "Sponsor", name: "Chris Coach", firstName: "Chris", mobile: "9876 5432" });
    expect(chase(ID.atChair)).toEqual({ role: "Chairman", name: "Charles Chair", firstName: "Charles", mobile: "6333 4444" });
    expect(chase(ID.atOfficer)).toEqual({
      role: "Membership Officer",
      name: "Olive Officer",
      firstName: "Olive",
      mobile: "6111 2222",
    });
    // Stage 6 waits on the club, not a person.
    expect(chase(ID.atStage6)).toBeUndefined();
  });

  it("reads the people it contacts by id, for name, mobile and photo only", async () => {
    const res = await board();
    const formulaOf = (url: string) => new URLSearchParams(url.split("?")[1] ?? "").get("filterByFormula") ?? "";
    const reads = handle.calls.filter((c) => c.url.includes("/People?") && formulaOf(c.url).startsWith("OR(RECORD_ID()"));
    expect(reads).toHaveLength(1);
    expect(requestedFields(reads[0].url)).toEqual(["Preferred Name", "Given Name(s)", "Surname", "Mobile No.", "Photo", "Status"]);
    expect(JSON.stringify(res)).not.toMatch(/B765432/);
  });

  it("asks People for the membership fields only, never the CRM", async () => {
    const res = await board();
    // The board's own read, told apart from the sign-in lookup by its filter.
    const formulaOf = (url: string) => new URLSearchParams(url.split("?")[1] ?? "").get("filterByFormula") ?? "";
    const reads = handle.calls.filter(
      (c) => c.url.includes("/People?") && formulaOf(c.url).startsWith('AND({Applicant Stage}!=""'),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(requestedFields(reads[0].url)).toEqual(Object.values(MEMBERSHIP_FIELDS));
    expect(JSON.stringify(res)).not.toMatch(/HKID|A123456|Bank|000-111/);
  });
});

describe("the active-members export", () => {
  it("lists every Active person but Temporary players, sorted by surname, with exactly the four columns", async () => {
    const res = await as("olive@personal.com", "/api/membership/active-members");
    const { filename, csv, count } = await body(res);
    expect(filename).toBe("hkfc-hockey-active-members-2026-09-25.csv");
    expect(count).toBe(4);
    expect(csv.split("\r\n")).toEqual([
      "Membership No.,Surname,Given Name(s),Status",
      // The formula is neutralised and the comma quoted.
      `"'=HYPERLINK(""x"")",Hand,"Oliver, Jr",Member`,
      "2001,Joiner,Newton,Member",
      "0999,Longtime,Louis,Member",
      "1001,Player,Patrick,Member",
      "",
    ]);
    expect(csv).not.toContain("Visitor");
  });

  it("records who exported it", async () => {
    await as("olive@personal.com", "/api/membership/active-members");
    expect(data["Membership Events"]).toEqual([
      {
        id: expect.any(String),
        fields: {
          "Event Type": "Exported",
          Notes: "Active members CSV, 4 rows",
          Actor: [ID.officer],
          "Actor Email": "olive@personal.com",
          Timestamp: NOW.toISOString(),
        },
      },
    ]);
  });

  it("neutralises anything a spreadsheet would run", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+852")).toBe("'+852");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell("O'Brien")).toBe("O'Brien");
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
  });
});

describe("Approve", () => {
  const valid = { personId: ID.atStage6, joinDate: "2026-09-25", commitmentEndDate: "2028-09-24", membershipNo: "3001" };

  it("moves stage 6 to Accepted with the club's details, writing exactly five fields", async () => {
    const res = await approve("olive@personal.com", valid);
    expect(res.status).toBe(200);
    expect(patches()).toEqual([
      {
        url: expect.stringContaining(`/People/${ID.atStage6}`),
        fields: {
          Status: "Member",
          "Applicant Stage": "Accepted",
          "Join Date": "2026-09-25",
          "Commitment End Date": "2028-09-24",
          "Membership No.": "3001",
        },
      },
    ]);
    // The link field was never sent, so it is untouched.
    const una = data.People.find((r) => r.id === ID.atStage6)!;
    expect(una.fields.Commitments).toEqual(["recCommitment0001"]);
  });

  it("records the approval in Membership Events", async () => {
    await approve("olive@personal.com", valid);
    expect(data["Membership Events"]?.map((r) => r.fields)).toEqual([
      {
        "Event Type": "Approved",
        Person: [ID.atStage6],
        "Previous Stage": "6. Membership Officer (Signed)",
        "New Stage": "Accepted",
        "Membership No.": "3001",
        "Join Date": "2026-09-25",
        "Commitment End Date": "2028-09-24",
        "Shared Membership No.": false,
        Actor: [ID.officer],
        "Actor Email": "olive@personal.com",
        Timestamp: NOW.toISOString(),
      },
    ]);
  });

  it("still approves when the audit row cannot be written", async () => {
    const airtable = handle.fetchMock as unknown as typeof fetch;
    const failing = vi.fn((url: any, init?: any) =>
      String(url).includes("/Membership%20Events")
        ? Promise.resolve(new Response('{"error":{"type":"UNKNOWN_FIELD_NAME"}}', { status: 422 }))
        : airtable(url, init),
    );
    handle.fetchMock = failing as any;
    const res = await approve("olive@personal.com", valid);
    expect(res.status).toBe(200);
    expect(failing.mock.calls.some(([url]) => String(url).includes("/Membership%20Events"))).toBe(true);
    expect(data.People.find((r) => r.id === ID.atStage6)!.fields["Applicant Stage"]).toBe("Accepted");
  });

  it("shows the result on the board straight away", async () => {
    await as("olive@personal.com", "/api/membership/board"); // warm the cache
    await approve("olive@personal.com", valid);
    const { cards } = await body(await as("olive@personal.com", "/api/membership/board"));
    expect(cards.find((c: any) => c.id === ID.atStage6)).toMatchObject({ column: "Accepted", membershipNo: "3001" });
  });

  it("is open to a Section Captains row too", async () => {
    expect((await approve("cap@personal.com", valid)).status).toBe(200);
  });

  it("refuses anyone not at stage 6", async () => {
    const res = await approve("olive@personal.com", { ...valid, personId: ID.atSponsor });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("NOT_APPROVABLE");
    expect(patches()).toHaveLength(0);
  });

  // Spouses and children share the main member's number: a warning, not a block.
  it("will not share a Membership No. unseen", async () => {
    const res = await approve("olive@personal.com", { ...valid, membershipNo: "1001" });
    expect(res.status).toBe(409);
    const refused = await body(res);
    expect(refused.error).toBe("SHARED_MEMBERSHIP_NO");
    expect(refused.message).toContain("Pat Player (Member)");
    expect(patches()).toHaveLength(0);
  });

  it("shares a Membership No. once the officer has seen who has it, and says so in the log", async () => {
    const res = await approve("olive@personal.com", { ...valid, membershipNo: "1001", sharedNumberAcknowledged: true });
    expect(res.status).toBe(200);
    expect(patches()[0].fields["Membership No."]).toBe("1001");
    expect(data["Membership Events"]?.[0].fields).toMatchObject({
      "Shared Membership No.": true,
      Notes: "Shares Membership No. with Pat Player (Member)",
    });
  });

  it("looks up who else has a number, leaving out the applicant", async () => {
    const res = await as("olive@personal.com", `/api/membership/number-holders?membershipNo=1001&exclude=${ID.atStage6}`);
    expect(await body(res)).toEqual({ holders: [{ id: ID.player, name: "Pat Player", status: "Member" }] });
    const self = await as("olive@personal.com", `/api/membership/number-holders?membershipNo=1001&exclude=${ID.player}`);
    expect(await body(self)).toEqual({ holders: [] });
    expect((await as("charles@personal.com", "/api/membership/number-holders?membershipNo=1001")).status).toBe(403);
  });

  it.each([
    ["a missing Join Date", { joinDate: "" }],
    ["an impossible date", { joinDate: "2026-02-30" }],
    ["an end date before the join date", { commitmentEndDate: "2026-09-01" }],
    ["a blank Membership No.", { membershipNo: "   " }],
    ["a malformed record id", { personId: "not-a-record" }],
  ])("rejects %s", async (_label, change) => {
    const res = await approve("olive@personal.com", { ...valid, ...change });
    expect(res.status).toBe(400);
    expect(patches()).toHaveLength(0);
  });
});

describe("Insights", () => {
  it("is for the membership section only", async () => {
    expect((await as("charles@personal.com", "/api/membership/insights")).status).toBe(403);
    expect((await as("pat@hkfc.com", "/api/membership/insights")).status).toBe(403);
    expect((await as("cap@personal.com", "/api/membership/insights")).status).toBe(200);
  });

  it("sends countable facts only - no contact details, notes or attachments", async () => {
    const res = await body(await as("olive@personal.com", "/api/membership/insights"));
    const sam = res.facts.find((f: any) => f.name === "Sam Sponsorwait");
    expect(sam).toEqual({
      name: "Sam Sponsorwait",
      stage: "3. Club Application (Signed)",
      column: "3. Club Application (Signed)",
      appliedOn: "2026-08-26",
      days: 30,
      sponsor: "Chris",
    });
    expect(JSON.stringify(res)).not.toMatch(/9123|dl\.airtable\.com|HKID|Bank/);
    // Every season, not just the board's last 12 months.
    expect(res.facts.map((f: any) => f.name)).toContain("Old Hand");
  });

  it("counts each team's Active players by position, against its matchday squad size", async () => {
    data.Teams.push(
      { id: "recTeamC", fields: { "Team Name": "HKFC C", "Team Rank": 3, Active: true, "Target Squad Size": 16 } },
      { id: "recTeamD", fields: { "Team Name": "HKFC D", "Team Rank": 4, Active: true } },
    );
    Object.assign(data.People.find((r) => r.id === ID.player)!.fields, { "Registered Team": "HKFC D", "Selected Team EOS": "HKFC C", "Playing Position": "Goalkeeper" });
    Object.assign(data.People.find((r) => r.id === ID.longMember)!.fields, { "Registered Team": "HKFC C", "Playing Position": "Defender" });
    Object.assign(data.People.find((r) => r.id === ID.acceptedRecent)!.fields, { "Registered Team": "HKFC D" });

    const { teams } = await body(await as("olive@personal.com", "/api/membership/insights"));
    expect(teams).toEqual([
      { team: "HKFC C", teamRank: 3, targetSquadSize: 16, active: 2, byPosition: { Goalkeeper: 1, Defender: 1 } },
      { team: "HKFC D", teamRank: 4, targetSquadSize: 16, active: 1, byPosition: { "Not set": 1 } },
    ]);
  });
});
