import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getCached, invalidateAll } from "../worker/src/cache";
import { newRequestStats, runWithRequestContext } from "../worker/src/requestContext";

// A request that starts a shared fetch can be cancelled by Cloudflare when
// its client goes away, taking its Airtable/KV calls with it. The shared
// promise then never settles. On 2026-09-24 that left every later request
// on a preview isolate pending for 15+ minutes. A promise that never
// settles is exactly what a cancelled owner looks like to its waiters.
const never = <T,>() => new Promise<T>(() => {});

beforeEach(() => {
  invalidateAll();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCached: a stranded shared fetch", () => {
  it("stops waiting after 20 s and fetches for itself", async () => {
    void getCached("club-reference", never); // the cancelled owner
    const waiter = getCached("club-reference", async () => "fresh");

    await vi.advanceTimersByTimeAsync(20_000);

    expect(await waiter).toEqual({ data: "fresh", fromCache: false });
  });

  it("does not make later callers wait on the dead fetch too", async () => {
    void getCached("club-reference", never);
    const first = getCached("club-reference", async () => "fresh");
    await vi.advanceTimersByTimeAsync(20_000);
    await first;

    // The fresh result is cached, so the next caller does not wait at all.
    let calls = 0;
    const next = await getCached("club-reference", async () => { calls++; return "again"; });
    expect(next).toEqual({ data: "fresh", fromCache: true });
    expect(calls).toBe(0);
  });

  it("still shares a slow fetch that finishes inside the wait", async () => {
    let calls = 0;
    const slow = () => new Promise<string>((resolve) => { calls++; setTimeout(() => resolve("slow"), 15_000); });
    const owner = getCached("all-matches:2026-2027", slow);
    const waiter = getCached("all-matches:2026-2027", slow);

    await vi.advanceTimersByTimeAsync(15_000);

    expect((await owner).data).toBe("slow");
    expect(await waiter).toEqual({ data: "slow", fromCache: true });
    expect(calls).toBe(1);
  });

  it("still passes a shared failure on to its waiters", async () => {
    const failing = getCached("k", () => Promise.reject(new Error("Airtable 500")));
    const waiter = getCached("k", async () => "unused");
    await expect(failing).rejects.toThrow("Airtable 500");
    await expect(waiter).rejects.toThrow("Airtable 500");
  });

  it("lets a stranded fetch that finishes late commit nothing", async () => {
    let finishLate!: (v: string) => void;
    void getCached("k", () => new Promise<string>((resolve) => { finishLate = resolve; }));
    const waiter = getCached("k", async () => "fresh");
    await vi.advanceTimersByTimeAsync(20_000);
    await waiter;

    finishLate("stale");
    await vi.advanceTimersByTimeAsync(0);

    expect((await getCached("k", async () => "unused")).data).toBe("fresh");
  });
});

describe("getCached: the shared fetch outlives the request that started it", () => {
  it("is handed to waitUntil, so a cancelled client does not strand the others", async () => {
    const waitUntil = vi.fn();
    await runWithRequestContext({ stats: newRequestStats(), waitUntil }, () =>
      getCached("club-reference", async () => "v"),
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("is not handed over for a cache hit", async () => {
    await getCached("club-reference", async () => "v");
    const waitUntil = vi.fn();
    await runWithRequestContext({ stats: newRequestStats(), waitUntil }, () =>
      getCached("club-reference", async () => "v"),
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
