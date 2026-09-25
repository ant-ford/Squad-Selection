/**
 * Applicant Stage values as they appear in Airtable, and the board columns
 * they map to. One list for the Worker and the app, so the columns, their
 * order and "who is it waiting on" cannot drift apart.
 *
 * Make.com moves applicants through stages 1-6. The only move the app makes
 * is stage 6 -> Accepted, when the membership officer approves.
 */

export const APPROVABLE_STAGE = "6. Membership Officer (Signed)";
export const ACCEPTED_STAGE = "Accepted";

/** The pipeline, left to right. */
export const PIPELINE_STAGES = [
  "1. Trial Application",
  "2. Section Captain Invitation",
  "3. Club Application (Signed)",
  "4. Sponsor (Signed)",
  "5. Chairman (Signed)",
  APPROVABLE_STAGE,
  ACCEPTED_STAGE,
] as const;

/**
 * Off the pipeline. Temporary is a player registered with HKFC without the
 * membership process, usually a visiting player here for a few months.
 * (Pending and On Hold were retired from the base in September 2026.)
 */
export const PARKED_STAGES = ["Rejected", "Temporary"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type ParkedStage = (typeof PARKED_STAGES)[number];

/**
 * Column for a record whose stage is none of the above: "undefined", which
 * should not be in use, or a retired stage (Pending, On Hold) still set on
 * a record. Anything landing here is a data problem to fix in Airtable.
 */
export const NEEDS_FIXING = "Needs fixing";

export type BoardColumn = PipelineStage | ParkedStage | typeof NEEDS_FIXING;

/** Who the application is waiting on at each pipeline stage. */
export function waitingOn(stage: string, sponsorName?: string): string | null {
  switch (stage) {
    case "1. Trial Application":
      return "Section Captain invitation";
    case "2. Section Captain Invitation":
      return "Applicant's club application";
    case "3. Club Application (Signed)":
      return sponsorName ? `Sponsor (${sponsorName})` : "Sponsor signature";
    case "4. Sponsor (Signed)":
      return "Chairman signature";
    case "5. Chairman (Signed)":
      return "Membership Officer signature";
    case APPROVABLE_STAGE:
      return "Club confirmation, then approve";
    default:
      return null;
  }
}

export function columnFor(stage: string): BoardColumn {
  if ((PIPELINE_STAGES as readonly string[]).includes(stage)) return stage as PipelineStage;
  if ((PARKED_STAGES as readonly string[]).includes(stage)) return stage as ParkedStage;
  return NEEDS_FIXING;
}
