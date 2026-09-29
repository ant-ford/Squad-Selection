import { AirtableError, airtableFindAll, airtableUpdate } from "../airtable";
import type { Env } from "../env";
import { HttpError } from "../http";
import { pick } from "./backend";
import { supabaseCommitments } from "./supabase/crm";
import { toRow, type Row } from "./rows";
import { TABLES } from "../../../shared/schema/tableNames";
import { COMMITMENT_FIELDS as F } from "../../../shared/schema/fieldMaps";
import { REVIEWS_FROM } from "../../../shared/statementStages";

/**
 * The Statements board's view of a Commitments row. The AI, combined-context
 * and signature fields are deliberately not in it.
 */
export type StatementRow = Row<typeof F>;

/** What Notify Now checks before ticking the box, read fresh. */
export const NOTIFY_FIELDS = {
  reviewProgress: F.reviewProgress,
  notifyNow: F.notifyNow,
  people: F.people,
  periodEnd: F.periodEnd,
  period: F.period,
  yearNo: F.yearNo,
} as const;
export type NotifyRow = Row<typeof NOTIFY_FIELDS>;

/** Reviews in progress for My Tasks: who they wait on, and each one's form. */
export const REVIEW_TASK_FIELDS = {
  reviewProgress: F.reviewProgress,
  people: F.people,
  fullName: F.fullName,
  periodEnd: F.periodEnd,
  sponsorLink: F.sponsorLink,
  officerLink: "Membership Officers",
  /** A lookup of the member's own People formula. */
  memberFormUrl: "Fillout - Member (Commitment Record Picker)",
  sponsorFormUrl: "Fillout - Sponsor (Commitment Review Form)",
  officerFormUrl: F.officerFormUrl,
} as const;
export type ReviewTaskRow = Row<typeof REVIEW_TASK_FIELDS>;

export interface CommitmentsRepo {
  /**
   * Rows whose period has started and ends on or after REVIEWS_FROM, give or
   * take a day or two. A superset: statementBelongsOnBoard is the rule.
   */
  listReviewBoard(): Promise<StatementRow[]>;
  /** One row for Notify Now; null when there is no such row. */
  getNotifyState(id: string): Promise<NotifyRow | null>;
  /**
   * Ticks Notify Now, and writes nothing else: People is a link, and
   * sending it would replace the link's contents.
   */
  setNotifyNow(id: string): Promise<void>;
  /** Rows at any of the given Review Progress values, any period. */
  listReviewsAtStages(stages: readonly string[]): Promise<ReviewTaskRow[]>;
}

const addDays = (dayKey: string, n: number) =>
  new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function airtableCommitments(env: Env): CommitmentsRepo {
  return {
    async listReviewBoard() {
      const records = await airtableFindAll(
        env,
        TABLES.commitment,
        // Narrows the scan to started periods that end on or after
        // REVIEWS_FROM (a day's slack either side for Airtable's UTC dates).
        `AND({${F.periodStart}}!="", IS_BEFORE({${F.periodStart}}, DATEADD(TODAY(), 2, "days")), IS_AFTER({${F.periodEnd}}, DATETIME_PARSE("${addDays(REVIEWS_FROM, -2)}", "YYYY-MM-DD")))`,
        undefined,
        Object.values(F),
      );
      return records.map((r) => toRow(r, F));
    },

    async getNotifyState(id) {
      // A filtered list rather than a record GET, which cannot be projected.
      const found = await airtableFindAll(env, TABLES.commitment, `RECORD_ID()="${id}"`, undefined, Object.values(NOTIFY_FIELDS));
      const record = found.find((r) => r.id === id);
      return record ? toRow(record, NOTIFY_FIELDS) : null;
    },

    async setNotifyNow(id) {
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
    },

    async listReviewsAtStages(stages) {
      const records = await airtableFindAll(
        env,
        TABLES.commitment,
        `OR(${stages.map((s) => `{${REVIEW_TASK_FIELDS.reviewProgress}}="${s}"`).join(",")})`,
        undefined,
        Object.values(REVIEW_TASK_FIELDS),
      );
      return records.map((r) => toRow(r, REVIEW_TASK_FIELDS));
    },
  };
}

export function commitments(env: Env): CommitmentsRepo {
  return pick(env, "commitments", airtableCommitments, supabaseCommitments);
}
