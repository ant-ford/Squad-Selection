/**
 * The chairman's section: the directory behind the email lists, and the
 * record of every list taken out of the app.
 *
 * The whole directory is sent once and the app filters it, so building a
 * list is instant and costs no request per click. It is still only names,
 * group values and email addresses: reads pass CHAIRMAN_FIELDS (through
 * data/people.ts), so no HKID, bank or home-address field is ever requested.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { getShared } from "./cache";
import { HttpError } from "./http";
import { CHAIRMAN_DIRECTORY_KEY } from "./reference";
import { recordMembershipEvent } from "./membership";
import { people, type DirectoryRow } from "./data/people";
import { GROUPS, type DirectoryPerson, type EmailSource } from "../../shared/emailLists";

/** Five minutes, and dropped at once by any People write (invalidation.ts). */
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
export function resolveEmails(row: { age?: unknown; email?: unknown; guardianEmail?: unknown; [other: string]: unknown }): {
  emails: string[];
  emailSource: EmailSource;
  under18: boolean;
} {
  const age = typeof row.age === "number" ? row.age : undefined;
  const under18 = age !== undefined && age < 18;
  const own = cleanEmail(row.email);
  const guardian = under18 ? cleanEmail(row.guardianEmail) : undefined;
  const emails = [own, guardian].filter((e): e is string => !!e);
  // A guardian who is also the junior's listed Email is one address, not
  // two; the junior's own spelling is the one kept.
  const unique = emails.filter((e, i) => emails.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
  const emailSource: EmailSource =
    own && guardian && unique.length === 2 ? "own-and-guardian" : own ? "own" : guardian ? "guardian" : "none";
  return { emails: unique, emailSource, under18 };
}

/** Group key -> the directory column its values come from (the computed ones are below). */
const GROUP_FIELD: Record<string, keyof DirectoryRow> = {
  status: "status",
  memberType: "memberType",
  category: "categoryType",
  playerCoach: "playerCoach",
  ageBand: "ageBand",
  hockeyCommittee: "hockeyCommittee",
  subCommittee: "subCommittee",
  teamRoles: "teamRoles",
  touringCommittee: "touringCommittee",
  juniorVolunteers: "juniorVolunteers",
  easter5s: "easter5s",
  generalVolunteers: "generalVolunteers",
  tourInterest: "tourInterest",
  tournamentInterest: "tournamentInterest",
  qualifiedUmpire: "qualifiedUmpire",
  qualifiedCoach: "qualifiedCoach",
  captaincyInterest: "captaincyInterest",
};

export function toDirectoryPerson(row: DirectoryRow): DirectoryPerson {
  const values: Record<string, string[]> = {};
  for (const g of GROUPS) {
    let raw: string[];
    if (g.key === "active") raw = [row.active === true ? "Active player" : "Not an active player"];
    // The team the app shows them in: Selected Team EOS -> SOS -> Registered.
    else if (g.key === "team") raw = list(text(row.selectedTeamEos) ?? text(row.selectedTeamSos) ?? text(row.registeredTeam));
    else raw = list(row[GROUP_FIELD[g.key]]);
    const kept = raw.filter((v) => !(g.ignore ?? []).includes(v));
    if (kept.length) values[g.key] = kept;
  }
  const first = text(row.preferredName) ?? text(row.givenNames);
  const surname = text(row.surname) ?? "";
  return {
    id: row.id,
    name: [first, surname].filter(Boolean).join(" ") || "Unnamed",
    surname,
    membershipNo: text(row.membershipNo),
    mobile: text(row.mobileNo),
    firstName: first,
    values,
    ...resolveEmails(row),
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
      const rows = await people(env).listDirectory();
      return {
        people: rows
          .filter((r) => text(r.status) !== "Resigned")
          .map(toDirectoryPerson),
        generatedAt: new Date().toISOString(),
      };
    },
    DIRECTORY_TTL_MS,
  );
}

/**
 * One person's directory entry, read on its own (~1 KB): what the events
 * checks need to know whether the viewer is invited, without the whole
 * directory (~200 KB). Null when there's no such person, or they resigned.
 */
export async function getDirectoryPerson(env: Env, personId: string): Promise<DirectoryPerson | null> {
  if (!personId) return null;
  const row = await people(env).getDirectoryRow(personId);
  return row && text(row.status) !== "Resigned" ? toDirectoryPerson(row) : null;
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
    eventType: "Exported",
    notes:
      `Email list ${KIND_LABEL[input.kind]}: ${count(input.addresses)} addresses, ${count(input.people)} people. ${description}`.trim(),
  });
  return { success: true };
}
