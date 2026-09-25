/**
 * The membership section: the applicant board, the active-members export and
 * the one write the section makes, approving an applicant.
 *
 * Every read here passes MEMBERSHIP_FIELDS explicitly, so the squad app's
 * People projection (PEOPLE_FIELDS) never grows for membership's sake, and
 * no HKID, bank or address field is ever requested.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { airtableCreate, airtableFindAll, airtableUpdate, escapeFormulaValue } from "./airtable";
import { getShared } from "./cache";
import { MEMBERSHIP_RECORDS_KEY, getReferenceData } from "./reference";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import type { InsightFact, TeamSquad } from "../../shared/membershipInsights";
import { HttpError } from "./http";
import { invalidateForTables } from "./airtableWebhook";
import { TABLES } from "../../shared/schema/tableNames";
import { MEMBERSHIP_FIELDS as F } from "../../shared/schema/fieldMaps";
import { hkDateKey } from "../../shared/hkDateKey";
import { toCsv } from "../../shared/csv";
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

export function toCard(record: any, today: string): ApplicantCard {
  const f = record.fields ?? {};
  const stage = text(f[F.applicantStage]) ?? "";
  const column = columnFor(stage);
  const sponsor = firstText(f[F.sponsorName]);
  const appliedOn = text(f[F.applicationDate]) ? hkDateKey(f[F.applicationDate]) : undefined;
  const stageSince = text(f[F.stageUpdatedAt]) ? hkDateKey(f[F.stageUpdatedAt]) : undefined;
  const since = stageSince ?? appliedOn;
  const givenNames = text(f[F.givenNames]) ?? "";
  const surname = text(f[F.surname]) ?? "";
  const first = text(f[F.preferredName]) ?? givenNames;
  const photo = attachments(f[F.photo])[0]?.url;
  return {
    id: record.id,
    name: [first, surname].filter(Boolean).join(" ") || "Unnamed",
    surname,
    givenNames,
    photo,
    stage,
    column,
    status: text(f[F.status]) ?? "",
    membershipNo: text(f[F.membershipNo]),
    joinDate: text(f[F.joinDate]),
    commitmentEndDate: text(f[F.commitmentEndDate]),
    appliedOn,
    stageSince,
    days: since ? daysBetween(since, today) : null,
    waitingOn: waitingOn(stage, sponsor),
    canApprove: stage === APPROVABLE_STAGE,
    mobileNo: text(f[F.mobileNo]),
    applicantType: text(f[F.applicantType]),
    categoryType: text(f[F.categoryType]),
    gender: text(f[F.gender]),
    playingPosition: text(f[F.playingPosition]),
    team: text(f[F.selectedTeamEos]) ?? text(f[F.selectedTeamSos]) ?? text(f[F.registeredTeam]),
    sponsor,
    sportsBackground: text(f[F.sportsBackground]),
    personalInterest: text(f[F.personalInterest]),
    tourInterest: list(f[F.tourInterest]),
    qualifiedUmpire: text(f[F.qualifiedUmpire]),
    qualifiedCoach: text(f[F.qualifiedCoach]),
    playingLevel: list(f[F.playingLevel]),
    selectionComments: text(f[F.selectionComments]),
    applicationForm: attachments(f[F.applicationForm]),
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

/**
 * Everyone who has ever had an Applicant Stage and has not resigned. One
 * shared read feeds both the board and Insights, so opening Insights costs
 * no Airtable call of its own.
 */
async function getMembershipRecords(env: Env): Promise<any[]> {
  return getShared<any[]>(
    env,
    MEMBERSHIP_RECORDS_KEY,
    () =>
      airtableFindAll(
        env,
        TABLES.player,
        // Narrows the scan; belongsOnBoard / the insight facts are the rules.
        `AND({${F.applicantStage}}!="", {${F.status}}!="Resigned")`,
        undefined,
        Object.values(F),
      ),
    RECORDS_TTL_MS,
  );
}

const hasStageDates = (records: any[]) => records.some((r) => text(r.fields?.[F.stageUpdatedAt]) !== undefined);

export async function getMembershipBoard(env: Env): Promise<MembershipBoard> {
  const records = await getMembershipRecords(env);
  const today = hkDateKey(new Date().toISOString());
  const cards = records
    .map((r) => toCard(r, today))
    .filter((c) => belongsOnBoard(c, today))
    // Longest-waiting first within each column.
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.name.localeCompare(b.name));
  return {
    columns: { pipeline: PIPELINE_STAGES, parked: PARKED_STAGES },
    cards,
    hasStageDates: hasStageDates(records),
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
  const [records, ref] = await Promise.all([getMembershipRecords(env), getReferenceData(env)]);
  const today = hkDateKey(new Date().toISOString());
  const facts: InsightFact[] = records.map((r) => {
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
    hasStageDates: hasStageDates(records),
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
  const records = await airtableFindAll(
    env,
    TABLES.player,
    `AND({Active}=TRUE(), {${F.applicantStage}}!="Temporary")`,
    undefined,
    [F.membershipNo, F.surname, F.givenNames, F.status, F.applicantStage],
  );
  const rows = records
    .filter((r) => text(r.fields?.[F.applicantStage]) !== "Temporary")
    .map((r) => {
      const f = r.fields ?? {};
      return [text(f[F.membershipNo]) ?? "", text(f[F.surname]) ?? "", text(f[F.givenNames]) ?? "", text(f[F.status]) ?? ""];
    })
    .sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
  const csv = toCsv([CSV_HEADER, ...rows]);
  const today = hkDateKey(new Date().toISOString());
  // The file carries every member's name and number and leaves the app, so
  // who took a copy, and when, goes on the record.
  await recordMembershipEvent(env, actor, {
    [EV.eventType]: "Exported",
    [EV.notes]: `Active members CSV, ${rows.length} rows`,
  });
  return { filename: `hkfc-hockey-active-members-${today}.csv`, csv, count: rows.length };
}

// ── Membership Events ───────────────────────────────────────────────────

/**
 * Audit table for the section's actions, created in Airtable by the owner:
 *
 *   Id                    autonumber     primary field
 *   Event Type            single select  Approved | Exported
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
 */
export const MEMBERSHIP_EVENTS_TABLE = "Membership Events";
export const MEMBERSHIP_EVENTS_FIELDS = {
  eventType: "Event Type",
  person: "Person",
  actor: "Actor",
  actorEmail: "Actor Email",
  previousStage: "Previous Stage",
  newStage: "New Stage",
  membershipNo: "Membership No.",
  joinDate: "Join Date",
  commitmentEndDate: "Commitment End Date",
  sharedMembershipNo: "Shared Membership No.",
  notes: "Notes",
  timestamp: "Timestamp",
} as const;
const EV = MEMBERSHIP_EVENTS_FIELDS;

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
  fields: Record<string, unknown>,
): Promise<void> {
  const row: Record<string, unknown> = {
    ...fields,
    [EV.actorEmail]: actor.email,
    [EV.timestamp]: new Date().toISOString(),
  };
  if (actor.personId) row[EV.actor] = [actor.personId];
  // Airtable rejects an explicit undefined less politely than a missing key.
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  try {
    await airtableCreate(env, MEMBERSHIP_EVENTS_TABLE, row);
  } catch (err) {
    console.error(
      `[MembershipEvents] audit row not written (${err instanceof Error ? err.message : err}); the action itself succeeded:`,
      JSON.stringify(row),
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
  const records = await airtableFindAll(
    env,
    TABLES.player,
    `{${F.membershipNo}}="${escapeFormulaValue(wanted)}"`,
    undefined,
    [F.membershipNo, F.preferredName, F.givenNames, F.surname, F.status],
  );
  return records
    .filter((r) => r.id !== excludeId && text(r.fields?.[F.membershipNo]) === wanted)
    .map((r) => {
      const f = r.fields ?? {};
      const first = text(f[F.preferredName]) ?? text(f[F.givenNames]);
      return {
        id: r.id,
        name: [first, text(f[F.surname])].filter(Boolean).join(" ") || "Unnamed",
        status: text(f[F.status]) ?? "",
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
  // A filtered list rather than a record GET, which cannot be projected and
  // would bring back the whole CRM record.
  const found = await airtableFindAll(env, TABLES.player, `RECORD_ID()="${personId}"`, undefined, [F.applicantStage]);
  const record = found.find((r) => r.id === personId);
  if (!record) throw new HttpError("Applicant not found.", 404, "NOT_FOUND");
  const stage = text(record.fields?.[F.applicantStage]) ?? "";
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

  const fields = {
    [F.status]: "Member",
    [F.applicantStage]: ACCEPTED_STAGE,
    [F.joinDate]: input.joinDate,
    [F.commitmentEndDate]: input.commitmentEndDate,
    [F.membershipNo]: membershipNo,
  };
  await airtableUpdate(env, TABLES.player, personId, fields);

  await recordMembershipEvent(env, actor, {
    [EV.eventType]: "Approved",
    [EV.person]: [personId],
    [EV.previousStage]: stage,
    [EV.newStage]: ACCEPTED_STAGE,
    [EV.membershipNo]: membershipNo,
    [EV.joinDate]: input.joinDate,
    [EV.commitmentEndDate]: input.commitmentEndDate,
    [EV.sharedMembershipNo]: holders.length > 0,
    [EV.notes]: holders.length > 0 ? `Shares Membership No. with ${describeHolders(holders)}` : undefined,
  });

  // Status and stage feed the ranking lists and the roster too, so drop
  // everything a People edit invalidates (the board included) now, rather
  // than waiting for the webhook.
  await invalidateForTables(env, [TABLES.player]);

  return { success: true, personId, ...fields };
}
