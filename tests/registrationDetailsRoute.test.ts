import { beforeEach, describe, expect, it, vi } from "vitest";

// The Registered Name / visiting save goes through the router's registration
// gate (Hockey Convenor only), with the actor taken from the session, never
// from the body.

const mocks = vi.hoisted(() => ({
  requireSection: vi.fn(),
  saveRegistrationDetails: vi.fn(),
}));

vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
vi.mock("../worker/src/registration", () => ({
  getRegistrationBoard: vi.fn(),
  markRegistered: vi.fn(),
  registrationCsv: vi.fn(),
  unmarkRegistered: vi.fn(),
  saveRegistrationDetails: mocks.saveRegistrationDetails,
}));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ENV = { ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const CTX = { waitUntil: () => {} } as any;
const convenor = { email: "c@x.com", personId: "recCONVENOR", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [{ office: "hockeyConvenor", designation: "" }] };

const post = (body: unknown) =>
  worker.fetch(
    new Request("https://hkfc-api.test/api/registration/details", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid.jwt.token" },
      body: JSON.stringify(body),
    }),
    ENV,
    CTX,
  );

beforeEach(() => {
  mocks.requireSection.mockReset();
  mocks.saveRegistrationDetails.mockReset();
});

describe("POST /api/registration/details", () => {
  it("is refused to anyone without the registration section, before anything is saved", async () => {
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await post({ id: "rec1", visiting: true });
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("registration");
    expect(mocks.saveRegistrationDetails).not.toHaveBeenCalled();
  });

  it("saves as the signed-in Convenor", async () => {
    mocks.requireSection.mockResolvedValue(convenor);
    mocks.saveRegistrationDetails.mockResolvedValue({ ok: true, linked: 2 });
    const res = await post({ id: "rec1", registeredName: "LEE Sam", personId: "recSOMEONE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: 2 });
    const [, actor, body] = mocks.saveRegistrationDetails.mock.calls[0];
    expect(actor).toBe(convenor);
    expect(body).toMatchObject({ id: "rec1", registeredName: "LEE Sam" });
  });
});
