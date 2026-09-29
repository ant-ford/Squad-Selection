import { airtableFindAll } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { TABLES } from "../../../shared/schema/tableNames";
import { OFFICER_FIELDS } from "../../../shared/schema/fieldMaps";

/**
 * The three office tables. A "sectionCaptain" row is in the Section Captains
 * TABLE, which is not the Teams.Section Captain link (see reference.ts).
 */
export type Office = "membershipOfficer" | "sectionChair" | "sectionCaptain";

export const OFFICE_TABLES: Record<Office, string> = {
  membershipOfficer: TABLES.membershipOfficer,
  sectionChair: TABLES.sectionChair,
  sectionCaptain: TABLES.sectionCaptainOffice,
};

/** One office row: who holds it (People ids) and its Designation. */
export interface OfficeRow {
  office: Office;
  /** Empty when the row has none. */
  designation: string;
  memberIds: string[];
}

export interface OfficersRepo {
  /** Active rows of the given offices, in the order the offices are given. */
  listActive(offices: readonly Office[]): Promise<OfficeRow[]>;
}

function toRow(office: Office, record: any): OfficeRow {
  const designation = record.fields?.[OFFICER_FIELDS.designation];
  const member = record.fields?.[OFFICER_FIELDS.member];
  return {
    office,
    designation: typeof designation === "string" ? designation : "",
    memberIds: (Array.isArray(member) ? member : []).filter((id: unknown): id is string => typeof id === "string"),
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
      return offices.flatMap((office, i) => tables[i].map((record) => toRow(office, record)));
    },
  };
}

export function officers(env: Env): OfficersRepo {
  return pick(env, "officers", airtableOfficers);
}
