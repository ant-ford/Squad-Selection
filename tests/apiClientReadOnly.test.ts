import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// While the Worker's read-only switch is on (worker/src/readOnly.ts), every
// save gets 503 READ_ONLY. The person sees one toast, however many saves
// fail; the save still rejects, so the screen doesn't show it as saved; and
// the failure is never reported back as an app crash.

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } } })),
  refreshSession: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
const signOut = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../src/lib/supabase", () => ({ supabase: { auth } }));
vi.mock("../src/lib/auth", () => ({ signOut }));
vi.mock("../src/lib/accessDenied", () => ({ setAccessDenied: vi.fn() }));
vi.mock("../src/lib/toast", () => ({ toast }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const readOnly = () => json(503, { error: "READ_ONLY", message: "Eddy is read-only for a short while. Your change wasn't saved." });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  fetchMock.mockReset();
  toast.error.mockClear();
  signOut.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a save while Eddy is read-only", () => {
  it("rejects with READ_ONLY and shows one toast", async () => {
    const { apiPost, READ_ONLY_TOAST } = await import("../src/lib/apiClient");
    fetchMock.mockResolvedValue(readOnly());

    await expect(apiPost("/api/set-my-availability", { matchId: "m" })).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "READ_ONLY",
    });
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_TOAST, { id: "READ_ONLY" });
    expect(signOut).not.toHaveBeenCalled();
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("uses the same toast id for every failed save, so it shows once", async () => {
    const { apiPost } = await import("../src/lib/apiClient");
    fetchMock.mockImplementation(async () => readOnly());

    const results = await Promise.allSettled([apiPost("/a", {}), apiPost("/b", {}), apiPost("/c", {})]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const ids = new Set(toast.error.mock.calls.map(([, options]) => (options as { id: string }).id));
    expect(ids).toEqual(new Set(["READ_ONLY"]));
  });

  it("is not reported as a crash", async () => {
    const { apiPost } = await import("../src/lib/apiClient");
    const { reportClientError } = await import("../src/lib/clientErrors");
    fetchMock.mockResolvedValue(readOnly());

    vi.stubGlobal("window", { location: { pathname: "/" } });

    const err = await apiPost("/api/set-my-availability", {}).catch((e: unknown) => e);
    fetchMock.mockReset();
    reportClientError("rejection", err);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    // The control: a real crash is reported.
    fetchMock.mockResolvedValue(json(200, {}));
    reportClientError("rejection", new TypeError("x is undefined"));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/api/client-error", expect.anything());
  });

  it("leaves other 503s as they were: no read-only toast", async () => {
    const { apiPost } = await import("../src/lib/apiClient");
    fetchMock.mockResolvedValue(json(503, { error: "AUTH_UNAVAILABLE", message: "Sign-in service unavailable" }));

    await expect(apiPost("/a", {})).rejects.toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
