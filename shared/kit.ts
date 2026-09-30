/**
 * Kit: orders from a supplier, one set per shirt number, who has each set,
 * and the spares. See supabase/migrations/20260930210000_kit.sql.
 *
 * A set belongs to whoever holds its number. A set whose number nobody holds
 * is a spare. Shirts are printed with the number, so a set's shirt size is
 * fixed; the other items can be swapped.
 */

export type KitPlace =
  /** The order hasn't arrived. */
  | "on_order"
  /** With the Kit Convenor. */
  | "in_store"
  /** Its owner has it: done. */
  | "with_owner"
  /** Someone is holding it for its owner (a captain, a friend). */
  | "with_holder";

export interface KitSizes {
  shirt: string | null;
  shorts: string | null;
  socks: string | null;
  goalieSmock: string | null;
  goalieSmockStyle: string | null;
}

export const KIT_ITEMS: { key: keyof KitSizes; label: string }[] = [
  { key: "shirt", label: "Shirt" },
  { key: "shorts", label: "Shorts" },
  { key: "socks", label: "Socks" },
  { key: "goalieSmock", label: "Smock" },
  { key: "goalieSmockStyle", label: "Smock style" },
];

/** The size choices, per supplier's chart. Sizes are stored as these words. */
export const KIT_SIZE_OPTIONS: Record<keyof KitSizes, string[]> = {
  shirt: ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
  shorts: ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
  socks: ["Small", "Medium", "Large", "X-Large"],
  goalieSmock: ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL"],
  goalieSmockStyle: ["Short Sleeve", "Long Sleeve"],
};

export interface KitPersonRef {
  id: string;
  name: string;
}

export interface KitSet {
  id: string;
  shirtNo: number;
  /** The number's range, e.g. "HKFC A" (higher teams have lower numbers). */
  teamRange: string | null;
  sizes: KitSizes;
  /** Who it was ordered for, as the order file names them. */
  orderedForName: string | null;
  owner: (KitPersonRef & { team: string; status: string }) | null;
  holder: KitPersonRef | null;
  heldSince: string | null;
  place: KitPlace;
  /** Items where the owner's own sizes differ from the set's, e.g. "Shorts: wants XL". */
  mismatches: string[];
}

export interface KitOrder {
  id: string;
  supplier: string;
  name: string;
  orderedOn: string | null;
  receivedOn: string | null;
}

/** A person the kit screens can hand kit to or allocate a spare to. */
export interface KitPerson extends KitPersonRef {
  /** Every name they go by, lower case, for search ("ant anthony john ford"). */
  search: string;
  team: string;
  status: string;
  shirtNo: number | null;
  /** Their own sizes for the order's supplier. */
  sizes: KitSizes;
  /** Whether a set in this order carries their number. */
  hasSet: boolean;
}

/** GET /api/kit/board?order=: the kit screens (Kit Convenor, Section Captains). */
export interface KitBoard {
  orders: KitOrder[];
  order: KitOrder | null;
  sets: KitSet[];
  /** Members and applicants, by name. */
  people: KitPerson[];
  /** Teams in rank order, as the number ranges run. */
  teams: string[];
}

export interface KitMove {
  kind: "handed" | "delivered" | "returned" | "allocated" | "released" | "edited";
  from: string | null;
  to: string | null;
  by: string | null;
  note: string | null;
  at: string;
}

/** GET /api/kit/me: the player's own kit, and any they're holding for others. */
export interface MyKit {
  /** The player's own id, as the kit moves name people. */
  personId: string;
  mine: (Pick<KitSet, "id" | "shirtNo" | "sizes" | "holder" | "heldSince" | "place"> & { supplier: string }) | null;
  holding: Pick<KitSet, "id" | "shirtNo" | "owner" | "heldSince" | "sizes">[];
  /** Who hands kit out, for "collect it from ...". */
  convenors: string[];
}

export interface KitMoveResult {
  moved: string[];
  conflicts: { id: string; shirtNo: number | null; reason: string }[];
}

/** The index of a team or number range ("HKFC A" = 0) for ordering by rank. */
function rankOf(team: string | null, teams: readonly string[]): number {
  const i = team ? teams.indexOf(team) : -1;
  return i < 0 ? teams.length : i;
}

/**
 * Spares that fit a person, best first. The shirt must fit (it's printed);
 * then a number from their own team's range, since higher teams usually get
 * the lower numbers; then the most other items that fit; then the lower
 * number. Without a shirt size on record nothing is offered: ask them first.
 */
export function suggestSpares(person: Pick<KitPerson, "team" | "sizes">, spares: KitSet[], teams: readonly string[]): KitSet[] {
  const want = person.sizes;
  if (!want.shirt) return [];
  const fits = spares.filter((s) => !s.owner && s.sizes.shirt === want.shirt);
  const others = (s: KitSet) =>
    (["shorts", "socks", "goalieSmock"] as const).filter((k) => want[k] && s.sizes[k] === want[k]).length;
  const home = rankOf(person.team, teams);
  return [...fits].sort(
    (a, b) =>
      Math.abs(rankOf(a.teamRange, teams) - home) - Math.abs(rankOf(b.teamRange, teams) - home) ||
      others(b) - others(a) ||
      a.shirtNo - b.shirtNo,
  );
}

/** Where a set is, in a few words. */
export function describePlace(set: Pick<KitSet, "place" | "holder">): string {
  switch (set.place) {
    case "on_order":
      return "On order";
    case "in_store":
      return "In the kit store";
    case "with_owner":
      return "Handed out";
    case "with_holder":
      return `With ${set.holder?.name ?? "someone"}`;
  }
}
