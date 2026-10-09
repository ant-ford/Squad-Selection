import { describe, expect, it } from "vitest";
import { byKitAction, kitActionAge, kitNextAction } from "../shared/kitActions";
import type { KitOrder, KitSet } from "../shared/kit";
import { umpiringAttention } from "../shared/umpiringAttention";
import type { DutyAssignment, UmpireDuty, UmpiringBoard } from "../shared/umpiring";

const order: KitOrder = { id: "order", supplier: "Kukri", name: "Order", orderedOn: "2026-09-01", receivedOn: "2026-09-20", expectedOn: null };
const kit = (shirtNo: number, more: Partial<KitSet> = {}): KitSet => ({
  id: `kit${shirtNo}`, shirtNo, teamRange: "HKFC A", sizes: { shirt: "M", shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null },
  orderedForName: null, owner: { id: `player${shirtNo}`, name: `Player ${shirtNo}`, team: "HKFC A", status: "Member" },
  numberHeldBy: null, holder: null, heldSince: null, pendingTo: null, place: "in_store", mismatches: [], wanted: null, ...more,
});
const now = Date.parse("2026-10-10T00:30:00+08:00");
const assignment = (personId: string, status: DutyAssignment["status"] = "confirmed"): DutyAssignment => ({
  id: `a${personId}`, personId, name: personId, external: false, paid: false, status, createdAt: "2026-10-01T12:00:00+08:00",
});
const duty = (id: string, more: Partial<UmpireDuty> = {}): UmpireDuty => ({
  id, matchDate: "2026-10-10T12:00:00+08:00", timeTbc: false, division: "3", venue: "HKFC", homeTeam: id, awayTeam: "Away", slot: 1,
  dutyTeam: "HKFC A", status: "scheduled", notNeeded: false, assignments: [], ...more,
});
const board = (duties: UmpireDuty[], more: Partial<UmpiringBoard> = {}): UmpiringBoard => ({
  access: "coordinator", week: "2026-10-05", weeks: ["2026-10-05"], duties, messages: false, link: "https://example.com/umpiring",
  me: { personId: "me", isUmpire: false, onCommitment: false, commitmentEndDate: null }, ...more,
});

describe("Kit next actions", () => {
  it("puts the oldest collections and handovers before completed kit and spares, with stable number ties", () => {
    const sets = [kit(1, { place: "with_owner" }), kit(2, { owner: null }), kit(5), kit(4),
      kit(80, { place: "with_holder", heldSince: "2026-09-18T19:00:00+08:00" }),
      kit(90, { place: "with_holder", heldSince: "2026-10-01T19:00:00+08:00", pendingTo: { id: "p", name: "Pat" }, pendingSince: "2026-10-07T19:00:00+08:00" })];
    expect(sets.sort(byKitAction(order)).map((s) => s.shirtNo)).toEqual([80, 4, 5, 90, 1, 2]);
    expect(kitActionAge(kitNextAction(sets[1], order)!, now)).toBe("20 days since arrival");
    expect(kitActionAge(kitNextAction(sets[0], order)!, now)).toBe("22 days with holder");
    expect(kitActionAge(kitNextAction(sets[3], order)!, now)).toBe("3 days awaiting confirmation");
  });

  it("doesn't infer a handover offer's age from the earlier collection, including older API responses", () => {
    const pending = kit(8, { place: "with_holder", heldSince: "2026-09-01T12:00:00+08:00", pendingTo: { id: "p", name: "Pat" } });
    const action = kitNextAction(pending, order)!;
    expect(action.label).toContain("Pat");
    expect(kitActionAge(action, now)).toBe("Age not recorded");
    expect([pending, kit(9)].sort(byKitAction(order)).map((s) => s.shirtNo)).toEqual([9, 8]);
    expect(kitNextAction(kit(10, { place: "on_order" }), order)).toBeNull();
  });

  it("ages by Hong Kong calendar days and handles missing, invalid or future timestamps", () => {
    const action = { label: "Hand over", since: "2026-10-09T23:59:00+08:00", basis: "with holder" as const };
    expect(kitActionAge(action, now)).toBe("1 day with holder");
    expect(kitActionAge({ ...action, since: "2026-10-11T12:00:00+08:00" }, now)).toBe("0 days with holder");
    expect(kitActionAge({ ...action, since: "invalid" }, now)).toBe("Age not recorded");
    expect(kitActionAge(kitNextAction(kit(1), null)!, now)).toBe("Age not recorded");
  });

  it("keeps an owner's onward handover and a spare's pending handover actionable", () => {
    const pending = { pendingTo: { id: "p", name: "Pat" }, pendingSince: "2026-10-08T12:00:00+08:00" };
    expect(kitActionAge(kitNextAction(kit(1, { ...pending, place: "with_owner" }), order)!, now)).toBe("2 days awaiting confirmation");
    expect(kitNextAction(kit(2, { ...pending, owner: null, place: "with_holder" }), order)?.label).toContain("Pat");
  });
});

describe("Umpiring attention", () => {
  it("keeps imminent open duties and unconfirmed offers ahead of normal covered duties, with TBC last on its HK day", () => {
    const data = board([
      duty("later", { matchDate: "2026-10-11T09:00:00+08:00" }),
      duty("tbc", { matchDate: "2026-10-10T00:00:00+08:00", timeTbc: true }),
      duty("covered", { assignments: [assignment("Pat")] }),
      duty("offer", { matchDate: "2026-10-10T09:00:00+08:00", assignments: [assignment("Lee", "offered")] }),
      duty("no-show", { matchDate: "2026-10-10T10:00:00+08:00", assignments: [assignment("Sam", "no_show")] }),
    ]);
    const urgent = umpiringAttention(data, now);
    expect(urgent.map((item) => item.duty.id)).toEqual(["offer", "no-show", "tbc", "later"]);
    expect(urgent.every((item) => item.uncovered)).toBe(true);
    expect(umpiringAttention(board([data.duties[1]]), Date.parse("2026-10-11T00:00:00+08:00"))).toEqual([]);
  });

  it("excludes past, cancelled and not-needed duties, including conflicts on those duties", () => {
    expect(umpiringAttention(board([
      duty("past", { matchDate: "2026-10-09T23:00:00+08:00" }),
      duty("cancelled", { status: "cancelled", assignments: [assignment("Pat")], clashes: { Pat: "12:00" } }),
      duty("not-needed", { notNeeded: true }),
    ]), now)).toEqual([]);
  });

  it("flags the assigned umpire's game, rather than every candidate with a clash", () => {
    const urgent = umpiringAttention(board([
      duty("candidate", { assignments: [assignment("Pat")], clashes: { Lee: "12:00" } }),
      duty("conflict", { assignments: [assignment("Sam")], clashes: { Sam: "11:00" } }),
    ]), now);
    expect(urgent.map((item) => item.duty.id)).toEqual(["conflict"]);
    expect(urgent[0]).toMatchObject({ uncovered: false, conflicts: ["Sam is playing at 11:00"] });
  });

  it("shows a viewer's game conflict only for an open duty or their own confirmed assignment", () => {
    const data = board([
      duty("other", { clash: "12:00 My game", assignments: [assignment("Pat")] }),
      duty("mine", { clash: "12:00 My game", assignments: [assignment("me")] }),
      duty("open", { clash: "12:00 My game", matchDate: "2026-10-11T12:00:00+08:00" }),
    ], { access: "umpire", me: { personId: "me", isUmpire: true, onCommitment: false, commitmentEndDate: null } });
    expect(umpiringAttention(data, now).map((item) => [item.duty.id, item.conflicts])).toEqual([
      ["mine", ["Your game 12:00 My game"]], ["open", ["Your game 12:00 My game"]],
    ]);
  });

  it("flags overlapping confirmed umpiring assignments, respects travel margins and ignores removed assignments", () => {
    const first = duty("first", { assignments: [assignment("Pat")] });
    const other = duty("other", { matchDate: "2026-10-10T13:45:00+08:00", assignments: [assignment("Pat")] });
    expect(umpiringAttention(board([first, other]), now)).toEqual([]); // 1h45 at the same ground is allowed.
    expect(umpiringAttention(board([first, { ...other, venue: "King's Park" }]), now).map((item) => item.duty.id)).toEqual(["first", "other"]);
    expect(umpiringAttention(board([first, { ...other, matchDate: "2026-10-10T13:30:00+08:00" }]), now)).toHaveLength(2);
    expect(umpiringAttention(board([first, { ...other, status: "cancelled" }]), now)).toEqual([]);
    expect(umpiringAttention(board([first, { ...other, assignments: [assignment("Pat", "withdrawn")] }]), now).map((item) => item.duty.id)).toEqual(["other"]);
  });
});
