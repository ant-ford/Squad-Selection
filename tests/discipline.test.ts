import { beforeEach, describe, expect, it, vi } from "vitest";

// The Men's Convenor's suspensions: the section gate, input checks, and the
// writes going to the one SQL function each with the actor from the session.

const mocks = vi.hoisted(() => ({
  requireSection: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
vi.mock("../worker/src/data/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/data/supabase")>()),
  db: () => ({ rpc: mocks.rpc }),
}));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";
import { SupabaseError } from "../worker/src/data/supabase";
import { sectionsFor } from "../worker/src/auth";
import { parseNewSuspension, parseSuspensionChange } from "../worker/src/discipline";

const ENV = {
  ALLOWED_ORIGIN: "https://hkfc-squad-selection.test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "k",
  DATA_BACKEND: "supabase",
} as any;
const CTX = { waitUntil: () => {} } as any;
const ID = "0f8c2b9e-3c1d-4a8e-9b7f-2d6e5a4c3b21";
const convenor = {
  email: "c@x.com",
  personId: "recCONVENOR",
  role: "player",
  coachTeams: [],
  isSectionCaptain: false,
  officerRoles: [{ office: "hockeyConvenor", designation: "" }],
};

const post = (path: string, body: unknown) =>
  worker.fetch(
    new Request(`https://hkfc-api.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid.jwt.token" },
      body: JSON.stringify(body),
    }),
    ENV,
    CTX,
  );

const valid = { playerId: "recP1", matches: 2, fromDate: "2026-09-12", reason: "R3 v Valley, 12 Sep" };

beforeEach(() => {
  mocks.requireSection.mockReset();
  mocks.rpc.mockReset();
});

describe("the discipline section", () => {
  const env = { DATA_BACKEND: "supabase" } as any;
  const holding = (office: string) => ({ officerRoles: [{ office, designation: "" }] }) as any;

  it("opens to the Men's Convenor only, on Supabase only", () => {
    expect(sectionsFor(holding("hockeyConvenor"), env)).toContain("discipline");
    for (const office of ["sectionCaptain", "membershipOfficer", "assistantDirector", "sectionChair"]) {
      expect(sectionsFor(holding(office), env)).not.toContain("discipline");
    }
    expect(sectionsFor(holding("hockeyConvenor"), { DATA_BACKEND: "airtable" } as any)).not.toContain("discipline");
  });

  it("refuses anyone without it before anything is saved", async () => {
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    for (const path of ["/api/discipline/suspensions", `/api/discipline/suspensions/${ID}`, `/api/discipline/suspensions/${ID}/clear`]) {
      const res = await post(path, valid);
      expect(res.status).toBe(403);
    }
    const get = await worker.fetch(
      new Request("https://hkfc-api.test/api/discipline/suspensions", { headers: { Authorization: "Bearer valid.jwt.token" } }),
      ENV,
      CTX,
    );
    expect(get.status).toBe(403);
    expect(mocks.requireSection.mock.calls.every((c) => c[2] === "discipline")).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("writes", () => {
  beforeEach(() => mocks.requireSection.mockResolvedValue(convenor));

  it("records a suspension as the signed-in Convenor", async () => {
    mocks.rpc.mockResolvedValue(ID);
    const res = await post("/api/discipline/suspensions", { ...valid, personId: "recSOMEONE", servingTeam: "HKFC C" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: ID });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_save_suspension", {
      p: { player: "recP1", matches: 2, fromDate: "2026-09-12", reason: "R3 v Valley, 12 Sep", servingTeam: "HKFC C" },
      p_actor: "recCONVENOR",
    });
  });

  it("sends only the fields changed", async () => {
    mocks.rpc.mockResolvedValue(ID);
    const res = await post(`/api/discipline/suspensions/${ID}`, { matches: null });
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_save_suspension", { p: { id: ID, matches: null }, p_actor: "recCONVENOR" });
  });

  it("clears with an optional note", async () => {
    mocks.rpc.mockResolvedValue(null);
    const res = await post(`/api/discipline/suspensions/${ID}/clear`, { reason: "  Overturned on appeal " });
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_clear_suspension", { p_id: ID, p_actor: "recCONVENOR", p_reason: "Overturned on appeal" });
  });

  it("answers a suspension that is gone or already cleared with 404", async () => {
    mocks.rpc.mockRejectedValue(new SupabaseError("Supabase rpc admin_clear_suspension failed", 404, "P0002"));
    const res = await post(`/api/discipline/suspensions/${ID}/clear`, {});
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "NOT_FOUND" });
  });

  it("answers an unknown team with a plain 400", async () => {
    mocks.rpc.mockRejectedValue(new SupabaseError("Supabase rpc admin_save_suspension failed", 409, "23503"));
    const res = await post("/api/discipline/suspensions", { ...valid, servingTeam: "HKFC Z" });
    expect(res.status).toBe(400);
  });
});

describe("input checks", () => {
  const refuses = (fn: () => unknown, status = 400) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(status);
      return;
    }
    throw new Error("expected a refusal");
  };

  it("needs a player, matches (or until cleared), a real date and a reason", () => {
    expect(parseNewSuspension({ ...valid, matches: null })).toMatchObject({ matches: null });
    refuses(() => parseNewSuspension({ ...valid, playerId: "" }));
    refuses(() => parseNewSuspension({ ...valid, playerId: "rec 1;drop" }));
    refuses(() => parseNewSuspension({ ...valid, matches: undefined }));
    refuses(() => parseNewSuspension({ ...valid, matches: 0 }));
    refuses(() => parseNewSuspension({ ...valid, matches: 53 }));
    refuses(() => parseNewSuspension({ ...valid, matches: 1.5 }));
    refuses(() => parseNewSuspension({ ...valid, matches: "2" }));
    refuses(() => parseNewSuspension({ ...valid, fromDate: "2026-02-30" }));
    refuses(() => parseNewSuspension({ ...valid, fromDate: "12/09/2026" }));
    refuses(() => parseNewSuspension({ ...valid, reason: "   " }));
    refuses(() => parseNewSuspension({ ...valid, reason: "x".repeat(281) }));
  });

  it("defaults the serving team to the registered team (left to SQL)", () => {
    expect(parseNewSuspension(valid)).not.toHaveProperty("servingTeam");
    expect(parseNewSuspension({ ...valid, servingTeam: "" })).not.toHaveProperty("servingTeam");
  });

  it("a change needs a real id and something to change", () => {
    refuses(() => parseSuspensionChange("not-a-uuid", { matches: 1 }), 404);
    refuses(() => parseSuspensionChange(ID, {}));
    refuses(() => parseSuspensionChange(ID, { servingTeam: "" }));
    expect(parseSuspensionChange(ID, { reason: " DC: 4 matches ", fromDate: "2026-10-01" })).toEqual({
      id: ID,
      reason: "DC: 4 matches",
      fromDate: "2026-10-01",
    });
  });
});
