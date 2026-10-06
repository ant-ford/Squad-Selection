import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/admin/data-checks goes through the "dataChecks" section gate
// (the Men's Convenor and the Section Captains) before anything is read.

const mocks = vi.hoisted(() => ({
  requireSection: vi.fn(),
  getDataChecks: vi.fn(),
}));

vi.mock("../worker/src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker/src/auth")>()),
  requireSection: mocks.requireSection,
}));
vi.mock("../worker/src/dataChecks", () => ({ getDataChecks: mocks.getDataChecks }));

import worker from "../worker/src/index";
import { HttpError } from "../worker/src/http";

const ENV = { ALLOWED_ORIGIN: "https://hkfc-squad-selection.test", SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "k" } as any;
const CTX = { waitUntil: () => {} } as any;
const captain = { email: "c@x.com", personId: "recCAPTAIN", role: "coach", coachTeams: [], isSectionCaptain: true, officerRoles: [{ office: "sectionCaptain", designation: "" }] };

const get = () =>
  worker.fetch(
    new Request("https://hkfc-api.test/api/admin/data-checks", { headers: { Authorization: "Bearer valid.jwt.token" } }),
    ENV,
    CTX,
  );

beforeEach(() => {
  mocks.requireSection.mockReset();
  mocks.getDataChecks.mockReset();
});

describe("GET /api/admin/data-checks", () => {
  it("is refused without the dataChecks section, before anything is read", async () => {
    mocks.requireSection.mockRejectedValue(new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED"));
    const res = await get();
    expect(res.status).toBe(403);
    expect(mocks.requireSection.mock.calls[0][2]).toBe("dataChecks");
    expect(mocks.getDataChecks).not.toHaveBeenCalled();
  });

  it("returns the checks to a Section Captain", async () => {
    mocks.requireSection.mockResolvedValue(captain);
    const checks = { unlinkedCards: [], sharedRegisteredNames: [], reRegistrations: [], incomplete: [], duplicates: [], needsFixing: [] };
    mocks.getDataChecks.mockResolvedValue(checks);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(checks);
  });
});
