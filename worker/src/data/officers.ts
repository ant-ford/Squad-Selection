import type { Env } from "../env";
import { supabaseOfficers } from "./supabase/squad";

/**
 * The office tables. A "sectionCaptain" row is in the Section Captains
 * TABLE, which is not the Teams.Section Captain link (see reference.ts).
 * Sponsors share the shape; a sponsor row names who signs an application
 * (contacts.ts) and grants no section access.
 */
export type Office =
  | "membershipOfficer"
  | "sectionChair"
  | "sectionCaptain"
  | "sponsor"
  // The kit screens (auth.ts).
  | "kitConvenor"
  // League registration: the requests for new joiners (joiners.ts) and the
  // registration screen (auth.ts).
  | "hockeyConvenor"
  // Coach rights for every team and the trial sessions (auth.ts).
  | "assistantDirector"
  // Runs the umpiring duties (umpiring.ts).
  | "umpireCoordinator";

/** One office row: who holds it (People ids) and its Designation. */
export interface OfficeRow {
  office: Office;
  /** Empty when the row has none. */
  designation: string;
  memberIds: string[];
}

/** One office row of any status, with only its holder. */
export interface OfficeMemberRow {
  /** The office row's own id, which applicants and reviews link to. */
  id: string;
  office: Office;
  memberIds: string[];
}

export interface OfficersRepo {
  /** Active rows of the given offices, in the order the offices are given. */
  listActive(offices: readonly Office[]): Promise<OfficeRow[]>;
  /**
   * Every row of the given offices, whatever its status, in the order the
   * offices are given: an application waiting on a sponsor who has since
   * retired still names them.
   */
  listAllMembers(offices: readonly Office[]): Promise<OfficeMemberRow[]>;
}

export function officers(env: Env): OfficersRepo {
  return supabaseOfficers(env);
}
