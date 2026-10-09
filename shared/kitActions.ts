import { hkDateKey } from "./hkDateKey";
import type { KitOrder, KitSet } from "./kit";

export interface KitNextAction {
  label: string;
  since: string | null;
  basis: "since arrival" | "awaiting confirmation" | "with holder";
}

/** Use the current stage's date, rather than ageing an offer from an earlier collection. */
export function kitNextAction(set: KitSet, order: KitOrder | null): KitNextAction | null {
  if (set.place === "on_order") return null;
  if (set.pendingTo) {
    return { label: `Chase confirmation from ${set.pendingTo.name}`, since: set.pendingSince ?? null, basis: "awaiting confirmation" };
  }
  if (set.place === "with_owner") return null;
  if (!set.owner) return null;
  if (set.place === "in_store") {
    return { label: "Arrange collection", since: order?.receivedOn ?? null, basis: "since arrival" };
  }
  return { label: "Hand over to owner", since: set.heldSince, basis: "with holder" };
}

function started(action: KitNextAction): number {
  // Receipt dates have no time: treat them as Hong Kong dates, like the rest of Kit.
  return action.since ? Date.parse(action.since.length === 10 ? `${action.since}T00:00:00+08:00` : action.since) : NaN;
}

export function kitActionAge(action: KitNextAction, now = Date.now()): string {
  const at = started(action);
  if (!Number.isFinite(at)) return "Age not recorded";
  const days = Math.max(0, Math.round((Date.parse(hkDateKey(new Date(now).toISOString())) - Date.parse(hkDateKey(new Date(at).toISOString()))) / 86_400_000));
  return `${days} ${days === 1 ? "day" : "days"} ${action.basis}`;
}

/** Outstanding actions first, oldest recorded date first; retain number order for ties. */
export function byKitAction(order: KitOrder | null): (a: KitSet, b: KitSet) => number {
  return (a, b) => {
    const left = kitNextAction(a, order);
    const right = kitNextAction(b, order);
    if (!!left !== !!right) return left ? -1 : 1;
    const date = (action: KitNextAction | null) => {
      const at = action ? started(action) : NaN;
      return Number.isFinite(at) ? at : Infinity;
    };
    return (date(left) - date(right) || 0) || a.shirtNo - b.shirtNo || a.id.localeCompare(b.id);
  };
}
