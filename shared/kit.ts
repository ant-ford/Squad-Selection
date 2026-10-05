/**
 * Kit: orders from a supplier, one set per shirt number, who has each set,
 * and the spares. See supabase/migrations/20260930210000_kit.sql.
 *
 * A set belongs to the Active player who holds its number: kit goes only to
 * Active players (owner, 2026-10-01). A set whose number nobody Active holds
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
  /** A spare's number, when someone who isn't Active still holds it: it moves to whoever gets the spare. */
  numberHeldBy: { name: string; status: string } | null;
  holder: KitPersonRef | null;
  heldSince: string | null;
  /** The holder has passed it on and is waiting for this person to confirm they've got it. */
  pendingTo: KitPersonRef | null;
  place: KitPlace;
  /** Items where the owner's own sizes differ from the set's, e.g. "Shorts: wants XL". */
  mismatches: string[];
  /** The owner's own sizes, for swaps. */
  wanted: KitSizes | null;
}

/** What can be swapped between sets. Shirts are printed with the number, so never. */
export const SWAPPABLE = [
  { key: "shorts", label: "Shorts" },
  { key: "socks", label: "Socks" },
  { key: "goalieSmock", label: "Smock" },
] as const;
export type SwappableItem = (typeof SWAPPABLE)[number]["key"];

export interface KitSwap {
  item: SwappableItem;
  label: string;
  with: KitSet;
  /** The other set's owner wants this set's size: one swap fixes both. */
  mutual: boolean;
}

/**
 * Swaps that give a set's owner the size they now want for an item: a spare
 * with that size (lowest number first), or another player's set whose owner
 * wants this set's size, which fixes both. Owner decision, 2026-10-01.
 */
export function suggestSwaps(set: KitSet, sets: KitSet[]): KitSwap[] {
  if (!set.owner || !set.wanted) return [];
  const out: KitSwap[] = [];
  for (const { key, label } of SWAPPABLE) {
    const want = set.wanted[key];
    const have = set.sizes[key];
    if (!want || want === have) continue;
    const others = sets.filter((s) => s.id !== set.id && s.sizes[key] === want).sort((a, b) => a.shirtNo - b.shirtNo);
    const mutual = others.find((s) => s.owner && s.wanted?.[key] === have);
    const spare = others.find((s) => !s.owner);
    if (mutual) out.push({ item: key, label, with: mutual, mutual: true });
    if (spare) out.push({ item: key, label, with: spare, mutual: false });
  }
  return out;
}

export interface KitOrder {
  id: string;
  supplier: string;
  name: string;
  orderedOn: string | null;
  receivedOn: string | null;
  /** When the supplier says it will arrive, for players waiting on it. */
  expectedOn: string | null;
}

/** A person the kit screens can hand kit to or allocate a spare to. */
export interface KitPerson extends KitPersonRef {
  /** Every name they go by, lower case, for search ("ant anthony john ford"). */
  search: string;
  team: string;
  status: string;
  /** Only Active players get kit. */
  active: boolean;
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
  /** Members and applicants, by name (anyone may collect kit; only Active players get it). */
  people: KitPerson[];
  /** Teams in rank order, as the number ranges run. */
  teams: string[];
}

export interface KitMove {
  kind: "handed" | "delivered" | "returned" | "allocated" | "released" | "edited" | "offered" | "declined";
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
  mine: (Pick<KitSet, "id" | "shirtNo" | "sizes" | "holder" | "heldSince" | "place" | "pendingTo"> & { supplier: string; expectedOn: string | null }) | null;
  holding: Pick<KitSet, "id" | "shirtNo" | "owner" | "heldSince" | "sizes" | "pendingTo">[];
  /** Sets someone says they've given them, waiting for them to confirm (their own, or one to pass on). */
  incoming: (Pick<KitSet, "id" | "shirtNo" | "owner" | "holder"> & { mine: boolean })[];
  /** Who hands kit out, for "collect it from ...". */
  convenors: string[];
}

export interface KitMoveResult {
  moved: string[];
  /** Passed on by a holder: waiting for the receiver to confirm. */
  offered: string[];
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
export function describePlace(set: Pick<KitSet, "place" | "holder"> & { pendingTo?: KitPersonRef | null }): string {
  switch (set.place) {
    case "on_order":
      return "On order";
    case "in_store":
      return "In the kit store";
    case "with_owner":
      return "Handed out";
    case "with_holder":
      return set.pendingTo ? `With ${set.holder?.name ?? "someone"}, offered to ${set.pendingTo.name}` : `With ${set.holder?.name ?? "someone"}`;
  }
}

/**
 * Suppliers' size charts, for the size pickers (inches). Kukri's from its
 * size guide and goalkeeper smock sizing (owner, 2026-09-30).
 */
export const KIT_SIZE_CHARTS: Record<string, { garment: string; columns: string[]; rows: [string, ...number[]][] }[]> = {
  Kukri: [
    {
      garment: "Shirts and shorts",
      columns: ["To fit chest", "To fit waist"],
      rows: [["2XS", 34, 28], ["XS", 36, 30], ["S", 38, 32], ["M", 40, 34], ["L", 42, 36], ["XL", 44, 38], ["2XL", 46, 40], ["3XL", 48, 42], ["4XL", 50, 44]],
    },
    {
      garment: "Goalkeeper smock",
      columns: ["Chest", "Hem"],
      rows: [["2XS", 46, 46], ["XS", 49, 49], ["S", 51, 51], ["M", 53, 53], ["L", 56, 56], ["XL", 58, 58], ["2XL", 60.5, 60.5]],
    },
  ],
};

// ── Insights (owner, 6 Oct 2026): sizes for guessing a re-order, and where
// the kit is. Worked out from the board the kit screen already has.

/** The items a size count is kept for: the smock style isn't a size. */
export const SIZE_ITEMS = KIT_ITEMS.filter((i) => i.key !== "goalieSmockStyle") as { key: Exclude<keyof KitSizes, "goalieSmockStyle">; label: string }[];

export interface SizeCount {
  size: string;
  /** People in the group who wear this size. */
  people: number;
  /** Spare sets in this order in this size (no Active owner). */
  spares: number;
}

/**
 * How many people wear each size of one item, in the size chart's order
 * (any size not on the chart goes last), with the spares in each size.
 * `missing` is how many in the group have no size for it.
 */
export function sizeCounts(item: keyof KitSizes, people: Pick<KitPerson, "sizes">[], sets: Pick<KitSet, "owner" | "sizes">[]) {
  const chart = KIT_SIZE_OPTIONS[item];
  const byPeople = new Map<string, number>();
  const bySpares = new Map<string, number>();
  let missing = 0;
  for (const p of people) {
    const s = p.sizes[item];
    if (s) byPeople.set(s, (byPeople.get(s) ?? 0) + 1);
    else missing++;
  }
  for (const set of sets) {
    const s = set.sizes[item];
    if (!set.owner && s) bySpares.set(s, (bySpares.get(s) ?? 0) + 1);
  }
  const seen = [...new Set([...byPeople.keys(), ...bySpares.keys()])];
  const order = [...chart.filter((s) => seen.includes(s)), ...seen.filter((s) => !chart.includes(s))];
  const rows: SizeCount[] = order.map((size) => ({ size, people: byPeople.get(size) ?? 0, spares: bySpares.get(size) ?? 0 }));
  return { rows, missing };
}

/**
 * Splits an order of `total` across sizes in proportion to how many wear
 * each (largest remainder, so the parts add up to the total exactly).
 */
export function splitOrder(counts: number[], total: number): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum === 0 || total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c * total) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || counts[b[1]] - counts[a[1]]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

export interface KitHolder extends KitPersonRef {
  /** Sets they have that belong to someone else, or are spares. */
  sets: Pick<KitSet, "id" | "shirtNo" | "owner" | "heldSince" | "pendingTo">[];
}

/**
 * Who has kit that isn't theirs (captains, friends collecting for others),
 * most sets first. The kit store isn't a person, so it isn't listed.
 */
export function kitHolders(sets: KitSet[]): KitHolder[] {
  const by = new Map<string, KitHolder>();
  for (const s of sets) {
    if (s.place !== "with_holder" || !s.holder) continue;
    const h = by.get(s.holder.id) ?? { ...s.holder, sets: [] };
    h.sets.push({ id: s.id, shirtNo: s.shirtNo, owner: s.owner, heldSince: s.heldSince, pendingTo: s.pendingTo });
    by.set(s.holder.id, h);
  }
  return [...by.values()]
    .map((h) => ({ ...h, sets: h.sets.sort((a, b) => a.shirtNo - b.shirtNo) }))
    .sort((a, b) => b.sets.length - a.sets.length || a.name.localeCompare(b.name));
}
