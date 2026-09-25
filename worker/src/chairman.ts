/**
 * The chairman's section: the directory behind the email lists, and the
 * record of every list taken out of the app.
 *
 * The whole directory is sent once and the app filters it, so building a
 * list is instant and costs no request per click. It is still only names,
 * group values and email addresses: reads pass CHAIRMAN_FIELDS, so no HKID,
 * bank or home-address field is ever requested.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { airtableFindAll } from "./airtable";
import { getShared } from "./cache";
import { HttpError } from "./http";
import { CHAIRMAN_DIRECTORY_KEY } from "./reference";
import { MEMBERSHIP_EVENTS_FIELDS, recordMembershipEvent } from "./membership";
import { TABLES } from "../../shared/schema/tableNames";
import { CHAIRMAN_FIELDS as F } from "../../shared/schema/fieldMaps";
import { GROUPS, type DirectoryPerson, type EmailSource } from "../../shared/emailLists";

/** Five minutes, and dropped at once by the webhook on any People edit. */
const DIRECTORY_TTL_MS = 5 * 60 * 1000;

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : text(v) ? [text(v)!] : [];

/** Loose on purpose: it only has to keep obvious junk ("n/a", "-") out of a Bcc line. */
const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
const cleanEmail = (v: unknown) => {
  const e = text(v);
  return e && EMAIL_RE.test(e) ? e : undefined;
};

/**
 * The addresses to write to (owner decision, 2026-09-25): always the
 * person's own Email, and for an under-18 the guardian's as well. Office,
 * spouse and "preferred channel" addresses are deliberately not used.
 */
export function resolveEmails(fields: Record<string, unknown>): {
  emails: string[];
  emailSource: EmailSource;
  under18: boolean;
} {
  const age = typeof fields[F.age] === "number" ? (fields[F.age] as number) : undefined;
  const under18 = age !== undefined && age < 18;
  const own = cleanEmail(fields[F.email]);
  const guardian = under18 ? cleanEmail(fields[F.guardianEmail]) : undefined;
  const emails = [own, guardian].filter((e): e is string => !!e);
  // A guardian who is also the junior's listed Email is one address, not
  // two; the junior's own spelling is the one kept.
  const unique = emails.filter((e, i) => emails.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
  const emailSource: EmailSource =
    own && guardian && unique.length === 2 ? "own-and-guardian" : own ? "own" : guardian ? "guardian" : "none";
  return { emails: unique, emailSource, under18 };
}

/** Group key -> the field its values come from (the computed ones are below). */
const GROUP_FIELD: Record<string, string> = {
  status: F.status,
  memberType: F.memberType,
  category: F.categoryType,
  playerCoach: F.playerCoach,
  ageBand: F.ageBand,
  hockeyCommittee: F.hockeyCommittee,
  subCommittee: F.subCommittee,
  teamRoles: F.teamRoles,
  touringCommittee: F.touringCommittee,
  juniorVolunteers: F.juniorVolunteers,
  easter5s: F.easter5s,
  generalVolunteers: F.generalVolunteers,
  tourInterest: F.tourInterest,
  tournamentInterest: F.tournamentInterest,
  qualifiedUmpire: F.qualifiedUmpire,
  qualifiedCoach: F.qualifiedCoach,
  captaincyInterest: F.captaincyInterest,
};

export function toDirectoryPerson(record: any): DirectoryPerson {
  const f = record.fields ?? {};
  const values: Record<string, string[]> = {};
  for (const g of GROUPS) {
    let raw: string[];
    if (g.key === "active") raw = [f[F.active] === true ? "Active player" : "Not an active player"];
    // The team the app shows them in: Selected Team EOS -> SOS -> Registered.
    else if (g.key === "team") raw = list(text(f[F.selectedTeamEos]) ?? text(f[F.selectedTeamSos]) ?? text(f[F.registeredTeam]));
    else raw = list(f[GROUP_FIELD[g.key]]);
    const kept = raw.filter((v) => !(g.ignore ?? []).includes(v));
    if (kept.length) values[g.key] = kept;
  }
  const first = text(f[F.preferredName]) ?? text(f[F.givenNames]);
  const surname = text(f[F.surname]) ?? "";
  return {
    id: record.id,
    name: [first, surname].filter(Boolean).join(" ") || "Unnamed",
    surname,
    membershipNo: text(f[F.membershipNo]),
    values,
    ...resolveEmails(f),
  };
}

export interface ChairmanDirectory {
  people: DirectoryPerson[];
  generatedAt: string;
}

/** Everyone who has not resigned: members, applicants and Temporary players. */
export async function getChairmanDirectory(env: Env): Promise<ChairmanDirectory> {
  return getShared<ChairmanDirectory>(
    env,
    CHAIRMAN_DIRECTORY_KEY,
    async () => {
      const records = await airtableFindAll(env, TABLES.player, `{${F.status}}!="Resigned"`, undefined, Object.values(F));
      return {
        people: records
          .filter((r) => text(r.fields?.[F.status]) !== "Resigned")
          .map(toDirectoryPerson),
        generatedAt: new Date().toISOString(),
      };
    },
    DIRECTORY_TTL_MS,
  );
}

export interface EmailExportInput {
  kind: "outlook" | "gmail" | "csv" | "mailto";
  people: number;
  addresses: number;
  /** describeSelection() of the list, plus any hand-made changes. */
  description: string;
}

const KIND_LABEL: Record<EmailExportInput["kind"], string> = {
  outlook: "copied for Outlook",
  gmail: "copied for Gmail",
  csv: "downloaded as CSV",
  mailto: "opened in the mail app",
};

/**
 * Records that a list left the app. Reported by the page when the chairman
 * copies or downloads it; the addresses themselves are never logged, only
 * how many and which groups.
 */
export async function logEmailExport(env: Env, actor: AuthorizedUser, input: EmailExportInput) {
  if (!(input.kind in KIND_LABEL)) throw new HttpError("Unknown export.", 400, "INVALID_INPUT");
  const count = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0);
  const description = typeof input.description === "string" ? input.description.slice(0, 800) : "";
  await recordMembershipEvent(env, actor, {
    [MEMBERSHIP_EVENTS_FIELDS.eventType]: "Exported",
    [MEMBERSHIP_EVENTS_FIELDS.notes]:
      `Email list ${KIND_LABEL[input.kind]}: ${count(input.addresses)} addresses, ${count(input.people)} people. ${description}`.trim(),
  });
  return { success: true };
}
