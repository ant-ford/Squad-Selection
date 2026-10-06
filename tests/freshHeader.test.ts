import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FRESH_HEADER, FRESH_WINDOW_MS } from "../shared/freshHeader";
import { corsHeaders } from "../worker/src/http";

// The Worker reuses a person's auth_context answer for a few seconds per
// isolate. So that a person always sees what they just saved, the app marks
// its requests for that long after a save, and the Worker reads afresh for
// those. These pin the app's side; tests/authContextCalls.test.ts the Worker's.

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ supabase: { auth } }));
vi.mock("../src/lib/auth", () => ({ signOut: vi.fn(async () => {}) }));
vi.mock("../src/lib/accessDenied", () => ({ setAccessDenied: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** The header each fetch was sent with, in order. */
const sentFresh = () => fetchMock.mock.calls.map(([, init]) => ((init as RequestInit).headers as Record<string, string>)[FRESH_HEADER] ?? null);

let client: typeof import("../src/lib/apiClient");
beforeEach(async () => {
  vi.resetModules(); // a fresh "last saved" time
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
  vi.stubEnv("VITE_API_URL", "https://api.test");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(200, { ok: true }));
  auth.getSession.mockImplementation(async () => ({ data: { session: { access_token: "t" } } }));
  client = await import("../src/lib/apiClient");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the app's fresh-read header", () => {
  it("is not sent before anything is saved", async () => {
    await client.apiGet("/api/my-fixtures");
    expect(sentFresh()).toEqual([null]);
  });

  it("is sent on every request for the window after a save, then stops", async () => {
    await client.apiPost("/api/set-my-availability", { matchId: "m", status: "Unavailable" });
    await client.apiGet("/api/my-fixtures");
    vi.setSystemTime(Date.now() + FRESH_WINDOW_MS - 1);
    await client.apiGet("/api/my-profile");
    vi.setSystemTime(Date.now() + 2);
    await client.apiGet("/api/my-profile");
    // The save itself, then two marked reads, then back to normal.
    expect(sentFresh()).toEqual([null, "1", "1", null]);
  });

  it("is not started by a save that failed", async () => {
    fetchMock.mockImplementationOnce(async () => json(400, { error: "INVALID_INPUT", message: "No" }));
    await expect(client.apiPost("/api/set-my-availability", {})).rejects.toBeTruthy();
    await client.apiGet("/api/my-fixtures");
    expect(sentFresh()).toEqual([null, null]);
  });
});

describe("the Worker's CORS preflight", () => {
  it("allows the header, so the browser may send it cross-origin", () => {
    expect(corsHeaders("https://app.test")["Access-Control-Allow-Headers"].split(", ")).toEqual(
      expect.arrayContaining(["Content-Type", "Authorization", FRESH_HEADER]),
    );
  });
});
