import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { AuthClient } from "@supabase/auth-js";
import { authClientOptions } from "../src/lib/authClientOptions";

// The frontend used to sign in through supabase-js's createClient(url, key).auth
// and now builds the AuthClient itself. If anything differs - above all the
// localStorage key - everyone already signed in is signed out on the next
// deploy, so the two are compared field by field on real instances.
//
// supabase-js stays a devDependency for this test only.

const KEY = "sb_publishable_test-key";
const URLS = [
  "https://biipqddulsbjpbmxuoss.supabase.co",
  "https://biipqddulsbjpbmxuoss.supabase.co/",
  " https://example-ref.supabase.co ",
  "http://127.0.0.1:54321",
];

// Fields that legitimately differ. Everything else on the instances must match.
const DIFFERS = new Set([
  // A per-storage-key counter: the second client built in a test is #1.
  "instanceID",
  // Objects of bound methods / sub-clients; their inputs are compared below.
  "admin", "mfa", "oauth", "passkey",
  // supabase-js also sends "X-Client-Info: supabase-js/<version>"; compared below.
  "headers",
  // supabase-js passes these as undefined, auth-js defaults them to
  // false / 5000. All falsy or unused: lockAcquireTimeout only applies with a
  // custom lock, and both clients have none (lock is compared and is null).
  "throwOnError", "lockAcquireTimeout",
  // supabase-js subscribes to auth changes itself, to pass tokens to Realtime.
  "stateChangeEmitters",
]);

const fields = (c: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v !== "function" && !DIFFERS.has(k)) out[k] = v;
  }
  return out;
};

describe("authClientOptions", () => {
  // Look like a browser to auth-js (it picks localStorage only in one),
  // without starting initialisation, timers or BroadcastChannels.
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the production storage key and auth URL", () => {
    const opts = authClientOptions("https://biipqddulsbjpbmxuoss.supabase.co", KEY);
    expect(opts.storageKey).toBe("sb-biipqddulsbjpbmxuoss-auth-token");
    expect(opts.url).toBe("https://biipqddulsbjpbmxuoss.supabase.co/auth/v1");
    expect(opts.headers).toEqual({ apikey: KEY, Authorization: `Bearer ${KEY}` });
  });

  for (const url of URLS) {
    it(`builds the same auth client as supabase-js for ${JSON.stringify(url)}`, () => {
      const theirs = createClient(url, KEY, { auth: { skipAutoInitialize: true } }).auth;
      const ours = new AuthClient({ ...authClientOptions(url, KEY), skipAutoInitialize: true });

      expect(fields(ours)).toEqual(fields(theirs));

      const t = theirs as unknown as Record<string, unknown>;
      const o = ours as unknown as Record<string, unknown>;
      expect(o.storage).toBe(localStorage);
      expect(t.storage).toBe(localStorage);
      expect(o.lock).toBeNull();
      expect(t.lock).toBeNull();
      expect(o.flowType).toBe("implicit");
      expect(o.detectSessionInUrl).toBe(true);
      expect(o.autoRefreshToken).toBe(true);
      expect(o.persistSession).toBe(true);
      expect(Boolean(o.throwOnError)).toBe(Boolean(t.throwOnError));

      const { "X-Client-Info": clientInfo, ...theirHeaders } = t.headers as Record<string, string>;
      expect(clientInfo).toMatch(/^supabase-js\//);
      expect(o.headers).toEqual(theirHeaders);
    });
  }
});
