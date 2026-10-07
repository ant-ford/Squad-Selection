import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { assignDuty, confirmAssignment, getUmpiringBoard, refreshUmpirePool, takeDuty, tallyDuties, umpiringAccess, withdrawAssignment } from "../worker/src/umpiring";
import { signedIn } from "./helpers/factories";
import { invalidateAll } from "../worker/src/cache";
import {
  captainsMessage,
  clashingGame,
  reportCsvRows,
  reportGrid,
  dutyLine,
  isOnCommitment,
  mergeOutsideNames,
  similarOutsideNames,
  umpiresMessage,
  weekOf,
  type DutyAssignment,
  type UmpireDuty,
} from "../shared/umpiring";
import { gamesUmpiredChoice } from "../shared/commitmentReview";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
/** Who auth_context says is in the umpire pool: the qualified (George, Ann) and Bob, from a match card. */
const UMPIRES = new Set(["recGEORGE", "recANN", "recBOB"]);
const user = (personId: string, officerRoles: AuthorizedUser["officerRoles"] = []) =>
  signedIn({ email: "u@x.com", personId, officerRoles, umpire: UMPIRES.has(personId) });
const george = user("recGEORGE", [{ office: "umpireCoordinator", designation: "" }]);

const DUTY = "11111111-1111-1111-1111-111111111111";
const PAID = "22222222-2222-2222-2222-222222222222";
const future = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();

type Call = { url: URL; method: string; body: any };
/** PostgREST by table: a function of the request, or rows for any GET. */
function fake(tables: Record<string, unknown[] | ((url: URL, method: string, body: any) => unknown)>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const t = tables[url.pathname.split("/").pop()!];
      const out = typeof t === "function" ? t(url, method, body) : method === "GET" ? t ?? [] : body ?? [];
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out ?? []), { status: 200 });
    }),
  );
  return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET" && c.url.pathname.endsWith("/umpire_assignments"));

const people = (over: Record<string, unknown>[] = []) => [
  { id: "u-george", api_id: "recGEORGE", given_names: "George", surname: "Lam", qualified_umpire: "Level 2", commitment_end_date: null },
  { id: "u-ann", api_id: "recANN", given_names: "Ann", surname: "Lee", qualified_umpire: "Level 1", commitment_end_date: "2030-06-30" },
  { id: "u-bob", api_id: "recBOB", given_names: "Bob", surname: "Page", preferred_name: "Pagey", qualified_umpire: null, commitment_end_date: "2020-06-30" },
  { id: "u-cat", api_id: "recCAT", given_names: "Cat", surname: "Wong", qualified_umpire: "Not Applicable", commitment_end_date: null },
  ...over,
];
const byApiId = (url: URL) => {
  const id = url.searchParams.get("api_id")?.replace(/^eq\./, "");
  return id ? people().filter((p) => p.api_id === id).map((p) => ({ ...p, active: true })) : people();
};

beforeEach(() => invalidateAll());
afterEach(() => {
  vi.unstubAllGlobals();
  invalidateAll();
});

const assignment = (over: Partial<DutyAssignment> = {}): DutyAssignment => ({
  id: "a1", personId: "recANN", name: "Ann", external: false, paid: false, status: "confirmed", createdAt: "2026-10-01T00:00:00Z", ...over,
});
const duty = (over: Partial<UmpireDuty> = {}): UmpireDuty => ({
  id: "d1", matchDate: "2026-10-11T01:00:00.000Z", timeTbc: false, division: "3", venue: "HKFC",
  homeTeam: "HKFC F", awayTeam: "Elite B", slot: 1, dutyTeam: "HKFC D", status: "scheduled", assignments: [], ...over,
});

describe("umpiring messages", () => {
  it("writes a duty as George does: date, kick-off, venue, duty team letter", () => {
    expect(dutyLine(duty())).toBe("11/10 0900 HKFC D");
    expect(dutyLine(duty({ matchDate: "2026-10-02T10:50:00.000Z", venue: "HV2", dutyTeam: "HKFC E" }))).toBe("2/10 1850 HV2 E");
    expect(dutyLine(duty({ matchDate: "2026-10-10T16:00:00.000Z", timeTbc: true, venue: "KP", dutyTeam: "HKFC G" }))).toBe("11/10 TBC KP G");
  });

  it("sends the umpires the week with the taken ones marked and one link", () => {
    const text = umpiresMessage(
      [
        duty({ id: "d2", matchDate: "2026-10-11T02:45:00.000Z", dutyTeam: "HKFC G" }),
        duty({ assignments: [assignment({ name: "George" })] }),
        duty({ id: "d3", status: "cancelled", dutyTeam: "HKFC H" }),
      ],
      "https://app.eddy.global/umpiring?week=2026-10-05",
    );
    expect(text).toBe(
      ["🏑Weekly Club Duties🥳", "", "11/10 0900 HKFC D ✅George", "11/10 1045 HKFC G", "", "Put your name down: https://app.eddy.global/umpiring?week=2026-10-05"].join("\n"),
    );
  });

  it("sends the captains the final list: club umpires ✅, paid 💰, gaps ❓, offers not shown", () => {
    const text = captainsMessage([
      duty({ assignments: [assignment({ name: "George" })] }),
      duty({ id: "d2", matchDate: "2026-10-11T02:45:00.000Z", dutyTeam: "HKFC F", assignments: [assignment({ name: "Pagey", personId: null, external: true, paid: true })] }),
      duty({ id: "d3", matchDate: "2026-10-11T10:00:00.000Z", dutyTeam: "HKFC A", assignments: [assignment({ status: "offered", paid: true })] }),
    ]);
    expect(text.split("\n").slice(2)).toEqual(["11/10 0900 HKFC D ✅George", "11/10 1045 HKFC F 💰Pagey", "11/10 1800 HKFC A ❓"]);
  });

  it("weeks start on Monday, Hong Kong time", () => {
    expect(weekOf("2026-10-11T01:00:00.000Z")).toBe("2026-10-05"); // Sunday morning
    expect(weekOf("2026-10-11T16:30:00.000Z")).toBe("2026-10-12"); // 00:30 Monday in HK
  });
});

describe("the commitment and pay", () => {
  it("is on commitment until the end date; no end date counts as finished", () => {
    expect(isOnCommitment("2026-10-07", "2026-10-06")).toBe(true);
    expect(isOnCommitment("2026-10-06", "2026-10-06")).toBe(false);
    expect(isOnCommitment(null, "2026-10-06")).toBe(false);
  });

  it("turns a count into the review's choice, leaving none unchosen", () => {
    expect(gamesUmpiredChoice(undefined)).toBe("");
    expect(gamesUmpiredChoice(0)).toBe("");
    expect(gamesUmpiredChoice(3)).toBe("3");
    expect(gamesUmpiredChoice(9)).toBe("5+");
  });
});

describe("who sees the duties", () => {
  /** The pool refreshUmpirePool stores (People uuids), from a fake with the given tables. */
  async function storedPool(tables: Parameters<typeof fake>[0]): Promise<string[]> {
    let stored: string[] = [];
    fake({ ...tables, set_umpire_pool: (_url, _method, body) => ((stored = [...body.p_people].sort()), stored.length) });
    await refreshUmpirePool(env);
    return stored;
  }

  it("stores qualified umpires and anyone named as umpire on an HKFC match card this year", async () => {
    const pool = await storedPool({
      people: people(),
      matches: [
        { id: "m1", ump_1: "HKFC D - Page Bob", ump_2: "Appointed", home_team: "HKFC F", away_team: "Elite B" },
        { id: "m2", ump_1: "Cat", ump_2: "Valley B", home_team: "HKFC D", away_team: "Valley B" },
      ],
      umpire_assignments: [],
    });
    // Ann and George are qualified; Bob is on a match card, names swapped.
    // Cat isn't: "Not Applicable", and a first name alone isn't enough.
    expect(pool).toEqual(["u-ann", "u-bob", "u-george"]);
  });

  it("stores anyone who umpired a game in Eddy this year", async () => {
    expect(await storedPool({ people: people(), matches: [], umpire_assignments: [{ id: "a1", person_id: "u-cat" }] })).toContain("u-cat");
  });

  it("decides the screen from sign-in (auth_context's umpire flag) and the offices, with no reads", async () => {
    const calls = fake({});
    expect(await umpiringAccess(env, user("recANN"))).toBe("umpire");
    expect(await umpiringAccess(env, user("recCAT"))).toBeNull();
    expect(await umpiringAccess(env, user("recZED", [{ office: "sectionCaptain", designation: "" }]))).toBe("coordinator");
    expect(calls).toHaveLength(0);
  });
});

describe("taking a duty", () => {
  const base = (live: unknown[] = []) => ({
    people: byApiId,
    matches: [],
    umpire_duties: [{ id: DUTY, match_date: future, time_tbc: false, status: "scheduled", duty_team: "HKFC D" }],
    umpire_assignments: (url: URL, method: string, body: any) =>
      method === "GET" ? (url.searchParams.get("duty_id") ? live : []) : body ?? [],
  });

  it("confirms an unpaid umpire at once", async () => {
    const calls = fake(base());
    expect(await takeDuty(env, user("recANN"), DUTY, {})).toMatchObject({ status: "confirmed" });
    const [w] = writes(calls);
    expect(w.method).toBe("POST");
    expect(w.body[0]).toMatchObject({ duty_id: DUTY, person_id: "u-ann", paid: false, status: "confirmed" });
  });

  it("won't pay anyone still on their commitment", async () => {
    fake(base());
    await expect(takeDuty(env, user("recANN"), DUTY, { paid: true })).rejects.toThrow(/until your commitment ends/);
  });

  it("holds a paid offer for the coordinator", async () => {
    const calls = fake(base());
    expect(await takeDuty(env, user("recGEORGE"), DUTY, { paid: true })).toMatchObject({ status: "offered" });
    expect(writes(calls)[0].body[0]).toMatchObject({ paid: true, status: "offered", confirmed_at: null });
  });

  it("lets a free umpire take a game a paid offer is waiting on", async () => {
    const calls = fake(base([{ id: PAID, duty_id: DUTY, person_id: "u-george", paid: true, status: "offered" }]));
    await takeDuty(env, user("recANN"), DUTY, {});
    expect(writes(calls)[0].body[0]).toMatchObject({ person_id: "u-ann", status: "confirmed" });
  });

  it("turns their own paid offer into a free confirmation", async () => {
    const calls = fake(base([{ id: "a-mine", duty_id: DUTY, person_id: "u-george", paid: true, status: "offered" }]));
    await takeDuty(env, user("recGEORGE"), DUTY, {});
    const [w] = writes(calls);
    expect(w.method).toBe("PATCH");
    expect(w.body).toMatchObject({ paid: false, status: "confirmed" });
  });

  it("refuses a game someone already has, a cancelled one and a played one", async () => {
    fake(base([{ id: "a1", duty_id: DUTY, person_id: "u-george", paid: false, status: "confirmed" }]));
    await expect(takeDuty(env, user("recANN"), DUTY, {})).rejects.toThrow(/already taken/);
    fake({ ...base(), umpire_duties: [{ id: DUTY, match_date: future, status: "cancelled" }] });
    await expect(takeDuty(env, user("recANN"), DUTY, {})).rejects.toThrow(/off the list/);
    fake({ ...base(), umpire_duties: [{ id: DUTY, match_date: "2026-01-01T00:00:00Z", status: "scheduled" }] });
    await expect(takeDuty(env, user("recANN"), DUTY, {})).rejects.toThrow(/already started/);
  });

  it("reads a clash on the one-umpire index as someone getting there first", async () => {
    fake({
      ...base(),
      umpire_assignments: (_url: URL, method: string) =>
        method === "GET" ? [] : new Response(JSON.stringify({ code: "23505", message: "duplicate key" }), { status: 409 }),
    });
    await expect(takeDuty(env, user("recANN"), DUTY, {})).rejects.toThrow(/already taken/);
  });

  it("is for the club's umpires only", async () => {
    fake(base());
    await expect(takeDuty(env, user("recCAT"), DUTY, {})).rejects.toThrow(/club's umpires/);
  });
});

describe("the coordinator", () => {
  const live = [{ id: PAID, duty_id: DUTY, person_id: "u-bob", paid: true, status: "offered" }];
  const base = () => ({
    people: byApiId,
    matches: [],
    umpire_duties: [{ id: DUTY, match_date: future, time_tbc: false, status: "scheduled" }],
    umpire_assignments: (url: URL, method: string, body: any) => {
      if (method !== "GET") return body ?? [];
      if (url.searchParams.get("id")) return live.filter((a) => `eq.${a.id}` === url.searchParams.get("id"));
      return url.searchParams.get("duty_id") ? live : [];
    },
  });

  it("confirms a paid offer", async () => {
    const calls = fake(base());
    await confirmAssignment(env, george, PAID);
    expect(writes(calls)[0].body).toMatchObject({ status: "confirmed" });
  });

  it("puts an outside umpire down, always paid", async () => {
    const calls = fake({ ...base(), umpire_assignments: (_u: URL, m: string, b: any) => (m === "GET" ? [] : b) });
    await assignDuty(env, george, DUTY, { externalName: "  Pagey  " });
    expect(writes(calls)[0].body[0]).toMatchObject({ external_name: "Pagey", paid: true, status: "confirmed", created_by: "u-george" });
  });

  it("can't pay a club umpire on their commitment, and needs one of a person or a name", async () => {
    fake({ ...base(), umpire_assignments: (_u: URL, m: string, b: any) => (m === "GET" ? [] : b) });
    await expect(assignDuty(env, george, DUTY, { personId: "recANN", paid: true })).rejects.toThrow(/on their commitment/);
    await expect(assignDuty(env, george, DUTY, {})).rejects.toThrow(/Choose a club umpire/);
    await expect(assignDuty(env, george, DUTY, { personId: "recANN", externalName: "X" })).rejects.toThrow(/Choose a club umpire/);
  });

  it("is the only one who can confirm or take someone else off", async () => {
    fake(base());
    await expect(confirmAssignment(env, user("recANN"), PAID)).rejects.toThrow(/Umpire Coordinator/);
    await expect(withdrawAssignment(env, user("recANN"), PAID)).rejects.toThrow(/Umpire Coordinator/);
    // The offer is Bob's, who is on a match card, so he can pull out himself.
    invalidateAll();
    const calls = fake({ ...base(), matches: [{ id: "m1", ump_1: "Bob Page", ump_2: "", home_team: "HKFC F", away_team: "Elite B" }] });
    await withdrawAssignment(env, user("recBOB"), PAID);
    expect(writes(calls)[0].body).toEqual({ status: "withdrawn" });
  });
});

describe("clashes with the umpire's own games", () => {
  const game = (hk: string, venue = "HKFC") => ({ matchDate: new Date(`2026-10-11T${hk}:00+08:00`).toISOString(), venue, homeTeam: "HKFC D", awayTeam: "Valley B" });
  const at = (hk: string, venue = "HKFC", timeTbc = false) => ({ matchDate: new Date(`2026-10-11T${hk}:00+08:00`).toISOString(), venue, timeTbc });

  it("flags overlapping kick-offs at the same ground, but not the next slot", () => {
    expect(clashingGame(at("10:45"), [game("10:45")])).toBeTruthy();
    expect(clashingGame(at("10:45"), [game("09:30")])).toBeTruthy();
    expect(clashingGame(at("10:45"), [game("09:00")])).toBeUndefined(); // the slot before
    expect(clashingGame(at("10:45"), [game("12:30")])).toBeUndefined(); // the slot after
  });

  it("allows for travel to another ground", () => {
    expect(clashingGame(at("10:45", "KP"), [game("12:30")])).toBeTruthy();
    expect(clashingGame(at("10:45", "KP"), [game("12:45")])).toBeUndefined(); // two hours apart
    expect(clashingGame(at("10:45", "KP"), [game("13:30")])).toBeUndefined();
  });

  it("flags a TBC time on the same day, and nothing on another day", () => {
    expect(clashingGame(at("00:00", "KP", true), [game("18:00")])).toBeTruthy();
    expect(clashingGame(at("10:45"), [game("00:00")])).toBeTruthy();
    expect(clashingGame(at("10:45"), [{ ...game("10:45"), matchDate: "2026-10-12T02:45:00.000Z" }])).toBeUndefined();
  });

  it("counts the umpire's team's games and games they're picked for, not ones they're Unavailable for", async () => {
    const sunday = (hk: string) => new Date(`2026-10-11T${hk}:00+08:00`).toISOString();
    const team = (id: string, over: Record<string, unknown>) => ({ ...people().find((p) => p.id === id), active: true, ...over });
    fake({
      people: (url: URL) =>
        url.searchParams.get("api_id")
          ? [team("u-george", { selected_team_sos: "HKFC D" })]
          : [team("u-george", { selected_team_sos: "HKFC D" }), team("u-ann", { registered_team: "HKFC F" }), team("u-bob", { registered_team: "HKFC E", qualified_umpire: "Level 1" })],
      matches: (url: URL) =>
        url.searchParams.get("match_status")
          ? [
              { id: "m-d", match_date: sunday("12:30"), venue: "HKFC", home_team: "HKFC D", away_team: "Valley B" },
              { id: "m-f", match_date: sunday("09:00"), venue: "HKFC", home_team: "HKFC F", away_team: "Elite B" },
              { id: "m-e", match_date: sunday("14:15"), venue: "HKFC", home_team: "HKFC E", away_team: "Rhino A" },
            ]
          : [],
      match_selections: [{ match_id: "m-e", person_id: "u-ann" }],
      availability_exceptions: [{ id: "x1", match_id: "m-d", person_id: "u-george" }],
      umpire_duties: [{ id: DUTY, match_date: sunday("14:15"), time_tbc: false, venue: "HKFC", home_team: "HKFC E", away_team: "Rhino A", slot: 1, duty_team: "HKFC G", status: "scheduled" }],
      umpire_assignments: [],
    });
    const board = await getUmpiringBoard(env, george, "2026-10-05");
    const [d] = board.duties;
    expect(d.clash).toBeUndefined(); // George's 12:30 game: he's Unavailable for it
    expect(d.clashes).toEqual({ recANN: "14:15", recBOB: "14:15" }); // Ann picked to play up; Bob's own team
    // The week's WhatsApp messages are the Umpire Coordinator's alone, not a Section Captain's.
    expect(board.messages).toBe(true);
    const captain = await getUmpiringBoard(env, user("recGEORGE", [{ office: "sectionCaptain", designation: "" }]), "2026-10-05");
    expect(captain.access).toBe("coordinator");
    expect(captain.messages).toBe(false);
  });
});

describe("the season's record", () => {
  it("counts confirmed umpires of played games, free, paid and outside, and the gaps", () => {
    const report = tallyDuties(
      [
        duty({ assignments: [assignment({ name: "George", personId: "recGEORGE" })] }),
        duty({ id: "d2", assignments: [assignment({ name: "George", personId: "recGEORGE", paid: true })] }),
        duty({ id: "d3", dutyTeam: "HKFC E", assignments: [assignment({ name: "Pagey", personId: null, external: true, paid: true })] }),
        duty({ id: "d4", dutyTeam: "HKFC E", assignments: [assignment({ name: "Ann", status: "no_show" })] }),
        duty({ id: "d5", dutyTeam: "HKFC E", assignments: [assignment({ status: "offered", paid: true })] }),
        duty({ id: "d6", status: "cancelled", assignments: [assignment()] }),
      ],
      "2026-2027",
    );
    expect(report).toMatchObject({ duties: 5, coveredFree: 1, coveredPaidMembers: 1, coveredExternal: 1, noShows: 1, uncovered: 2 });
    expect(report.umpires.map((u) => [u.name, u.free, u.paid, u.noShows])).toEqual([
      ["George", 1, 1, 0],
      ["Pagey", 0, 1, 0],
      ["Ann", 0, 0, 1],
    ]);
    expect(report.byTeam).toEqual([
      { team: "HKFC D", duties: 2, free: 1, paidMembers: 1, outside: 0, uncovered: 0 },
      { team: "HKFC E", duties: 3, free: 0, paidMembers: 0, outside: 1, uncovered: 2 },
    ]);
    expect(report.rows.map((r) => r.outcome)).toEqual(["free", "paid", "outside", "no_show", "uncovered"]);
  });

  it("downloads every played duty for a spreadsheet", () => {
    const report = tallyDuties(
      [
        duty({ assignments: [assignment({ name: "George", personId: "recGEORGE" })] }),
        duty({ id: "d3", dutyTeam: "HKFC E", venue: "KP", assignments: [assignment({ name: "Pagey", personId: null, external: true, paid: true })] }),
        duty({ id: "d5", dutyTeam: "HKFC F", timeTbc: true, matchDate: "2026-10-10T16:00:00.000Z" }),
      ],
      "2026-2027",
    );
    expect(reportCsvRows(report)).toEqual([
      ["Date", "Time", "Venue", "Division", "Home", "Away", "Duty team", "Umpire", "Affiliation", "Type"],
      ["2026-10-11", "TBC", "HKFC", "3", "HKFC F", "Elite B", "HKFC F", "", "", "Uncovered"], // a TBC time sorts first
      ["2026-10-11", "09:00", "HKFC", "3", "HKFC F", "Elite B", "HKFC D", "George", "HKFC", "Free"],
      ["2026-10-11", "09:00", "KP", "3", "HKFC F", "Elite B", "HKFC E", "Pagey", "Outside", "Paid (outside)"],
    ]);
  });

  it("lays out George's grid: a row per day, a column per duty team", () => {
    const report = tallyDuties(
      [
        duty({ assignments: [assignment({ name: "George", personId: "recGEORGE" })] }),
        duty({ id: "d2", matchDate: "2026-10-11T02:45:00.000Z", assignments: [assignment({ name: "Pagey", personId: null, external: true, paid: true })] }),
        duty({ id: "d3", dutyTeam: "HKFC E", assignments: [assignment({ name: "Ann", status: "no_show" })] }),
        duty({ id: "d4", matchDate: "2026-10-18T01:00:00.000Z", dutyTeam: "HKFC A" }),
      ],
      "2026-2027",
    );
    expect(reportGrid(report)).toEqual({
      teams: ["HKFC A", "HKFC D", "HKFC E"],
      days: [
        { day: "2026-10-11", cells: { "HKFC D": ["George", "💰Pagey"], "HKFC E": ["✗Ann"] } },
        { day: "2026-10-18", cells: { "HKFC A": ["–"] } },
      ],
    });
  });
});

describe("outside umpires' names", () => {
  const known = ["Andy Chan", "Philipp Boettger", "Jelena Surjanac", "Kuldeep Singh"];

  it("keeps one spelling per umpire, however written, the first list's winning", () => {
    expect(mergeOutsideNames(["andy chan", "Kuldeep Singh"], ["Andy CHAN", "SINGH Kuldeep", "Lyle  Williams"])).toEqual([
      "andy chan",
      "Kuldeep Singh",
      "Lyle Williams",
    ]);
  });

  it("asks about a name a letter or two out, or part of one", () => {
    expect(similarOutsideNames("Andy Chen", known)).toEqual(["Andy Chan"]);
    expect(similarOutsideNames("Phillip Boettger", known)).toEqual(["Philipp Boettger"]);
    expect(similarOutsideNames("Singh Kuldip", known)).toEqual(["Kuldeep Singh"]);
    expect(similarOutsideNames("boettger", known)).toEqual(["Philipp Boettger"]);
    expect(similarOutsideNames("Surjanak", known)).toEqual(["Jelena Surjanac"]);
  });

  it("asks nothing for a known name, a new one, or too little to go on", () => {
    expect(similarOutsideNames("ANDY  chan", known)).toEqual([]);
    expect(similarOutsideNames("Chan Andy", known)).toEqual([]);
    expect(similarOutsideNames("Mark Lee", known)).toEqual([]);
    expect(similarOutsideNames("An", known)).toEqual([]);
    expect(similarOutsideNames("Andy", ["Andy Chan", "Andy Lo"])).toEqual(["Andy Chan", "Andy Lo"]);
  });

  const recent = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const board = (used: unknown[]) => ({
    people: byApiId,
    matches: [
      { id: "m1", ump_1: "Appt - Jelena SURJANAC", ump_2: "Khalsa C - Lyle Williams - 4477", home_team: "HKFC F", away_team: "Khalsa C" },
      { id: "m2", ump_1: "HKFC D - Ray Smith", ump_2: "Page Bob", home_team: "HKFC D", away_team: "Valley B" },
      { id: "m3", ump_1: "Appointed", ump_2: "Gurdev", home_team: "HKFC B", away_team: "Valley A" },
      { id: "m4", ump_1: "andy chan", ump_2: "Valley B", home_team: "HKFC E", away_team: "Valley B" },
    ],
    umpire_duties: [{ id: DUTY, match_date: future, time_tbc: false, status: "scheduled", duty_team: "HKFC D" }],
    umpire_assignments: (url: URL, method: string, body: any) => {
      if (method !== "GET") return body ?? [];
      return url.searchParams.get("external_name") ? used : [];
    },
  });

  it("lists those put down in Eddy and those on HKFC match cards, A–Z", async () => {
    const calls = fake(board([{ id: "a1", external_name: "Andy Chan", created_at: recent }]));
    const b = await getUmpiringBoard(env, george, null);
    // Not Bob (a member, names swapped), nor HKFC D's duty umpire, nor a first name alone.
    expect(b.externalNames).toEqual(["Andy Chan", "Jelena SURJANAC", "Lyle Williams"]);
    const read = calls.find((c) => c.url.searchParams.get("external_name"))!;
    expect(read.url.searchParams.get("status")).toBe("neq.withdrawn");
  });

  it("saves a known name in its known spelling", async () => {
    const calls = fake(board([{ id: "a1", external_name: "Andy Chan", created_at: recent }]));
    await assignDuty(env, george, DUTY, { externalName: "andy  CHAN" });
    expect(writes(calls)[0].body[0]).toMatchObject({ external_name: "Andy Chan" });
    invalidateAll();
    const again = fake(board([]));
    await assignDuty(env, george, DUTY, { externalName: "jelena surjanac" });
    expect(writes(again)[0].body[0]).toMatchObject({ external_name: "Jelena SURJANAC" });
  });

  it("counts one outside umpire once in the season's record, however written", () => {
    const outside = (name: string, id: string) => duty({ id, assignments: [assignment({ name, personId: null, external: true, paid: true })] });
    const report = tallyDuties([outside("Andy Chan", "d1"), outside("andy chan", "d2"), outside("Chan Andy", "d3")], "2026-2027");
    expect(report.umpires.map((u) => [u.name, u.paid])).toEqual([["Andy Chan", 3]]);
  });
});
