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
 * Stages after the applicant has sent their application: in Eddy, or in
 * Fillout before the October 2026 switch-over (those have no Eddy
 * application record, but must not be asked to apply again).
 */
export const SUBMITTED_STAGES: readonly string[] = [
  "3. Club Application (Signed)",
  "4. Sponsor (Signed)",
  "5. Chairman (Signed)",
  APPROVABLE_STAGE,
  ACCEPTED_STAGE,
];

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

/** Stages 1-6: moving someone there makes them an Applicant again. */
export const isOpenStage = (stage: string) => (PIPELINE_STAGES as readonly string[]).includes(stage) && stage !== ACCEPTED_STAGE;

/**
 * Where an officer may move someone's stage by hand (the person page; POST
 * /api/admin/people/:id/stage). Offered only for an Applicant, a Temporary
 * player, or a stage the board lists under "Needs fixing". Stages 1-6,
 * Rejected and Temporary, minus the current one; never Accepted (Approve
 * does that, with the membership details). A Temporary player isn't
 * offered Rejected.
 */
export function stageTargets(status: string | null, stage: string | null): string[] {
  const current = stage ?? "";
  const offered = status === "Applicant" || current === "Temporary" || (current !== "" && columnFor(current) === NEEDS_FIXING);
  if (!offered) return [];
  return [...PIPELINE_STAGES.filter(isOpenStage), ...PARKED_STAGES].filter(
    (s) => s !== current && !(current === "Temporary" && s === "Rejected"),
  );
}
