import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { getUmpiringBoard } from "../worker/src/umpiring";
import { invalidateAll } from "../worker/src/cache";
import { signedIn } from "./helpers/factories";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest, type PgRow } from "./helpers/postgrest";

// ---------------------------------------------------------------------------
// The umpiring board's reads (worker/src/umpiring.ts getUmpiringBoard): the
// week's duties come with their live assignments and the umpires' names in
// ONE embedded PostgREST read, and the reads that don't wait on each other
// go out together. Behaviour (who sees what, clashes, names) is pinned in
// tests/umpiring.test.ts.
// ---------------------------------------------------------------------------

const env = { ...SUPABASE_TEST_ENV } as unknown as Env;
const umpire = (personId: string, officerRoles: AuthorizedUser["officerRoles"] = []) =>
  signedIn({ email: "u@x.com", personId, officerRoles, umpire: true });

const sunday = (hk: string) => new Date(`2026-10-11T${hk}:00+08:00`).toISOString();
const WEEK = "2026-10-05";
const D1 = "11111111-1111-1111-1111-111111111111";
const D2 = "22222222-2222-2222-2222-222222222222";

const person = (id: string, api_id: string, given_names: string, extra: PgRow = {}): PgRow => ({
  id, api_id, preferred_name: null, given_names, surname: "Test", qualified_umpire: "Level 1", commitment_end_date: null,
  selected_team_eos: null, selected_team_sos: null, registered_team: null, active: true, ...extra,
});
const dutyRow = (id: string, hk: string, extra: PgRow = {}): PgRow => ({
  id, match_date: sunday(hk), time_tbc: false, division: "3", venue: "HKFC", home_team: "HKFC E", away_team: "Rhino A",
  slot: 1, duty_team: "HKFC G", status: "scheduled", ...extra,
});
const assignmentRow = (id: string, duty_id: string, person_id: string | null, created_at: string, extra: PgRow = {}): PgRow => ({
  id, duty_id, person_id, external_name: null, paid: false, status: "confirmed", created_at, created_by: null, ...extra,
});

let pg: FakePostgrest;

beforeEach(() => {
  invalidateAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T04:00:00Z")); // Tuesday of the week asked for
  pg = fakePostgrest({
    tables: {
      people: [person("u-ann", "recAnn00000000000", "Ann"), person("u-bob", "recBob00000000000", "Bob"), person("u-cat", "recCat00000000000", "Cat")],
      umpire_duties: [dutyRow(D1, "09:00"), dutyRow(D2, "14:15", { duty_team: "HKFC D" })],
      umpire_assignments: [
        assignmentRow("a2", D1, "u-bob", "2026-10-03T00:00:00Z"),
        assignmentRow("a1", D1, "u-ann", "2026-10-01T00:00:00Z"),
        assignmentRow("a3", D1, "u-cat", "2026-10-02T00:00:00Z", { status: "withdrawn" }),
        assignmentRow("a4", D2, null, "2026-10-02T00:00:00Z", { external_name: "Andy Chan", paid: true }),
      ],
      matches: [],
      match_selections: [],
      availability_exceptions: [],
    },
    relations: {
      "umpire_duties.umpire_assignments": { table: "umpire_assignments", from: "id", to: "duty_id", kind: "many" },
      "umpire_assignments.umpire_assignments_person_id_fkey": { table: "people", from: "person_id", to: "id", kind: "one" },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the umpiring board's reads", () => {
  it("reads the week's duties, live assignments and names in one embedded query", async () => {
    const board = await getUmpiringBoard(env, umpire("recAnn00000000000"), WEEK);
    expect(board.duties.map((d) => d.id)).toEqual([D1, D2]);
    // Live ones only, in the order they were put down; club umpires by first name, outside ones as entered.
    expect(board.duties[0].assignments.map((a) => [a.id, a.name, a.personId])).toEqual([
      ["a1", "Ann", "recAnn00000000000"],
      ["a2", "Bob", "recBob00000000000"],
    ]);
    expect(board.duties[1].assignments).toMatchObject([{ id: "a4", name: "Andy Chan", external: true, paid: true, personId: null }]);

    // The week's duties: one read of umpire_duties with the assignments embedded (the other is the list of weeks).
    const weekRead = pg.reads("umpire_duties").find((c) => (c.params.get("select") ?? "").includes("umpire_assignments("))!;
    expect(weekRead.params.get("umpire_assignments.status")).toBe("neq.withdrawn");
    expect(pg.reads("umpire_assignments")).toHaveLength(0);
    // Only their own record from people: no separate read for the names.
    expect(pg.reads("people")).toHaveLength(1);
    expect(pg.problems).toEqual([]);
  });

  it("sends the reads that don't wait on each other together", async () => {
    pg.tables.matches.push({ id: "m1", match_date: sunday("12:30"), venue: "HKFC", home_team: "HKFC E", away_team: "Valley B", match_status: "Scheduled" });
    // Every answer takes a moment; count the rounds of reads, one after another.
    const inner = globalThis.fetch;
    let inFlight = 0;
    let rounds = 0;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      if (inFlight++ === 0) rounds++;
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await inner(input, init);
      } finally {
        inFlight--;
      }
    });
    await getUmpiringBoard(env, umpire("recAnn00000000000"), WEEK);
    // Their record, the weeks, the week's duties and its games; then picks and Unavailable answers.
    // (It was seven: record, weeks, duties, assignments, names, games, then picks and answers.)
    expect(rounds).toBe(2);
  });
});
