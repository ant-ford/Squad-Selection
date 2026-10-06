import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../worker/src/reference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/reference")>()),
  getReferenceData: vi.fn(async () => ({ teams: [{ teamName: "HKFC C", teamCaptain: ["recCAPTAIN"] }] })),
}));

import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { canSeeVolunteers } from "../worker/src/volunteerAccess";
import { getMyVolunteering, getVolunteersBoard, parseVolunteering, rolesOf, saveVolunteering } from "../worker/src/volunteering";
import { invalidateAll } from "../worker/src/cache";
import { EMPTY_ROLES, VOLUNTEER_GROUPS } from "../shared/volunteering";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const player = { email: "p@x.com", personId: "recME", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(tables[url.pathname.split("/").pop()!] ?? []), { status: 200 });
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); invalidateAll(); });

const allNotInterested = Object.fromEntries(VOLUNTEER_GROUPS.map((g) => [g.column, ["Not Interested"]]));

describe("volunteering", () => {
  it("reads only the roles the form offers, dropping Not Interested and retired dated choices", () => {
    const roles = rolesOf({ junior_hockey_volunteers: ["Not Interested", "Summer Camp 1: 12-15 Jul 2026", "Junior Hockey League (JHL)"], easter_5s_committee: ["Umpiring"] });
    expect(roles.juniorHockey).toEqual(["Junior Hockey League (JHL)"]);
    expect(roles.easter5s).toEqual(["Umpiring"]);
    expect(roles.hockeyCommittee).toEqual([]);
  });

  it("needs a role or Nothing for now, not both, and only choices from the list", () => {
    expect(parseVolunteering({ roles: { easter5s: ["Fixtures", "Umpiring"] }, qualifiedUmpire: "Level 1" })).toMatchObject({
      roles: { ...EMPTY_ROLES, easter5s: ["Fixtures", "Umpiring"] }, nothingForNow: false, qualifiedUmpire: "Level 1", qualifiedCoach: null,
    });
    expect(parseVolunteering({ nothingForNow: true }).nothingForNow).toBe(true);
    expect(() => parseVolunteering({})).toThrow(/Nothing for now/);
    expect(() => parseVolunteering({ nothingForNow: true, roles: { teamRoles: ["Balls & Masks"] } })).toThrow(/Untick/);
    expect(() => parseVolunteering({ roles: { juniorHockey: ["Summer Camp 1: 12-15 Jul 2026"] } })).toThrow(/Junior hockey/);
    expect(() => parseVolunteering({ nothingForNow: true, qualifiedCoach: "Level 9" })).toThrow(/coaching/);
  });

  it("saves through the database function, with the choices on offer so older answers are kept", async () => {
    const calls = fake({ save_volunteering: null });
    await saveVolunteering(env, player, { roles: { teamRoles: ["Balls & Masks"] } });
    const rpc = calls.find((c) => c.url.pathname.endsWith("/rpc/save_volunteering"))!;
    expect(rpc.body.p_actor).toBe("recME");
    expect(rpc.body.p.roles.teamRoles).toEqual(["Balls & Masks"]);
    expect(rpc.body.p.offered.juniorHockey).toContain("Junior Hockey League (JHL)");
    expect(rpc.body.p.offered.juniorHockey).not.toContain("Summer Camp 1: 12-15 Jul 2026");
  });

  it("counts every group answered Not Interested on the Airtable form as Nothing for now", async () => {
    fake({ people: [{ api_id: "recME", qualified_coach: "Not Applicable", qualified_umpire: "Level 2", volunteering_updated_at: null, ...allNotInterested }] });
    expect(await getMyVolunteering(env, player)).toMatchObject({ nothingForNow: true, qualifiedCoach: null, qualifiedUmpire: "Level 2", updatedAt: null });
    fake({ people: [{ api_id: "recME", volunteering_updated_at: null }] });
    expect((await getMyVolunteering(env, player)).nothingForNow).toBe(false); // never answered
  });

  it("is for officers (sponsors included), coaches and team captains", async () => {
    fake({ api_offices: [{ id: "o1", member: "recSPONSOR" }] });
    expect(await canSeeVolunteers(env, { ...player, role: "coach" } as AuthorizedUser)).toBe(true);
    expect(await canSeeVolunteers(env, { ...player, officerRoles: [{ office: "membershipOfficer", designation: "" }] } as AuthorizedUser)).toBe(true);
    expect(await canSeeVolunteers(env, { ...player, personId: "recCAPTAIN" })).toBe(true);
    expect(await canSeeVolunteers(env, { ...player, personId: "recSPONSOR" })).toBe(true);
    expect(await canSeeVolunteers(env, player)).toBe(false);
  });

  it("lists everyone who offered a role or holds a level", async () => {
    fake({
      api_offices: [],
      people: [
        { api_id: "recA", given_names: "Al", surname: "One", status: "Member", active: true, selected_team_sos: "HKFC C", team_roles: ["Balls & Masks"], qualified_coach: "Not Applicable" },
        { api_id: "recB", given_names: "Bo", surname: "Two", status: "Member", active: false, qualified_umpire: "Level 1", ...allNotInterested },
        { api_id: "recC", given_names: "Cy", surname: "Three", status: "Member", active: true, ...allNotInterested, qualified_coach: "Not Applicable" },
      ],
    });
    const board = await getVolunteersBoard(env, { ...player, role: "coach" } as AuthorizedUser);
    expect(board.volunteers.map((v) => [v.name, v.team, v.active, v.qualifiedUmpire])).toEqual([["Al One", "HKFC C", true, null], ["Bo Two", "", false, "Level 1"]]);
    await expect(getVolunteersBoard(env, player)).rejects.toMatchObject({ status: 403 });
  });
});
