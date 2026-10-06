import { describe, expect, it, vi } from "vitest";
import { createUndoQueue, type UndoTimers } from "../src/lib/undoQueue";
import { hasPending, withPending, type PendingAction } from "../src/lib/umpiringPending";
import type { DutyAssignment, UmpireDuty } from "../shared/umpiring";

/** Timers the test fires by hand. */
function manualTimers() {
  let next = 1;
  const live = new Map<number, () => void>();
  const timers: UndoTimers = {
    set: (fn) => {
      const id = next++;
      live.set(id, fn);
      return id;
    },
    clear: (id) => {
      live.delete(id as number);
    },
  };
  const fireAll = () => {
    const fns = [...live.values()];
    live.clear();
    fns.forEach((fn) => fn());
  };
  return { timers, fireAll, count: () => live.size };
}

describe("createUndoQueue", () => {
  it("sends when the delay runs out, not before", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const send = vi.fn();
    q.add("a", send);
    expect(send).not.toHaveBeenCalled();
    expect(q.pending()).toEqual(["a"]);
    t.fireAll();
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.pending()).toEqual([]);
  });

  it("passes the delay to the timer", () => {
    const set = vi.fn(() => 1);
    const q = createUndoQueue(5000, { timers: { set, clear: () => {} } });
    q.add("a", () => {});
    expect(set).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it("undo drops the action and clears its timer", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const send = vi.fn();
    q.add("a", send);
    expect(q.undo("a")).toBe(true);
    expect(t.count()).toBe(0);
    t.fireAll();
    expect(send).not.toHaveBeenCalled();
    expect(q.pending()).toEqual([]);
  });

  it("undo after the send is too late, and says so", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const send = vi.fn();
    q.add("a", send);
    t.fireAll();
    expect(q.undo("a")).toBe(false);
    expect(q.undo("never queued")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a second action sends the waiting one at once", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const first = vi.fn();
    const second = vi.fn();
    q.add("a", first);
    q.add("b", second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(q.pending()).toEqual(["b"]);
    // The first one's timer is gone: it is not sent a second time.
    t.fireAll();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a second action on the same key sends the first, then waits on the second", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const first = vi.fn();
    const second = vi.fn();
    q.add("a", first);
    q.add("a", second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(q.pending()).toEqual(["a"]);
    expect(q.undo("a")).toBe(true);
    t.fireAll();
    expect(second).not.toHaveBeenCalled();
  });

  it("flush (leaving the page) sends everything waiting, once", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const send = vi.fn();
    q.add("a", send);
    q.flush();
    q.flush();
    t.fireAll();
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.pending()).toEqual([]);
  });

  it("a send that throws still lets the others go, and a new action is still queued", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const bad = vi.fn(() => {
      throw new Error("offline");
    });
    const next = vi.fn();
    q.add("a", bad);
    expect(() => q.add("b", next)).toThrow("offline");
    expect(q.pending()).toEqual(["b"]);
    t.fireAll();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("a send that throws is not retried and leaves the queue usable", () => {
    const t = manualTimers();
    const q = createUndoQueue(5000, { timers: t.timers });
    const bad = vi.fn(() => {
      throw new Error("offline");
    });
    q.add("a", bad);
    expect(() => q.flush()).toThrow("offline");
    expect(q.pending()).toEqual([]);
    const good = vi.fn();
    q.add("b", good);
    t.fireAll();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("reports the waiting keys on every change", () => {
    const t = manualTimers();
    const onChange = vi.fn();
    const q = createUndoQueue(5000, { timers: t.timers, onChange });
    q.add("a", () => {});
    q.add("b", () => {});
    q.undo("b");
    q.add("c", () => {});
    t.fireAll();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([["a"], [], ["b"], [], ["c"], []]);
  });

  it("uses real timers by default", () => {
    vi.useFakeTimers();
    try {
      const q = createUndoQueue(5000);
      const send = vi.fn();
      q.add("a", send);
      vi.advanceTimersByTime(4999);
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

const A = (id: string, status: DutyAssignment["status"], more: Partial<DutyAssignment> = {}): DutyAssignment => ({
  id,
  personId: `rec${id}`,
  name: `Ump ${id}`,
  external: false,
  paid: false,
  status,
  createdAt: "2026-10-01T00:00:00Z",
  ...more,
});

const duty = (assignments: DutyAssignment[]): UmpireDuty => ({
  id: "d1",
  matchDate: "2026-10-10T01:00:00Z",
  timeTbc: false,
  division: "2",
  venue: "HKFC",
  homeTeam: "Demo A",
  awayTeam: "Demo B",
  slot: 1,
  dutyTeam: "HKFC D",
  status: "scheduled",
  assignments,
});

describe("withPending", () => {
  it("leaves a duty with nothing waiting untouched (same object)", () => {
    const d = duty([A("a1", "confirmed")]);
    expect(withPending(d, [])).toBe(d);
    expect(withPending(d, [{ kind: "pullOut", assignmentId: "other" }])).toBe(d);
  });

  it.each(["pullOut", "remove", "withdrawOffer"] as const)("%s takes the assignment off the duty", (kind) => {
    const d = duty([A("a1", "confirmed"), A("a2", "offered")]);
    const id = kind === "withdrawOffer" ? "a2" : "a1";
    const out = withPending(d, [{ kind, assignmentId: id }]);
    expect(out.assignments.map((a) => a.id)).toEqual(kind === "withdrawOffer" ? ["a1"] : ["a2"]);
    expect(d.assignments).toHaveLength(2); // not mutated
  });

  it("noShow marks the confirmed umpire as a no-show", () => {
    const d = duty([A("a1", "confirmed", { paid: true })]);
    const out = withPending(d, [{ kind: "noShow", assignmentId: "a1" }]);
    expect(out.assignments).toEqual([{ ...d.assignments[0], status: "no_show" }]);
  });

  it("noShow leaves anything not confirmed as it was", () => {
    const d = duty([A("a1", "offered")]);
    expect(withPending(d, [{ kind: "noShow", assignmentId: "a1" }]).assignments[0].status).toBe("offered");
  });

  it("hasPending: only for the duty holding the assignment", () => {
    const pending: PendingAction[] = [{ kind: "pullOut", assignmentId: "a1" }];
    expect(hasPending(duty([A("a1", "confirmed")]), pending)).toBe(true);
    expect(hasPending(duty([A("a9", "confirmed")]), pending)).toBe(false);
    expect(hasPending(duty([A("a1", "confirmed")]), [])).toBe(false);
  });
});
