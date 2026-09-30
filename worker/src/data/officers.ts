import { airtableFindAll } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { supabaseOfficers } from "./supabase/squad";
import { TABLES } from "../../../shared/schema/tableNames";
import { OFFICER_FIELDS } from "../../../shared/schema/fieldMaps";

/**
 * The office tables. A "sectionCaptain" row is in the Section Captains
 * TABLE, which is not the Teams.Section Captain link (see reference.ts).
 * Sponsors share the shape; a sponsor row names who signs an application
 * (contacts.ts) and grants no section access.
 */
export type Office = "membershipOfficer" | "sectionChair" | "sectionCaptain" | "sponsor" | "kitConvenor";

export const OFFICE_TABLES: Record<Office, string> = {
  membershipOfficer: TABLES.membershipOfficer,
  sectionChair: TABLES.sectionChair,
  sectionCaptain: TABLES.sectionCaptainOffice,
  sponsor: TABLES.sponsor,
  // Read on the Supabase backend only (reference.ts getOfficerLinks): the kit
  // screens don't exist on Airtable.
  kitConvenor: "Kit Convenor",
};

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

const linkIds = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((id: unknown): id is string => typeof id === "string");

function toOfficeRow(office: Office, record: any): OfficeRow {
  const designation = record.fields?.[OFFICER_FIELDS.designation];
  const member = record.fields?.[OFFICER_FIELDS.member];
  return {
    office,
    designation: typeof designation === "string" ? designation : "",
    memberIds: linkIds(member),
  };
}

function airtableOfficers(env: Env): OfficersRepo {
  return {
    async listActive(offices) {
      const tables = await Promise.all(
        offices.map((office) =>
          airtableFindAll(env, OFFICE_TABLES[office], `{${OFFICER_FIELDS.status}}="Active"`),
        ),
      );
      return offices.flatMap((office, i) => tables[i].map((record) => toOfficeRow(office, record)));
    },

    async listAllMembers(offices) {
      const tables = await Promise.all(
        offices.map((office) => airtableFindAll(env, OFFICE_TABLES[office], undefined, undefined, [OFFICER_FIELDS.member])),
      );
      return offices.flatMap((office, i) =>
        tables[i].map((record) => ({ id: record.id, office, memberIds: linkIds(record.fields?.[OFFICER_FIELDS.member]) })),
      );
    },
  };
}

export function officers(env: Env): OfficersRepo {
  return pick(env, "officers", airtableOfficers, supabaseOfficers);
}
