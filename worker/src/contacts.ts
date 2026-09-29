/**
 * Names, mobiles and photos for the membership boards' WhatsApp shortcuts:
 * the applicant or member on a card, and whoever the card is waiting on
 * (their sponsor, the chairman or the membership officer who signs).
 *
 * People reads here ask for the contact fields only and name the records by
 * id (data/people.ts), so a board refresh never scans People for them. Both
 * boards fold the result into their own cached read (membership.ts,
 * statements.ts).
 */
import type { Env } from "./env";
import { people } from "./data/people";
import { officers } from "./data/officers";

export interface Contact {
  name: string;
  firstName: string;
  mobile?: string;
  photo?: string;
  status?: string;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export { ID_RE } from "./data/people";

/** People by record id, reading only what a WhatsApp shortcut needs. */
export async function getPeopleByIds(env: Env, ids: Iterable<string>): Promise<Record<string, Contact>> {
  const rows = await people(env).listContactsByIds(ids);
  const out: Record<string, Contact> = {};
  for (const row of rows) {
    const first = text(row.preferredName) ?? text(row.givenNames) ?? "";
    const photo = Array.isArray(row.photo) ? row.photo.find((a: any) => a && typeof a.url === "string")?.url : undefined;
    out[row.id] = {
      name: [first, text(row.surname)].filter(Boolean).join(" ") || "Unnamed",
      firstName: first,
      mobile: text(row.mobileNo),
      photo,
      status: text(row.status),
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
  const rows = await officers(env).listAllMembers(["sponsor", "sectionChair", "membershipOfficer"]);
  const out: Record<string, string> = {};
  for (const row of rows) {
    const first = row.memberIds[0];
    if (first) out[row.id] = first;
  }
  return out;
}

/** The first linked record id in a link field, if any. */
export const firstLink = (v: unknown): string | undefined =>
  Array.isArray(v) ? v.find((x): x is string => typeof x === "string") : undefined;
