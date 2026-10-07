import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast, toasterReady, onToastQueued, resetToastsForTest } from "../src/lib/toast";

// lib/toast.ts keeps sonner off the first load: calls made before the
// Toaster has loaded wait, then run in order. These pin that hand-over.

function fakeSonner() {
  const calls: unknown[][] = [];
  const record = (kind: string) => (...args: unknown[]) => { calls.push([kind, ...args]); return args[1] && (args[1] as { id?: unknown }).id; };
  const sonner = Object.assign(record("default"), {
    success: record("success"),
    error: record("error"),
    info: record("info"),
    warning: record("warning"),
    message: record("message"),
    dismiss: (id?: unknown) => { calls.push(["dismiss", id]); },
  });
  return { sonner: sonner as unknown as Parameters<typeof toasterReady>[0], calls };
}

describe("toast before and after sonner loads", () => {
  beforeEach(() => resetToastsForTest());

  it("queues calls made before the Toaster is ready, then runs them in order", () => {
    toast.success("Saved");
    toast.error("Couldn't save", { duration: 10_000 });
    const { sonner, calls } = fakeSonner();
    expect(calls).toEqual([]);
    toasterReady(sonner);
    expect(calls.map((c) => c[0])).toEqual(["success", "error"]);
    expect(calls[1][1]).toBe("Couldn't save");
    expect(calls[1][2]).toMatchObject({ duration: 10_000 });
  });

  it("returns an id at once, so a queued toast can be dismissed before sonner arrives", () => {
    const id = toast("Unassigning…", { duration: 5000 });
    toast.success("Saved");
    toast.dismiss(id);
    const { sonner, calls } = fakeSonner();
    toasterReady(sonner);
    // Sonner would apply a same-tick dismiss before the add, so neither is replayed.
    expect(calls.map((c) => [c[0], c[1]])).toEqual([["success", "Saved"]]);
  });

  it("drops everything queued before a dismiss-all", () => {
    toast.success("a");
    toast.dismiss();
    toast.error("b");
    const { sonner, calls } = fakeSonner();
    toasterReady(sonner);
    expect(calls.map((c) => c[1])).toEqual(["b"]);
  });

  it("passes a dismiss straight on once sonner is ready", () => {
    const { sonner, calls } = fakeSonner();
    toasterReady(sonner);
    const id = toast("Unassigning…");
    toast.dismiss(id);
    expect(calls[1]).toEqual(["dismiss", id]);
  });

  it("keeps an id the caller gave", () => {
    expect(toast.info("Hi", { id: "mine" })).toBe("mine");
  });

  it("gives each toast its own id", () => {
    expect(toast.success("a")).not.toBe(toast.success("b"));
  });

  it("goes straight to sonner once it is ready", () => {
    const { sonner, calls } = fakeSonner();
    toasterReady(sonner);
    toast.warning("Still on order");
    toast.message("Nothing new");
    expect(calls.map((c) => c[0])).toEqual(["warning", "message"]);
  });

  it("wakes the Toaster at the first queued toast, and at once if one is already waiting", () => {
    const wake = vi.fn();
    const off = onToastQueued(wake);
    expect(wake).not.toHaveBeenCalled();
    toast.success("Saved");
    expect(wake).toHaveBeenCalledTimes(1);
    off();

    const late = vi.fn();
    onToastQueued(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
