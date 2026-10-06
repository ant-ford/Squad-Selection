import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The player-page banner: the person's own forms (Player Statement,
// Waivers & Declarations) and whatever the New Joiner and Statements
// processes are waiting on them for. Driven through the real router, on the
// Supabase backend: the repositories in memory, and the fake PostgREST for
// what myTasks reads directly (the signing lines from applicationSigning.ts,
// the details check, joiner requests and events).
//
// On Supabase every line opens an Eddy screen, not a Fillout form, so the
// URLs differ from the Airtable version of this file: /review/<id>,
// /waivers, /apply and /sign-application/<id>.
// ---------------------------------------------------------------------------

import { invalidateAll } from "../worker/src/cache";
import { invalidateCommitments, invalidatePeople } from "../worker/src/invalidation";
import { waiversDoneThisSeason } from "../worker/src/myTasks";
import worker from "../worker/src/index";
import type { Env } from "../worker/src/env";
import { useFakeRepos, type FakePerson } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest, type PgRow } from "./helpers/postgrest";
import { commitment, office, person as personRow } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

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

// Office rows: the same ids in the repositories and in PostgREST.
const OFFICE = {
  sponsor: "recSponsorRow0001",
  chair: "recChairRow000001",
  officer: "recOfficerRow0001",
  captain: "recCaptainRow0001",
};

/** Where each line goes: Eddy's own screens. */
const SIGN = (id: string) => `/sign-application/${id}`;
const REVIEW = (id: string) => `/review/${id}`;

/** PostgREST's uuid for a People row. */
const uuid = (apiId: string) => `uuid-${apiId}`;

// ── The repositories ─────────────────────────────────────────────────────

function member(id: string, email: string, first: string, crm: FakePerson["crm"] = {}): FakePerson {
  return {
    ...personRow({
      id, preferredName: first, surname: "Test", email, active: true, status: "Member",
      // Everyone confirmed their details this season: no "details" line.
      crm: { waiversSubmittedAt: SIGNED, ...({ profileUpdatedAt: SIGNED } as FakePerson["crm"]), ...crm },
    }),
    // Sign-in (auth_context) gives the same uuid the PostgREST rows have.
    uuid: uuid(id),
  } as FakePerson;
}

function applicant(id: string, first: string, stage: string, overrides: Partial<FakePerson> = {}, crm: FakePerson["crm"] = {}): FakePerson {
  return personRow({
    id, preferredName: first, surname: "Applicant", status: "Applicant", applicantStage: stage, active: false,
    ...overrides,
    crm,
  });
}

const review = (id: string, stage: string, fields: Parameters<typeof commitment>[0]) =>
  commitment({
    id, reviewProgress: stage, periodEnd: ["2026-11-30"],
    ...fields,
  });

const db = useFakeRepos(() => ({
  people: [
    member(ID.pat, "pat@hkfc.com", "Pat", {
      // Last season's: this season still needs one.
      waiversSubmittedAt: "2026-05-20T02:00:00.000Z",
      ...({ hkidNo: "A123456(7)" } as FakePerson["crm"]),
    }),
    member(ID.sue, "sue@hkfc.com", "Sue"),
    member(ID.chris, "chris@hkfc.com", "Chris"),
    member(ID.charles, "charles@hkfc.com", "Charles"),
    member(ID.olive, "olive@hkfc.com", "Olive"),
    member(ID.cap, "cap@hkfc.com", "Cap"),
    applicant(ID.tim, "Tim", "1. Trial Application"),
    applicant(ID.ivy, "Ivy", "2. Section Captain Invitation", { email: "ivy@hkfc.com", active: true }, { waiversSubmittedAt: SIGNED }),
    applicant(ID.sam, "Sam", "3. Club Application (Signed)", {}, { sponsoredBySponsor: [OFFICE.sponsor] }),
    applicant(ID.cara, "Cara", "4. Sponsor (Signed)", {}, { sponsoredByChair: [OFFICE.chair] }),
    applicant(ID.otto, "Otto", "5. Chairman (Signed)", {}, { sponsoredByOfficer: [OFFICE.officer] }),
  ],
  officers: [
    office("sponsor", ID.chris, { id: OFFICE.sponsor }),
    office("sectionChair", ID.charles, { id: OFFICE.chair, designation: "Chairman" }),
    office("membershipOfficer", ID.olive, { id: OFFICE.officer }),
    office("sectionCaptain", ID.cap, { id: OFFICE.captain, designation: "Men's Captain" }),
  ],
  commitments: [
    review("recCmtPat00000001", "Notified Member", {
      people: [ID.pat], fullName: ["Pat Test"],
    }),
    review("recCmtSue00000001", "Member Submitted (with Sponsor)", {
      people: [ID.sue], fullName: ["Sue Test"], sponsorLink: [OFFICE.sponsor],
    }),
    review("recCmtLou00000001", "Sponsor Submitted (with Membership Officer)", {
      people: ["recMemberLou00001"], fullName: ["Lou Test"], officerLink: [OFFICE.officer],
    }),
    // Before the Statements cut-off (1 July 2026): history, not a task.
    review("recCmtOld00000001", "Member Submitted (with Sponsor)", {
      people: [ID.sue], fullName: ["Sue Test"], sponsorLink: [OFFICE.sponsor], periodEnd: ["2025-11-30"],
    }),
  ],
}));

// ── PostgREST: the same people, as Postgres has them ─────────────────────

/** One people row per repository person, keyed by uuid, with what the direct reads select. */
function pgPerson(p: FakePerson): PgRow {
  const crm = (p.crm ?? {}) as Record<string, unknown>;
  const link = (key: string) => (Array.isArray(crm[key]) ? (crm[key] as string[])[0] : null);
  return {
    id: uuid(p.id),
    api_id: p.id,
    email: p.email ?? null,
    status: p.status ?? null,
    active: p.active,
    // Everyone confirmed their details this season: no "details" line.
    profile_updated_at: SIGNED,
    preferred_name: p.preferredName ?? null,
    given_names: p.givenNames ?? null,
    surname: p.surname ?? null,
    applicant_stage: p.applicantStage ?? null,
    sponsored_by_sponsor_id: link("sponsoredBySponsor"),
    sponsored_by_chair_id: link("sponsoredByChair"),
    sponsored_by_officer_id: link("sponsoredByOfficer"),
    hkid_no: (crm.hkidNo as string | undefined) ?? null,
  };
}

/** A new member's application, submitted, nobody signed yet. */
const application = (apiId: string): PgRow => ({
  id: `app-${apiId}`,
  person_id: uuid(apiId),
  application_type: "New HKFC Member",
  submitted_at: "2026-08-01T02:00:00.000Z",
  sponsor_signed_at: null,
  sponsor_signature_file_id: null,
  chair_signed_at: null,
  chair_signature_file_id: null,
  officer_signed_at: null,
  officer_signature_file_id: null,
  pdf_file_id: null,
  sent_at: null,
  sent_by: null,
  sent_to: null,
});

const ROLE = { sponsor: "sponsor", sectionChair: "section_chair", membershipOfficer: "membership_officer", sectionCaptain: "section_captain" } as const;

let pg: FakePostgrest;

beforeEach(() => {
  invalidateAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  pg = fakePostgrest({
    tables: {
      people: db.state.people.map(pgPerson),
      applications: [ID.sam, ID.cara, ID.otto].map(application),
      offices: db.state.officers.map((o) => ({
        id: o.id, role: ROLE[o.office as keyof typeof ROLE], status: o.status, person_id: o.member ? uuid(o.member) : null, office_email: null,
      })),
      team_people: [],
      steps: [],
      events: [],
      event_responses: [],
    },
    relations: { "offices.offices_person_id_fkey": { table: "people", from: "person_id", to: "id", kind: "one" } },
    // Supabase vouches for any token: "token-for-<email>" signs in as <email>.
    other: (_u, init) => {
      const auth = String((init.headers as Record<string, string>).Authorization ?? "");
      return new Response(JSON.stringify({ email: auth.replace(/^Bearer token-for-/, "") }), { status: 200 });
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function as(email: string | null, path: string): Promise<Response> {
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
      { id: "statement:recCmtPat00000001", key: "statement", url: REVIEW("recCmtPat00000001") },
      { id: "waivers", key: "waivers", url: "/waivers" },
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
    db.state.commitments[0].reviewProgress = "Member Submitted (with Sponsor)";
    await invalidateCommitments(ENV);
    expect((await tasksFor("pat@hkfc.com")).map((t: any) => t.key)).toEqual(["waivers"]);
  });

  it("goes as soon as the base shows this season's waivers", async () => {
    await tasksFor("pat@hkfc.com");
    (db.state.people[0].crm as Record<string, unknown>).waiversSubmittedAt = "2026-09-26T03:00:00.000Z";
    await invalidatePeople(ENV);
    expect((await tasksFor("pat@hkfc.com")).map((t: any) => t.key)).toEqual(["statement"]);
  });
});

describe("what the processes are waiting on someone for", () => {
  it("asks each New Joiner signer for their part, with their form", async () => {
    expect(await tasksFor("chris@hkfc.com")).toEqual([
      { id: `application:${ID.sam}`, key: "application", subject: "Sam Applicant", role: "Sponsor", url: SIGN(ID.sam) },
      // Sue's review waits on Chris too; the pre-cut-off one does not appear.
      { id: "review:recCmtSue00000001", key: "review", subject: "Sue Test", role: "Sponsor", url: REVIEW("recCmtSue00000001") },
    ]);
    expect(await tasksFor("charles@hkfc.com")).toEqual([
      { id: `application:${ID.cara}`, key: "application", subject: "Cara Applicant", role: "Chairman", url: SIGN(ID.cara) },
    ]);
    expect(await tasksFor("olive@hkfc.com")).toEqual([
      { id: `application:${ID.otto}`, key: "application", subject: "Otto Applicant", role: "Membership Officer", url: SIGN(ID.otto) },
      { id: "review:recCmtLou00000001", key: "review", subject: "Lou Test", role: "Membership Officer", url: REVIEW("recCmtLou00000001") },
    ]);
  });

  it("asks an invited applicant for their New Joiner Form", async () => {
    expect(await tasksFor("ivy@hkfc.com")).toEqual([
      { id: `joiner:${ID.ivy}`, key: "joiner", url: "/apply" },
    ]);
  });

  it("asks nothing of the Section Captains about trialists (owner decision)", async () => {
    expect(await tasksFor("cap@hkfc.com")).toEqual([]);
  });

  it("moves the line on with the application", async () => {
    await tasksFor("chris@hkfc.com");
    // Chris signs: stage 4 now waits on the chairman. On Supabase the
    // signing lines come from the people and applications tables.
    const sam = pg.tables.people.find((r) => r.api_id === ID.sam)!;
    Object.assign(sam, { applicant_stage: "4. Sponsor (Signed)", sponsored_by_chair_id: OFFICE.chair });
    pg.tables.applications.find((a) => a.person_id === sam.id)!.sponsor_signed_at = "2026-09-26T03:00:00.000Z";
    const samRow = db.state.people.find((r) => r.id === ID.sam)!;
    samRow.applicantStage = "4. Sponsor (Signed)";
    (samRow.crm as Record<string, unknown>).sponsoredByChair = [OFFICE.chair];
    await invalidatePeople(ENV);
    expect((await tasksFor("chris@hkfc.com")).map((t: any) => t.key)).toEqual(["review"]);
    expect((await tasksFor("charles@hkfc.com")).map((t: any) => t.subject)).toEqual(["Cara Applicant", "Sam Applicant"]);
  });

  it("reads only what the lines need, and the person's own record by id", async () => {
    const res = await as("pat@hkfc.com", "/api/my-tasks");
    // The person's own forms: one read, by their id.
    const own = db.callsTo("people", "getMyTaskFields");
    expect(own).toHaveLength(1);
    expect(own[0].args).toEqual([ID.pat]);
    // The direct People reads (signing lines, details check) never select the HKID.
    const selects = pg.reads("people").map((c) => c.params.get("select") ?? "*");
    expect(selects.filter((s) => s === "*" || s.includes("hkid"))).toEqual([]);
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
