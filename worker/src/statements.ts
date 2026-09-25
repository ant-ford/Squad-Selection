/**
 * The membership section's Statements board: each member's yearly
 * commitment review (a Commitments row) by Review Progress, and the one
 * write it makes, asking for the review email early.
 *
 * Reads pass COMMITMENT_FIELDS explicitly: the AI, combined-context and
 * signature fields on Commitments are never requested.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { AirtableError, airtableFindAll, airtableUpdate } from "./airtable";
import { getShared } from "./cache";
import { HttpError } from "./http";
import { invalidateForTables } from "./airtableWebhook";
import { STATEMENT_RECORDS_KEY } from "./reference";
import { MEMBERSHIP_EVENTS_FIELDS as EV, daysBetween, recordMembershipEvent, type Attachment } from "./membership";
import { TABLES } from "../../shared/schema/tableNames";
import { COMMITMENT_FIELDS as F } from "../../shared/schema/fieldMaps";
import { hkDateKey } from "../../shared/hkDateKey";
import {
  AUTO_NOTICE_DAYS,
  COMPLETE,
  MEMBER_SUBMITTED,
  NOT_STARTED,
  REVIEWS_FROM,
  REVIEW_STAGES,
  SPONSOR_SUBMITTED,
  reviewColumnFor,
  reviewWaitingOn,
  type ReviewColumn,
} from "../../shared/statementStages";

/** Same reasoning as the applicant board: attachment URLs expire, the webhook drops it sooner. */
const RECORDS_TTL_MS = 5 * 60 * 1000;

/** Complete reviews stay on the board this long after their period ends. */
const RECENT_DAYS = 365;

export interface StatementCard {
  id: string;
  personId?: string;
  name: string;
  membershipNo?: string;
  yearNo?: number;
  period?: string;
  periodStart?: string;
  periodEnd?: string;
  joinDate?: string;
  commitmentEndDate?: string;
  stage: string;
  column: ReviewColumn;
  team?: string;
  sponsor?: string;
  waitingOn: string | null;
  /** Hong Kong calendar day the row reached its current stage, when known. */
  stageSince?: string;
  days: number | null;
  /** The day the automation emails the member: Period End less AUTO_NOTICE_DAYS. */
  autoNoticeOn?: string;
  /**
   * Period End is inside the automation's window now, so a Not Started row
   * should already have been emailed (or is being emailed this minute).
   * Ticking Notify Now as well could send a second email, so the app says
   * to check the automation instead of offering the button.
   */
  inAutoWindow: boolean;
  /** Notify Now is ticked and the automation has not moved the row yet. */
  notifyRequested: boolean;
  canNotify: boolean;
  matchesPlayed?: number;
  matchesAvailable?: number;
  matchesNotAvailable?: number;
  matchesTeamPlayed?: number;
  teamsPlayed: string[];
  practices?: string;
  socialFunctions: string[];
  gamesUmpired?: string;
  qualifiedUmpire?: string;
  otherContributions?: string;
  lowParticipationReason?: string;
  sectionServiceMember?: string;
  hkfcServiceMember?: string;
  sectionServiceSponsor?: string;
  hkfcServiceSponsor?: string;
  sponsorRecommendation?: string;
  recommendedReduction?: string;
  memberSubmittedOn?: string;
  sponsorSubmittedOn?: string;
  officerSubmittedOn?: string;
  playerStatement: Attachment[];
  officerFormUrl?: string;
}

export interface StatementBoard {
  columns: readonly string[];
  cards: StatementCard[];
  /** Rows under review with no People link: the automation has no one to email. */
  unlinked: number;
  /** False until Commitments has a Review Progress Updated At field. */
  hasStageDates: boolean;
  generatedAt: string;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const firstText = (v: unknown): string | undefined => (Array.isArray(v) ? text(v[0]) : text(v));
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const day = (v: unknown): string | undefined => (text(v) ? hkDateKey(text(v)!) : undefined);
/** Period Start / End are date-only fields; a lookup of one arrives as an array. */
const dateOnly = (v: unknown): string | undefined => {
  const t = firstText(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : undefined;
};

function attachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a.url === "string")
    .map((a) => ({ url: a.url as string, filename: typeof a.filename === "string" ? a.filename : "Attachment" }));
}

export function addDays(dayKey: string, n: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Period End falls between today and AUTO_NOTICE_DAYS from now, inclusive. */
export function inAutoWindow(periodEnd: string | undefined, today: string): boolean {
  return periodEnd !== undefined && periodEnd >= today && periodEnd <= addDays(today, AUTO_NOTICE_DAYS);
}

/**
 * When the row reached its stage: the Review Progress Updated At field if
 * the base has it, otherwise the submission that moved it there.
 */
function stageSinceOf(f: Record<string, unknown>, stage: string): string | undefined {
  const stamped = day(f[F.reviewUpdatedAt]);
  if (stamped) return stamped;
  if (stage === MEMBER_SUBMITTED) return day(f[F.memberSubmittedAt]);
  if (stage === SPONSOR_SUBMITTED) return day(f[F.sponsorSubmittedAt]);
  if (stage === COMPLETE) return day(f[F.officerSubmittedAt]);
  return undefined;
}

export function toStatementCard(record: any, today: string): StatementCard {
  const f = record.fields ?? {};
  const stage = text(f[F.reviewProgress]) ?? "";
  const personId = list(f[F.people])[0];
  const periodEnd = dateOnly(f[F.periodEnd]);
  const stageSince = stageSinceOf(f, stage);
  const notifyRequested = stage === NOT_STARTED && f[F.notifyNow] === true;
  const windowOpen = stage === NOT_STARTED && inAutoWindow(periodEnd, today);
  return {
    id: record.id,
    personId,
    name: firstText(f[F.fullName]) ?? firstText(f[F.preferredName]) ?? "No member linked",
    membershipNo: firstText(f[F.membershipNo]),
    yearNo: num(f[F.yearNo]),
    period: text(f[F.period]),
    periodStart: dateOnly(f[F.periodStart]),
    periodEnd,
    joinDate: dateOnly(f[F.joinDate]),
    commitmentEndDate: dateOnly(f[F.commitmentEndDate]),
    stage,
    column: reviewColumnFor(stage),
    team: firstText(f[F.selectedTeamEos]) ?? firstText(f[F.selectedTeamSos]),
    sponsor: firstText(f[F.sponsorName]),
    waitingOn: reviewWaitingOn(stage, firstText(f[F.sponsorName])),
    stageSince,
    days: stageSince ? daysBetween(stageSince, today) : null,
    autoNoticeOn: periodEnd ? addDays(periodEnd, -AUTO_NOTICE_DAYS) : undefined,
    inAutoWindow: windowOpen,
    notifyRequested,
    canNotify: stage === NOT_STARTED && !!personId && !notifyRequested && !windowOpen,
    matchesPlayed: num(f[F.matchesPlayed]),
    matchesAvailable: num(f[F.matchesAvailable]),
    matchesNotAvailable: num(f[F.matchesNotAvailable]),
    matchesTeamPlayed: num(f[F.matchesTeamPlayed]),
    teamsPlayed: list(f[F.teamsPlayed]),
    practices: text(f[F.practices]),
    socialFunctions: list(f[F.socialFunctions]),
    gamesUmpired: text(f[F.gamesUmpired]),
    qualifiedUmpire: firstText(f[F.qualifiedUmpire]),
    otherContributions: text(f[F.otherContributions]),
    lowParticipationReason: text(f[F.lowParticipationReason]),
    sectionServiceMember: text(f[F.sectionServiceMember]),
    hkfcServiceMember: text(f[F.hkfcServiceMember]),
    sectionServiceSponsor: text(f[F.sectionServiceSponsor]),
    hkfcServiceSponsor: text(f[F.hkfcServiceSponsor]),
    sponsorRecommendation: text(f[F.sponsorRecommendation]),
    recommendedReduction: text(f[F.recommendedReduction]),
    memberSubmittedOn: day(f[F.memberSubmittedAt]),
    sponsorSubmittedOn: day(f[F.sponsorSubmittedAt]),
    officerSubmittedOn: day(f[F.officerSubmittedAt]),
    playerStatement: attachments(f[F.playerStatement]),
    officerFormUrl: text(f[F.officerFormUrl]),
  };
}

/**
 * Which rows belong on the board (owner decisions, 2026-09-25): the period
 * in progress plus any unfinished earlier year, and Complete reviews for a
 * year after their period ends - but nothing whose period ended before
 * REVIEWS_FROM, the pre-process history. Future years (every year of a
 * commitment is created at once) never.
 */
export function statementBelongsOnBoard(card: StatementCard, today: string): boolean {
  if (!card.periodStart || card.periodStart > today) return false;
  if (!card.periodEnd || card.periodEnd < REVIEWS_FROM) return false;
  if (card.column === COMPLETE) {
    const ended = card.periodEnd ?? card.officerSubmittedOn;
    return ended !== undefined && daysBetween(ended, today) <= RECENT_DAYS;
  }
  return true;
}

interface StatementRecords {
  records: any[];
  /** People who have resigned; their reviews are not chased. */
  resignedIds: string[];
}

async function getStatementRecords(env: Env): Promise<StatementRecords> {
  return getShared<StatementRecords>(
    env,
    STATEMENT_RECORDS_KEY,
    async () => {
      const [records, resigned] = await Promise.all([
        airtableFindAll(
          env,
          TABLES.commitment,
          // Narrows the scan to started periods that end on or after
          // REVIEWS_FROM (a day's slack either side for Airtable's UTC dates);
          // statementBelongsOnBoard is the rule.
          `AND({${F.periodStart}}!="", IS_BEFORE({${F.periodStart}}, DATEADD(TODAY(), 2, "days")), IS_AFTER({${F.periodEnd}}, DATETIME_PARSE("${addDays(REVIEWS_FROM, -2)}", "YYYY-MM-DD")))`,
          undefined,
          Object.values(F),
        ),
        airtableFindAll(env, TABLES.player, `{Status}="Resigned"`, undefined, ["Status"]),
      ]);
      return { records, resignedIds: resigned.map((r) => r.id) };
    },
    RECORDS_TTL_MS,
  );
}

export async function getStatementBoard(env: Env): Promise<StatementBoard> {
  const { records, resignedIds } = await getStatementRecords(env);
  const resigned = new Set(resignedIds);
  const today = hkDateKey(new Date().toISOString());
  const candidates = records
    .map((r) => toStatementCard(r, today))
    .filter((c) => statementBelongsOnBoard(c, today) && !(c.personId && resigned.has(c.personId)));
  const cards = candidates
    .filter((c) => c.personId)
    // Longest in stage first; Not Started (no stage date) by the soonest period end.
    .sort(
      (a, b) =>
        (b.days ?? -1) - (a.days ?? -1) ||
        (a.periodEnd ?? "9999").localeCompare(b.periodEnd ?? "9999") ||
        a.name.localeCompare(b.name),
    );
  return {
    columns: REVIEW_STAGES,
    cards,
    unlinked: candidates.length - cards.length,
    hasStageDates: records.some((r) => text(r.fields?.[F.reviewUpdatedAt]) !== undefined),
    generatedAt: new Date().toISOString(),
  };
}

// ── Notify now ──────────────────────────────────────────────────────────

/**
 * Ticks Notify Now on a Not Started row. A second Airtable automation, a
 * copy of the 60-day one triggered on "Not Started and Notify Now checked",
 * sends the same email and moves the row to Notified Member. The app never sets Review Progress itself -
 * that would move the row without the email going out.
 *
 * Writes exactly one field. People is a link: sending it would replace the
 * link's contents, which is how Commitments rows have been orphaned before.
 */
export async function requestReviewEmail(env: Env, actor: AuthorizedUser, commitmentId: string) {
  const id = typeof commitmentId === "string" ? commitmentId.trim() : "";
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) throw new HttpError("Unknown commitment review.", 400, "INVALID_INPUT");

  // Fresh, not from the board cache: the automation may have run meanwhile.
  const found = await airtableFindAll(env, TABLES.commitment, `RECORD_ID()="${id}"`, undefined, [
    F.reviewProgress,
    F.notifyNow,
    F.people,
    F.periodEnd,
    F.period,
    F.yearNo,
  ]);
  const record = found.find((r) => r.id === id);
  if (!record) throw new HttpError("Commitment review not found.", 404, "NOT_FOUND");
  const f = record.fields ?? {};
  const stage = text(f[F.reviewProgress]) ?? "";
  const personId = list(f[F.people])[0];
  const today = hkDateKey(new Date().toISOString());

  if (stage !== NOT_STARTED) {
    throw new HttpError(`This review is already at "${stage || "no stage"}".`, 409, "NOT_NOTIFIABLE");
  }
  if (!personId) {
    throw new HttpError("This row has no member linked, so there is no one to email. Fix the People link in Airtable.", 409, "NOT_LINKED");
  }
  if (f[F.notifyNow] === true) {
    throw new HttpError("The email has already been requested; Airtable will send it shortly.", 409, "ALREADY_REQUESTED");
  }
  if (inAutoWindow(dateOnly(f[F.periodEnd]), today)) {
    throw new HttpError(
      `The period ends within ${AUTO_NOTICE_DAYS} days, so the automation should already have sent this email. Check its run history in Airtable.`,
      409,
      "IN_AUTOMATION_WINDOW",
    );
  }

  try {
    await airtableUpdate(env, TABLES.commitment, id, { [F.notifyNow]: true });
  } catch (err) {
    if (err instanceof AirtableError && err.message.includes("UNKNOWN_FIELD_NAME")) {
      throw new HttpError(
        `Commitments has no "${F.notifyNow}" checkbox yet. Add it in Airtable, then try again.`,
        409,
        "SETUP_REQUIRED",
      );
    }
    throw err;
  }

  const year = num(f[F.yearNo]);
  const period = text(f[F.period]);
  await recordMembershipEvent(env, actor, {
    [EV.eventType]: "Notified",
    [EV.person]: [personId],
    [EV.notes]: `Commitment review email requested early${year ? ` for Year ${year}` : ""}${period ? ` (${period})` : ""}.`,
  });

  await invalidateForTables(env, [TABLES.commitment]);
  return { success: true, commitmentId: id };
}
