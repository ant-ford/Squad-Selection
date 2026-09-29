import { afterEach, describe, expect, it, vi } from "vitest";
import { db, eq, inList, SupabaseError, withTotalOrder } from "../worker/src/data/supabase";
import { newRequestStats, runWithRequestContext, serverTimingHeader } from "../worker/src/requestContext";
import type { Env } from "../worker/src/env";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co/", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;

function stubFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body = [] } = handler(url, init);
    return new Response(body === null ? "" : JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Supabase data client", () => {
  it("refuses to run unconfigured, naming both settings", () => {
    expect(() => db({} as Env)).toThrow(/DATA_SUPABASE_URL.*DATA_SUPABASE_SECRET_KEY/);
  });

  it("sends the secret key in apikey only, never Authorization", async () => {
    const calls = stubFetch(() => ({ body: [{ id: "a" }] }));
    await db(env).select("people", "select=id");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://proj.supabase.co/rest/v1/people?select=id&order=id");
    expect(headers.apikey).toBe("sb_secret_test");
    expect(headers.Authorization).toBeUndefined();
  });

  it("follows pages until a short one", async () => {
    let n = 0;
    const calls = stubFetch(() => ({ body: n++ === 0 ? Array.from({ length: 1000 }, (_, i) => ({ i })) : [{ i: 1000 }] }));
    const rows = await db(env).select("match_cards", "select=*");
    expect(rows).toHaveLength(1001);
    expect((calls[1].init.headers as Record<string, string>).Range).toBe("1000-1999");
  });

  it("pages in a total order, ending on id", () => {
    expect(withTotalOrder("select=*")).toBe("select=*&order=id");
    expect(withTotalOrder("select=*&order=occurred_at.desc")).toBe("select=*&order=occurred_at.desc,id");
    expect(withTotalOrder("select=*&order=occurred_at.desc&kind=eq.move")).toBe("select=*&order=occurred_at.desc,id&kind=eq.move");
    expect(withTotalOrder("select=*&order=id")).toBe("select=*&order=id");
    expect(withTotalOrder("select=*&order=season,id.desc")).toBe("select=*&order=season,id.desc");
  });

  it("upserts on the named conflict columns and returns the rows", async () => {
    const calls = stubFetch(() => ({ body: [{ id: "x" }] }));
    const rows = await db(env).upsert("season_plans", [{ person_id: "p", season: "2026-2027" }], "person_id,season");
    expect(rows).toEqual([{ id: "x" }]);
    expect(calls[0].url).toContain("on_conflict=person_id%2Cseason");
    expect((calls[0].init.headers as Record<string, string>).Prefer).toContain("merge-duplicates");
  });

  it("will not update or delete without a filter", async () => {
    stubFetch(() => ({}));
    await expect(db(env).update("people", "", { active: true })).rejects.toThrow(/filter/);
    await expect(db(env).remove("people", "")).rejects.toThrow(/filter/);
  });

  it("turns a PostgREST error into a SupabaseError with its code", async () => {
    stubFetch(() => ({ status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "people_email_key"' } }));
    const err = await db(env).insert("people", [{ email: "a@b.c" }]).catch((e) => e);
    expect(err).toBeInstanceOf(SupabaseError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("23505");
  });

  it("encodes filter values", () => {
    expect(eq("2026-2027")).toBe("eq.2026-2027");
    expect(eq("a&b=c")).toBe("eq.a%26b%3Dc");
    expect(inList(["Played", "A,B"])).toBe('in.("Played","A%2CB")');
  });

  it("counts calls in Server-Timing only when Supabase was used", async () => {
    const quiet = newRequestStats();
    expect(serverTimingHeader(quiet, 5)).not.toContain("db;");
    stubFetch(() => ({ body: [] }));
    const stats = newRequestStats();
    await runWithRequestContext({ stats }, () => db(env).select("teams", "select=*"));
    expect(stats.dbCalls).toBe(1);
    expect(serverTimingHeader(stats, 5)).toMatch(/db;dur=\d+;desc="calls=1 bytes=2"/);
  });
});
