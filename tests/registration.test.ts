import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { sectionsFor } from "../worker/src/auth";
import { getRegistrationBoard, markRegistered, reasonFor, registrationCsv, unmarkRegistered } from "../worker/src/registration";
import { missingDetails, type RegistrationPlayer } from "../shared/registration";
import { currentSeason } from "../worker/src/seasonContext";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  API_ORIGIN: "https://api.example",
} as Env;
const player = { email: "p@x.com", personId: "recPLAYER", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;
const convenor = { ...player, personId: "recCONVENOR", officerRoles: [{ office: "hockeyConvenor", designation: "" }] } as AuthorizedUser;
const captain = { ...player, officerRoles: [{ office: "sectionCaptain", designation: "" }] } as AuthorizedUser;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEASON = currentSeason();

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown[] | ((url: URL) => unknown[])>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const t = tables[url.pathname.split("/").pop()!];
      const body = method !== "GET" ? [] : typeof t === "function" ? t(url) : t ?? [];
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const writes = (calls: Call[], table: string, method = "POST") => calls.filter((c) => c.url.pathname.endsWith(`/${table}`) && c.method === method);

const person = (n: number, more: Record<string, unknown> = {}) => ({
  id: U(n), api_id: `rec${n}`, preferred_name: `P${n}`, given_names: `Given ${n}`, surname: `S${n}`, registered_name: `S${n} Given ${n}`,
  chinese_name: null, date_of_birth: "1990-01-01", hkid_no: `A12345${n}(1)`, passport_no: null, nationality: "British", mobile_no: "+852 9123 4567",
  email: `p${n}@x.com`, registered_team: "HKFC B", previous_eos: "HKFC B", shirt: { shirt_no: n }, ...more,
});

const blank: RegistrationPlayer = {
  id: "rec1", name: "Sam Lee", team: "HKFC C", previousEos: "HKFC C", shirtNo: 5, registeredName: "LEE Sam", surname: "Lee", givenNames: "Sam",
  chineseName: null, hkidNo: "A123456(7)", passportNo: null, dateOfBirth: "1990-01-01", nationality: "British", mobileNo: null, email: null,
  files: { photo: "https://f/1", hkid: "https://f/2", passport: null, u18Form: null }, registeredAt: null, reason: "season", reasonDetail: null,
};

describe("HKHA registration", () => {
  it("opens to the Hockey Convenor only", () => {
    expect(sectionsFor(convenor)).toEqual(["registration"]);
    expect(sectionsFor(captain)).not.toContain("registration");
  });

  it("lists what's missing before a player can be registered", () => {
    expect(missingDetails(blank, "2026-10-06")).toEqual([]);
    expect(missingDetails({ ...blank, hkidNo: null }, "2026-10-06")).toEqual(["HKID or passport number"]);
    expect(missingDetails({ ...blank, hkidNo: null, passportNo: "X1", files: { ...blank.files, hkid: null } }, "2026-10-06")).toEqual(["ID copy"]);
    expect(missingDetails({ ...blank, registeredName: null, files: { ...blank.files, photo: null } }, "2026-10-06")).toEqual(["Registered name", "Photo"]);
    // Under 18: the U18 registration form too.
    expect(missingDetails({ ...blank, dateOfBirth: "2010-01-01" }, "2026-10-06")).toEqual(["U18 registration form"]);
    expect(missingDetails({ ...blank, dateOfBirth: "2010-01-01", files: { ...blank.files, u18Form: "https://f/3" } }, "2026-10-06")).toEqual([]);
  });

  it("says why someone needs registering", () => {
    const p = { registered_team: "HKFC E", previous_eos: "HKFC F" };
    const moveUp = { person_id: U(1), previous_team: "HKFC F", new_team: "HKFC E", created_at: "2026-10-03T02:00:00Z" };
    expect(reasonFor(p, [], [moveUp])).toEqual({ reason: "playUps", detail: "From HKFC F, 3 Oct" });
    expect(reasonFor(p, [{ person_id: U(1), team: "HKFC F", registered_at: "2026-09-10T02:00:00Z" }], [])).toEqual({ reason: "moved", detail: "Registered for HKFC F on 10 Sep" });
    expect(reasonFor({ ...p, previous_eos: null }, [], [])).toEqual({ reason: "new", detail: null });
    expect(reasonFor(p, [], [])).toEqual({ reason: "season", detail: null });
  });

  it("builds the board: ticked-off players, reasons, the newest document of each kind, by team", async () => {
    fake({
      people: [
        person(1, { registered_team: "HKFC B" }),
        person(2, { registered_team: "HKFC A", previous_eos: null, surname: "Zed" }),
        person(3, { registered_team: "HKFC A", surname: "Abe" }),
      ],
      hkha_registrations: [
        { person_id: U(1), team: "HKFC B", registered_at: "2026-09-20T02:00:00Z" },
        { person_id: U(3), team: "HKFC B", registered_at: "2026-09-20T02:00:00Z" },
      ],
      registration_events: [],
      files: [
        { id: U(51), person_id: U(1), kind: "photo" },
        { id: U(50), person_id: U(1), kind: "photo" },
        { id: U(52), person_id: U(99), kind: "hkid" },
      ],
    });
    const board = await getRegistrationBoard(env);
    expect(board.season).toBe(SEASON);
    expect(board.players.map((p) => [p.id, p.team, p.reason])).toEqual([
      ["rec3", "HKFC A", "moved"],
      ["rec2", "HKFC A", "new"],
      ["rec1", "HKFC B", null],
    ]);
    const one = board.players.find((p) => p.id === "rec1")!;
    expect(one.registeredAt).toBe("2026-09-20T02:00:00Z");
    expect(one.files.photo).toContain(`/api/files/${U(51)}?`);
    expect(one.files.hkid).toBeNull();
    expect(one.shirtNo).toBe(1);
  });

  it("downloads only who needs registering when asked, logs the download, and keeps formulas out", async () => {
    const calls = fake({
      people: (url) => (url.searchParams.get("api_id") ? [{ id: U(9) }] : [person(1), person(2, { registered_name: "=HYPERLINK(1)" })]),
      hkha_registrations: [{ person_id: U(1), team: "HKFC B", registered_at: "2026-09-20T02:00:00Z" }],
      registration_events: [],
      files: [],
    });
    const out = await registrationCsv(env, convenor, { todo: true, team: "HKFC B" });
    expect(out.count).toBe(1);
    expect(out.filename).toMatch(/^hkha-registration-hkfc-b-to-register-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = out.csv.trim().split("\r\n");
    expect(lines[0]).toBe("Team,Shirt No,Registered Name,Surname,Given Names,Chinese Name,Date of Birth,HKID No.,Passport No.,Nationality,Email,Tel.,Previous EOS,Status");
    expect(lines[1]).toContain("'=HYPERLINK(1)");
    expect(lines[1]).toContain("'+852 9123 4567");
    const log = writes(calls, "activity_log")[0].body[0];
    expect(log).toMatchObject({ actor_person_id: U(9), action: "registration-export", entity: "people", entity_id: null });
    expect(log.fields[0]).toBe("1 rows (needs registering, HKFC B)");
    // The log holds field names, never anyone's details.
    expect(JSON.stringify(log)).not.toContain("A12345");
  });

  it("ticks players off for their current team, skipping anyone already ticked, in one log write", async () => {
    const calls = fake({
      people: (url) =>
        url.searchParams.get("select") === "id"
          ? url.searchParams.get("api_id")?.startsWith("in.")
            ? [{ id: U(1) }, { id: U(2) }]
            : [{ id: U(9) }]
          : [
              { id: U(1), registered_team: "HKFC B" },
              { id: U(2), registered_team: "HKFC C" },
            ],
      hkha_registrations: [{ person_id: U(1), team: "HKFC B", registered_at: "2026-09-20T02:00:00Z" }],
    });
    const r = await markRegistered(env, convenor, { ids: ["rec1", "rec2", 7, "bad id!"] });
    expect(r.count).toBe(1);
    expect(writes(calls, "hkha_registrations")[0].body).toEqual([{ person_id: U(2), season: SEASON, team: "HKFC C", registered_by_person_id: U(9) }]);
    expect(writes(calls, "activity_log")).toHaveLength(1);
    expect(writes(calls, "activity_log")[0].body).toHaveLength(2);
    await expect(markRegistered(env, convenor, { ids: [] })).rejects.toThrow(/Choose/);
  });

  it("takes a tick back off for this season and their current team", async () => {
    const calls = fake({ people: [{ id: U(2), registered_team: "HKFC C" }] });
    await unmarkRegistered(env, convenor, { id: "rec2" });
    const del = writes(calls, "hkha_registrations", "DELETE")[0];
    expect(del.url.searchParams.get("person_id")).toBe(`eq.${U(2)}`);
    expect(del.url.searchParams.get("season")).toBe(`eq.${SEASON}`);
    expect(del.url.searchParams.get("team")).toBe("eq.HKFC C");
  });
});
