/**
 * Writing to an office holder, and writing as one: the rules every module
 * that emails an officer shares.
 *
 *  - An office is written to at its own mailbox (offices.office_email, e.g.
 *    mensmembership@hkfchockey.com) when it has one, else at its holder's
 *    own email (owner, PR #133).
 *  - An officer's email goes out from their office's mailbox when that is on
 *    hkfchockey.com (the domain verified in Resend), else from
 *    REVIEW_EMAIL_FROM.
 *
 * A module that already reads offices inside a bigger select keeps its read
 * and uses contactOf / officeAddress / senderFor on what it got.
 */
import type { Env } from "./env";
import { db, eq } from "./data/supabase";
import { firstName, fullName } from "../../shared/personName";

/** An office's holder, as OFFICE_HOLDER_SELECT reads them. */
export interface OfficeHolderPerson {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  email: string | null;
}

/** One office row with its holder. */
export interface OfficeHolderRow {
  id: string;
  role: string;
  designation: string | null;
  office_email: string | null;
  person_id: string | null;
  people: OfficeHolderPerson | null;
}

export const OFFICE_HOLDER_SELECT =
  "select=id,role,designation,office_email,person_id,people!offices_person_id_fkey(id,api_id,preferred_name,given_names,surname,email)";

/** The least contactOf needs, so other modules' office selects fit it too. */
export interface OfficeLike {
  office_email: string | null;
  people: {
    id?: string;
    api_id?: string;
    preferred_name: string | null;
    given_names: string | null;
    surname?: string | null;
    email: string | null;
  } | null;
}

export interface OfficeContact {
  /** "Preferred Surname"; null without any name. */
  name: string | null;
  firstName: string | null;
  /** Where to write: the office's mailbox, else the holder's email; null when neither. */
  email: string | null;
  /** The holder's people.id and api_id. */
  personId: string | null;
  apiId: string | null;
}

/** Where an office is written to: its own mailbox, else its holder's email. */
export const officeAddress = (officeEmail: string | null | undefined, personalEmail: string | null | undefined): string | null =>
  officeEmail || personalEmail || null;

export function contactOf(row: OfficeLike | null | undefined): OfficeContact {
  const p = row?.people ?? null;
  return {
    name: fullName(p) || null,
    firstName: firstName(p) || null,
    email: officeAddress(row?.office_email, p?.email),
    personId: p?.id ?? null,
    apiId: p?.api_id ?? null,
  };
}

/**
 * The Active holders of an office (every Active office without a role),
 * oldest first. One read.
 */
export function activeOfficeHolders(env: Env, role?: string): Promise<OfficeHolderRow[]> {
  return db(env).select<OfficeHolderRow>(
    "offices",
    `${OFFICE_HOLDER_SELECT}${role ? `&role=${eq(role)}` : ""}&status=eq.Active&order=created_at,id`,
  );
}

/** The Active holder of a one-holder office, as a contact; null when nobody holds it. One read. */
export async function officeContact(env: Env, role: string): Promise<OfficeContact | null> {
  const rows = await activeOfficeHolders(env, role);
  const row = rows.find((r) => r.people) ?? rows[0];
  return row ? contactOf(row) : null;
}

/**
 * The From for an officer's email: their office's mailbox in their name when
 * it is on hkfchockey.com, else REVIEW_EMAIL_FROM (undefined: the mailer's
 * MAIL_FROM).
 */
export function senderFor(env: Pick<Env, "REVIEW_EMAIL_FROM">, name: string, officeEmail: string | null | undefined): string | undefined {
  return officeEmail?.endsWith("@hkfchockey.com") ? `${name} <${officeEmail}>` : env.REVIEW_EMAIL_FROM || undefined;
}
