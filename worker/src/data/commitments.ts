import type { Env } from "../env";
import { supabaseCommitments } from "./supabase/crm";
import type { Row } from "./rows";
import { COMMITMENT_FIELDS } from "../../../shared/schema/fieldMaps";

/**
 * The Statements board's view of a Commitments row. The AI, combined-context
 * and signature columns are deliberately not in it.
 */
export type StatementRow = Row<typeof COMMITMENT_FIELDS>;

/** What Notify Now checks before starting the review, read fresh. */
export const NOTIFY_FIELDS = ["reviewProgress", "notifyNow", "people", "periodEnd", "period", "yearNo"] as const;
export type NotifyRow = Row<typeof NOTIFY_FIELDS>;

/** Reviews in progress for My Tasks: the member, and who they wait on. */
export const REVIEW_TASK_FIELDS = ["reviewProgress", "people", "fullName", "periodEnd", "sponsorLink", "officerLink"] as const;
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
   * Starts the review now: Eddy sends the request email (reviewEmails.ts).
   * 409 ALREADY_STARTED when it has been started already.
   */
  setNotifyNow(id: string): Promise<void>;
  /** Rows at any of the given Review Progress values, any period. */
  listReviewsAtStages(stages: readonly string[]): Promise<ReviewTaskRow[]>;
}

export function commitments(env: Env): CommitmentsRepo {
  return supabaseCommitments(env);
}
