/**
 * The Section Captain's part of the New Joiner process (replacing Fillout
 * forms 1 and 2 and the Make scenario's Section Captain routes): propose a
 * new joiner, then three actions, each sending one email from the captain:
 *
 *  - invitation: stage 2, the applicant is asked to fill in their
 *    application (/apply); copied to the vice captains and the membership
 *    inbox, and to the sponsor for a new HKFC member;
 *  - kit: the Kit Convenor is asked for kit, copied to the applicant and
 *    sponsor;
 *  - registration: the Hockey Convenor is asked to register them with
 *    HockeyHK, copied to the applicant.
 *
 * Kit and registration each open a My Tasks line for the convenor, with a
 * Done button (nothing to fill in), until it's done. No reminder emails
 * (owner decision).
 */
import { phoneProblem } from "./phone";
import type { JoinerTrial } from "./trials";

export const APPLICATION_TYPES = ["Existing HKFC Member", "New HKFC Member"] as const;
export const CATEGORY_TYPES = ["Sports Preferred", "Junior (21-27)", "Junior (under 21)", "Sports Debenture", "Sports Subscriber"] as const;
export const JOINER_TEAMS = ["HKFC A", "HKFC B", "HKFC C", "HKFC D", "HKFC E", "HKFC F", "HKFC G", "HKFC H"] as const;
export const JOINER_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible/Varies"] as const;
export const JOINER_GENDERS = ["Male", "Female"] as const;
export const PLAYER_COACH = ["Player", "Coach"] as const;

/** What the Section Captain gives (Fillout forms 1 and 2). Office fields are office ids. */
export interface JoinerForm {
  applicantType: string;
  email: string;
  preferredName: string;
  gender: string;
  mobileNo: string;
  categoryType: string;
  playerCoach: string[];
  selectedTeamSos: string;
  registeredTeam: string;
  playingPosition: string;
  sponsorId: string;
  officerId: string;
  chairId: string;
  kitConvenorId: string;
  hockeyConvenorId: string;
}

export const EMPTY_JOINER: JoinerForm = {
  applicantType: "",
  email: "",
  preferredName: "",
  gender: "",
  mobileNo: "",
  categoryType: "",
  playerCoach: ["Player"],
  selectedTeamSos: "",
  registeredTeam: "",
  playingPosition: "",
  sponsorId: "",
  officerId: "",
  chairId: "",
  kitConvenorId: "",
  hockeyConvenorId: "",
};

export interface OfficeChoice {
  id: string;
  name: string;
  designation: string;
}

/** GET /api/joiners/options: who can be picked for each office. */
export interface JoinerOptions {
  /** Active teams, for a practice trial. */
  teams: string[];
  sponsors: OfficeChoice[];
  officers: OfficeChoice[];
  chairs: OfficeChoice[];
  kitConvenors: OfficeChoice[];
  hockeyConvenors: OfficeChoice[];
}

export type JoinerStepKey = "kit" | "registration";

export interface JoinerStepState {
  id: string;
  startedAt: string;
  doneAt: string | null;
  waitingOn: string | null;
}

/** GET /api/joiners/:id. */
export interface JoinerView {
  id: string;
  form: JoinerForm;
  stage: string | null;
  status: string | null;
  /** When the last invitation email went. */
  invitedAt: string | null;
  kit: JoinerStepState | null;
  registration: JoinerStepState | null;
  /** For someone who registered to join (stage 1). */
  trial: JoinerTrial | null;
}

/** The first thing wrong with the form, or null. */
export function joinerProblem(f: JoinerForm): string | null {
  if (!(APPLICATION_TYPES as readonly string[]).includes(f.applicantType)) return "Choose the type of application.";
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return "Give the new joiner's email address.";
  if (!f.preferredName.trim()) return "Give the new joiner's preferred name.";
  if (f.preferredName.trim().length > 100) return "The preferred name is too long.";
  if (!(JOINER_GENDERS as readonly string[]).includes(f.gender)) return "Choose their gender.";
  if (f.mobileNo.trim()) {
    const bad = phoneProblem(f.mobileNo);
    if (bad) return `Mobile no.: ${bad}.`;
  }
  if (!(CATEGORY_TYPES as readonly string[]).includes(f.categoryType)) return "Choose the application category.";
  if (f.playerCoach.length === 0 || f.playerCoach.some((x) => !(PLAYER_COACH as readonly string[]).includes(x))) return "Choose player, coach or both.";
  if (f.selectedTeamSos && !(JOINER_TEAMS as readonly string[]).includes(f.selectedTeamSos)) return "Choose the team from the list.";
  if (!(JOINER_TEAMS as readonly string[]).includes(f.registeredTeam)) return "Choose the HKHA registering team.";
  if (!(JOINER_POSITIONS as readonly string[]).includes(f.playingPosition)) return "Choose their playing position.";
  if (!f.sponsorId) return "Choose the application sponsor.";
  if (!f.officerId) return "Choose the Membership Officer.";
  if (!f.chairId) return "Choose the Section Chair.";
  return null;
}
