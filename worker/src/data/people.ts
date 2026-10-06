import type { Env } from "../env";
import { supabasePeople } from "./supabase/people";
import type { Row } from "./rows";
import { CHAIRMAN_FIELDS, MEMBERSHIP_FIELDS } from "../../../shared/schema/fieldMaps";
import type { Player } from "../../../shared/schema/domainTypes";

/**
 * The People fields the Worker writes. A key left out is not touched; null
 * clears the field. Never a link field: a PATCH naming a link replaces the
 * link's whole contents (see approveApplicant in membership.ts).
 */
export interface PersonPatch {
  active?: boolean;
  sectionRank?: number | null;
  playingAbility?: string | null;
  rankUpdatedAt?: string;
  optInOnly?: boolean;
  status?: string;
  applicantStage?: string;
  joinDate?: string;
  commitmentEndDate?: string;
  membershipNo?: string;
}

// ── Row views for the membership, chairman, contacts, stats and My Tasks reads ──
//
// Each list is the exact set of api_people_crm columns its read selects, and
// the keys module code reads. Reads for the membership and chairman sections
// never select an HKID, bank or address column.

/** The applicant board and Insights (membership.ts). */
export type MembershipRow = Row<typeof MEMBERSHIP_FIELDS>;

/** The active-members export. */
export const EXPORT_FIELDS = ["membershipNo", "surname", "givenNames", "status", "applicantStage"] as const;
export type ExportRow = Row<typeof EXPORT_FIELDS>;

/** Who else holds a Membership No. */
export const NUMBER_HOLDER_FIELDS = ["membershipNo", "preferredName", "givenNames", "surname", "status"] as const;
export type NumberHolderRow = Row<typeof NUMBER_HOLDER_FIELDS>;

export const APPLICANT_STAGE_FIELDS = ["applicantStage"] as const;
export type ApplicantStageRow = Row<typeof APPLICANT_STAGE_FIELDS>;

/** The chairman's email-list directory (chairman.ts). */
export type DirectoryRow = Row<typeof CHAIRMAN_FIELDS>;

/** What a WhatsApp shortcut needs (contacts.ts). */
export const CONTACT_FIELDS = ["preferredName", "givenNames", "surname", "mobileNo", "photo", "status"] as const;
export type ContactRow = Row<typeof CONTACT_FIELDS>;

/**
 * Everyone's name, for the Stats page (clubStats.ts). The date of birth is
 * only to tell a father from a son who share a name; not stored.
 */
export const NAME_FIELDS = ["preferredName", "givenNames", "surname", "dateOfBirth"] as const;
export type NameRow = Row<typeof NAME_FIELDS>;

/** The signed-in person's own forms, for My Tasks (myTasks.ts). */
export const MY_TASK_FIELDS = ["waiversSubmittedAt"] as const;
export type MyTaskRow = Row<typeof MY_TASK_FIELDS>;

/** Applicants in the New Joiner process, by stage (myTasks.ts). `stage` is the applicantStage column. */
export const APPLICANT_TASK_FIELDS = ["stage"] as const;
export type ApplicantTaskRow = Row<typeof APPLICANT_TASK_FIELDS>;

export interface PeopleRepo {
  /** Every person with Active ticked. */
  listActive(): Promise<Player[]>;
  /**
   * The person whose Email matches, case-insensitively on both sides. Where
   * several share it, an Active record wins over an inactive one.
   */
  findByEmail(email: string): Promise<Player | null>;
  getById(id: string): Promise<Player | null>;
  /**
   * Everyone in the Section Ranking: Active players and Applicants, less
   * anyone Rejected or Resigned. Unsorted.
   */
  listRankingPool(): Promise<Player[]>;
  /** Inactive members who could be brought back into the ranking. Unsorted. */
  listInactiveRankable(): Promise<Player[]>;
  update(id: string, patch: PersonPatch): Promise<void>;
  /** Several people at once, in order. */
  updateMany(updates: { id: string; patch: PersonPatch }[]): Promise<void>;

  /**
   * Everyone who has ever had an Applicant Stage and has not resigned. A
   * superset: belongsOnBoard and the insight facts are the rules.
   */
  listMembershipBoard(): Promise<MembershipRow[]>;
  /** Active people, less (most) Temporary players. The caller re-checks the stage. */
  listActiveForExport(): Promise<ExportRow[]>;
  /** People whose Membership No. matches (a superset; the caller compares exactly). */
  listByMembershipNo(membershipNo: string): Promise<NumberHolderRow[]>;
  /** One person's Applicant Stage, read fresh; null when there is no such person. */
  getApplicantStage(id: string): Promise<ApplicantStageRow | null>;
  /** Everyone not Resigned (a superset; the caller re-checks). */
  listDirectory(): Promise<DirectoryRow[]>;
  /**
   * Contact details for the given ids. Anything that is not a row id is
   * ignored; each person comes back once, in no particular order.
   */
  listContactsByIds(ids: Iterable<string>): Promise<ContactRow[]>;
  /** Everyone in People, with their names. */
  listNames(): Promise<NameRow[]>;
  /** The person's own-forms fields; null when there is no such person. */
  getMyTaskFields(id: string): Promise<MyTaskRow | null>;
  /** Applicants at any of the given Applicant Stage values. */
  listApplicantsAtStages(stages: readonly string[]): Promise<ApplicantTaskRow[]>;
}

export function people(env: Env): PeopleRepo {
  return supabasePeople(env);
}
