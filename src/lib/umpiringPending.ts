import type { DutyAssignment, UmpireDuty } from '@shared/umpiring';

/**
 * The Umpire view's actions that wait out an Undo toast (src/lib/undoQueue.ts)
 * before they are sent, and how a duty looks while one is waiting.
 *
 * Why wait rather than send and reverse: none of these has a clean reverse
 * in worker/src/umpiring.ts. A withdrawn assignment cannot be restored (taking
 * the duty again makes a new row, loses who confirmed it and when, needs the
 * game still upcoming, and fails if someone else has taken it in between),
 * and the coordinator has no way to put a withdrawn paid offer back at all.
 */
export type PendingKind = 'pullOut' | 'withdrawOffer' | 'remove' | 'noShow';

export interface PendingAction {
  kind: PendingKind;
  assignmentId: string;
}

/** The toast's words; its button says "Undo". */
export const pendingLabel: Record<PendingKind, string> = {
  pullOut: 'Pulled out',
  withdrawOffer: 'Offer withdrawn',
  remove: 'Removed',
  noShow: 'Marked no-show',
};

/** One queue key per assignment: a second action on the same one sends the first. */
export const pendingKey = (a: Pick<PendingAction, 'assignmentId'>) => a.assignmentId;

/** The duty as it will be once the waiting actions are sent. */
export function withPending(duty: UmpireDuty, pending: readonly PendingAction[]): UmpireDuty {
  if (pending.length === 0) return duty;
  const byId = new Map(pending.map((p) => [p.assignmentId, p.kind]));
  let changed = false;
  const assignments = duty.assignments.flatMap((a): DutyAssignment[] => {
    const kind = byId.get(a.id);
    if (!kind) return [a];
    changed = true;
    if (kind === 'noShow') return a.status === 'confirmed' ? [{ ...a, status: 'no_show' }] : [a];
    return [];
  });
  return changed ? { ...duty, assignments } : duty;
}

/** True when the duty has an action waiting (its buttons stay hidden until it is sent or undone). */
export const hasPending = (duty: Pick<UmpireDuty, 'assignments'>, pending: readonly PendingAction[]) =>
  pending.some((p) => duty.assignments.some((a) => a.id === p.assignmentId));
