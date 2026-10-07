import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { HttpError } from "../worker/src/http";
import { parseSquadChange, saveSquad, squadRights } from "../worker/src/admin/squad";
import { canFor } from "../worker/src/admin/people";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;
const user = (office: string, more: Record<string, unknown> = {}) =>
  ({
    email: "o@x.com", personId: "recOFFICER", role: "player", coachTeams: [], isSectionCaptain: false,
    officerRoles: [{ office, designation: "" }], ...more,
  }) as unknown as AuthorizedUser;
const convenor = user("hockeyConvenor");
const captain = user("sectionCaptain");
const membershipOfficer = user("membershipOfficer");

const person = {
  api_id: "recP1", preferred_name: "Sam", given_names: null, surname: "Lee", registered_team: "HKFC C", status: "Member",
  applicant_stage: null, active: true, member_type: "Main", category_type: "Sports Preferred", membership_no: "M1",
  join_date: "2024-09-01", commitment_end_date: "2027-08-31", selected_team_sos: null, selected_team_eos: null, playing_position: null,
};

type Call = { path: string; method: string; body: any };
function fake(answers: { rpc?: unknown; teams?: string[] } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const p = url.pathname.replace("/rest/v1/", "");
      calls.push({ path: p, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const body =
        p === "people" ? [person]
        : p === "teams" ? (answers.teams ?? ["HKFC A", "HKFC B", "HKFC C", "HKFC D"]).map((team_name) => ({ team_name }))
        : p.startsWith("rpc/") ? answers.rpc ?? { status: "ok", changed: [] }
        : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const rpcCall = (calls: Call[]) => calls.find((c) => c.path === "rpc/admin_update_person");

describe("who may change what", () => {
  it("gives the registered team to the Men's Convenor only", () => {
    expect(squadRights(convenor)).toEqual({ registeredTeam: true, squad: true });
    expect(squadRights(captain)).toEqual({ registeredTeam: false, squad: true });
    expect(squadRights(membershipOfficer)).toEqual({ registeredTeam: false, squad: false });
  });

  it("matches the person page's can flags", () => {
    for (const u of [convenor, captain, membershipOfficer]) {
      const can = canFor(u, person as any);
      expect({ registeredTeam: can.registeredTeam, squad: can.squad }).toEqual(squadRights(u));
    }
  });

  it("refuses a Section Captain's registered team change with 403, whatever else is sent", () => {
    const body = { registeredTeam: "HKFC B", playingPosition: "Defender", expect: { registeredTeam: "HKFC C", playingPosition: null } };
    expect(() => parseSquadChange(body, squadRights(captain))).toThrow(/Only the Men's Convenor/);
    try {
      parseSquadChange(body, squadRights(captain));
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
    }
  });
});

describe("parseSquadChange", () => {
  const all = { registeredTeam: true, squad: true };

  it("maps fields to columns, with what the screen read as expect", () => {
    expect(
      parseSquadChange({ selectedTeamSos: " HKFC B ", playingPosition: "Defender", expect: { selectedTeamSos: null, playingPosition: "Forward" } }, all),
    ).toEqual({
      patch: { selected_team_sos: "HKFC B", playing_position: "Defender" },
      expect: { selected_team_sos: null, playing_position: "Forward" },
      teams: ["HKFC B"],
    });
  });

  it("clears with null or blank", () => {
    expect(parseSquadChange({ selectedTeamEos: "", expect: { selectedTeamEos: "HKFC A" } }, all).patch).toEqual({ selected_team_eos: null });
  });

  it("ignores columns it doesn't know (no way to reach another column)", () => {
    const r = parseSquadChange({ playingPosition: "Forward", status: "Member", active: false, expect: { playingPosition: null } }, all);
    expect(Object.keys(r.patch)).toEqual(["playing_position"]);
  });

  it("refuses a position off the list, a missing expect, and nothing to save", () => {
    expect(() => parseSquadChange({ playingPosition: "Sweeper", expect: { playingPosition: null } }, all)).toThrow(/position from the list/);
    expect(() => parseSquadChange({ playingPosition: "Forward", expect: {} }, all)).toThrow(/Reload/);
    expect(() => parseSquadChange({ playingPosition: "Forward" }, all)).toThrow(/Reload/);
    expect(() => parseSquadChange({ expect: {} }, all)).toThrow(/Nothing to save/);
  });
});

describe("saveSquad", () => {
  it("writes through admin_update_person as admin-squad", async () => {
    const calls = fake({ rpc: { status: "ok", changed: ["registered_team"] } });
    const r = await saveSquad(env, convenor, "recP1", { registeredTeam: "HKFC B", expect: { registeredTeam: "HKFC C" } });
    expect(r).toEqual({ ok: true, changed: ["registered_team"] });
    expect(rpcCall(calls)?.body).toEqual({
      p_person: "recP1",
      p_actor: "recOFFICER",
      p_action: "admin-squad",
      p_patch: { registered_team: "HKFC B" },
      p_expect: { registered_team: "HKFC C" },
    });
  });

  it("refuses a team that isn't an active team, before writing", async () => {
    const calls = fake({ teams: ["HKFC A", "HKFC B"] });
    await expect(saveSquad(env, captain, "recP1", { selectedTeamEos: "HKFC Z", expect: { selectedTeamEos: null } })).rejects.toMatchObject({
      status: 400,
      message: "Choose one of the club's teams.",
    });
    expect(rpcCall(calls)).toBeUndefined();
  });

  it("answers 409 CHANGED when the field moved since the screen read it", async () => {
    fake({ rpc: { status: "conflict", field: "playing_position" } });
    await expect(saveSquad(env, captain, "recP1", { playingPosition: "Defender", expect: { playingPosition: null } })).rejects.toMatchObject({
      status: 409,
      code: "CHANGED",
      message: expect.stringMatching(/Someone else changed this/),
    });
  });

  it("refuses an officer without either section", async () => {
    const calls = fake();
    await expect(saveSquad(env, membershipOfficer, "recP1", { playingPosition: "Defender", expect: { playingPosition: null } })).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("admin_update_person", () => {
  it("already allows the four squad columns (no migration needed)", () => {
    const sql = readFileSync(path.join(__dirname, "..", "supabase/migrations/20261007130503_commitment_period_fixups.sql"), "utf8");
    const allowed = sql.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? "";
    for (const col of ["registered_team", "selected_team_sos", "selected_team_eos", "playing_position"]) expect(allowed).toContain(`'${col}'`);
  });
});
