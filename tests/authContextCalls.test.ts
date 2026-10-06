import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/src/index";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest } from "./helpers/postgrest";
import { authorize } from "../worker/src/auth";
import { parseAuthContext } from "../worker/src/authContext";
import { parseCacheVersions, raiseVersionFloor } from "../worker/src/cacheVersions";
import { db } from "../worker/src/data/supabase";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";

/**
 * The database calls a signed-in request makes, counted by the Worker's own
 * instrumentation (the Server-Timing header): sign-in is ONE call
 * (auth_context), started while Supabase checks the session, and the
 * player page's header flags (volunteers, events, umpiring, captaincies)
 * need no reads of their own.
 */
const ENV = {
  ...SUPABASE_TEST_ENV,
  SUPABASE_URL: "https://auth.test",
  SUPABASE_ANON_KEY: "anon",
  ALLOWED_ORIGIN: "https://app.test",
} as unknown as Env;
const CTX = { waitUntil: () => {} } as any;

const ADA = "recAda0000000000";
/** auth_context's answer for Ada: an Active player who captains HKFC C and is in the umpire pool. */
const CONTEXT = {
  person: { uuid: "uuid-ada", id: ADA, preferredName: "Ada", email: "ada@hkfc.com", active: true, status: "Member", registeredTeam: "HKFC C" },
  isTeamCoach: false,
  coachTeams: [],
  teamSectionCaptain: false,
  allTeamNames: [],
  captainTeams: ["HKFC C"],
  socialSecretaryTeams: [],
  offices: [{ role: "sponsor", office: null, designation: "" }],
  umpire: true,
  versions: { matches: 7, people: 4 },
};
const apiPlayer = {
  id: ADA, preferred_name: "Ada", given_names: null, surname: null, shirt_no_value: null, email: "ada@hkfc.com", email_lower: "ada@hkfc.com",
  mobile_no: null, active: true, registered_team: "HKFC C", selected_team_sos: null, selected_team_eos: null, playing_position: null,
  playing_ability: null, is_visiting_player: false, is_suspended: false, matches_to_serve: null, ever_registered_to_premier: false,
  u21_eligible: false, player_coach: [], section_rank: null, rank_updated_at: null, status: "Member", applicant_stage: null,
  sports_background: null, selection_comments: null, opt_in_only: false, date_of_birth: null, photo_file_id: null,
};

function jwt(email: string): string {
  const b64 = btoa(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, "");
  return `h.${b64}.s`;
}
const dbCalls = (res: Response) => Number(/calls=(\d+)/.exec(res.headers.get("Server-Timing") ?? "")?.[1] ?? 0);

let pg: FakePostgrest;
let verified = 0;
beforeEach(() => {
  invalidateAll();
  verified = 0;
  pg = fakePostgrest({
    tables: {
      api_players: [apiPlayer],
      api_teams: [{ id: "recTeamC000000000", team_name: "HKFC C", team_rank: 3, is_premier: false, target_squad_size: 16, active: true, coach: [], team_captain: [ADA], section_captain: [], auto_select_players: [] }],
      notes: [],
    },
    rpc: { auth_context: () => CONTEXT },
    other: (url) => {
      if (url.endsWith("/auth/v1/user")) {
        verified++;
        return new Response(JSON.stringify({ email: "ada@hkfc.com" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const get = (path: string) =>
  worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${jwt("ada@hkfc.com")}` } }), ENV, CTX);

describe("database calls behind a signed-in request", () => {
  it("my profile: auth_context and the teams; no reads for the person or the header flags", async () => {
    const res = await get("/api/my-profile");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ captainTeams: ["HKFC C"], volunteers: true, events: false, umpiring: "umpire" });

    expect(pg.rpcCalls("auth_context")).toEqual([{ p_email: "ada@hkfc.com" }]);
    // Before: the email lookup, every team and every office for sign-in, then
    // offices, people, team_people, a year of matches and the umpire
    // assignments for the flags, and every Active player for the teams.
    for (const table of ["api_offices", "offices", "people", "team_people", "matches", "umpire_assignments"]) {
      expect(pg.reads(table), table).toHaveLength(0);
    }
    expect(pg.reads("api_players"), "api_players").toHaveLength(0);
    expect(dbCalls(res)).toBe(2);
    expect(verified).toBe(1);
  });

  it("a repeat request within 10 s on a warm isolate: no database call at all", async () => {
    await get("/api/my-profile");
    const again = await get("/api/my-profile");
    expect(again.status).toBe(200);
    expect(dbCalls(again)).toBe(0);
    expect(pg.rpcCalls("auth_context")).toHaveLength(1);
    // Supabase's check is held 60 s per token, as before.
    expect(verified).toBe(1);
  });

  it("asks auth_context again once the 10 s are up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await get("/api/my-profile");
      vi.setSystemTime(Date.now() + 9_000);
      await get("/api/my-profile");
      expect(pg.rpcCalls("auth_context")).toHaveLength(1);
      vi.setSystemTime(Date.now() + 2_000);
      const later = await get("/api/my-profile");
      expect(later.status).toBe(200);
      expect(pg.rpcCalls("auth_context")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a page's parallel requests share one auth_context call", async () => {
    const all = await Promise.all([get("/api/my-profile"), get("/api/my-profile"), get("/api/my-profile")]);
    for (const res of all) expect(res.status).toBe(200);
    expect(pg.rpcCalls("auth_context")).toHaveLength(1);
  });

  it("after the person writes, their next request reads auth_context again (their write shows at once)", async () => {
    await get("/api/my-profile");
    // Any database write made inside one of their requests.
    await runWithRequestContext({ stats: newRequestStats(), email: "ada@hkfc.com" }, () => db(ENV).insert("notes", [{ id: "n1" }]));
    await get("/api/my-profile");
    expect(pg.rpcCalls("auth_context")).toHaveLength(2);
    // Someone else's write doesn't drop Ada's answer.
    await runWithRequestContext({ stats: newRequestStats(), email: "bob@hkfc.com" }, () => db(ENV).insert("notes", [{ id: "n2" }]));
    await get("/api/my-profile");
    expect(pg.rpcCalls("auth_context")).toHaveLength(2);
  });

  it("a reused answer's versions are raised to the newest this isolate has seen", () => {
    const stale = parseAuthContext({ ...CONTEXT, versions: { matches: 7, people: 4 } });
    expect(authorize("ada@hkfc.com", stale).versions.matches).toBe(7);
    // Someone else's fresh sign-in on this isolate, after Ada's answer was read.
    raiseVersionFloor(parseCacheVersions({ matches: 9, people: 3 }));
    const reused = authorize("ada@hkfc.com", stale);
    expect(reused.versions.matches).toBe(9);
    expect(reused.versions.people).toBe(4); // never lowered
  });
});
