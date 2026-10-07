import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/admin/people/:id/squad goes through the "people" section gate
// before anything is read; squad.ts then checks each field's own rights.

const mocks = vi.hoisted(() => ({ requireSection: vi.fn(), saveSquad: vi.fn() }));

vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
vi.mock("../worker/src/admin/squad", () => ({ saveSquad: mocks.saveSquad }));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ENV = { ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const CTX = { waitUntil: () => {} } as any;
const convenor = { email: "c@x.com", personId: "recCONVENOR", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [{ office: "hockeyConvenor", designation: "" }] };

const post = (body: unknown) =>
  worker.fetch(
    new Request("https://hkfc-api.test/api/admin/people/recP1/squad", {
      method: "POST",
      headers: { Authorization: "Bearer valid.jwt.token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ENV,
    CTX,
  );

beforeEach(() => {
  mocks.requireSection.mockReset();
  mocks.saveSquad.mockReset();
});

describe("POST /api/admin/people/:id/squad", () => {
  it("is refused without the people section, before anything is saved", async () => {
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await post({ playingPosition: "Defender", expect: { playingPosition: null } });
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("people");
    expect(mocks.saveSquad).not.toHaveBeenCalled();
  });

  it("hands the caller, person and body to saveSquad", async () => {
    mocks.requireSection.mockResolvedValue(convenor);
    mocks.saveSquad.mockResolvedValue({ ok: true, changed: ["registered_team"] });
    const body = { registeredTeam: "HKFC B", expect: { registeredTeam: "HKFC C" } };
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(mocks.saveSquad.mock.calls[0].slice(1)).toEqual([convenor, "recP1", body]);
  });
});
