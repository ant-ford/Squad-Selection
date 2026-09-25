/**
 * Commitments.Review Progress values as they appear in Airtable, and the
 * Statements board columns they map to. One list for the Worker and the app.
 *
 * An Airtable automation moves a row from Not Started to Notified Member
 * when its Period End comes within AUTO_NOTICE_DAYS, emailing the member
 * (copying the Membership Officer) on the way. Fillout submissions move it
 * on from there. The only thing the app does is ask for that email early,
 * by ticking Notify Now, which a copy of that automation triggers on.
 */

export const NOT_STARTED = "Not Started";
export const NOTIFIED = "Notified Member";
export const MEMBER_SUBMITTED = "Member Submitted (with Sponsor)";
export const SPONSOR_SUBMITTED = "Sponsor Submitted (with Membership Officer)";
export const COMPLETE = "Complete";

/** The review, left to right. */
export const REVIEW_STAGES = [NOT_STARTED, NOTIFIED, MEMBER_SUBMITTED, SPONSOR_SUBMITTED, COMPLETE] as const;

/** The automation emails the member this many days before Period End. */
export const AUTO_NOTICE_DAYS = 60;

/**
 * Reviews whose period ended before this day are not on the board, whatever
 * their stage (owner decision, 2026-09-25). Commitment rows go back to 2017,
 * long before the review process began, and about seventy past years were
 * never reviewed; this is the start of the 2026-27 season.
 */
export const REVIEWS_FROM = "2026-07-01";

/**
 * Column for a row whose Review Progress is blank or not one of the above.
 * The automation only fires on Not Started, so such a row would never be
 * reviewed: it is a data problem to fix in Airtable.
 */
export const REVIEW_NEEDS_FIXING = "Needs fixing";

export type ReviewStage = (typeof REVIEW_STAGES)[number];
export type ReviewColumn = ReviewStage | typeof REVIEW_NEEDS_FIXING;

export function reviewColumnFor(stage: string): ReviewColumn {
  return (REVIEW_STAGES as readonly string[]).includes(stage) ? (stage as ReviewStage) : REVIEW_NEEDS_FIXING;
}

/** Who the review is waiting on at each stage. */
export function reviewWaitingOn(stage: string, sponsorName?: string): string | null {
  switch (stage) {
    case NOT_STARTED:
      return "The review email";
    case NOTIFIED:
      return "The member's Commitment Form";
    case MEMBER_SUBMITTED:
      return sponsorName ? `Sponsor (${sponsorName})` : "The sponsor";
    case SPONSOR_SUBMITTED:
      return "Membership Officer review";
    default:
      return null;
  }
}

/** Column heading short enough for a stage chip. */
export function shortReviewStage(stage: string): string {
  return stage.replace(/ \(with [^)]+\)$/, "");
}
