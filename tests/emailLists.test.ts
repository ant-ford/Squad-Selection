import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// The chairman's email lists: the shared matching and output (instant, in
// the app), and the Worker's directory and export log, driven through the
// real router and auth path on the Supabase backend's in-memory
// repositories.
// ---------------------------------------------------------------------------

import {
  ANY,
  bccText,
  buildList,
  chunk,
  describeSelection,
  fromParams,
  groupOptions,
  mailtoBcc,
  matches,
  toParams,
  uniqueAddresses,
  type DirectoryPerson,
} from "../shared/emailLists";
import { resolveEmails } from "../worker/src/chairman";
import { invalidateAll } from "../worker/src/cache";
import worker from "../worker/src/index";
import type { Env } from "../worker/src/env";
import { useFakeRepos, type FakePerson } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { office, person as personRow, recId } from "./helpers/factories";

const person = (id: string, values: Record<string, string[]>, emails: string[] = [`${id}@x.com`]): DirectoryPerson => ({
  id,
  name: id,
  surname: id,
  values,
  emails,
  emailSource: emails.length ? "own" : "none",
  under18: false,
});

describe("matching", () => {
  const ann = person("ann", { status: ["Member"], team: ["HKFC A"], touringCommittee: ["Hotel Bookings"] });
  const bob = person("bob", { status: ["Member"], team: ["HKFC B"] });
  const cat = person("cat", { status: ["Applicant"], team: ["HKFC A"] });

  it("ORs within a group and ANDs across groups", () => {
    const pick = { status: ["Member"], team: ["HKFC A", "HKFC B"] };
    expect([ann, bob, cat].filter((p) => matches(p, pick)).map((p) => p.id)).toEqual(["ann", "bob"]);
    expect([ann, bob, cat].filter((p) => matches(p, { team: ["HKFC A"] })).map((p) => p.id)).toEqual(["ann", "cat"]);
  });

  it("treats an empty group as no filter, and Any as having any value there", () => {
    expect(matches(bob, { team: [] })).toBe(true);
    expect([ann, bob].filter((p) => matches(p, { touringCommittee: [ANY] })).map((p) => p.id)).toEqual(["ann"]);
  });

  it("adds and removes people by hand, and sorts by surname", () => {
    const list = buildList([cat, bob, ann], { status: ["Member"] }, ["cat"], ["bob"]);
    expect(list.map((p) => p.id)).toEqual(["ann", "cat"]);
  });
});

describe("output", () => {
  it("lists each address once, whatever its case", () => {
    const a = person("a", {}, ["Pat@x.com", "work@y.com"]);
    const b = person("b", {}, ["pat@X.com"]); // a spouse on the same address
    expect(uniqueAddresses([a, b])).toEqual(["Pat@x.com", "work@y.com"]);
  });

  it("separates with semicolons for Outlook and commas for Gmail", () => {
    expect(bccText(["a@x.com", "b@x.com"], "outlook")).toBe("a@x.com; b@x.com");
    expect(bccText(["a@x.com", "b@x.com"], "gmail")).toBe("a@x.com, b@x.com");
  });

  it("splits a long list into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("offers a mail-app link only while it is short enough to open", () => {
    expect(mailtoBcc(["a@x.com", "b+1@x.com"])).toBe("mailto:?bcc=a%40x.com,b%2B1%40x.com");
    const many = Array.from({ length: 150 }, (_, i) => `member${i}@example.com`);
    expect(mailtoBcc(many)).toBeNull();
    expect(mailtoBcc([])).toBeNull();
  });

  it("describes the list in words, groups in a fixed order", () => {
    expect(describeSelection({ team: ["HKFC A", "HKFC B"], status: ["Member"], touringCommittee: [ANY] })).toBe(
      "Status: Member; Team: HKFC A or HKFC B; Touring Committee: any",
    );
    expect(describeSelection({})).toBe("Everyone");
  });

  it("round-trips a list through the page address", () => {
    const selection = { status: ["Member"], team: ["HKFC A", "HKFC B"] };
    const params = toParams(selection, ["recA"], ["recB"]);
    expect(fromParams(params)).toEqual({ selection, added: ["recA"], removed: ["recB"] });
  });

  it("offers each group's values in display order", () => {
    const opts = groupOptions([
      person("a", { ageBand: ["36-40"], memberType: ["Child"] }),
      person("b", { ageBand: ["16-20"], memberType: ["Main"] }),
    ]);
    expect(opts.ageBand).toEqual(["16-20", "36-40"]);
    expect(opts.memberType).toEqual(["Main", "Child"]);
  });
});

describe("which address a person is written to", () => {
  // Owner decision, 2026-09-25: always their own Email; under-18s copy in
  // the guardian as well. Office, spouse and preferred-channel addresses are
  // not used, whatever the record says.
  it("uses an adult's own Email and nothing else", () => {
    expect(
      resolveEmails({
        age: 34,
        email: "me@home.com",
        officeEmail: "me@work.com",
        preferredChannel: ["Office Email"],
        guardianEmail: "mum@home.com",
      }),
    ).toEqual({ emails: ["me@home.com"], emailSource: "own", under18: false });
  });

  it("copies in the guardian for an under-18", () => {
    expect(resolveEmails({ age: 15, email: "kid@home.com", guardianEmail: "mum@home.com" })).toEqual({
      emails: ["kid@home.com", "mum@home.com"],
      emailSource: "own-and-guardian",
      under18: true,
    });
  });

  it("treats 18 as an adult", () => {
    expect(resolveEmails({ age: 18, email: "me@home.com", guardianEmail: "mum@home.com" }).emails).toEqual([
      "me@home.com",
    ]);
  });

  it("writes to the guardian alone when an under-18 has no address of their own", () => {
    expect(resolveEmails({ age: 12, guardianEmail: "mum@home.com" })).toEqual({
      emails: ["mum@home.com"],
      emailSource: "guardian",
      under18: true,
    });
  });

  it("says when an under-18's guardian has no address, so the page can warn", () => {
    expect(resolveEmails({ age: 16, email: "kid@home.com" })).toEqual({
      emails: ["kid@home.com"],
      emailSource: "own",
      under18: true,
    });
  });

  it("counts one address once when the guardian's is the junior's Email too", () => {
    expect(resolveEmails({ age: 10, email: "Family@home.com", guardianEmail: "family@home.com" }).emails).toEqual([
      "Family@home.com",
    ]);
  });

  it("does not treat an unknown age as under 18, and ignores junk", () => {
    expect(resolveEmails({ email: "n/a", guardianEmail: "mum@home.com" })).toEqual({
      emails: [],
      emailSource: "none",
      under18: false,
    });
  });
});

// ── Through the router ────────────────────────────────────────────────

const ENV = {
  ...SUPABASE_TEST_ENV,
  CALENDAR_SECRET: "***",
  ALLOWED_ORIGIN: "https://app.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "***",
} as unknown as Env;

const ID = { chair: "recChair000000001", captain: "recCaptain0000001", officer: "recOfficer0000001", pat: "recPat00000000001", ray: "recRay00000000001" };

/** Inactive unless the overrides say otherwise, as the old People fixture was. */
const row = (id: string, overrides: Partial<FakePerson>) => personRow({ id, active: false, ...overrides });

const db = useFakeRepos(() => ({
  people: [
    row(ID.chair, { preferredName: "Charles", surname: "Chair", email: "charles@personal.com", status: "Member" }),
    row(ID.captain, { preferredName: "Cap", surname: "Tain", email: "cap@personal.com", status: "Member", active: true }),
    row(ID.officer, { preferredName: "Olive", surname: "Officer", email: "olive@personal.com", status: "Member" }),
    row(ID.pat, {
      preferredName: "Pat", surname: "Player", email: "pat@home.com", status: "Member", active: true,
      registeredTeam: "HKFC D", selectedTeamEos: "HKFC C",
      crm: {
        memberType: "Main", touringCommittee: ["Not Interested"], qualifiedUmpire: "Not Applicable",
        tourInterest: ["Bangkok 11s (5-6 Dec 2026)"],
        // CRM-only columns no directory view carries.
        ...({ hkidNo: "A123456(7)", bankAccountNo: "000-111", homeStreet: "1 Secret Road" } as FakePerson["crm"]),
      },
    }),
    row(ID.ray, { preferredName: "Ray", surname: "Resigned", email: "ray@home.com", status: "Resigned" }),
  ],
  officers: [
    office("membershipOfficer", ID.officer, { id: recId("MO") }),
    office("sectionChair", ID.chair, { id: recId("SC"), designation: "Chairman" }),
    office("sectionCaptain", ID.captain, { id: recId("CP") }),
  ],
}));

beforeEach(() => {
  invalidateAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T04:00:00Z"));
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

describe("the directory", () => {
  it.each([
    ["the chair", "charles@personal.com", 200],
    ["a Section Captains row", "cap@personal.com", 200],
    ["a membership officer", "olive@personal.com", 403],
    ["an ordinary player", "pat@home.com", 403],
  ])("is open to %s? %i", async (_label, email, status) => {
    expect((await as(email, "/api/chairman/directory")).status).toBe(status);
  });

  it("holds everyone but the resigned, with their groups and addresses", async () => {
    const { people } = await body(await as("charles@personal.com", "/api/chairman/directory"));
    expect(people.map((p: any) => p.name)).not.toContain("Ray Resigned");
    expect(people.find((p: any) => p.id === ID.pat)).toEqual({
      id: ID.pat,
      name: "Pat Player",
      surname: "Player",
      values: {
        status: ["Member"],
        active: ["Active player"],
        team: ["HKFC C"], // Selected Team EOS, not Registered
        memberType: ["Main"],
        tourInterest: ["Bangkok 11s (5-6 Dec 2026)"],
        // "Not Interested" and "Not Applicable" are not values to match on.
      },
      emails: ["pat@home.com"],
      emailSource: "own",
      under18: false,
    });
  });

  it("asks People for the list fields only, never the CRM", async () => {
    const res = await body(await as("charles@personal.com", "/api/chairman/directory"));
    // The directory view (CHAIRMAN_FIELDS) is the only People read besides sign-in.
    expect([...new Set(db.callsTo("people").map((c) => c.method))].sort()).toEqual(["findByEmail", "listDirectory"]);
    expect(JSON.stringify(res)).not.toMatch(/HKID|A123456|000-111|Secret Road/);
  });
});

describe("the export log", () => {
  const log = (email: string, input: Record<string, unknown>) =>
    as(email, "/api/chairman/export-log", { method: "POST", body: JSON.stringify(input) });

  it("records how many and which groups, never the addresses", async () => {
    const res = await log("charles@personal.com", {
      kind: "outlook",
      people: 42,
      addresses: 40,
      description: "Status: Member; Team: HKFC C",
    });
    expect(res.status).toBe(200);
    expect(db.state.membershipEvents).toEqual([
      {
        eventType: "Exported",
        notes: "Email list copied for Outlook: 40 addresses, 42 people. Status: Member; Team: HKFC C",
        actorId: ID.chair,
        actorEmail: "charles@personal.com",
        timestamp: "2026-09-25T04:00:00.000Z",
      },
    ]);
  });

  it("is refused outside the chairman's section, and for an unknown kind", async () => {
    expect((await log("olive@personal.com", { kind: "csv", people: 1, addresses: 1 })).status).toBe(403);
    expect((await log("charles@personal.com", { kind: "fax", people: 1, addresses: 1 })).status).toBe(400);
    expect(db.state.membershipEvents).toEqual([]);
  });
});
