/**
 * The membership section's Statements board: each member's yearly
 * commitment review (a Commitments row) by Review Progress, and the one
 * write it makes, asking for the review email early.
 *
 * Reads go through data/commitments.ts, which passes COMMITMENT_FIELDS
 * explicitly: the AI, combined-context and signature fields on Commitments
 * are never requested. Photos and mobiles
 * come from the linked People records (contacts.ts), read by id.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { getShared } from "./cache";
import { HttpError } from "./http";
import { invalidateCommitments } from "./invalidation";
import { STATEMENT_RECORDS_KEY } from "./reference";
import { daysBetween, recordMembershipEvent, type Attachment, type Chase } from "./membership";
import { firstLink, getOfficeHolders, getPeopleByIds, type Contact } from "./contacts";
import { commitments, type StatementRow } from "./data/commitments";
import { isRowId } from "./data/ids";
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
  photo?: string;
  mobileNo?: string;
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
  /** The sponsor, while the review waits on them (Member Submitted). */
  chase?: Chase;
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
function stageSinceOf(row: StatementRow, stage: string): string | undefined {
  const stamped = day(row.reviewUpdatedAt);
  if (stamped) return stamped;
  if (stage === MEMBER_SUBMITTED) return day(row.memberSubmittedAt);
  if (stage === SPONSOR_SUBMITTED) return day(row.sponsorSubmittedAt);
  if (stage === COMPLETE) return day(row.officerSubmittedAt);
  return undefined;
}

export function toStatementCard(row: StatementRow, today: string): StatementCard {
  const stage = text(row.reviewProgress) ?? "";
  const personId = list(row.people)[0];
  const periodEnd = dateOnly(row.periodEnd);
  const stageSince = stageSinceOf(row, stage);
  const notifyRequested = stage === NOT_STARTED && row.notifyNow === true;
  const windowOpen = stage === NOT_STARTED && inAutoWindow(periodEnd, today);
  return {
    id: row.id,
    personId,
    name: firstText(row.fullName) ?? firstText(row.preferredName) ?? "No member linked",
    membershipNo: firstText(row.membershipNo),
    yearNo: num(row.yearNo),
    period: text(row.period),
    periodStart: dateOnly(row.periodStart),
    periodEnd,
    joinDate: dateOnly(row.joinDate),
    commitmentEndDate: dateOnly(row.commitmentEndDate),
    stage,
    column: reviewColumnFor(stage),
    team: firstText(row.selectedTeamEos) ?? firstText(row.selectedTeamSos),
    sponsor: firstText(row.sponsorName),
    waitingOn: reviewWaitingOn(stage, firstText(row.sponsorName)),
    stageSince,
    days: stageSince ? daysBetween(stageSince, today) : null,
    autoNoticeOn: periodEnd ? addDays(periodEnd, -AUTO_NOTICE_DAYS) : undefined,
    inAutoWindow: windowOpen,
    notifyRequested,
    canNotify: stage === NOT_STARTED && !!personId && !notifyRequested && !windowOpen,
    matchesPlayed: num(row.matchesPlayed),
    matchesAvailable: num(row.matchesAvailable),
    matchesNotAvailable: num(row.matchesNotAvailable),
    matchesTeamPlayed: num(row.matchesTeamPlayed),
    teamsPlayed: list(row.teamsPlayed),
    practices: text(row.practices),
    socialFunctions: list(row.socialFunctions),
    gamesUmpired: text(row.gamesUmpired),
    qualifiedUmpire: firstText(row.qualifiedUmpire),
    otherContributions: text(row.otherContributions),
    lowParticipationReason: text(row.lowParticipationReason),
    sectionServiceMember: text(row.sectionServiceMember),
    hkfcServiceMember: text(row.hkfcServiceMember),
    sectionServiceSponsor: text(row.sectionServiceSponsor),
    hkfcServiceSponsor: text(row.hkfcServiceSponsor),
    sponsorRecommendation: text(row.sponsorRecommendation),
    recommendedReduction: text(row.recommendedReduction),
    memberSubmittedOn: day(row.memberSubmittedAt),
    sponsorSubmittedOn: day(row.sponsorSubmittedAt),
    officerSubmittedOn: day(row.officerSubmittedAt),
    playerStatement: attachments(row.playerStatement),
    officerFormUrl: text(row.officerFormUrl),
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

/** The member's photo and mobile, and the sponsor while the review waits on them. */
function withContacts(
  card: StatementCard,
  row: StatementRow,
  people: Record<string, Contact>,
  sponsorHolders: Record<string, string>,
): StatementCard {
  const member = card.personId ? people[card.personId] : undefined;
  const sponsor =
    card.stage === MEMBER_SUBMITTED ? people[sponsorHolders[firstLink(row.sponsorLink) ?? ""] ?? ""] : undefined;
  return {
    ...card,
    photo: member?.photo,
    mobileNo: member?.mobile,
    chase: sponsor ? { role: "Sponsor", name: sponsor.name, firstName: sponsor.firstName, mobile: sponsor.mobile } : undefined,
  };
}

interface StatementRecords {
  rows: StatementRow[];
  /** The linked members, and the sponsors of reviews waiting on one. */
  people: Record<string, Contact>;
  /** Sponsors row id -> the People record holding it. */
  sponsorHolders: Record<string, string>;
}

async function getStatementRecords(env: Env): Promise<StatementRecords> {
  return getShared<StatementRecords>(
    env,
    STATEMENT_RECORDS_KEY,
    async () => {
      // Started periods ending on or after REVIEWS_FROM, give or take a
      // day; statementBelongsOnBoard is the rule.
      const rows = await commitments(env).listReviewBoard();
      const waitingOnSponsor = rows.filter(
        (r) => text(r.reviewProgress) === MEMBER_SUBMITTED && firstLink(r.sponsorLink),
      );
      const sponsorHolders = waitingOnSponsor.length ? await getOfficeHolders(env) : {};
      const people = await getPeopleByIds(env, [
        ...rows.map((r) => firstLink(r.people)).filter((id): id is string => !!id),
        ...waitingOnSponsor.map((r) => sponsorHolders[firstLink(r.sponsorLink)!]).filter(Boolean),
      ]);
      return { rows, people, sponsorHolders };
    },
    RECORDS_TTL_MS,
  );
}

export async function getStatementBoard(env: Env): Promise<StatementBoard> {
  const { rows, people, sponsorHolders } = await getStatementRecords(env);
  const today = hkDateKey(new Date().toISOString());
  const candidates = rows
    .map((r) => withContacts(toStatementCard(r, today), r, people, sponsorHolders))
    // A resigned member's review is not chased.
    .filter((c) => statementBelongsOnBoard(c, today) && !(c.personId && people[c.personId]?.status === "Resigned"));
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
    hasStageDates: rows.some((r) => text(r.reviewUpdatedAt) !== undefined),
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
  if (!isRowId(env, "commitments", id)) throw new HttpError("Unknown commitment review.", 400, "INVALID_INPUT");

  // Fresh, not from the board cache: the automation may have run meanwhile.
  const row = await commitments(env).getNotifyState(id);
  if (!row) throw new HttpError("Commitment review not found.", 404, "NOT_FOUND");
  const stage = text(row.reviewProgress) ?? "";
  const personId = list(row.people)[0];
  const today = hkDateKey(new Date().toISOString());

  if (stage !== NOT_STARTED) {
    throw new HttpError(`This review is already at "${stage || "no stage"}".`, 409, "NOT_NOTIFIABLE");
  }
  if (!personId) {
    throw new HttpError("This row has no member linked, so there is no one to email. Ask the Section Captain to link the member.", 409, "NOT_LINKED");
  }
  if (row.notifyNow === true) {
    throw new HttpError("The email has already been requested; it goes shortly.", 409, "ALREADY_REQUESTED");
  }
  if (inAutoWindow(dateOnly(row.periodEnd), today)) {
    throw new HttpError(
      `The period ends within ${AUTO_NOTICE_DAYS} days, so the automatic email should already have gone. If it hasn't arrived, ask the Section Captain to check.`,
      409,
      "IN_AUTOMATION_WINDOW",
    );
  }

  // Refuses with SETUP_REQUIRED while the base has no Notify Now checkbox.
  await commitments(env).setNotifyNow(id);

  const year = num(row.yearNo);
  const period = text(row.period);
  await recordMembershipEvent(env, actor, {
    eventType: "Notified",
    personId,
    notes: `Commitment review email requested early${year ? ` for Year ${year}` : ""}${period ? ` (${period})` : ""}.`,
  });

  await invalidateCommitments(env);
  return { success: true, commitmentId: id };
}
