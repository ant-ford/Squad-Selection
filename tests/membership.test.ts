import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Membership section: the applicant board, the active-members export and
// Approve. Driven through the real router and the real auth path, with a
// stubbed Supabase session and the in-memory repositories (Supabase
// backend), so access is tested along with behaviour.
// ---------------------------------------------------------------------------

import { invalidateAll } from "../worker/src/cache";
import { csvCell } from "../worker/src/membership";
import { SupabaseError } from "../worker/src/data/supabase";
import worker from "../worker/src/index";
import type { Env } from "../worker/src/env";
import { useFakeRepos, type FakePerson } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { office, person as personRow, recId, team } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

// 12:00 on 25 September 2026 in Hong Kong.
const NOW = new Date("2026-09-25T04:00:00Z");

// Row ids are rec + 14 characters (or uuids): isRowId() refuses anything else.
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

// The office rows the applicants' "Sponsored By" links point to.
const OFFICE = {
  membershipOfficer: recId("MO"),
  sectionChair: recId("SC"),
  sectionCaptain: recId("CP"),
  sponsor: "recSponsorRow0001",
};

const COMMITMENT_LINK = recId("Commitment0001");

/** CRM-only columns (HKID, bank) that no membership row view carries. */
const crmOnly = (extra: Record<string, unknown>) => extra as FakePerson["crm"];

/** Inactive unless the overrides say otherwise, as the old People fixture was. */
const person = (id: string, overrides: Partial<FakePerson>) => personRow({ id, active: false, ...overrides });

function seed() {
  return {
    people: [
      person(ID.officer, { preferredName: "Olive", surname: "Officer", email: "olive@personal.com", mobileNo: "6111 2222" }),
      person(ID.chair, { preferredName: "Charles", surname: "Chair", email: "charles@personal.com", mobileNo: "6333 4444" }),
      person(ID.sponsorPerson, { preferredName: "Chris", surname: "Coach", mobileNo: "9876 5432", crm: crmOnly({ hkidNo: "B765432(1)" }) }),
      person(ID.atChair, {
        preferredName: "Cara", surname: "Chairwait", applicantStage: "4. Sponsor (Signed)", status: "Applicant",
        crm: { applicationDate: "2026-08-01T02:00:00.000Z", sponsoredByChair: [OFFICE.sectionChair] },
      }),
      person(ID.atOfficer, {
        preferredName: "Otto", surname: "Officerwait", applicantStage: "5. Chairman (Signed)", status: "Applicant",
        crm: { applicationDate: "2026-08-01T02:00:00.000Z", sponsoredByOfficer: [OFFICE.membershipOfficer] },
      }),
      person(ID.captain, { preferredName: "Cap", surname: "Tain", email: "cap@personal.com" }),
      person(ID.player, {
        preferredName: "Pat", surname: "Player", email: "pat@hkfc.com", active: true, status: "Member", givenNames: "Patrick",
        crm: { membershipNo: "1001" },
      }),
      person(ID.atSponsor, {
        preferredName: "Sam", surname: "Sponsorwait", givenNames: "Samuel",
        applicantStage: "3. Club Application (Signed)", status: "Applicant", mobileNo: "9123 4567",
        crm: crmOnly({
          applicationDate: "2026-08-26T02:00:00.000Z", sponsorName: ["Chris"], sponsoredBySponsor: [OFFICE.sponsor],
          dateOfBirth: "2008-01-02", tourInterest: ["Bangkok 11s (5-6 Dec 2026)"], playingLevel: ["Division 2"],
          photo: [{ url: "https://files.test/sam.jpg", filename: "sam.jpg" }],
          applicationForm: [{ url: "https://files.test/form.pdf", filename: "form.pdf" }],
          // CRM-only fields the board must never carry.
          hkidNo: "A123456(7)", bankAccountNo: "000-111",
        }),
      }),
      Object.assign(
        person(ID.atStage6, {
          preferredName: "Una", surname: "Ready", givenNames: "Una",
          applicantStage: "6. Membership Officer (Signed)", status: "Applicant",
          crm: { applicationDate: "2026-06-01T02:00:00.000Z", stageUpdatedAt: "2026-09-15T02:00:00.000Z", dateOfBirth: "2003-05-14" },
        }),
        // A link column no row view carries: Approve must leave it alone.
        { commitments: [COMMITMENT_LINK] },
      ),
      person(ID.acceptedRecent, {
        preferredName: "New", surname: "Joiner", applicantStage: "Accepted", status: "Member", active: true, givenNames: "Newton",
        crm: { joinDate: "2026-07-01", membershipNo: "2001" },
      }),
      person(ID.acceptedOld, {
        preferredName: "Old", surname: "Hand", applicantStage: "Accepted", status: "Member", active: true, givenNames: "Oliver, Jr",
        crm: { joinDate: "2023-01-10", membershipNo: "=HYPERLINK(\"x\")" },
      }),
      person(ID.pendingRecent, {
        preferredName: "Penny", surname: "Pending", applicantStage: "Pending", status: "Applicant",
        crm: { applicationDate: "2026-08-01T02:00:00.000Z" },
      }),
      person(ID.rejectedOld, {
        preferredName: "Rex", surname: "Rejected", applicantStage: "Rejected", status: "Applicant",
        crm: { applicationDate: "2025-06-01T02:00:00.000Z" },
      }),
      person(ID.resigned, { preferredName: "Ray", surname: "Resigned", applicantStage: "2. Section Captain Invitation", status: "Resigned" }),
      person(ID.longMember, { preferredName: "Lou", surname: "Longtime", status: "Member", active: true, givenNames: "Louis", crm: { membershipNo: "0999" } }),
      person(ID.broken, { preferredName: "Bo", surname: "Broken", applicantStage: "undefined", status: "Applicant" }),
      // Active, but registered without the membership process: not in the export.
      person(ID.visitor, {
        preferredName: "Vic", surname: "Visitor", applicantStage: "Temporary", status: "Applicant", active: true, givenNames: "Victor",
        crm: { applicationDate: "2026-09-01T02:00:00.000Z" },
      }),
    ],
    teams: [],
    officers: [
      office("membershipOfficer", ID.officer, { id: OFFICE.membershipOfficer, designation: "Men's Membership Officer" }),
      office("sectionChair", ID.chair, { id: OFFICE.sectionChair, designation: "Chairman" }),
      office("sectionCaptain", ID.captain, { id: OFFICE.sectionCaptain, designation: "Men's Captain" }),
      office("sponsor", ID.sponsorPerson, { id: OFFICE.sponsor, designation: "Team Captain" }),
    ],
  };
}

const db = useFakeRepos(seed);
const findPerson = (id: string) => db.state.people.find((p) => p.id === id)!;

beforeEach(() => {
  invalidateAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // Supabase vouches for any token: "token-for-<email>" signs in as <email>.
  // Nothing in the membership section queries PostgREST directly, so a
  // request that did would be a problem and fail the test.
  fakePostgrest({
    tables: {},
    other: (_url, init) => {
      const auth = String((init.headers as Record<string, string>).Authorization ?? "");
      return new Response(JSON.stringify({ email: auth.replace(/^Bearer token-for-/, "") }), { status: 200 });
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Calls the router as whoever `email` is. */
async function as(email: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { Authorization: `Bearer token-for-${email}`, "Content-Type": "application/json", Origin: "https://app.test" };
  return worker.fetch(new Request(`https://api.test${path}`, { ...init, headers }), ENV, { waitUntil: () => {} } as any);
}

/** Response bodies are whatever the route sends; typed loosely for assertions. */
const body = async (res: Response): Promise<any> => res.json();

const approve = (email: string, input: Record<string, unknown>) =>
  as(email, "/api/membership/approve", { method: "POST", body: JSON.stringify(input) });

/** Every People write, as the record id and the patch. */
const patches = () =>
  db.calls
    .filter((c) => c.repo === "people" && (c.method === "update" || c.method === "updateMany"))
    .map((c) => ({ id: c.args[0], fields: c.args[1] as Record<string, unknown> }));

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
      photo: "https://files.test/sam.jpg",
      applicationForm: [{ url: "https://files.test/form.pdf", filename: "form.pdf" }],
      tourInterest: ["Bangkok 11s (5-6 Dec 2026)"],
      playingLevel: ["Division 2"],
    });
    const una = cards.find((c: any) => c.id === ID.atStage6);
    expect(una).toMatchObject({ stageSince: "2026-09-15", days: 10, canApprove: true, turns28On: "2031-05-14" });
    // Only a card that can be approved carries it, and no date of birth leaves the Worker.
    expect(sam.turns28On).toBeUndefined();
    expect(JSON.stringify(cards)).not.toMatch(/2003-05-14|2008-01-02/);
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
    // One contact read, naming exactly the three office holders.
    const reads = db.callsTo("people", "listContactsByIds");
    expect(reads).toHaveLength(1);
    expect([...(reads[0].args[0] as string[])].sort()).toEqual([ID.chair, ID.officer, ID.sponsorPerson].sort());
    expect(JSON.stringify(res)).not.toMatch(/B765432/);
  });

  it("asks People for the membership fields only, never the CRM", async () => {
    const res = await board();
    // The board's own read is the membership view, and no wider People read
    // (the squad list, the chairman's directory) goes into it: only sign-in
    // and the contact lookup besides.
    expect(db.callsTo("people", "listMembershipBoard").length).toBeGreaterThan(0);
    expect([...new Set(db.callsTo("people").map((c) => c.method))].sort()).toEqual(
      ["findByEmail", "listContactsByIds", "listMembershipBoard"],
    );
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
    expect(db.state.membershipEvents).toEqual([
      {
        eventType: "Exported",
        notes: "Active members CSV, 4 rows",
        actorId: ID.officer,
        actorEmail: "olive@personal.com",
        timestamp: NOW.toISOString(),
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

  it("moves stage 6 to Accepted with the club's details and makes them Active, writing exactly six fields", async () => {
    const res = await approve("olive@personal.com", valid);
    expect(res.status).toBe(200);
    expect(patches()).toEqual([
      {
        id: ID.atStage6,
        fields: {
          status: "Member",
          applicantStage: "Accepted",
          active: true,
          joinDate: "2026-09-25",
          commitmentEndDate: "2028-09-24",
          membershipNo: "3001",
        },
      },
    ]);
    // The link column was never named, so it is untouched.
    const una = findPerson(ID.atStage6) as FakePerson & { commitments?: string[] };
    expect(una.commitments).toEqual([COMMITMENT_LINK]);
  });

  it("records the approval in Membership Events", async () => {
    await approve("olive@personal.com", valid);
    expect(db.state.membershipEvents).toEqual([
      {
        eventType: "Approved",
        personId: ID.atStage6,
        previousStage: "6. Membership Officer (Signed)",
        newStage: "Accepted",
        membershipNo: "3001",
        joinDate: "2026-09-25",
        commitmentEndDate: "2028-09-24",
        sharedMembershipNo: false,
        actorId: ID.officer,
        actorEmail: "olive@personal.com",
        timestamp: NOW.toISOString(),
      },
    ]);
  });

  it("still approves when the audit row cannot be written", async () => {
    const record = vi
      .spyOn(db.repos.membershipEvents, "record")
      .mockRejectedValue(new SupabaseError("Could not find the function public.log_activity", 404, "PGRST202"));
    const res = await approve("olive@personal.com", valid);
    expect(res.status).toBe(200);
    expect(record).toHaveBeenCalled();
    expect(findPerson(ID.atStage6).applicantStage).toBe("Accepted");
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
    expect(patches()[0].fields.membershipNo).toBe("1001");
    expect(db.state.membershipEvents[0]).toMatchObject({
      sharedMembershipNo: true,
      notes: "Shares Membership No. with Pat Player (Member)",
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
    expect(JSON.stringify(res)).not.toMatch(/9123|files\.test|HKID|Bank/);
    // Every season, not just the board's last 12 months.
    expect(res.facts.map((f: any) => f.name)).toContain("Old Hand");
  });

  it("counts each team's Active players by position, against its matchday squad size", async () => {
    db.state.teams.push(
      team({ id: recId("TeamC"), teamName: "HKFC C", teamRank: 3, active: true, targetSquadSize: 16 }),
      // No squad size set: counted against 16.
      team({ id: recId("TeamD"), teamName: "HKFC D", teamRank: 4, active: true, targetSquadSize: undefined }),
    );
    Object.assign(findPerson(ID.player), { registeredTeam: "HKFC D", selectedTeamEos: "HKFC C", playingPosition: "Goalkeeper" });
    Object.assign(findPerson(ID.longMember), { registeredTeam: "HKFC C", playingPosition: "Defender" });
    Object.assign(findPerson(ID.acceptedRecent), { registeredTeam: "HKFC D" });

    const { teams } = await body(await as("olive@personal.com", "/api/membership/insights"));
    expect(teams).toEqual([
      { team: "HKFC C", teamRank: 3, targetSquadSize: 16, active: 2, byPosition: { Goalkeeper: 1, Defender: 1 } },
      { team: "HKFC D", teamRank: 4, targetSquadSize: 16, active: 1, byPosition: { "Not set": 1 } },
    ]);
  });
});
