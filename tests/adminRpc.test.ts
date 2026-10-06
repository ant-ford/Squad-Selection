import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { adminRpc } from "../worker/src/admin/rpc";
import { actorUuid, logActivity } from "../worker/src/activity";

const env = {
  DATA_BACKEND: "supabase",
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;

function answer(status: number, body: unknown) {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("adminRpc", () => {
  it("calls the function with the arguments and returns its answer", async () => {
    const calls = answer(200, { status: "ok", changed: ["member_type"] });
    expect(await adminRpc(env, "admin_update_person", { p_person: "rec1" })).toEqual({ status: "ok", changed: ["member_type"] });
    expect(calls[0].url).toBe("https://proj.supabase.co/rest/v1/rpc/admin_update_person");
    expect(calls[0].body).toEqual({ p_person: "rec1" });
  });

  it.each([
    ["P0002", 404, "NOT_FOUND"],
    ["23505", 409, "TAKEN"],
    ["22023", 400, "INVALID_INPUT"],
    ["23514", 400, "INVALID_INPUT"],
    ["23503", 400, "INVALID_INPUT"],
    ["22008", 400, "INVALID_INPUT"],
    ["42501", 403, "FORBIDDEN"],
  ])("maps Postgres %s to %i %s, without the database's message", async (pgCode, status, code) => {
    answer(400, { code: pgCode, message: "No person recSECRETVALUE" });
    const err = await adminRpc(env, "admin_update_person", {}).catch((e) => e);
    expect(err).toMatchObject({ status, code });
    expect(err.message).not.toContain("SECRETVALUE");
  });

  it("lets a caller word a code its own way", async () => {
    answer(400, { code: "P0002", message: "x" });
    await expect(adminRpc(env, "f", {}, { messages: { NOT_FOUND: "Person not found." } })).rejects.toMatchObject({ message: "Person not found." });
  });

  it("passes other database errors on unchanged (the router's 502)", async () => {
    answer(500, { code: "XX000", message: "boom" });
    await expect(adminRpc(env, "f", {})).rejects.toMatchObject({ name: "SupabaseError" });
  });

  it("turns a conflict answer into a 409 with its code, or the caller's code for a field", async () => {
    answer(200, { status: "conflict", code: "LAST_SECTION_CAPTAIN" });
    await expect(adminRpc(env, "f", {}, { messages: { LAST_SECTION_CAPTAIN: "Keep one." } })).rejects.toMatchObject({ status: 409, code: "LAST_SECTION_CAPTAIN", message: "Keep one." });
    answer(200, { status: "conflict", field: "applicant_stage" });
    await expect(adminRpc(env, "f", {}, { conflictCode: "STAGE_CHANGED" })).rejects.toMatchObject({ status: 409, code: "STAGE_CHANGED" });
    answer(200, { status: "conflict", field: "member_type" });
    await expect(adminRpc(env, "f", {})).rejects.toMatchObject({ status: 409, code: "CHANGED" });
  });
});

describe("logActivity", () => {
  it("writes one row per entity in one request, field names only", async () => {
    const calls = answer(201, []);
    await logActivity(env, { actorId: "u-actor", action: "registration-export", entityIds: ["u1", "u2"], fields: ["hkha_registrations"] });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual([
      { actor_person_id: "u-actor", action: "registration-export", entity: "people", entity_id: "u1", fields: ["hkha_registrations"] },
      { actor_person_id: "u-actor", action: "registration-export", entity: "people", entity_id: "u2", fields: ["hkha_registrations"] },
    ]);
  });

  it("never fails the action it records", async () => {
    answer(500, { message: "down" });
    await expect(logActivity(env, { actorId: null, action: "x", entityIds: [null], fields: [] })).resolves.toBeUndefined();
  });

  it("looks the actor's uuid up by api id", async () => {
    const calls = answer(200, [{ id: "u-me" }]);
    expect(await actorUuid(env, { personId: "recME" })).toBe("u-me");
    expect(calls[0].url).toContain("api_id=eq.recME");
  });
});
