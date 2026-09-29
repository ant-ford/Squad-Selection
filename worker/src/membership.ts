/**
 * The membership section: the applicant board, the active-members export and
 * the one write the section makes, approving an applicant.
 *
 * Every read here goes through the People repository's membership views
 * (data/people.ts), which request MEMBERSHIP_FIELDS or a subset explicitly,
 * so the squad app's People projection (PEOPLE_FIELDS) never grows for
 * membership's sake, and no HKID, bank or address field is ever requested.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { getShared } from "./cache";
import { MEMBERSHIP_RECORDS_KEY, getReferenceData } from "./reference";
import { firstLink, getOfficeHolders, getPeopleByIds } from "./contacts";
import { people, type MembershipRow } from "./data/people";
import { membershipEvents, type NewMembershipEvent } from "./data/membershipEvents";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import type { InsightFact, TeamSquad } from "../../shared/membershipInsights";
import { HttpError } from "./http";
import { invalidateForTables } from "./airtableWebhook";
import { TABLES } from "../../shared/schema/tableNames";
import { hkDateKey } from "../../shared/hkDateKey";
import { toCsv } from "../../shared/csv";
import { birthdayAtAge } from "../../shared/birthday";
import {
  ACCEPTED_STAGE,
  APPROVABLE_STAGE,
  NEEDS_FIXING,
  PARKED_STAGES,
  PIPELINE_STAGES,
  columnFor,
  waitingOn,
  type BoardColumn,
} from "../../shared/membershipStages";

/**
 * Short and fixed, not webhook-extended like the raw squad reads: the records
 * carry Airtable attachment URLs (photo, application form), which Airtable
 * expires after a couple of hours. The webhook still drops the entry the
 * moment People changes.
 */
const RECORDS_TTL_MS = 5 * 60 * 1000;

/** Accepted and parked applicants stay on the board this long. */
const RECENT_DAYS = 365;

export interface Attachment {
  url: string;
  filename: string;
}

/**
 * Whoever a card is waiting on, for its WhatsApp shortcut: the applicant's
 * sponsor, the chairman or the membership officer who signs next.
 */
export interface Chase {
  role: "Sponsor" | "Chairman" | "Membership Officer";
  name: string;
  firstName: string;
  mobile?: string;
}

/** The stages waiting on a signature, and the People link naming who signs. */
const CHASE_BY_STAGE: Record<string, [Chase["role"], keyof MembershipRow]> = {
  "3. Club Application (Signed)": ["Sponsor", "sponsoredBySponsor"],
  "4. Sponsor (Signed)": ["Chairman", "sponsoredByChair"],
  "5. Chairman (Signed)": ["Membership Officer", "sponsoredByOfficer"],
};

export interface ApplicantCard {
  id: string;
  name: string;
  surname: string;
  givenNames: string;
  photo?: string;
  stage: string;
  column: BoardColumn;
  status: string;
  membershipNo?: string;
  joinDate?: string;
  commitmentEndDate?: string;
  /** Hong Kong calendar day the application was created. */
  appliedOn?: string;
  /** Hong Kong calendar day the stage last changed, when the base records it. */
  stageSince?: string;
  /** Days in the current stage, or since applying when the stage date is unknown. */
  days: number | null;
  waitingOn: string | null;
  canApprove: boolean;
  mobileNo?: string;
  applicantType?: string;
  categoryType?: string;
  gender?: string;
  playingPosition?: string;
  team?: string;
  sponsor?: string;
  sportsBackground?: string;
  personalInterest?: string;
  tourInterest: string[];
  qualifiedUmpire?: string;
  qualifiedCoach?: string;
  playingLevel: string[];
  selectionComments?: string;
  applicationForm: Attachment[];
  /** Whoever the application is waiting on, when the record links them. */
  chase?: Chase;
  /**
   * The applicant's 28th birthday, which Approve offers as the Commitment
   * End Date for anyone younger. Only on cards that can be approved, so the
   * board does not spread everyone's age about.
   */
  turns28On?: string;
}

export interface MembershipBoard {
  columns: { pipeline: readonly string[]; parked: readonly string[] };
  cards: ApplicantCard[];
  /** False until the base has a Stage Updated At field (see fieldMaps.ts). */
  hasStageDates: boolean;
  generatedAt: string;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** A lookup comes back as an array; the board wants its first value. */
const firstText = (v: unknown): string | undefined => (Array.isArray(v) ? text(v[0]) : text(v));

function attachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a.url === "string")
    .map((a) => ({ url: a.url as string, filename: typeof a.filename === "string" ? a.filename : "Attachment" }));
}

/** Whole days from one "YYYY-MM-DD" to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function toCard(row: MembershipRow, today: string): ApplicantCard {
  const stage = text(row.applicantStage) ?? "";
  const column = columnFor(stage);
  const sponsor = firstText(row.sponsorName);
  const applicationDate = text(row.applicationDate);
  const stageUpdatedAt = text(row.stageUpdatedAt);
  const appliedOn = applicationDate ? hkDateKey(row.applicationDate as string) : undefined;
  const stageSince = stageUpdatedAt ? hkDateKey(row.stageUpdatedAt as string) : undefined;
  const since = stageSince ?? appliedOn;
  const givenNames = text(row.givenNames) ?? "";
  const surname = text(row.surname) ?? "";
  const first = text(row.preferredName) ?? givenNames;
  const photo = attachments(row.photo)[0]?.url;
  return {
    id: row.id,
    name: [first, surname].filter(Boolean).join(" ") || "Unnamed",
    surname,
    givenNames,
    photo,
    stage,
    column,
    status: text(row.status) ?? "",
    membershipNo: text(row.membershipNo),
    joinDate: text(row.joinDate),
    commitmentEndDate: text(row.commitmentEndDate),
    appliedOn,
    stageSince,
    days: since ? daysBetween(since, today) : null,
    waitingOn: waitingOn(stage, sponsor),
    canApprove: stage === APPROVABLE_STAGE,
    mobileNo: text(row.mobileNo),
    applicantType: text(row.applicantType),
    categoryType: text(row.categoryType),
    gender: text(row.gender),
    playingPosition: text(row.playingPosition),
    team: text(row.selectedTeamEos) ?? text(row.selectedTeamSos) ?? text(row.registeredTeam),
    sponsor,
    sportsBackground: text(row.sportsBackground),
    personalInterest: text(row.personalInterest),
    tourInterest: list(row.tourInterest),
    qualifiedUmpire: text(row.qualifiedUmpire),
    qualifiedCoach: text(row.qualifiedCoach),
    playingLevel: list(row.playingLevel),
    selectionComments: text(row.selectionComments),
    applicationForm: attachments(row.applicationForm),
    turns28On: stage === APPROVABLE_STAGE ? birthdayAtAge(text(row.dateOfBirth), 28) : undefined,
  };
}

/**
 * Which records belong on the board:
 *  - stages 1-6: always, however old - an application in progress
 *  - Accepted: joined in the last 12 months
 *  - Rejected / Temporary: stage set (or, without a stage date, applied) in
 *    the last 12 months
 *  - any other non-empty stage ("undefined", or a retired Pending / On Hold):
 *    always, as Needs fixing
 * Resigned people and records with no stage (long-standing members) never.
 */
export function belongsOnBoard(card: ApplicantCard, today: string): boolean {
  if (card.status === "Resigned" || !card.stage) return false;
  const recent = (day?: string) => day !== undefined && daysBetween(day, today) <= RECENT_DAYS;
  if (card.column === NEEDS_FIXING) return true;
  if (card.column === ACCEPTED_STAGE) return recent(card.joinDate ?? card.stageSince ?? card.appliedOn);
  if ((PARKED_STAGES as readonly string[]).includes(card.column)) return recent(card.stageSince ?? card.appliedOn);
  return true;
}

interface MembershipRecords {
  rows: MembershipRow[];
  /** Applicant record id -> whoever their application is waiting on. */
  chase: Record<string, Chase>;
}

/**
 * Who each application at a signature stage is waiting on. The applicant
 * links the office row (a Sponsors, Section Chairs or Membership Officers
 * row), which links the holder's People record, which has their mobile.
 */
async function resolveChases(env: Env, rows: MembershipRow[]): Promise<Record<string, Chase>> {
  const waiting = rows.filter((r) => CHASE_BY_STAGE[text(r.applicantStage) ?? ""]);
  if (waiting.length === 0) return {};
  const holders = await getOfficeHolders(env);
  const officeOf = (r: MembershipRow) => {
    const [, link] = CHASE_BY_STAGE[text(r.applicantStage) ?? ""];
    return firstLink(r[link]);
  };
  const contacts = await getPeopleByIds(
    env,
    waiting.map((r) => holders[officeOf(r) ?? ""]).filter((id): id is string => !!id),
  );
  const chase: Record<string, Chase> = {};
  for (const r of waiting) {
    const [role] = CHASE_BY_STAGE[text(r.applicantStage) ?? ""];
    const person = contacts[holders[officeOf(r) ?? ""] ?? ""];
    if (!person) continue;
    chase[r.id] = { role, name: person.name, firstName: person.firstName, mobile: person.mobile };
  }
  return chase;
}

/**
 * Everyone who has ever had an Applicant Stage and has not resigned, and
 * who each application is waiting on. One shared read feeds both the board
 * and Insights, so opening Insights costs no Airtable call of its own.
 */
async function getMembershipRecords(env: Env): Promise<MembershipRecords> {
  return getShared<MembershipRecords>(
    env,
    MEMBERSHIP_RECORDS_KEY,
    async () => {
      // Narrows the scan; belongsOnBoard / the insight facts are the rules.
      const rows = await people(env).listMembershipBoard();
      return { rows, chase: await resolveChases(env, rows) };
    },
    RECORDS_TTL_MS,
  );
}

const hasStageDates = (rows: MembershipRow[]) => rows.some((r) => text(r.stageUpdatedAt) !== undefined);

export async function getMembershipBoard(env: Env): Promise<MembershipBoard> {
  const { rows, chase } = await getMembershipRecords(env);
  const today = hkDateKey(new Date().toISOString());
  const cards = rows
    .map((r) => ({ ...toCard(r, today), chase: chase[r.id] }))
    .filter((c) => belongsOnBoard(c, today))
    // Longest-waiting first within each column.
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.name.localeCompare(b.name));
  return {
    columns: { pipeline: PIPELINE_STAGES, parked: PARKED_STAGES },
    cards,
    hasStageDates: hasStageDates(rows),
    generatedAt: new Date().toISOString(),
  };
}

// ── Insights ────────────────────────────────────────────────────────────

/**
 * One row per applicant, every season, with only what the charts count
 * (no contact details, notes or attachments), plus each team's current
 * roster. The app slices the rows by the period the officer picks, so a new
 * period is instant and costs no request; shared/membershipInsights.ts does
 * the counting.
 */
export interface MembershipInsights {
  facts: InsightFact[];
  teams: TeamSquad[];
  hasStageDates: boolean;
  generatedAt: string;
}

export async function getMembershipInsights(env: Env): Promise<MembershipInsights> {
  const [{ rows }, ref] = await Promise.all([getMembershipRecords(env), getReferenceData(env)]);
  const today = hkDateKey(new Date().toISOString());
  const facts: InsightFact[] = rows.map((r) => {
    const c = toCard(r, today);
    return {
      name: c.name,
      stage: c.stage,
      column: c.column,
      appliedOn: c.appliedOn,
      joinDate: c.joinDate,
      stageSince: c.stageSince,
      days: c.days,
      team: c.team,
      playingPosition: c.playingPosition,
      applicantType: c.applicantType,
      categoryType: c.categoryType,
      gender: c.gender,
      sponsor: c.sponsor,
    };
  });

  const byTeam = new Map<string, TeamSquad>();
  for (const t of ref.teams) {
    if (!t.teamName) continue;
    byTeam.set(t.teamName, {
      team: t.teamName,
      teamRank: t.teamRank ?? 99,
      targetSquadSize: t.targetSquadSize || 16,
      active: 0,
      byPosition: {},
    });
  }
  // ref.players is Active players only. Counted against the team the app
  // shows them in (Selected Team EOS -> SOS -> Registered).
  for (const p of ref.players) {
    const squad = byTeam.get(selectedDisplayTeam(p) || p.registeredTeam || "");
    if (!squad) continue;
    squad.active += 1;
    const position = p.playingPosition || "Not set";
    squad.byPosition[position] = (squad.byPosition[position] ?? 0) + 1;
  }

  return {
    facts,
    teams: [...byTeam.values()].sort((a, b) => a.teamRank - b.teamRank),
    hasStageDates: hasStageDates(rows),
    generatedAt: new Date().toISOString(),
  };
}

// ── Active-members export ───────────────────────────────────────────────

const CSV_HEADER = ["Membership No.", "Surname", "Given Name(s)", "Status"];

// Lives in shared/csv.ts now; re-exported for the export's tests.
export { csvCell } from "../../shared/csv";

/**
 * Every Active person, for the club to confirm membership against. Temporary
 * players (registered with HKFC without the membership process, usually
 * visiting) are left out: the club has no membership for them to confirm.
 */
export async function getActiveMembersCsv(
  env: Env,
  actor: AuthorizedUser,
): Promise<{ filename: string; csv: string; count: number }> {
  const members = await people(env).listActiveForExport();
  const rows = members
    .filter((r) => text(r.applicantStage) !== "Temporary")
    .map((r) => [text(r.membershipNo) ?? "", text(r.surname) ?? "", text(r.givenNames) ?? "", text(r.status) ?? ""])
    .sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
  const csv = toCsv([CSV_HEADER, ...rows]);
  const today = hkDateKey(new Date().toISOString());
  // The file carries every member's name and number and leaves the app, so
  // who took a copy, and when, goes on the record.
  await recordMembershipEvent(env, actor, {
    eventType: "Exported",
    notes: `Active members CSV, ${rows.length} rows`,
  });
  return { filename: `hkfc-hockey-active-members-${today}.csv`, csv, count: rows.length };
}

// ── Membership Events ───────────────────────────────────────────────────

/**
 * Audit table for the section's actions, created in Airtable by the owner:
 *
 *   Id                    autonumber     primary field
 *   Event Type            single select  Approved | Exported | Notified
 *   Person                link (People)  the applicant approved (blank for an export)
 *   Actor                 link (People)  the officer who did it
 *   Actor Email           text           verified session email
 *   Previous Stage        text
 *   New Stage             text
 *   Membership No.        text
 *   Join Date             date
 *   Commitment End Date   date
 *   Shared Membership No. checkbox       approved with a number someone else has
 *   Notes                 long text
 *   Timestamp             date and time  stamped by the Worker
 *
 * The names live in shared/schema now; re-exported here for anything that
 * imported them from this module. data/membershipEvents.ts writes the rows.
 */
export { MEMBERSHIP_EVENTS_TABLE } from "../../shared/schema/tableNames";
export { MEMBERSHIP_EVENTS_FIELDS } from "../../shared/schema/fieldMaps";

/** What a caller says about the action; who did it and when are added here. */
export type MembershipEventInput = Omit<NewMembershipEvent, "actorId" | "actorEmail" | "timestamp">;

/**
 * Writes one audit row, and never fails the action it records. By the time
 * this runs the approval or export has already happened: reporting an error
 * now would invite the officer to repeat something that worked (and a
 * repeated approval is refused, the applicant being Accepted already). So
 * every failure - the table not created yet, a field named differently - is
 * logged loudly with the row it would have written, and swallowed.
 */
export async function recordMembershipEvent(
  env: Env,
  actor: AuthorizedUser,
  input: MembershipEventInput,
): Promise<void> {
  const event: NewMembershipEvent = {
    ...input,
    actorEmail: actor.email,
    timestamp: new Date().toISOString(),
    actorId: actor.personId || undefined,
  };
  try {
    await membershipEvents(env).record(event);
  } catch (err) {
    console.error(
      `[MembershipEvents] audit row not written (${err instanceof Error ? err.message : err}); the action itself succeeded:`,
      JSON.stringify(event),
    );
  }
}

// ── Approve ─────────────────────────────────────────────────────────────

export interface ApproveInput {
  personId: string;
  joinDate: string;
  commitmentEndDate: string;
  membershipNo: string;
  /**
   * The officer has been shown who else holds this Membership No. and is
   * going ahead. Spouses and children share the main member's number, so a
   * shared number is normal - but it must never happen unseen.
   */
  sharedNumberAcknowledged?: boolean;
}

export interface NumberHolder {
  id: string;
  name: string;
  status: string;
}

/** Everyone except `excludeId` who already has this Membership No. */
export async function getNumberHolders(env: Env, membershipNo: string, excludeId = ""): Promise<NumberHolder[]> {
  const wanted = membershipNo.trim();
  if (!wanted) return [];
  const rows = await people(env).listByMembershipNo(wanted);
  return rows
    .filter((r) => r.id !== excludeId && text(r.membershipNo) === wanted)
    .map((r) => {
      const first = text(r.preferredName) ?? text(r.givenNames);
      return {
        id: r.id,
        name: [first, text(r.surname)].filter(Boolean).join(" ") || "Unnamed",
        status: text(r.status) ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function describeHolders(holders: NumberHolder[]): string {
  return holders.map((h) => (h.status ? `${h.name} (${h.status})` : h.name)).join(", ");
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/**
 * Stage 6 -> Accepted, with the details the club confirmed. Writes exactly
 * five fields and nothing else: a PATCH that named a link field would
 * replace that link's whole contents, which is how Commitments rows have
 * been orphaned before.
 */
export async function approveApplicant(env: Env, actor: AuthorizedUser, input: ApproveInput) {
  const personId = typeof input.personId === "string" ? input.personId.trim() : "";
  const membershipNo = typeof input.membershipNo === "string" ? input.membershipNo.trim() : "";
  if (!/^rec[A-Za-z0-9]{14}$/.test(personId)) throw new HttpError("Unknown applicant.", 400, "INVALID_INPUT");
  if (!isIsoDate(input.joinDate)) throw new HttpError("Join Date must be a date.", 400, "INVALID_INPUT");
  if (!isIsoDate(input.commitmentEndDate)) {
    throw new HttpError("Commitment End Date must be a date.", 400, "INVALID_INPUT");
  }
  if (input.commitmentEndDate <= input.joinDate) {
    throw new HttpError("Commitment End Date must be after the Join Date.", 400, "INVALID_INPUT");
  }
  if (!membershipNo || membershipNo.length > 40 || /[\r\n"]/.test(membershipNo)) {
    throw new HttpError("Enter the Membership No. the club confirmed.", 400, "INVALID_INPUT");
  }

  // Read fresh, not from the board cache: the stage may have moved since.
  const current = await people(env).getApplicantStage(personId);
  if (!current) throw new HttpError("Applicant not found.", 404, "NOT_FOUND");
  const stage = text(current.applicantStage) ?? "";
  if (stage !== APPROVABLE_STAGE) {
    throw new HttpError(
      `Only applicants at "${APPROVABLE_STAGE}" can be approved; this one is at "${stage || "no stage"}".`,
      409,
      "NOT_APPROVABLE",
    );
  }

  // A warning, not a block: families share one number. The app looks the
  // holders up and shows them before the officer confirms; this refuses
  // only if that step was skipped (or someone took the number meanwhile).
  const holders = await getNumberHolders(env, membershipNo, personId);
  if (holders.length > 0 && input.sharedNumberAcknowledged !== true) {
    throw new HttpError(
      `Membership No. ${membershipNo} is already used by ${describeHolders(holders)}. Check it is meant to be shared, then approve again.`,
      409,
      "SHARED_MEMBERSHIP_NO",
    );
  }

  // Exactly these five, in this order; none of them is a link.
  await people(env).update(personId, {
    status: "Member",
    applicantStage: ACCEPTED_STAGE,
    joinDate: input.joinDate,
    commitmentEndDate: input.commitmentEndDate,
    membershipNo,
  });

  await recordMembershipEvent(env, actor, {
    eventType: "Approved",
    personId,
    previousStage: stage,
    newStage: ACCEPTED_STAGE,
    membershipNo,
    joinDate: input.joinDate,
    commitmentEndDate: input.commitmentEndDate,
    sharedMembershipNo: holders.length > 0,
    notes: holders.length > 0 ? `Shares Membership No. with ${describeHolders(holders)}` : undefined,
  });

  // Status and stage feed the ranking lists and the roster too, so drop
  // everything a People edit invalidates (the board included) now, rather
  // than waiting for the webhook.
  await invalidateForTables(env, [TABLES.player]);

  // The response has always echoed what was written under the People field
  // names; kept as it was for the app.
  return {
    success: true,
    personId,
    Status: "Member",
    "Applicant Stage": ACCEPTED_STAGE,
    "Join Date": input.joinDate,
    "Commitment End Date": input.commitmentEndDate,
    "Membership No.": membershipNo,
  };
}
