import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// The shared test fakes themselves (tests/helpers/postgrest.ts and
// tests/helpers/fakeRepos.ts): other tests trust them to answer as
// PostgREST and the Supabase repositories do, so their behaviour is pinned.
// ---------------------------------------------------------------------------

import { db, eq, inList } from "../worker/src/data/supabase";
import { people } from "../worker/src/data/people";
import { availabilityExceptions } from "../worker/src/data/availabilityExceptions";
import { officers } from "../worker/src/data/officers";
import type { Env } from "../worker/src/env";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { installFakeRepos } from "./helpers/fakeRepos";
import { exception, match, office, person, recId, team } from "./helpers/factories";
import { authContexts } from "../worker/src/authContext";

const env = { ...SUPABASE_TEST_ENV } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rows = () => [
  { id: "a", name: "Ann", team: "HKFC A", rank: 3, active: true, starts_at: "2026-10-01T09:00:00+00:00", tags: ["x"] },
  { id: "b", name: "bob", team: "HKFC B", rank: 10, active: false, starts_at: "2026-10-02T09:00:00+00:00", tags: [] },
  { id: "c", name: "Cy, Jr", team: null, rank: null, active: true, starts_at: null, tags: [] },
];

describe("fakePostgrest reads", () => {
  it("filters with eq/neq/in/is/gt/gte/lt/lte/ilike/like, not., or() and and()", async () => {
    fakePostgrest({ tables: { t: rows() } });
    const ids = async (q: string) => (await db(env).select<{ id: string }>("t", `select=id&${q}`)).map((r) => r.id);
    expect(await ids(`team=${eq("HKFC A")}`)).toEqual(["a"]);
    // NULL is neither equal nor unequal to anything.
    expect(await ids("team=neq.HKFC A")).toEqual(["b"]);
    expect(await ids(`name=${inList(["Cy, Jr", "bob"])}`)).toEqual(["b", "c"]);
    expect(await ids("team=is.null")).toEqual(["c"]);
    expect(await ids("team=not.is.null")).toEqual(["a", "b"]);
    expect(await ids("active=is.true")).toEqual(["a", "c"]);
    expect(await ids("rank=gt.3")).toEqual(["b"]);
    expect(await ids("rank=gte.3&rank=lte.9")).toEqual(["a"]);
    expect(await ids("rank=lt.10")).toEqual(["a"]);
    expect(await ids("name=ilike.B*")).toEqual(["b"]);
    expect(await ids("name=like.B*")).toEqual([]);
    expect(await ids("id=not.in.(a,b)")).toEqual(["c"]);
    expect(await ids("or=(team.is.null,team.neq.HKFC%20A)")).toEqual(["b", "c"]);
    expect(await ids("and=(active.is.true,or(rank.gt.5,rank.is.null))")).toEqual(["c"]);
    expect(await ids("starts_at=gte.2026-10-01T12:00:00.000Z")).toEqual(["b"]);
    expect(await ids("tags=neq.{}")).toEqual(["a"]);
  });

  it("orders (nulls last ascending, first descending), pages and counts", async () => {
    const pg = fakePostgrest({ tables: { t: rows() } });
    const order = async (q: string) => (await db(env).select<{ id: string }>("t", `select=id&${q}`)).map((r) => r.id);
    expect(await order("order=rank")).toEqual(["a", "b", "c"]);
    expect(await order("order=rank.desc")).toEqual(["c", "b", "a"]);
    expect(await order("order=rank.desc.nullslast")).toEqual(["b", "a", "c"]);
    expect(await order("order=rank.asc&limit=1&offset=1")).toEqual(["b"]);

    const res = await fetch(`${env.DATA_SUPABASE_URL}/rest/v1/t?select=id&order=id`, {
      headers: { Range: "1-1", Prefer: "count=exact" },
    });
    expect(await res.json()).toEqual([{ id: "b" }]);
    expect(res.headers.get("Content-Range")).toBe("1-1/3");
    expect(pg.reads("t")).toHaveLength(5);
  });

  it("returns one object for the single-object Accept header, 406 otherwise", async () => {
    fakePostgrest({ tables: { t: rows() } });
    const one = (q: string) =>
      fetch(`${env.DATA_SUPABASE_URL}/rest/v1/t?${q}`, { headers: { Accept: "application/vnd.pgrst.object+json" } });
    expect(await (await one("select=name&id=eq.a")).json()).toEqual({ name: "Ann" });
    expect((await one("select=name&active=is.true")).status).toBe(406);
  });

  it("embeds by declared relation, with aliases, !inner and filters on the embed", async () => {
    fakePostgrest({
      tables: {
        responses: [
          { id: "r1", event_id: "e1", person_id: "p1", status: "yes" },
          { id: "r2", event_id: "e2", person_id: "p1", status: "no" },
        ],
        events: [
          { id: "e1", title: "Dinner", status: "published" },
          { id: "e2", title: "Quiz", status: "draft" },
        ],
        people: [{ id: "p1", api_id: "recP", given_names: "Pat" }],
      },
      relations: {
        "responses.events": { table: "events", from: "event_id", to: "id", kind: "one" },
        "responses.responses_person_id_fkey": { table: "people", from: "person_id", to: "id", kind: "one" },
        "events.responses": { table: "responses", from: "id", to: "event_id", kind: "many" },
      },
    });
    const d = db(env);
    expect(
      await d.select("responses", "select=status,event:events!inner(title),who:people!responses_person_id_fkey(api_id)&event.status=eq.published"),
    ).toEqual([{ status: "yes", event: { title: "Dinner" }, who: { api_id: "recP" } }]);
    expect(await d.select("events", "select=title,responses(status)&order=title")).toEqual([
      { title: "Dinner", responses: [{ status: "yes" }] },
      { title: "Quiz", responses: [{ status: "no" }] },
    ]);
  });

  it("reads an embed seeded inline on the row when no relation is declared", async () => {
    fakePostgrest({ tables: { team_people: [{ person_id: "p1", role: "coach", teams: { id: "t1", team_name: "HKFC A" } }] } });
    expect(await db(env).select("team_people", "select=teams(team_name)&role=eq.coach", "person_id")).toEqual([
      { teams: { team_name: "HKFC A" } },
    ]);
  });
});

describe("fakePostgrest writes and rpc", () => {
  it("inserts, upserts on the conflict columns, updates and deletes, returning the rows", async () => {
    const pg = fakePostgrest({ tables: { t: [{ id: "x", k: 1, v: "old" }] } });
    const d = db(env);
    const [created] = await d.insert<{ id: string; k: number }>("t", [{ k: 2, v: "new" }]);
    expect(created).toMatchObject({ k: 2, v: "new" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await d.upsert("t", [{ k: 1, v: "merged" }, { k: 3, v: "added" }], "k");
    expect(pg.tables.t.map((r) => [r.k, r.v])).toEqual([[1, "merged"], [2, "new"], [3, "added"]]);
    expect(await d.update("t", "k=eq.2", { v: "patched" })).toMatchObject([{ k: 2, v: "patched" }]);
    await d.remove("t", "k=in.(1,3)");
    expect(pg.tables.t.map((r) => r.k)).toEqual([2]);
    expect(pg.writes("t").map((c) => c.method)).toEqual(["POST", "POST", "PATCH", "DELETE"]);
  });

  it("answers SQL functions from the rpc handlers, which may change the tables", async () => {
    const pg = fakePostgrest({
      tables: { plans: [] },
      rpc: { save_plan: (args, fake) => fake.table("plans").push({ id: "p", ...args.p }) && "p" },
    });
    expect(await db(env).rpc("save_plan", { p: { level: "all" } })).toBe("p");
    expect(pg.rpcCalls("save_plan")).toEqual([{ p: { level: "all" } }]);
    expect(pg.tables.plans).toEqual([{ id: "p", level: "all" }]);
  });

  it("fails loudly on anything it does not know, instead of matching everything", async () => {
    const pg = fakePostgrest({ tables: { t: rows() } });
    const d = db(env);
    await expect(d.select("t", "select=id&rank=cs.{1}")).rejects.toThrow(/unsupported operator "cs"/);
    await expect(d.select("t", "select=id&rnak=eq.1")).rejects.toThrow(/column "rnak" is on no seeded t row/);
    await expect(d.select("missing", "select=id")).rejects.toThrow(/table "missing" is not in the fake's tables/);
    await expect(d.select("t", "select=id,people(name)")).rejects.toThrow(/declare relations\["t.people"\]/);
    await expect(d.rpc("nope", {})).rejects.toThrow(/rpc "nope" has no handler/);
    // Each was also recorded, so a caller that swallowed the error still fails the test...
    expect(pg.problems).toHaveLength(5);
    // ...which this test does not want.
    pg.problems.length = 0;
  });
});

describe("fake repositories", () => {
  it("answer like the Supabase repositories and record writes in the state", async () => {
    const ALICE = recId("Alice");
    const M1 = recId("M1");
    const fake = installFakeRepos({
      people: [
        person({ id: ALICE, email: "Alice@X.com", status: "Member", playingAbility: "B", crm: { membershipNo: "M1", photo: [{ url: "u", filename: "f" }] }, photo: "https://p" }),
        person({ id: recId("Old"), email: "alice@x.com", active: false }),
        person({ id: recId("Gone"), active: false, status: "Resigned" }),
      ],
      matches: [match({ id: M1, season: "2026-2027" })],
      officers: [office("sponsor", ALICE), office("sponsor", null, { status: "Retired" })],
    });
    const env = {} as Env;
    // Case-insensitive email, active row preferred.
    expect((await people(env).findByEmail(" alice@x.COM "))?.id).toBe(ALICE);
    // Row views read crm first, then the Player field of that name.
    expect(await people(env).listByMembershipNo("M1")).toEqual([
      { id: ALICE, membershipNo: "M1", preferredName: "Test", status: "Member" },
    ]);
    expect((await people(env).listContactsByIds(new Set([ALICE, "nonsense"])))[0].photo).toEqual([{ url: "u", filename: "f" }]);
    expect((await people(env).listInactiveRankable()).map((p) => p.id)).toEqual([recId("Old")]);
    await people(env).update(ALICE, { sectionRank: 4, membershipNo: "M2", playingAbility: null });
    expect(fake.state.people[0]).toMatchObject({ sectionRank: 4, crm: { membershipNo: "M2" } });
    expect(fake.state.people[0].playingAbility).toBeUndefined();
    await expect(people(env).update("recNobody00000000", { active: true })).rejects.toThrow(/No person/);

    expect(await officers(env).listActive(["sponsor"])).toEqual([{ office: "sponsor", designation: "", memberIds: [ALICE] }]);
    expect(await officers(env).listAllMembers(["sponsor"])).toHaveLength(2);

    fake.state.availabilityExceptions.push(exception({ id: recId("X1"), player: [ALICE], match: [M1], season: "2026-2027" }));
    // set_availability: Available with nothing to override deletes the row.
    const cleared = await availabilityExceptions(env).set({ playerId: ALICE, matchIds: [M1], status: "Available" });
    expect(cleared).toMatchObject({ updated: 1, results: [{ matchId: M1, exceptionId: null }], seasons: ["2026-2027"] });
    expect(cleared.before).toEqual([{ matchId: M1, exceptionId: recId("X1"), status: "Unavailable" }]);
    expect(fake.state.availabilityExceptions).toEqual([]);
    const { results } = await availabilityExceptions(env).set({ playerId: ALICE, matchIds: [M1], status: "Maybe", updatedById: ALICE });
    expect(fake.state.availabilityExceptions).toMatchObject([
      { id: results[0].exceptionId, player: [ALICE], match: [M1], availabilityStatus: "Maybe", season: "2026-2027", updatedBy: ALICE },
    ]);
    // All or nothing, with set_availability's P0002 for a match that does not exist.
    await expect(
      availabilityExceptions(env).set({ playerId: ALICE, matchIds: [M1, recId("Nowhere")], status: "Unavailable" }),
    ).rejects.toMatchObject({ code: "P0002" });
    expect(fake.state.availabilityExceptions[0].availabilityStatus).toBe("Maybe");
    expect(fake.callsTo("availabilityExceptions").map((c) => c.method)).toEqual(["set", "set", "set"]);
    expect(fake.callsTo("people", "listContactsByIds")[0].args).toEqual([[ALICE, "nonsense"]]);
    fake.restore();
  });
});

describe("fake auth_context", () => {
  it("answers like the SQL: person by email (Active first), all teams' links, Active offices in office order", async () => {
    const ALICE = recId("Alice");
    const fake = installFakeRepos({
      people: [person({ id: ALICE, email: "Alice@X.com", active: false }), person({ id: recId("Other"), email: "bob@x.com" })],
      teams: [
        team({ id: recId("TeamB"), teamName: "B", active: false, coach: [ALICE], teamCaptain: [ALICE] }),
        team({ id: recId("TeamA"), teamName: "A", sectionCaptain: [ALICE], teamCaptain: [ALICE] }),
      ],
      officers: [
        office("sponsor", ALICE),
        office("sectionChair", ALICE, { designation: "Chairman" }),
        office("membershipOfficer", ALICE, { status: "Retired" }),
      ],
    });
    const ctx = await authContexts({} as Env).load(" alice@x.COM ");
    expect(ctx.person).toMatchObject({ id: ALICE, uuid: ALICE, active: false });
    expect(ctx).toMatchObject({
      isTeamCoach: true,
      coachTeams: ["B"], // an inactive team still counts
      teamSectionCaptain: true,
      allTeamNames: ["A", "B"],
      captainTeams: ["A"], // Active teams only
      offices: [
        { role: "section_chair", office: "sectionChair", designation: "Chairman" },
        { role: "sponsor", office: null, designation: "" },
      ],
      umpire: false,
    });
    expect((await authContexts({} as Env).load("nobody@x.com")).person).toBeNull();
    fake.restore();
  });
});
