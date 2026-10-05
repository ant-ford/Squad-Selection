import { describe, expect, it } from "vitest";
import { kitHolders, sizeCounts, splitOrder, type KitSet, type KitSizes } from "../shared/kit";

const sizes = (more: Partial<KitSizes>): KitSizes => ({ shirt: null, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null, ...more });
const set = (shirtNo: number, more: Partial<KitSet>): KitSet => ({
  id: `s${shirtNo}`, shirtNo, teamRange: null, sizes: sizes({}), orderedForName: null, owner: null, numberHeldBy: null,
  holder: null, heldSince: null, pendingTo: null, place: "in_store", mismatches: [], wanted: null, ...more,
});
const owner = (id: string) => ({ id, name: id, team: "HKFC A", status: "Member" });

describe("kit insights", () => {
  it("counts sizes in chart order, with spares and the people with no size", () => {
    const people = [{ sizes: sizes({ shirt: "XL" }) }, { sizes: sizes({ shirt: "M" }) }, { sizes: sizes({ shirt: "XL" }) }, { sizes: sizes({}) }, { sizes: sizes({ shirt: "XXXL" }) }];
    const sets = [set(1, { sizes: sizes({ shirt: "M" }) }), set(2, { sizes: sizes({ shirt: "S" }) }), set(3, { owner: owner("a"), sizes: sizes({ shirt: "XL" }) })];
    expect(sizeCounts("shirt", people, sets)).toEqual({
      rows: [
        { size: "S", people: 0, spares: 1 },
        { size: "M", people: 1, spares: 1 },
        { size: "XL", people: 2, spares: 0 },
        // Not on the chart: last.
        { size: "XXXL", people: 1, spares: 0 },
      ],
      missing: 1,
    });
  });

  it("splits a re-order across sizes so the parts add up", () => {
    expect(splitOrder([10, 20, 10], 8)).toEqual([2, 4, 2]);
    expect(splitOrder([1, 1, 1], 10).reduce((a, b) => a + b)).toBe(10);
    expect(splitOrder([5, 3, 2], 7)).toEqual([4, 2, 1]);
    expect(splitOrder([0, 0], 5)).toEqual([0, 0]);
    expect(splitOrder([3, 4], 0)).toEqual([0, 0]);
  });

  it("lists who holds other people's kit, most first, with whose", () => {
    const cap = { id: "cap", name: "Cap Tain" };
    const sets = [
      set(7, { owner: owner("b"), holder: cap, place: "with_holder" }),
      set(5, { owner: owner("a"), holder: cap, place: "with_holder", pendingTo: { id: "a", name: "a" } }),
      set(9, { holder: { id: "pal", name: "Al Pal" }, place: "with_holder" }),
      // Its owner has it, and the store isn't a person.
      set(3, { owner: owner("c"), holder: { id: "c", name: "c" }, place: "with_owner" }),
      set(4, { owner: owner("d") }),
    ];
    const holders = kitHolders(sets);
    expect(holders.map((h) => [h.name, h.sets.map((s) => s.shirtNo)])).toEqual([["Cap Tain", [5, 7]], ["Al Pal", [9]]]);
    expect(holders[1].sets[0].owner).toBeNull();
  });
});
