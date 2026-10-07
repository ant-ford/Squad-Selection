import { describe, it, expect } from "vitest";
import type { User } from "@supabase/auth-js";
import { savedSessionUser, startupOutcome } from "../src/lib/savedSession";

// The app opens as the person whose session is saved on the device, and
// getSession() confirms it behind the screen (src/lib/savedSession.ts).
// These pin who it opens as, and what each first answer does.

const user = (id: string) => ({ id, email: `${id}@example.com`, aud: "authenticated" }) as unknown as User;
const saved = (session: unknown) => JSON.stringify(session);

describe("savedSessionUser", () => {
  it("is the saved person when the session can still be refreshed", () => {
    const raw = saved({ access_token: "a", refresh_token: "r", expires_at: 1, user: user("u1") });
    expect(savedSessionUser(raw)?.id).toBe("u1");
  });

  it("opens as nobody without a saved session", () => {
    expect(savedSessionUser(null)).toBeNull();
    expect(savedSessionUser("")).toBeNull();
  });

  it("opens as nobody when there is no refresh token (it could never be confirmed)", () => {
    expect(savedSessionUser(saved({ access_token: "a", user: user("u1") }))).toBeNull();
    expect(savedSessionUser(saved({ access_token: "a", refresh_token: "", user: user("u1") }))).toBeNull();
  });

  it("opens as nobody when the saved user has no id", () => {
    expect(savedSessionUser(saved({ refresh_token: "r", user: {} }))).toBeNull();
    expect(savedSessionUser(saved({ refresh_token: "r", user: null }))).toBeNull();
    expect(savedSessionUser(saved({ refresh_token: "r" }))).toBeNull();
  });

  it("ignores something that isn't a session", () => {
    expect(savedSessionUser("not json")).toBeNull();
    expect(savedSessionUser("null")).toBeNull();
    expect(savedSessionUser("42")).toBeNull();
  });
});

describe("startupOutcome", () => {
  const a = user("a");
  const b = user("b");

  it("confirms the person the app opened as, keeping what's on screen", () => {
    expect(startupOutcome(a, { session: { user: a }, error: null })).toEqual({ kind: "signed-in", user: a, clearCache: false });
  });

  it("clears what was shown when a different person turns out to be signed in", () => {
    expect(startupOutcome(a, { session: { user: b }, error: null })).toEqual({ kind: "signed-in", user: b, clearCache: true });
  });

  it("signs in normally when the app opened as nobody (a sign-in link)", () => {
    expect(startupOutcome(null, { session: { user: b }, error: null })).toEqual({ kind: "signed-in", user: b, clearCache: false });
  });

  it("goes to sign-in and clears what was shown when Supabase refused the refresh", () => {
    expect(startupOutcome(a, { session: null, error: null })).toEqual({ kind: "signed-out", clearCache: true });
  });

  it("goes to sign-in with nothing to clear when there was never a session", () => {
    expect(startupOutcome(null, { session: null, error: null })).toEqual({ kind: "signed-out", clearCache: false });
  });

  it("stays as the saved person when Supabase can't be reached", () => {
    expect(startupOutcome(a, { session: null, error: new Error("Failed to fetch") })).toEqual({ kind: "unconfirmed", user: a });
  });

  it("shows sign-in when Supabase can't be reached and there was no saved person", () => {
    expect(startupOutcome(null, { session: null, error: new Error("Failed to fetch") })).toEqual({ kind: "unconfirmed", user: null });
  });
});
