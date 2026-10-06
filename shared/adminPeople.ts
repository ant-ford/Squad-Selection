/**
 * The officers' person search and person page (GET /api/admin/people and
 * /api/admin/people/:id). The page shows only the blocks the caller's
 * offices open; `can` says which, and the server checks again on every save.
 */

/** One search result. */
export interface PersonSearchRow {
  id: string;
  name: string;
  team: string | null;
  status: string | null;
  stage: string | null;
  active: boolean;
}

/** Membership details, as stored ("" is shown as null). Also the save's `expect`. */
export interface PersonMembership {
  memberType: string | null;
  categoryType: string | null;
  membershipNo: string | null;
  joinDate: string | null;
  commitmentEndDate: string | null;
}

/** Teams and position, as stored. */
export interface PersonSquad {
  registeredTeam: string | null;
  selectedTeamSos: string | null;
  selectedTeamEos: string | null;
  playingPosition: string | null;
}

export interface PersonAdminCan {
  /** Membership details: the Membership Officer and Section Captains. */
  membership: boolean;
  /** Move the applicant stage: the Membership Officer and Section Captains. */
  stage: boolean;
  /** Selected teams and position (Section Captains) or the registered team (Men's Convenor). */
  squad: boolean;
  /** The registered team: the Men's Convenor only. */
  registeredTeam: boolean;
  /** Manual suspensions: the Men's Convenor only. */
  suspend: boolean;
  /** Make active or inactive: Section Captains only. */
  activate: boolean;
  /** Start the junior route: a Section Captain or the Membership Officer, for a junior member. */
  juniorRoute: boolean;
}

export interface PersonAdminView {
  id: string;
  name: string;
  status: string | null;
  stage: string | null;
  active: boolean;
  team: string | null;
  can: PersonAdminCan;
  /** Only when can.membership. */
  membership?: PersonMembership;
  /** Only when can.squad. */
  squad?: PersonSquad;
  /** Team names to choose from, by rank; only when can.squad. */
  teamOptions?: string[];
}

/** First (preferred) name and surname, as the app shows names everywhere. */
export function displayName(p: { preferred_name?: string | null; given_names?: string | null; surname?: string | null }): string {
  return [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ") || "(no name)";
}
