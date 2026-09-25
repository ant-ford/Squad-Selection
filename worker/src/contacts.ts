/**
 * Names, mobiles and photos for the membership boards' WhatsApp shortcuts:
 * the applicant or member on a card, and whoever the card is waiting on
 * (their sponsor, the chairman or the membership officer who signs).
 *
 * People reads here ask for CONTACT_FIELDS only and name the records by
 * id, so a board refresh never scans People for them. Both boards fold the
 * result into their own cached read (membership.ts, statements.ts).
 */
import type { Env } from "./env";
import { airtableFindAll } from "./airtable";
import { TABLES } from "../../shared/schema/tableNames";
import { OFFICER_FIELDS } from "../../shared/schema/fieldMaps";

export interface Contact {
  name: string;
  firstName: string;
  mobile?: string;
  photo?: string;
  status?: string;
}

const CONTACT_FIELDS = ["Preferred Name", "Given Name(s)", "Surname", "Mobile No.", "Photo", "Status"] as const;

/** Record ids per request: keeps the filter formula well inside URL limits. */
const IDS_PER_READ = 40;

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export const ID_RE = /^rec[A-Za-z0-9]{14}$/;

/** People by record id, reading only what a WhatsApp shortcut needs. */
export async function getPeopleByIds(env: Env, ids: Iterable<string>): Promise<Record<string, Contact>> {
  const wanted = [...new Set([...ids].filter((id) => ID_RE.test(id)))];
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += IDS_PER_READ) chunks.push(wanted.slice(i, i + IDS_PER_READ));
  const pages = await Promise.all(
    chunks.map((chunk) =>
      airtableFindAll(
        env,
        TABLES.player,
        `OR(${chunk.map((id) => `RECORD_ID()="${id}"`).join(",")})`,
        undefined,
        CONTACT_FIELDS,
      ),
    ),
  );
  const out: Record<string, Contact> = {};
  for (const record of pages.flat()) {
    if (!wanted.includes(record.id)) continue;
    const f = record.fields ?? {};
    const first = text(f["Preferred Name"]) ?? text(f["Given Name(s)"]) ?? "";
    const photo = Array.isArray(f.Photo) ? f.Photo.find((a: any) => a && typeof a.url === "string")?.url : undefined;
    out[record.id] = {
      name: [first, text(f.Surname)].filter(Boolean).join(" ") || "Unnamed",
      firstName: first,
      mobile: text(f["Mobile No."]),
      photo,
      status: text(f.Status),
    };
  }
  return out;
}

/**
 * Office row id -> the People record holding it, for the Sponsors, Section
 * Chairs and Membership Officers tables. Every status counts: an
 * application waiting on a sponsor who has since retired still names them.
 */
export async function getOfficeHolders(env: Env): Promise<Record<string, string>> {
  const tables = [TABLES.sponsor, TABLES.sectionChair, TABLES.membershipOfficer];
  const rows = await Promise.all(
    tables.map((table) => airtableFindAll(env, table, undefined, undefined, [OFFICER_FIELDS.member])),
  );
  const out: Record<string, string> = {};
  for (const record of rows.flat()) {
    const member = record.fields?.[OFFICER_FIELDS.member];
    const first = Array.isArray(member) ? member.find((id) => typeof id === "string") : undefined;
    if (first) out[record.id] = first;
  }
  return out;
}

/** The first linked record id in a link field, if any. */
export const firstLink = (v: unknown): string | undefined =>
  Array.isArray(v) ? v.find((x): x is string => typeof x === "string") : undefined;
