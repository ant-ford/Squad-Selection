import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSection: vi.fn() }));
vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));

import worker from "../worker/src/index";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { HttpError } from "../worker/src/http";
import { parseResolve, resolveRegistrationEvent } from "../worker/src/reRegistrations";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  ALLOWED_ORIGIN: "https://hkfc-squad-selection.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "k",
} as Env;
const captain = {
  email: "c@x.com",
  personId: "recCAPTAIN",
  role: "coach",
  coachTeams: [],
  isSectionCaptain: true,
  officerRoles: [{ office: "sectionCaptain", designation: "" }],
} as unknown as AuthorizedUser;
const EVENT = "00000000-0000-4000-8000-0000000000a1";

type Call = { url: URL; method: string; body: any };
let calls: Call[];
function rpcAnswers(answer: { status: number; body: unknown }) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  mocks.requireSection.mockReset();
});

describe("parseResolve", () => {
  it("takes keep, or move with a team", () => {
    expect(parseResolve({ action: "keep", team: "ignored" })).toEqual({ action: "keep" });
    expect(parseResolve({ action: "move", team: " HKFC C " })).toEqual({ action: "move", team: "HKFC C" });
  });
  it.each([[{}], [{ action: "move" }], [{ action: "move", team: "" }], [{ action: "move", team: 3 }], [{ action: "promote" }]])(
    "refuses %j with a 400",
    (body) => {
      expect(() => parseResolve(body as Record<string, unknown>)).toThrow(HttpError);
    },
  );
});

describe("resolveRegistrationEvent", () => {
  it("moves through the SQL function, as the signed-in officer", async () => {
    rpcAnswers({ status: 200, body: { status: "ok", team: "HKFC C" } });
    await expect(resolveRegistrationEvent(env, captain, EVENT, { action: "move", team: "HKFC C", actor: "recSOMEONE" })).resolves.toEqual({
      ok: true,
      team: "HKFC C",
    });
    const rpc = calls.find((c) => c.url.pathname.endsWith("/rpc/resolve_registration_event"))!;
    expect(rpc.method).toBe("POST");
    expect(rpc.body).toEqual({ p_event: EVENT, p_action: "move", p_team: "HKFC C", p_actor: "recCAPTAIN" });
  });

  it("keeps with no team", async () => {
    rpcAnswers({ status: 200, body: { status: "ok", team: "HKFC D" } });
    await resolveRegistrationEvent(env, captain, EVENT, { action: "keep" });
    expect(calls[0].body).toMatchObject({ p_action: "keep", p_team: null });
  });

  it.each([
    ["ALREADY_RESOLVED", "already been dealt with"],
    ["TEAM_CHANGED", "has changed since"],
    ["NOT_A_MOVE_UP", "above their registered team"],
    ["OLD_SEASON", "earlier season"],
  ])("answers a %s conflict with a 409 in plain words", async (code, words) => {
    rpcAnswers({ status: 200, body: { status: "conflict", code } });
    await expect(resolveRegistrationEvent(env, captain, EVENT, { action: "move", team: "HKFC B" })).rejects.toMatchObject({
      status: 409,
      code,
      message: expect.stringContaining(words),
    });
  });

  it("answers an unknown event 404 and an unknown team 400", async () => {
    rpcAnswers({ status: 404, body: { code: "P0002", message: "No registration event" } });
    await expect(resolveRegistrationEvent(env, captain, EVENT, { action: "keep" })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    rpcAnswers({ status: 400, body: { code: "22023", message: "No ranked team" } });
    await expect(resolveRegistrationEvent(env, captain, EVENT, { action: "move", team: "Nope" })).rejects.toMatchObject({ status: 400, code: "INVALID_INPUT" });
  });

  it("refuses an id that isn't a uuid without calling the database", async () => {
    rpcAnswers({ status: 200, body: {} });
    await expect(resolveRegistrationEvent(env, captain, "x';drop", { action: "keep" })).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/admin/registration-events/:id/resolve", () => {
  const post = (body: unknown) =>
    worker.fetch(
      new Request(`https://hkfc-api.test/api/admin/registration-events/${EVENT}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer valid.jwt.token" },
        body: JSON.stringify(body),
      }),
      env,
      { waitUntil: () => {} } as any,
    );

  it("is refused without the dataChecks section, before anything is written", async () => {
    rpcAnswers({ status: 200, body: { status: "ok", team: "HKFC C" } });
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await post({ action: "keep" });
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("dataChecks");
    expect(calls.filter((c) => c.url.pathname.includes("/rpc/"))).toHaveLength(0);
  });

  it("resolves for a Section Captain", async () => {
    rpcAnswers({ status: 200, body: { status: "ok", team: "HKFC D" } });
    mocks.requireSection.mockResolvedValue(captain);
    const res = await post({ action: "keep" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, team: "HKFC D" });
  });
});
