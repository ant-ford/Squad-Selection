import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Users kept being signed out - on every device. The app signed out on the
// first 401 from the API, with Supabase's default "everywhere" scope, even
// though a 401 usually just meant the one-hour access token had run out.
// These pin the replacement: refresh and retry once, and sign out (this
// device only) only when Supabase refuses the refresh itself.

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));
const signOut = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../src/lib/supabase", () => ({ supabase: { auth } }));
vi.mock("../src/lib/auth", () => ({ signOut }));
vi.mock("../src/lib/accessDenied", () => ({ setAccessDenied: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

let apiGet: typeof import("../src/lib/apiClient").apiGet;
let apiPost: typeof import("../src/lib/apiClient").apiPost;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const unauthorised = () => json(401, { error: "UNAUTHORIZED", message: "Invalid or expired session" });

let token = "old-token";
const fetchMock = vi.fn();

beforeEach(async () => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  fetchMock.mockReset();
  signOut.mockClear();
  token = "old-token";
  auth.getSession.mockImplementation(async () => ({ data: { session: { access_token: token } } }));
  auth.refreshSession.mockReset();
  ({ apiGet, apiPost } = await import("../src/lib/apiClient"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const sentTokens = () => fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)?.Authorization);

describe("an expired access token", () => {
  it("is refreshed and the request retried, without signing out", async () => {
    fetchMock.mockResolvedValueOnce(unauthorised()).mockResolvedValueOnce(json(200, { ok: true }));
    auth.refreshSession.mockImplementation(async () => {
      token = "new-token";
      return { data: { session: { access_token: token } }, error: null };
    });

    expect(await apiGet("/api/my-fixtures")).toEqual({ ok: true });
    expect(sentTokens()).toEqual(["Bearer old-token", "Bearer new-token"]);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("works the same for a save", async () => {
    fetchMock.mockResolvedValueOnce(unauthorised()).mockResolvedValueOnce(json(200, { success: true }));
    auth.refreshSession.mockImplementation(async () => {
      token = "new-token";
      return { data: { session: { access_token: token } }, error: null };
    });

    expect(await apiPost("/api/squad/sync", { matchId: "m" })).toEqual({ success: true });
    const [, retry] = fetchMock.mock.calls[1];
    expect(retry.method).toBe("POST");
    expect(retry.body).toBe(JSON.stringify({ matchId: "m" }));
    expect(signOut).not.toHaveBeenCalled();
  });

  it("is refreshed once for a burst of requests, not once each", async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      (init.headers as Record<string, string>).Authorization === "Bearer new-token" ? json(200, {}) : unauthorised(),
    );
    auth.refreshSession.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      token = "new-token";
      return { data: { session: { access_token: token } }, error: null };
    });

    await Promise.all([apiGet("/a"), apiGet("/b"), apiGet("/c")]);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe("a session that really is over", () => {
  it("signs out when Supabase refuses the refresh", async () => {
    fetchMock.mockResolvedValue(unauthorised());
    auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), { status: 400 }),
    });

    await expect(apiGet("/api/my-fixtures")).rejects.toMatchObject({ status: 401 });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("never signed out for something that is not their session", () => {
  it("stays signed in when the refresh cannot reach Supabase", async () => {
    const { AuthRetryableFetchError } = await import("@supabase/supabase-js");
    fetchMock.mockResolvedValue(unauthorised());
    auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    await expect(apiGet("/api/my-fixtures")).rejects.toMatchObject({ status: 401 });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("stays signed in when the refresh throws (offline)", async () => {
    fetchMock.mockResolvedValue(unauthorised());
    auth.refreshSession.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiGet("/api/my-fixtures")).rejects.toMatchObject({ status: 401 });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("stays signed in when the API says Supabase is unavailable (503)", async () => {
    fetchMock.mockResolvedValue(json(503, { error: "AUTH_UNAVAILABLE", message: "Sign-in service unavailable" }));

    await expect(apiGet("/api/my-fixtures")).rejects.toMatchObject({ status: 503 });
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("stays signed in when a refreshed token is still refused (a server problem, not theirs)", async () => {
    fetchMock.mockResolvedValue(unauthorised());
    auth.refreshSession.mockImplementation(async () => {
      token = "new-token";
      return { data: { session: { access_token: token } }, error: null };
    });

    await expect(apiGet("/api/my-fixtures")).rejects.toMatchObject({ status: 401 });
    expect(signOut).not.toHaveBeenCalled();
  });
});
