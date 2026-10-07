import { afterEach, describe, expect, it, vi } from "vitest";
import { answerReactivation, askToBeReactivated, openReactivationTasks } from "../worker/src/reactivation";
import type { AuthorizedUser } from "../worker/src/auth";
import type { Env } from "../worker/src/env";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "k" } as Env;
const STEP = "00000000-0000-4000-8000-000000000001";
const captain = {
  personId: "recCAP",
  personUuid: "00000000-0000-4000-8000-0000000000aa",
  isSectionCaptain: false,
  officerRoles: [{ office: "sectionCaptain", designation: null }],
} as unknown as AuthorizedUser;

function fake(reply: (url: URL, body: any) => { status?: number; body: unknown }) {
  const calls: { url: URL; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const r = reply(url, body);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("ask to be reactivated", () => {
  it("asks with the verified email only", async () => {
    const calls = fake(() => ({ body: { status: "asked", askedAt: "2026-10-07T01:00:00Z" } }));
    expect(await askToBeReactivated(env, "lapsed@hkfc.com")).toEqual({ status: "asked", askedAt: "2026-10-07T01:00:00Z" });
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/request_reactivation");
    expect(calls[0].body).toEqual({ p_email: "lapsed@hkfc.com" });
  });

  it("lists a captain's open requests by name", async () => {
    const calls = fake(() => ({ body: [{ id: STEP, who: { preferred_name: "Sam", given_names: null, surname: "Lee" } }] }));
    expect(await openReactivationTasks(env, captain.personUuid)).toEqual([{ id: STEP, subject: "Sam Lee" }]);
    expect(calls[0].url.searchParams.get("process")).toBe("eq.reactivation");
    expect(calls[0].url.searchParams.get("waiting_on_person_id")).toBe(`eq.${captain.personUuid}`);
    expect(calls[0].url.searchParams.get("done_at")).toBe("is.null");
  });

  it("answers as the signed-in captain, and needs a yes or no", async () => {
    const calls = fake(() => ({ body: { status: "activated" } }));
    await expect(answerReactivation(env, captain, STEP, {})).rejects.toMatchObject({ status: 400 });
    expect(await answerReactivation(env, captain, STEP, { activate: true })).toEqual({ status: "activated" });
    expect(calls[0].body).toEqual({ p_step: STEP, p_actor: "recCAP", p_activate: true });
  });

  it("refuses someone who is no longer a Section Captain, before asking the database", async () => {
    const calls = fake(() => ({ body: { status: "activated" } }));
    const former = { ...captain, officerRoles: [] } as unknown as AuthorizedUser;
    await expect(answerReactivation(env, former, STEP, { activate: true })).rejects.toMatchObject({ status: 403, code: "SECTION_CAPTAIN_REQUIRED" });
    expect(calls).toHaveLength(0);
    // A Teams-linked Section Captain still answers.
    const linked = { ...former, isSectionCaptain: true } as unknown as AuthorizedUser;
    expect(await answerReactivation(env, linked, STEP, { activate: false })).toEqual({ status: "activated" });
  });

  it("is 404 for a request that isn't theirs", async () => {
    fake(() => ({ status: 400, body: { code: "P0002", message: "No such request" } }));
    await expect(answerReactivation(env, captain, STEP, { activate: false })).rejects.toMatchObject({ status: 404 });
    await expect(answerReactivation(env, captain, "not-a-uuid", { activate: false })).rejects.toMatchObject({ status: 404 });
  });

  it("is 409 when the person is no longer a member", async () => {
    fake(() => ({ status: 400, body: { code: "22023", message: "Only a member can be reactivated" } }));
    await expect(answerReactivation(env, captain, STEP, { activate: true })).rejects.toMatchObject({ status: 409, code: "NOT_A_MEMBER" });
  });
});
