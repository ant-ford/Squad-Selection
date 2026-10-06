/**
 * Volunteering: the roles someone would help with, and their coaching and
 * umpiring levels. Asked in the new joiner form and, for members, in the
 * start-of-season form with the season plan and kit sizes; it can also be
 * changed any time from the player page (owner decisions, 2026-10-01).
 *
 * One set of answers per person, not per season. Stored in the People
 * columns the Airtable form filled. One-off dated events (camps, the junior
 * festival, stock takes, umpire courses) are left out: they move to the
 * events schedule, built later. Answers for them already given are kept.
 *
 * Seen by every officer (sponsors included), coach and team captain.
 */

export interface VolunteerGroup {
  key: VolunteerGroupKey;
  /** The People column. */
  column: string;
  label: string;
  options: string[];
}

export type VolunteerGroupKey =
  | "hockeyCommittee"
  | "mensSubCommittee"
  | "teamRoles"
  | "touringCommittee"
  | "juniorHockey"
  | "easter5s";

/** Choices are the Airtable form's words, so the answers already given carry on. */
export const VOLUNTEER_GROUPS: VolunteerGroup[] = [
  { key: "hockeyCommittee", column: "hockey_committee_roles", label: "Hockey Committee", options: ["Chairman", "Treasurer", "Sponsorship", "Magazine", "Social Media"] },
  {
    key: "mensSubCommittee",
    column: "mens_sub_committee",
    label: "Men's Sub-Committee",
    options: ["Captain/Vice Captain", "Convenor", "Membership Officer", "Social & Events", "Kit Convenor", "Pre-Season Friendlies Rep"],
  },
  { key: "teamRoles", column: "team_roles", label: "Team roles", options: ["Social Secretary & Media", "Balls & Masks"] },
  {
    key: "touringCommittee",
    column: "touring_committee",
    label: "Touring Committee",
    options: ["Head of Tours", "Tournament Admin", "Tour Logistics", "Hotel Bookings", "Costume Ordering"],
  },
  {
    key: "juniorHockey",
    column: "junior_hockey_volunteers",
    label: "Junior hockey",
    options: [
      "Tue Coaching 4:30-6pm (Sep-May)",
      "Tue Schools Coaching 4-5pm (Sep-May)",
      "Thu Coaching 4:30-6pm (Sep-May)",
      "Fri Youth Coaching 5:30-7:30pm (Sep-May)",
      "Sat Coaching 9:15-12:15pm (Sep-May)",
      "Sat Youth Coaching 12-1pm (Sep-May)",
      "Sat Goalkeeper Coaching (Sep-May)",
      "Junior Hockey League (JHL)",
    ],
  },
  {
    key: "easter5s",
    column: "easter_5s_committee",
    label: "Easter 5s Committee",
    options: ["Tournament Director", "Media & Comms", "Fixtures", "Logistics", "Umpiring", "Pitch Setup", "Team Liaison", "F&B"],
  },
];

export const COACH_LEVELS = ["Level 1", "Level 2", "Level 3", "Level 4", "Level 5"] as const;
export const UMPIRE_LEVELS = ["Level 1", "Level 2", "Level 3", "FIH International Panel"] as const;
/** Stored for "no qualification", as the Airtable form did. */
export const NO_QUALIFICATION = "Not Applicable";

export type VolunteerRoles = Record<VolunteerGroupKey, string[]>;

export const EMPTY_ROLES: VolunteerRoles = {
  hockeyCommittee: [],
  mensSubCommittee: [],
  teamRoles: [],
  touringCommittee: [],
  juniorHockey: [],
  easter5s: [],
};

export interface VolunteeringAnswers {
  /** Only the roles offered on the form; unticked is no. */
  roles: VolunteerRoles;
  /** "Nothing for now": answered, and no roles. */
  nothingForNow: boolean;
  /** A COACH_LEVELS value, or null for none. */
  qualifiedCoach: string | null;
  /** An UMPIRE_LEVELS value, or null for none. */
  qualifiedUmpire: string | null;
}

/** GET /api/volunteering/me. */
export interface MyVolunteering extends VolunteeringAnswers {
  /** When they last saved it in Eddy; null if never (answers may still come from the Airtable form). */
  updatedAt: string | null;
}

/** Whether the answers are complete enough to save. */
export function volunteeringMissing(a: VolunteeringAnswers): string | null {
  const any = Object.values(a.roles).some((r) => r.length > 0);
  if (!any && !a.nothingForNow) return "Tick anything you'd help with, or “Nothing for now”.";
  return null;
}

export interface Volunteer {
  id: string;
  name: string;
  team: string;
  status: string;
  active: boolean;
  email: string | null;
  roles: VolunteerRoles;
  qualifiedCoach: string | null;
  qualifiedUmpire: string | null;
  updatedAt: string | null;
}

/** GET /api/volunteering/board: everyone who offered a role or holds a level. */
export interface VolunteersBoard {
  volunteers: Volunteer[];
}
