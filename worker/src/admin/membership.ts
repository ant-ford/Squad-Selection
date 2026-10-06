/**
 * The Membership Officer's edits on the person page (Supabase backend; the
 * "membership" section: Membership Officer, Section Captains):
 *
 *   POST /api/admin/people/:id/membership  member type, category, number, dates
 *   POST /api/admin/people/:id/stage       move the applicant stage by hand
 *
 * Both go through admin_update_person (one transaction with its
 * activity_log row) and refuse with a 409 when someone else saved first.
 * No emails are sent and joiner steps are untouched.
 */
import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { invalidateCommitments, invalidatePeople } from "../invalidation";
import { CATEGORY_TYPES, MEMBER_TYPES } from "../../../shared/profile";
import { isOpenStage, stageTargets } from "../../../shared/membershipStages";
import { describeHolders, getNumberHolders } from "../membership";
import { adminRpc } from "./rpc";
import { readPerson } from "./people";

interface UpdateResult {
  status: "ok";
  changed: string[];
  /** Untouched commitment periods removed because new dates left them out (20261007010503). */
  removedPeriods?: number;
}

/** The body's names and the People columns behind them. */
const MEMBERSHIP_FIELDS = {
  memberType: "member_type",
  categoryType: "category_type",
  membershipNo: "membership_no",
  joinDate: "join_date",
  commitmentEndDate: "commitment_end_date",
} as const;
type MembershipKey = keyof typeof MEMBERSHIP_FIELDS;

const LABELS: Record<MembershipKey, string> = {
  memberType: "Member type",
  categoryType: "Category",
  membershipNo: "Membership number",
  joinDate: "Join date",
  commitmentEndDate: "Commitment end date",
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export interface MembershipChange {
  /** Column -> new value (null clears). */
  patch: Record<string, string | null>;
  /** Column -> the value the screen read. */
  expect: Record<string, string | null>;
  sharedNumberAcknowledged: boolean;
}

/** Validates a membership save; throws a 400 the screen shows as it is. */
export function parseMembershipChange(body: Record<string, unknown>): MembershipChange {
  const expectIn = body.expect;
  if (!expectIn || typeof expectIn !== "object" || Array.isArray(expectIn)) {
    throw new HttpError("Reload the page and try again.", 400, "INVALID_INPUT");
  }
  const patch: Record<string, string | null> = {};
  const expect: Record<string, string | null> = {};
  for (const key of Object.keys(MEMBERSHIP_FIELDS) as MembershipKey[]) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw !== null && typeof raw !== "string") throw new HttpError(`${LABELS[key]} must be text.`, 400, "INVALID_INPUT");
    const value = (raw ?? "").trim() || null;
    if (value !== null) {
      if (key === "memberType" && !(MEMBER_TYPES as readonly string[]).includes(value)) {
        throw new HttpError("Choose a member type from the list.", 400, "INVALID_INPUT");
      }
      if (key === "categoryType" && !(CATEGORY_TYPES as readonly string[]).includes(value)) {
        throw new HttpError("Choose a category from the list.", 400, "INVALID_INPUT");
      }
      if (key === "membershipNo" && (value.length > 40 || /[\r\n"]/.test(value))) {
        throw new HttpError("Enter the membership number the club gave.", 400, "INVALID_INPUT");
      }
      if ((key === "joinDate" || key === "commitmentEndDate") && !isIsoDate(value)) {
        throw new HttpError(`${LABELS[key]} must be a date.`, 400, "INVALID_INPUT");
      }
    }
    const was = (expectIn as Record<string, unknown>)[key];
    if (!(key in expectIn) || (was !== null && typeof was !== "string")) {
      throw new HttpError("Reload the page and try again.", 400, "INVALID_INPUT");
    }
    patch[MEMBERSHIP_FIELDS[key]] = value;
    expect[MEMBERSHIP_FIELDS[key]] = was ?? null;
  }
  if (Object.keys(patch).length === 0) throw new HttpError("Nothing to save.", 400, "INVALID_INPUT");
  return { patch, expect, sharedNumberAcknowledged: body.sharedNumberAcknowledged === true };
}

export async function saveMembership(
  env: Env,
  actor: AuthorizedUser,
  personId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; changed: string[]; removedPeriods: number }> {
  const change = parseMembershipChange(body);
  const p = await readPerson(env, personId);

  // Commitment end after join date, with whichever of the two isn't changing.
  const joinDate = "join_date" in change.patch ? change.patch.join_date : p.join_date;
  const endDate = "commitment_end_date" in change.patch ? change.patch.commitment_end_date : p.commitment_end_date;
  if (joinDate && endDate && endDate <= joinDate) {
    throw new HttpError("Commitment end date must be after the join date.", 400, "INVALID_INPUT");
  }

  // A shared number is a warning, as at Approve: families share one.
  const number = change.patch.membership_no;
  if (number && number !== (p.membership_no ?? "").trim() && !change.sharedNumberAcknowledged) {
    const holders = await getNumberHolders(env, number, p.api_id);
    if (holders.length > 0) {
      throw new HttpError(
        `Membership number ${number} is already used by ${describeHolders(holders)}. Check it is meant to be shared, then save again.`,
        409,
        "SHARED_MEMBERSHIP_NO",
      );
    }
  }

  const result = await adminRpc<UpdateResult>(
    env,
    "admin_update_person",
    { p_person: p.api_id, p_actor: actor.personId, p_action: "admin-membership", p_patch: change.patch, p_expect: change.expect },
    { messages: { NOT_FOUND: "Person not found." } },
  );
  // Dates re-run the commitment periods (trigger), and a correction removes
  // untouched periods the new dates leave out; boards and statements read these.
  if (result.changed.length > 0) await invalidatePeople(env);
  if (result.changed.some((c) => c === "join_date" || c === "commitment_end_date")) await invalidateCommitments(env);
  return { ok: true, changed: result.changed, removedPeriods: result.removedPeriods ?? 0 };
}

const STAGE_CHANGED = "The stage changed while you had this open. Reload and try again.";

/**
 * Moves the applicant stage by hand. `from` is the stage the screen showed:
 * if it has moved since, 409 STAGE_CHANGED. Stages 1-6 make them an
 * Applicant again; Temporary makes an Applicant a Member (the
 * people_accept_status trigger).
 */
export async function moveStage(
  env: Env,
  actor: AuthorizedUser,
  personId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; changed: string[] }> {
  const stage = typeof body.stage === "string" ? body.stage : "";
  const from = body.from === null ? null : typeof body.from === "string" ? body.from : undefined;
  if (!stage || from === undefined) throw new HttpError("Choose a stage.", 400, "INVALID_INPUT");

  const p = await readPerson(env, personId);
  if ((p.applicant_stage || null) !== (from || null)) throw new HttpError(STAGE_CHANGED, 409, "STAGE_CHANGED");
  if (!stageTargets(p.status, p.applicant_stage).includes(stage)) {
    throw new HttpError("That stage can't be chosen here.", 400, "INVALID_INPUT");
  }

  const patch: Record<string, string> = { applicant_stage: stage };
  if (isOpenStage(stage)) patch.status = "Applicant";
  const result = await adminRpc<UpdateResult>(
    env,
    "admin_update_person",
    { p_person: p.api_id, p_actor: actor.personId, p_action: "admin-stage", p_patch: patch, p_expect: { applicant_stage: from } },
    { conflictCode: "STAGE_CHANGED", messages: { STAGE_CHANGED, NOT_FOUND: "Person not found." } },
  );
  if (result.changed.length > 0) await invalidatePeople(env);
  return { ok: true, changed: result.changed };
}
