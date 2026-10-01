import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { canSeeSeasonPlans, getMySeasonPlan, getSeasonPlanBoard, parseSeasonPlan, planTeamsFor, submitSeasonPlan } from "../worker/src/seasonPlan";
import { PLAYING_PREFERENCES, seasonPlanMissing, EMPTY_SEASON_PLAN } from "../shared/seasonPlan";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const player = { email: "p@x.com", personId: "recME", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;
const coach = { ...player, role: "coach", coachTeams: ["HKFC C"] } as AuthorizedUser;
const captain = { ...player, officerRoles: [{ office: "sectionCaptain", designation: "" }] } as AuthorizedUser;
const HIGHEST = PLAYING_PREFERENCES[0].value;
const DOWN = PLAYING_PREFERENCES[1].value;

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const name = url.pathname.split("/").pop()!;
    return new Response(JSON.stringify(tables[name] ?? []), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const people = [
  { id: "u1", api_id: "recA", given_names: "Al", surname: "One", status: "Member", playing_position: "Defender", selected_team_sos: "HKFC C" },
  { id: "u2", api_id: "recB", given_names: "Bo", surname: "Two", status: "Applicant", selected_team_sos: "HKFC D" },
  { id: "u3", api_id: "recC", given_names: "Cy", surname: "Three", status: "Member" },
];
const plans = [
  { person_id: "u1", season: "2026-2027", availability_level: "most", availability_half: "second", playing_preference: DOWN, captaincy_interest: "Maybe", submitted_at: null },
  { person_id: "u2", season: "2026-2027", availability_level: "all", availability_half: null, playing_preference: HIGHEST, captaincy_interest: "No", submitted_at: "2026-10-01T00:00:00Z" },
];

describe("season plan", () => {
  it("checks every answer against its choices, the preference by its exact stored words", () => {
    expect(parseSeasonPlan({ availabilityLevel: "most", availabilityHalf: "", playingPreference: DOWN, captaincyInterest: "Yes" })).toEqual({
      availabilityLevel: "most", availabilityHalf: null, playingPreference: DOWN, captaincyInterest: "Yes",
    });
    expect(() => parseSeasonPlan({ availabilityLevel: "loads" })).toThrow(/how much/);
    // The stored words use a non-breaking hyphen; a plain one isn't the same answer.
    expect(() => parseSeasonPlan({ playingPreference: DOWN.replace("‑", "-") })).toThrow(/preference/);
    expect(seasonPlanMissing(EMPTY_SEASON_PLAN)).toMatch(/How much/);
    expect(seasonPlanMissing({ ...EMPTY_SEASON_PLAN, availabilityLevel: "none", captaincyInterest: "No" })).toBeNull();
    expect(seasonPlanMissing({ ...EMPTY_SEASON_PLAN, availabilityLevel: "some", captaincyInterest: "No" })).toMatch(/preference/);
  });

  it("saves this season's plan through the database function", async () => {
    const calls = fake({ submit_season_plan: {} });
    await submitSeasonPlan(env, player, { availabilityLevel: "all", playingPreference: HIGHEST, captaincyInterest: "No" });
    expect(calls[0].url.pathname).toMatch(/rpc\/submit_season_plan$/);
    expect(calls[0].body).toEqual({ p_actor: "recME", p: { availabilityLevel: "all", availabilityHalf: null, playingPreference: HIGHEST, captaincyInterest: "No" } });
  });

  it("gives the player their own plan for the current season", async () => {
    fake({ current_season: "2026-2027", people: [{ id: "u1" }], season_plans_v: [plans[0]] });
    expect(await getMySeasonPlan(env, { ...player, personId: "recA" })).toEqual({
      season: "2026-2027",
      plan: { availabilityLevel: "most", availabilityHalf: "second", playingPreference: DOWN, captaincyInterest: "Maybe", submittedAt: null },
    });
  });

  it("shows Section Captains every team and coaches their own; others none", async () => {
    expect(planTeamsFor(env, captain)).toBe("all");
    expect(planTeamsFor(env, coach)).toEqual(["HKFC C"]);
    expect(planTeamsFor(env, player)).toEqual([]);

    // The Officers menu item, in both the profile and the fixtures payloads.
    expect(canSeeSeasonPlans(env, captain)).toBe(true);
    expect(canSeeSeasonPlans(env, coach)).toBe(true);
    expect(canSeeSeasonPlans(env, player)).toBe(false);
    expect(canSeeSeasonPlans({ ...env, DATA_BACKEND: "airtable" } as Env, coach)).toBe(false);

    fake({ current_season: "2026-2027", people, season_plans_v: plans });
    const all = await getSeasonPlanBoard(env, captain);
    expect(all.teams.map((t) => [t.team, t.players.map((p) => p.name)])).toEqual([
      ["HKFC C", ["Al One"]], ["HKFC D", ["Bo Two"]], ["No team yet", ["Cy Three"]],
    ]);
    expect(all.teams[0].players[0].plan).toEqual({ availabilityLevel: "most", availabilityHalf: "second", playingPreference: DOWN, captaincyInterest: "Maybe" });
    expect(all.teams[2].players[0].plan).toBeNull();

    const own = await getSeasonPlanBoard(env, coach);
    expect(own.teams.map((t) => t.team)).toEqual(["HKFC C"]);
    await expect(getSeasonPlanBoard(env, player)).rejects.toMatchObject({ status: 403 });
    await expect(getSeasonPlanBoard({ ...env, DATA_BACKEND: "airtable" }, captain)).rejects.toMatchObject({ status: 409 });
  });
});
