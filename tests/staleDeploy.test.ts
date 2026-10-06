// ---------------------------------------------------------------------------
// Recovery from a client holding a previous deploy (src/lib/staleDeploy.ts).
//
// First failure in a tab: plain reload, service worker and caches kept.
// Second: unregister the worker, delete every cache, reload.
// Third and later: give up, so the error shows instead of a reload loop.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recover = () => Promise<boolean>;

/** sessionStorage that survives "reloads" (fresh module imports) within a test. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

let storage: ReturnType<typeof memoryStorage>;
let reload: ReturnType<typeof vi.fn>;
let unregister: ReturnType<typeof vi.fn>;
let deleteCache: ReturnType<typeof vi.fn>;

function stubBrowser(sessionStorage: unknown = storage) {
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] },
  });
  const caches = { keys: async () => ["workbox-precache-v2", "app-shell"], delete: deleteCache };
  vi.stubGlobal("caches", caches);
  vi.stubGlobal("window", { location: { reload }, caches });
}

/** A fresh page load: module state reset, sessionStorage kept. */
async function loadPage(): Promise<Recover> {
  vi.resetModules();
  return (await import("../src/lib/staleDeploy")).recoverFromStaleDeploy;
}

beforeEach(() => {
  storage = memoryStorage();
  reload = vi.fn();
  unregister = vi.fn(async () => true);
  deleteCache = vi.fn(async () => true);
  stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recoverFromStaleDeploy", () => {
  it("reloads without touching the service worker or caches the first time", async () => {
    const recover = await loadPage();
    expect(await recover()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(unregister).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
  });

  it("clears the service worker and every cache before the second reload", async () => {
    await (await loadPage())();
    reload.mockClear();

    expect(await (await loadPage())()).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleteCache.mock.calls.map((c) => c[0])).toEqual(["workbox-precache-v2", "app-shell"]);
    expect(reload).toHaveBeenCalledTimes(1);
    // Cleared before reloading, not racing it.
    expect(deleteCache.mock.invocationCallOrder[1]).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it("gives up after two reloads in a tab", async () => {
    await (await loadPage())();
    await (await loadPage())();
    reload.mockClear();

    for (let i = 0; i < 3; i++) {
      expect(await (await loadPage())()).toBe(false);
    }
    expect(reload).not.toHaveBeenCalled();
  });

  it("treats the flag left by the clear-everything-first version as used up", async () => {
    storage = memoryStorage({ "stale-deploy-recovered": "1" });
    stubBrowser();
    expect(await (await loadPage())()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("acts once when one failure is reported by several listeners", async () => {
    const recover = await loadPage();
    const results = await Promise.all([recover(), recover(), recover()]);
    expect(results).toEqual([true, true, true]);
    expect(reload).toHaveBeenCalledTimes(1);
    // Still on the first step: the next page load reloads before clearing.
    expect(storage.data.get("stale-deploy-recovered")).toBe("reloaded");
    expect(unregister).not.toHaveBeenCalled();
  });

  it("does nothing when sessionStorage is blocked, so it cannot loop", async () => {
    stubBrowser({
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(await (await loadPage())()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing when the flag cannot be written", async () => {
    stubBrowser({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    expect(await (await loadPage())()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("still reloads when clearing the service worker or caches fails", async () => {
    await (await loadPage())();
    reload.mockClear();
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistrations: () => Promise.reject(new Error("denied")) },
    });
    const caches = { keys: () => Promise.reject(new Error("denied")), delete: deleteCache };
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("window", { location: { reload }, caches });

    expect(await (await loadPage())()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
