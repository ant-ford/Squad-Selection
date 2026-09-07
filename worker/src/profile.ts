import type { Env } from "./env";
import { getPlayerByEmail, getReferenceData, UNRANKED_TEAM_RANK } from "./reference";
import { HttpError } from "./http";
import type { AuthorizedUser } from "./auth";

export async function getMyProfile(env: Env, authUser: AuthorizedUser) {
  const user = await getPlayerByEmail(env, authUser.email);

  if (!user) {
    throw new HttpError("Player record not found for this email", 404);
  }

  const ref = await getReferenceData(env);

  // coachTeams/isSectionCaptain come from the single authorization derivation
  // (auth.ts) - Section Captains already see every team name there, so the
  // frontend gates and team-scoped calendar operations treat them equally.
  const coachTeamSet = new Set(authUser.coachTeams);
  const coachTeams = ref.teams
    .filter((t) => coachTeamSet.has(t.teamName || ""))
    .map((t) => ({
      id: t.id,
      teamName: t.teamName || "",
      teamRank: t.teamRank ?? UNRANKED_TEAM_RANK,
      targetSquadSize: t.targetSquadSize || 16,
    }))
    .sort((a, b) => a.teamRank - b.teamRank);

  const captainTeams = ref.teams
    .filter((t) => (t.teamCaptain || []).includes(user.id))
    .map((t) => t.teamName || "");

  return {
    preferredName:
      user.preferredName ||
      user.givenNames ||
      "Coach",

    roles: Array.isArray(user.playerCoach)
      ? user.playerCoach
      : [],

    isCoach: authUser.role === "coach",

    isSectionCaptain: authUser.isSectionCaptain,

    captainTeams,

    coachTeams,
  };
}