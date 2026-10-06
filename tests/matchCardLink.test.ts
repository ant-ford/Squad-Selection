import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// POST /api/admin/match-cards/:id/link: the dataChecks section gate, the
// request rules, and the SQL function's refusals as plain 409s.

const mocks = vi.hoisted(() => ({
  requireSection: vi.fn(),
  rpc: vi.fn(),
  invalidateMatchCards: vi.fn(),
  invalidatePeople: vi.fn(),
}));

vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
vi.mock("../worker/src/data/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/data/supabase")>()),
  db: () => ({ rpc: mocks.rpc }),
}));
vi.mock("../worker/src/invalidation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/invalidation")>()),
  invalidateMatchCards: mocks.invalidateMatchCards,
  invalidatePeople: mocks.invalidatePeople,
}));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";
import { SupabaseError } from "../worker/src/data/supabase";
import { parseLinkRequest } from "../worker/src/matchCardLink";

const ENV = { ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const CTX = { waitUntil: () => {} } as any;
const convenor = { email: "c@x.com", personId: "recCONVENOR", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [{ office: "hockeyConvenor", designation: "" }] };

const post = (card: string, body: unknown) =>
  worker.fetch(
    new Request(`https://hkfc-api.test/api/admin/match-cards/${card}/link`, {
      method: "POST",
      headers: { Authorization: "Bearer valid.jwt.token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ENV,
    CTX,
  );

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("POST /api/admin/match-cards/:id/link", () => {
  it("is refused without the dataChecks section, before anything is written", async () => {
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await post("recCARD1", { personId: "recP1" });
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("dataChecks");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("links through link_match_card as the caller and drops the card and People caches", async () => {
    mocks.requireSection.mockResolvedValue(convenor);
    mocks.rpc.mockResolvedValue({ status: "ok", linked: 3 });
    const res = await post("recCARD1", { personId: "recP1", saveName: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: 3 });
    expect(mocks.rpc).toHaveBeenCalledWith("link_match_card", { p_card: "recCARD1", p_person: "recP1", p_save_name: true, p_actor: "recCONVENOR" });
    expect(mocks.invalidateMatchCards).toHaveBeenCalled();
    expect(mocks.invalidatePeople).toHaveBeenCalled();
  });

  it.each([
    ["ALREADY_LINKED", /already linked/],
    ["NAME_TAKEN", /already has this registered name/],
  ])("answers %s as a plain 409 and invalidates nothing", async (code, words) => {
    mocks.requireSection.mockResolvedValue(convenor);
    mocks.rpc.mockResolvedValue({ status: "conflict", code });
    const res = await post("recCARD1", { personId: "recP1", saveName: true });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe(code);
    expect(body.message).toMatch(words);
    expect(mocks.invalidateMatchCards).not.toHaveBeenCalled();
  });

  it("answers an unknown card or person (P0002) as 404", async () => {
    mocks.requireSection.mockResolvedValue(convenor);
    mocks.rpc.mockRejectedValue(new SupabaseError("No match card recX", 400, "P0002"));
    const res = await post("recCARD1", { personId: "recP1" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).not.toMatch(/recX/);
  });
});

describe("parseLinkRequest", () => {
  it("needs a person and takes saveName as a boolean, default false", () => {
    expect(parseLinkRequest("recCARD1", { personId: "recP1" })).toEqual({ card: "recCARD1", personId: "recP1", saveName: false });
    expect(() => parseLinkRequest("recCARD1", {})).toThrow(/Choose who/);
    expect(() => parseLinkRequest("recCARD1", { personId: "a,b" })).toThrow(/Choose who/);
    expect(() => parseLinkRequest("recCARD1", { personId: "recP1", saveName: "yes" })).toThrow(/save the name/);
  });

  it("refuses an id that isn't one", () => {
    expect(() => parseLinkRequest("x", { personId: "recP1" })).toThrow(HttpError);
  });
});

describe("the migration", () => {
  const sql = readFileSync(path.join(__dirname, "..", "supabase/migrations/20261007131003_link_match_card.sql"), "utf8");

  it("is for the service role only", () => {
    expect(sql).toMatch(/revoke all on function public\.link_match_card\(text, text, boolean, text\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.link_match_card\(text, text, boolean, text\) to service_role;/);
    expect(sql).toMatch(/set search_path = ''/);
  });

  it("logs field names only", () => {
    expect(sql).toMatch(/'admin-card-link'/);
    expect(sql).not.toMatch(/fields[^;]*raw_player_name/);
  });
});
