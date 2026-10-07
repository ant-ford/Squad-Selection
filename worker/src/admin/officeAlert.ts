/**
 * An email to the owner (SYSTEM_ALERT_EMAIL) when an office change on /club
 * deserves a second look. Section Captains are trusted to grant any office
 * to anyone; the owner just hears about the sensitive ones (owner, 7 Oct
 * 2026, from the security review in PR #285):
 *
 *  - someone gives an office to themselves (a new holder, or their own
 *    retired office made Active again), or
 *  - an office in SENSITIVE_OFFICE_ROLES is granted or ended, whoever holds it.
 *
 * Names only: who did it, to whom, which office, granted or ended, when (HK
 * time), and a link to /club. It goes after the save, in the background, so
 * a slow or failed email never slows or fails the save. sendEmail keeps to
 * the daily cap and logs it in email_log; preview redirects it.
 *
 * Team roles saved on /club (admin_save_team) are only coaches and captains:
 * a team's Section Captain link can't be granted there, so team saves send
 * nothing.
 */
import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { db, eq, inList } from "../data/supabase";
import { sendEmail } from "../mailer";
import { inBackground } from "../requestContext";
import { displayName } from "../../../shared/adminPeople";
import { fieldLabel, matchWhen } from "../../../shared/history";

/**
 * Offices that open personal data (membership records, the Chairman's
 * records, People, registration and discipline): granting or ending one
 * always alerts. Database roles (offices.role).
 */
export const SENSITIVE_OFFICE_ROLES: readonly string[] = [
  "hockey_convenor", // Men's Convenor
  "section_captain", // Section Captain
  "membership_officer", // Membership Officer
  "section_chair", // Chairman
];

export interface OfficeChange {
  /** offices.role */
  role: string;
  change: "granted" | "ended";
  /** The holder's People api_id and name. */
  holderId: string;
  holderName: string;
  /** A handover: whose office this one replaced (retired in the same save). */
  replacedName?: string;
}

interface PersonNames {
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
}

/** One office row with its holder, as the alert reads it. */
export interface OfficeHolderRow {
  api_id: string;
  role: string;
  status: "Active" | "Retired";
  person: PersonNames | null;
}

const OFFICE_HOLDER_SELECT = "select=id,api_id,role,status,person:people!offices_person_id_fkey(api_id,preferred_name,given_names,surname)";

/** Whether alerts are on at all (no address, no extra reads). */
const alertsOn = (env: Env): boolean => !!env.SYSTEM_ALERT_EMAIL?.trim();

/** Whether this change alerts. Pure. */
export function shouldAlertOffice(actor: Pick<AuthorizedUser, "personId">, role: string, change: "granted" | "ended", holderId: string): boolean {
  return SENSITIVE_OFFICE_ROLES.includes(role) || (change === "granted" && holderId === actor.personId);
}

function actorName(actor: AuthorizedUser): string {
  const p = actor.person;
  return p ? displayName({ preferred_name: p.preferredName, given_names: p.givenNames, surname: p.surname }) : actor.personId;
}

/** The email. Pure. */
export function officeAlertEmail(actor: string, self: boolean, c: OfficeChange, at: Date, appOrigin: string): { subject: string; text: string } {
  const office = fieldLabel(c.role);
  const who = self ? "themselves" : c.holderName;
  const line =
    c.change === "granted"
      ? `${actor} made ${who} ${office}${c.replacedName ? `, taking over from ${c.replacedName}` : ""}.`
      : `${actor} retired ${who} as ${office}.`;
  return {
    subject: self && c.change === "granted" ? `Eddy: ${actor} made themselves ${office}` : `Eddy: ${office} ${c.change}`,
    text: [line, `${matchWhen(at.toISOString())}, Hong Kong time`, "", `${appOrigin.replace(/\/+$/, "")}/club`].join("\n"),
  };
}

async function send(env: Env, actor: AuthorizedUser, c: OfficeChange, at: Date): Promise<void> {
  const self = c.holderId === actor.personId;
  const { subject, text } = officeAlertEmail(actorName(actor), self, c, at, env.APP_ORIGIN ?? "https://app.eddy.global");
  await sendEmail(env, {
    // email_log's to_person_id is nullable: the owner isn't looked up, to keep the save's outside calls down.
    toPersonId: null as unknown as string,
    to: env.SYSTEM_ALERT_EMAIL!.trim(),
    subject,
    text,
    template: "office-change-alert",
  });
}

/**
 * After a new holder is saved: alerts when the office is sensitive or they
 * gave it to themselves. Reads the names (new row and any replaced one) only
 * then. Never throws.
 */
export function alertNewOffice(env: Env, actor: AuthorizedUser, p: { role: string; person: string; replaces?: string }, newId: string): Promise<void> {
  if (!alertsOn(env) || !shouldAlertOffice(actor, p.role, "granted", p.person)) return Promise.resolve();
  const at = new Date();
  return inBackground(async () => {
    const ids = [newId, ...(p.replaces ? [p.replaces] : [])];
    const rows = await db(env).select<OfficeHolderRow>("offices", `${OFFICE_HOLDER_SELECT}&api_id=${inList(ids)}`);
    const name = (id: string) => {
      const person = rows.find((r) => r.api_id === id)?.person;
      return person ? displayName(person) : undefined;
    };
    await send(env, actor, {
      role: p.role,
      change: "granted",
      holderId: p.person,
      holderName: name(newId) ?? "(no name)",
      replacedName: p.replaces ? name(p.replaces) : undefined,
    }, at);
  });
}

/**
 * Before a status edit: the office row as it is, when alerts are on. One
 * read; a failed read means no alert, never a failed save.
 */
export async function officeBeforeStatusChange(env: Env, officeId: string): Promise<OfficeHolderRow | undefined> {
  if (!alertsOn(env)) return undefined;
  try {
    const [row] = await db(env).select<OfficeHolderRow>("offices", `${OFFICE_HOLDER_SELECT}&api_id=${eq(officeId)}&limit=1`);
    return row;
  } catch (err) {
    console.error("Office alert: office not read:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * After an office's status changed (before = the row read just before the
 * save): Retired is ended, Active again is granted. Never throws.
 */
export function alertStatusChange(env: Env, actor: AuthorizedUser, before: OfficeHolderRow, status: "Active" | "Retired"): Promise<void> {
  if (!before.person || before.status === status) return Promise.resolve();
  const change = status === "Retired" ? "ended" : "granted";
  if (!shouldAlertOffice(actor, before.role, change, before.person.api_id)) return Promise.resolve();
  const at = new Date();
  const holder = before.person;
  return inBackground(() => send(env, actor, { role: before.role, change, holderId: holder.api_id, holderName: displayName(holder) }, at));
}
