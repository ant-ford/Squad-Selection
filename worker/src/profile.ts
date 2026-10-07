import type { Env } from "./env";
import { getActiveTeams, UNRANKED_TEAM_RANK } from "./reference";
import { sectionsFor, type AuthorizedUser } from "./auth";
import { canSeeSeasonPlans } from "./seasonPlan";
import { canSeeVolunteers } from "./volunteerAccess";
import { canManageEvents } from "./eventAccess";
import { umpiringAccess } from "./umpiring";
import { canViewSystem } from "./systemHealth";
import { SUBMITTED_STAGES } from "../../shared/membershipStages";
import { firstName } from "../../shared/personName";

/**
 * Whether signing in goes to the application rather than the player page:
 * an applicant who still has their application to send (stages 1-2). Once
 * it's sent, or for anyone holding an office or coaching (an officer can be
 * applying for their own membership), it's the player page, so Active
 * applicants keep their fixtures and availability.
 */
export function landsOnApplication(status: string | undefined, stage: string | undefined, authUser: AuthorizedUser): boolean {
  if (status !== "Applicant") return false;
  if (authUser.officerRoles.length > 0 || authUser.role === "coach") return false;
  return !SUBMITTED_STAGES.includes(stage ?? "");
}

export async function getMyProfile(env: Env, authUser: AuthorizedUser) {
  // The person came with sign-in (auth_context). The Active teams alone
  // (~3 KB): the players list (~150 KB) isn't needed here.
  const user = authUser.person;
  const teams = await getActiveTeams(env);

  // coachTeams/isSectionCaptain come from the single authorization derivation
  // (auth.ts) - Section Captains already see every team name there, so the
  // frontend gates and team-scoped calendar operations treat them equally.
  const coachTeamSet = new Set(authUser.coachTeams);
  const coachTeams = teams
    .filter((t) => coachTeamSet.has(t.teamName || ""))
    .map((t) => ({
      id: t.id,
      teamName: t.teamName || "",
      teamRank: t.teamRank ?? UNRANKED_TEAM_RANK,
      targetSquadSize: t.targetSquadSize || 16,
    }))
    .sort((a, b) => a.teamRank - b.teamRank);

  // From auth_context, like the header flags below: no reads.
  const captainTeams = authUser.captainTeams;
  const [volunteers, events, umpiring] = await Promise.all([
    canSeeVolunteers(env, authUser),
    canManageEvents(env, authUser),
    umpiringAccess(env, authUser),
  ]);

  return {
    preferredName: firstName(user) || "Coach",

    roles: Array.isArray(user.playerCoach)
      ? user.playerCoach
      : [],

    isCoach: authUser.role === "coach",

    isSectionCaptain: authUser.isSectionCaptain,

    officerRoles: authUser.officerRoles,

    // Which officers' sections to offer. Derived from the same rule the
    // Worker enforces, so the app never keeps its own copy of it.
    sections: sectionsFor(authUser),

    // Applicants (and people registering to join) with an application still
    // to fill in belong on it, not the player page.
    applicant: landsOnApplication(user.status, user.applicantStage, authUser),

    // Their own link for inviting someone to register to join (trials.ts):
    // members only.
    inviteLink:
      user.status === "Member"
        ? `${(env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "")}/join?ref=${encodeURIComponent(user.id)}`
        : null,

    // Whether the Season plans screen has anything for them.
    seasonPlans: canSeeSeasonPlans(authUser),

    // Whether the Volunteers screen is theirs: officers, coaches, captains.
    volunteers,

    // Whether the Events screen is theirs: social secretaries and Section Captains.
    events,

    // The umpiring duties: the club's umpires, and the Umpire Coordinator.
    umpiring,

    // Whether the System screen is theirs: the owner (SYSTEM_OWNER_IDS) and
    // the Section Captains. Not a section: the owner holds no office for it.
    system: canViewSystem(env, authUser),

    captainTeams,

    coachTeams,
  };
}