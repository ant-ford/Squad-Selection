import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { getMyDeclarations, isUnderEighteen, submitDeclarations } from "../worker/src/declarations";
import { DECLARATIONS_VERSION, REQUIRED_KEYS, guardianConsent } from "../shared/declarations";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const user = { email: "p@x.com", personId: "recPLAYER00000000", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;

type Call = { url: URL; method: string; body: any };
function fake(person: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.pathname.endsWith("/people")) return reply([{ id: "p-uuid", preferred_name: "Sam", given_names: "Samuel", surname: "Lee", waivers_signed_at: null, guardian_surname: null, guardian_given_names: null, guardian_mobile_no: null, guardian_email: null, ...person }]);
    if (url.pathname.endsWith("/rpc/submit_declarations")) return reply({ id: "d1" });
    return reply([]);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const all = { version: DECLARATIONS_VERSION, accepted: REQUIRED_KEYS };

describe("waivers & declarations", () => {
  it("counts under-18 from the date of birth, to the day", () => {
    expect(isUnderEighteen("2008-10-01", "2026-09-30")).toBe(true); // 18 tomorrow
    expect(isUnderEighteen("2008-09-30", "2026-09-30")).toBe(false); // 18 today
    expect(isUnderEighteen(null, "2026-09-30")).toBe(false);
  });

  it("records an adult's signing with every box, and nothing for a guardian", async () => {
    const calls = fake({ date_of_birth: "1990-01-01" });
    expect(await submitDeclarations(env, user, all)).toEqual({ ok: true, underEighteen: false });
    const rpc = calls.find((c) => c.url.pathname.endsWith("/rpc/submit_declarations"))!;
    expect(rpc.body).toMatchObject({ p_actor: "recPLAYER00000000", p_version: DECLARATIONS_VERSION, p_required: REQUIRED_KEYS, p_signature: null });
    expect(rpc.body.p_accepted.sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it("refuses a missing box, and wording that changed since the page opened", async () => {
    fake({ date_of_birth: "1990-01-01" });
    await expect(submitDeclarations(env, user, { ...all, accepted: REQUIRED_KEYS.slice(1) })).rejects.toMatchObject({ status: 400 });
    await expect(submitDeclarations(env, user, { ...all, version: "2025-01-01" })).rejects.toMatchObject({ status: 409, code: "WORDING_CHANGED" });
  });

  it("needs a parent or guardian's details, confirmation and signature for an under-18", async () => {
    const calls = fake({ date_of_birth: "2012-05-05" });
    await expect(submitDeclarations(env, user, all)).rejects.toMatchObject({ status: 400 });
    const guardian = { surname: "Lee", givenNames: "Jo", mobileNo: "+852 5555 0000", email: "jo@x.com" };
    await expect(submitDeclarations(env, user, { ...all, guardian })).rejects.toThrow(/confirm/);
    await expect(submitDeclarations(env, user, { ...all, accepted: [...REQUIRED_KEYS, "guardian_consent"], guardian })).rejects.toThrow(/sign/);
    expect(calls.some((c) => c.url.pathname.endsWith("/rpc/submit_declarations"))).toBe(false);
  });

  it("tells the player whether they are under 18 and what the guardian's details are", async () => {
    fake({ date_of_birth: "2012-05-05", guardian_surname: "Lee", guardian_given_names: "Jo" });
    const v = await getMyDeclarations(env, user);
    expect(v).toMatchObject({ underEighteen: true, playerName: "Sam Lee", signedThisSeasonAt: null, version: DECLARATIONS_VERSION });
    expect(v.guardian).toMatchObject({ surname: "Lee", givenNames: "Jo" });
    expect(guardianConsent("Jo Lee")[0]).toContain("I, Jo Lee (the “Parent or Guardian”)");
  });
});
