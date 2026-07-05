import { Env } from "./airtable";
import { getPlayerByEmail, getReferenceData } from "./reference";
import { HttpError } from "./http";

export async function getMyProfile(env: Env, email: string) {
  const user = await getPlayerByEmail(env, email);

  if (!user) {
    throw new HttpError("Player record not found for this email", 404);
  }

  const ref = await getReferenceData(env);

  const coachTeams = ref.teams
    .filter((t) => (t.coach || []).includes(user.id))
    .map((t) => ({
      id: t.id,
      teamName: t.teamName || "",
      teamRank: t.teamRank ?? 99,
      targetSquadSize: t.targetSquadSize || 16,
    }))
    .sort((a, b) => a.teamRank - b.teamRank);

  const captainTeams = ref.teams
    .filter((t) => (t.teamCaptain || []).includes(user.id))
    .map((t) => t.teamName || "");

  const isSectionCaptain = ref.teams.some(
    (t) => (t.sectionCaptain || []).includes(user.id)
  );

  return {
    preferredName:
      user.preferredName ||
      user.givenNames ||
      "Coach",

    roles: Array.isArray(user.playerCoach)
      ? user.playerCoach
      : [],

    isCoach: coachTeams.length > 0,

    isAdmin: coachTeams.length > 0,

    isSectionCaptain,

    captainTeams,

    coachTeams,
  };
}