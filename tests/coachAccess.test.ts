import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Coaches act only on their own teams' matches (owner decision, 7 Oct 2026,
// after the security review, PR #285). Section Captains and the Assistant
// Director keep every team. worker/src/coachAccess.ts and the team and
// player checks in worker/src/auth.ts; the routes that use them are pinned
// in tests/authorization-routes.test.ts.
// ---------------------------------------------------------------------------

import { invalidateAll } from "../worker/src/cache";
import { coachesEveryTeam, coachesPlayer, coachesTeam, requireCoachOfTeam } from "../worker/src/auth";
import { requireCoachOfMatch, requireCoachOfMatchSide } from "../worker/src/coachAccess";
import type { Env } from "../worker/src/env";
import { useFakeRepos } from "./helpers/fakeRepos";
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { match, recId, signedIn, team } from "./helpers/factories";

const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;

const D_MATCH = recId("DMatch");
const E_MATCH = recId("EMatch");
/** HKFC D at home to HKFC E. */
const DERBY = recId("Derby");
/** HKFC E away: the HKFC side is away. */
const E_AWAY = recId("EAway");

const db = useFakeRepos(() => ({
  teams: [
    team({ id: recId("TD"), teamName: "HKFC D", teamRank: 4, active: true }),
    team({ id: recId("TE"), teamName: "HKFC E", teamRank: 5, active: true }),
  ],
  matches: [
    match({ id: D_MATCH, homeTeam: "HKFC D", awayTeam: "Valley" }),
    match({ id: E_MATCH, homeTeam: "HKFC E", awayTeam: "KCC" }),
    match({ id: DERBY, homeTeam: "HKFC D", awayTeam: "HKFC E" }),
    match({ id: E_AWAY, homeTeam: "Dragons", awayTeam: "HKFC E" }),
  ],
}));

const coachOfD = signedIn({ email: "d@hkfc.com", role: "coach", coachTeams: ["HKFC D"], isSectionCaptain: false, officerRoles: [] });
/** A Section Captain's team link: coachTeams is every team name (auth.ts). */
const captain = signedIn({ email: "sc@hkfc.com", role: "coach", coachTeams: ["HKFC D", "HKFC E"], isSectionCaptain: true, officerRoles: [] });
const adh = signedIn({
  email: "adh@hkfc.com", role: "coach", coachTeams: ["HKFC D", "HKFC E"], isSectionCaptain: false,
  officerRoles: [{ office: "assistantDirector", designation: "" }],
});

const NOT_YOURS = { status: 403, code: "NOT_YOUR_TEAM" };

beforeEach(() => invalidateAll());

describe("a coach of one team", () => {
  it("may act on their own team's match", async () => {
    await expect(requireCoachOfMatch(ENV, coachOfD, D_MATCH)).resolves.toBeUndefined();
    await expect(requireCoachOfMatchSide(ENV, coachOfD, D_MATCH, "home")).resolves.toBeUndefined();
    // No side given: the HKFC side, as the squad save resolves it.
    await expect(requireCoachOfMatchSide(ENV, coachOfD, D_MATCH, undefined)).resolves.toBeUndefined();
  });

  it("gets 403 NOT_YOUR_TEAM on another team's match, whichever side it names", async () => {
    await expect(requireCoachOfMatch(ENV, coachOfD, E_MATCH)).rejects.toMatchObject(NOT_YOURS);
    await expect(requireCoachOfMatchSide(ENV, coachOfD, E_MATCH, "home")).rejects.toMatchObject(NOT_YOURS);
    // The opponent's side resolves to the HKFC one, so naming it gets nowhere.
    await expect(requireCoachOfMatchSide(ENV, coachOfD, E_MATCH, "away")).rejects.toMatchObject(NOT_YOURS);
    await expect(requireCoachOfMatch(ENV, coachOfD, E_AWAY)).rejects.toMatchObject(NOT_YOURS);
  });

  it("in a derby, reads the fixture but writes only their own side", async () => {
    await expect(requireCoachOfMatch(ENV, coachOfD, DERBY)).resolves.toBeUndefined();
    await expect(requireCoachOfMatchSide(ENV, coachOfD, DERBY, "home")).resolves.toBeUndefined();
    await expect(requireCoachOfMatchSide(ENV, coachOfD, DERBY, "away")).rejects.toMatchObject(NOT_YOURS);
    // No side in a derby means home, as squad.ts resolves it.
    await expect(requireCoachOfMatchSide(ENV, coachOfD, DERBY, undefined)).resolves.toBeUndefined();
    const coachOfE = { ...coachOfD, coachTeams: ["HKFC E"] };
    await expect(requireCoachOfMatchSide(ENV, coachOfE, DERBY, undefined)).rejects.toMatchObject(NOT_YOURS);
    await expect(requireCoachOfMatchSide(ENV, coachOfE, DERBY, "away")).resolves.toBeUndefined();
  });

  it("answers 404 for a match that does not exist", async () => {
    await expect(requireCoachOfMatch(ENV, coachOfD, recId("Nowhere"))).rejects.toMatchObject({ status: 404 });
  });

  it("acts for their own team and their own team's players only", () => {
    expect(coachesTeam(coachOfD, "HKFC D")).toBe(true);
    expect(coachesTeam(coachOfD, "HKFC E")).toBe(false);
    expect(coachesTeam(coachOfD, "")).toBe(false);
    expect(() => requireCoachOfTeam(coachOfD, "HKFC E")).toThrow(expect.objectContaining(NOT_YOURS));
    expect(() => requireCoachOfTeam(coachOfD, "HKFC D")).not.toThrow();
    // The team the app shows them in, or their registered team.
    expect(coachesPlayer(coachOfD, { registeredTeam: "HKFC D" })).toBe(true);
    expect(coachesPlayer(coachOfD, { registeredTeam: "HKFC E", selectedTeamEos: "HKFC D" })).toBe(true);
    expect(coachesPlayer(coachOfD, { registeredTeam: "HKFC D", selectedTeamSos: "HKFC E" })).toBe(true);
    expect(coachesPlayer(coachOfD, { registeredTeam: "HKFC E" })).toBe(false);
  });

  it("never passes a player, even with a team list", () => {
    const player = { ...coachOfD, role: "player" as const };
    expect(coachesTeam(player, "HKFC D")).toBe(false);
  });
});

describe("Section Captains and the Assistant Director", () => {
  it.each([["a Section Captain", captain], ["the Assistant Director", adh]])("%s act on every team and every side", async (_, user) => {
    expect(coachesEveryTeam(user)).toBe(true);
    for (const id of [D_MATCH, E_MATCH, DERBY, E_AWAY]) {
      await expect(requireCoachOfMatch(ENV, user, id)).resolves.toBeUndefined();
      await expect(requireCoachOfMatchSide(ENV, user, id, "home")).resolves.toBeUndefined();
      await expect(requireCoachOfMatchSide(ENV, user, id, "away")).resolves.toBeUndefined();
    }
    expect(coachesTeam(user, "HKFC E")).toBe(true);
    // Nothing is read for them: the check is free.
    expect(db.callsTo("matches", "getById")).toEqual([]);
  });

  it("a coach is not one of them", () => {
    expect(coachesEveryTeam(coachOfD)).toBe(false);
  });
});
