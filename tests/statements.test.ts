import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The membership section's Statements board: yearly commitment reviews by
// Review Progress, and Notify now. Driven through the real router and auth
// path, like membership.test.ts, on the Supabase backend's in-memory
// repositories.
// ---------------------------------------------------------------------------

import { invalidateAll } from "../worker/src/cache";
import { HttpError } from "../worker/src/http";
import worker from "../worker/src/index";
import type { Env } from "../worker/src/env";
import { useFakeRepos, type FakeCommitment, type FakePerson } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { commitment, office, person as personRow, recId } from "./helpers/factories";

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

// 12:00 on 25 September 2026 in Hong Kong. The automation's 60-day window
// runs to 24 November 2026.
const NOW = new Date("2026-09-25T04:00:00Z");

const ID = {
  officer: "recOfficer0000001",
  chair: "recChair000000001",
  captain: "recCaptain0000001",
  player: "recPlayer00000001",
  resigned: "recResigned000001",
  sponsorPerson: "recSponsorChris01",
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

const SPONSOR_ROW = "recSponsorRow0001";

/** Inactive unless the overrides say otherwise, as the old People fixture was. */
const person = (id: string, overrides: Partial<FakePerson>) => personRow({ id, active: false, ...overrides });
/** A Commitments row linked to Pat, as the view returns it (lookups as one-element lists). */
const cmt = (id: string, fields: Partial<FakeCommitment>) =>
  commitment({ id, people: [ID.player], fullName: ["Pat Player"], membershipNo: ["1001"], ...fields });

function seed() {
  return {
    people: [
      person(ID.officer, { preferredName: "Olive", surname: "Officer", email: "olive@personal.com" }),
      person(ID.chair, { preferredName: "Charles", surname: "Chair", email: "charles@personal.com" }),
      person(ID.captain, { preferredName: "Cap", surname: "Tain", email: "cap@personal.com" }),
      person(ID.player, {
        preferredName: "Pat", surname: "Player", email: "pat@hkfc.com", active: true, status: "Member", mobileNo: "9123 4567",
        crm: { photo: [{ url: "https://files.test/pat.jpg", filename: "pat.jpg" }] },
      }),
      person(ID.sponsorPerson, { preferredName: "Chris", surname: "Coach", mobileNo: "9876 5432" }),
      person(ID.resigned, { preferredName: "Ray", surname: "Resigned", status: "Resigned" }),
    ],
    officers: [
      office("membershipOfficer", ID.officer, { id: recId("MO"), designation: "Men's Membership Officer" }),
      office("sectionChair", ID.chair, { id: recId("SC"), designation: "Chairman" }),
      office("sectionCaptain", ID.captain, { id: recId("CP"), designation: "Men's Captain" }),
      office("sponsor", ID.sponsorPerson, { id: SPONSOR_ROW }),
    ],
    commitments: [
      cmt(ID.due, {
        reviewProgress: "Not Started", yearNo: 1, periodStart: "2025-12-01", periodEnd: "2026-11-30",
        period: "2025-12-01 to 2026-11-30", sponsorName: ["Chris"], selectedTeamEos: ["HKFC C"],
        // Not in the board's view, so never on the board.
        ...({ combinedContext: "=== MEMBER INPUTS ===", recommendationAi: { state: "generated", value: "x" } } as Partial<FakeCommitment>),
      }),
      cmt(ID.inWindow, { reviewProgress: "Not Started", yearNo: 2, periodStart: "2025-11-01", periodEnd: "2026-10-31" }),
      cmt(ID.requested, { reviewProgress: "Not Started", notifyNow: true, periodStart: "2026-01-01", periodEnd: "2026-12-31" }),
      cmt(ID.overdue, { reviewProgress: "Not Started", yearNo: 1, periodStart: "2025-09-01", periodEnd: "2026-08-31" }),
      cmt(ID.ancient, { reviewProgress: "Not Started", yearNo: 1, periodStart: "2022-07-01", periodEnd: "2023-06-30" }),
      cmt(ID.notified, { reviewProgress: "Notified Member", periodStart: "2025-10-15", periodEnd: "2026-10-14" }),
      cmt(ID.memberIn, {
        reviewProgress: "Member Submitted (with Sponsor)", periodStart: "2025-10-01", periodEnd: "2026-09-30",
        memberSubmittedAt: "2026-09-10T03:00:00.000Z", sponsorName: ["Chris"], sponsorLink: [SPONSOR_ROW],
        matchesPlayed: 14, teamsPlayed: ["HKFC C", "HKFC D"], practices: "Moderate 50-70%",
        playerStatement: [{ url: "https://files.test/statement.pdf", filename: "statement.pdf" }],
      }),
      cmt(ID.completeRecent, {
        reviewProgress: "Complete", periodStart: "2025-08-01", periodEnd: "2026-07-31",
        officerSubmittedAt: "2026-07-20T03:00:00.000Z",
      }),
      cmt(ID.completeJune, { reviewProgress: "Complete", periodStart: "2025-07-01", periodEnd: "2026-06-30" }),
      cmt(ID.completeOld, { reviewProgress: "Complete", periodStart: "2023-04-01", periodEnd: "2024-03-31" }),
      cmt(ID.future, { reviewProgress: "Not Started", yearNo: 2, periodStart: "2026-12-01", periodEnd: "2027-11-30" }),
      commitment({ id: ID.orphan, reviewProgress: "Not Started", periodStart: "2026-01-01", periodEnd: "2026-12-31" }),
      cmt(ID.ofResigned, { people: [ID.resigned], reviewProgress: "Notified Member", periodStart: "2025-10-01", periodEnd: "2026-09-30" }),
      cmt(ID.blank, { periodStart: "2025-11-15", periodEnd: "2026-11-14" }),
    ],
  };
}

const db = useFakeRepos(seed);

beforeEach(() => {
  invalidateAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // Supabase vouches for any token: "token-for-<email>" signs in as <email>.
  // Nothing here queries PostgREST directly; a request that did would fail the test.
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

async function as(email: string, path: string, init: RequestInit = {}): Promise<Response> {
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

/** Every Commitments write (Notify Now is the only one there is). */
const patches = () => db.callsTo("commitments", "setNotifyNow").map((c) => c.args[0]);
const row = (id: string) => db.state.commitments.find((r) => r.id === id)!;

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

  it("carries the member's photo and mobile, and the sponsor while the review waits on them", async () => {
    const { cards } = await board();
    const due = cards.find((c: any) => c.id === ID.due);
    expect(due).toMatchObject({ photo: "https://files.test/pat.jpg", mobileNo: "9123 4567" });
    expect(due.chase).toBeUndefined();
    expect(cards.find((c: any) => c.id === ID.memberIn).chase).toEqual({
      role: "Sponsor",
      name: "Chris Coach",
      firstName: "Chris",
      mobile: "9876 5432",
    });
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
      playerStatement: [{ url: "https://files.test/statement.pdf", filename: "statement.pdf" }],
    });
  });

  it("asks Commitments for the board's fields only, never the AI or combined context", async () => {
    const res = await board();
    // The board's view (COMMITMENT_FIELDS) is its only Commitments read.
    expect(db.callsTo("commitments").map((c) => c.method)).toEqual(["listReviewBoard"]);
    expect(JSON.stringify(res)).not.toMatch(/MEMBER INPUTS|"state"/);
  });
});

describe("Notify now", () => {
  it("ticks Notify Now and nothing else, leaving Review Progress to the automation", async () => {
    const res = await notify("olive@personal.com", ID.due);
    expect(res.status).toBe(200);
    expect(patches()).toEqual([ID.due]);
    // statements.ts never sets Review Progress itself: moving the row is the
    // repository's job (start_review on Supabase), with the email.
    expect(row(ID.due).reviewProgress).toBe("Not Started");
    expect(row(ID.due).people).toEqual([ID.player]); // the link was never written
  });

  it("records the request in Membership Events", async () => {
    await notify("cap@personal.com", ID.due);
    expect(db.state.membershipEvents).toEqual([
      {
        eventType: "Notified",
        personId: ID.player,
        notes: "Commitment review email requested early for Year 1 (2025-12-01 to 2026-11-30).",
        actorId: ID.captain,
        actorEmail: "cap@personal.com",
        timestamp: NOW.toISOString(),
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

  // Airtable refused with SETUP_REQUIRED while the base had no Notify Now
  // checkbox. Supabase has no such setup step; its counterpart is
  // start_review finding the review already started (by someone else, just
  // now), which refuses with ALREADY_STARTED. Either way: a plain 409, and
  // nothing written to the log.
  it("says plainly when the review was started meanwhile", async () => {
    vi.spyOn(db.repos.commitments, "setNotifyNow").mockRejectedValue(
      new HttpError("This review has already been started.", 409, "ALREADY_STARTED"),
    );
    const res = await notify("olive@personal.com", ID.overdue);
    expect(res.status).toBe(409);
    expect(await body(res)).toMatchObject({ error: "ALREADY_STARTED" });
    expect(db.state.membershipEvents).toHaveLength(0);
  });
});
