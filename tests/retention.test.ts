import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import { MAX_PER_RUN, R2_BATCH, runRetention } from "../worker/src/retention";

type Call = { url: URL; method: string; body: any };

/** A fake PostgREST: the due list, which removals succeed, and the R2 queue. */
function fakeDb(opts: { due?: string[]; failFor?: string[]; notDue?: string[]; queue?: string[] } = {}) {
  const calls: Call[] = [];
  let queue = [...(opts.queue ?? [])];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const c = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const reply = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url.pathname.endsWith("/rpc/retention_stamp")) return reply(2);
    if (url.pathname.endsWith("/rpc/remove_personal_data")) {
      if (opts.failFor?.includes(c.body.p_person)) return reply({ message: "boom" }, 400);
      return reply(!opts.notDue?.includes(c.body.p_person));
    }
    if (url.pathname.endsWith("/retention_due_v")) return reply((opts.due ?? []).map((id) => ({ id })));
    if (url.pathname.endsWith("/r2_deletions") && c.method === "GET") {
      const limit = Number(url.searchParams.get("limit"));
      return reply(queue.slice(0, limit).map((r2_key) => ({ r2_key })));
    }
    if (url.pathname.endsWith("/r2_deletions") && c.method === "DELETE") {
      const gone = decodeURIComponent(url.searchParams.get("r2_key") ?? "");
      queue = queue.filter((k) => !gone.includes(`"${k}"`));
      return reply(undefined, 204);
    }
    return reply([]);
  }));
  return calls;
}

function fakeBucket() {
  const deleted: string[][] = [];
  return { deleted, bucket: { delete: vi.fn(async (keys: string[]) => { deleted.push(keys); }) } as unknown as R2Bucket };
}

const base = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as Env;

const removals = (calls: Call[]) => calls.filter((c) => c.url.pathname.endsWith("/rpc/remove_personal_data")).map((c) => c.body.p_person);

afterEach(() => vi.unstubAllGlobals());

describe("data retention job", () => {
  it("in report mode stamps and counts, but removes nothing", async () => {
    const calls = fakeDb({ due: ["p1", "p2"] });
    const result = await runRetention({ ...base, RETENTION_MODE: "report" });
    expect(result).toMatchObject({ stamped: 2, due: 2, removed: 0 });
    expect(removals(calls)).toEqual([]);
  });

  it("with no mode set, removes nothing", async () => {
    const calls = fakeDb({ due: ["p1"] });
    await runRetention(base);
    expect(removals(calls)).toEqual([]);
  });

  it("in remove mode removes each person due, oldest activity first, at most MAX_PER_RUN", async () => {
    const calls = fakeDb({ due: ["p1", "p2", "p3"], notDue: ["p3"] });
    const result = await runRetention({ ...base, RETENTION_MODE: "remove" });
    expect(removals(calls)).toEqual(["p1", "p2", "p3"]);
    // p3 came back between the list and the removal: the database said no.
    expect(result).toMatchObject({ due: 3, removed: 2, failed: 0 });
    const list = calls.find((c) => c.url.pathname.endsWith("/retention_due_v"))!;
    expect(list.url.searchParams.get("limit")).toBe(String(MAX_PER_RUN));
    expect(list.url.searchParams.get("order")).toBe("last_activity,id");
  });

  it("carries on past one failed removal", async () => {
    const calls = fakeDb({ due: ["p1", "p2"], failFor: ["p1"] });
    const result = await runRetention({ ...base, RETENTION_MODE: "remove" });
    expect(removals(calls)).toEqual(["p1", "p2"]);
    expect(result).toMatchObject({ removed: 1, failed: 1 });
  });

  it("deletes queued R2 objects in batches, then their queue rows", async () => {
    const queue = Array.from({ length: R2_BATCH + 3 }, (_, i) => `people/x/photo/${i}.jpg`);
    const calls = fakeDb({ queue });
    const { bucket, deleted } = fakeBucket();
    const result = await runRetention({ ...base, FILES: bucket });
    expect(deleted.map((b) => b.length)).toEqual([R2_BATCH, 3]);
    expect(deleted.flat()).toEqual(queue);
    expect(result.filesDeleted).toBe(queue.length);
    expect(calls.filter((c) => c.url.pathname.endsWith("/r2_deletions") && c.method === "DELETE")).toHaveLength(2);
  });

  it("keeps the queue rows when the R2 delete fails", async () => {
    const calls = fakeDb({ queue: ["people/x/photo/1.jpg"] });
    const bucket = { delete: vi.fn(async () => { throw new Error("R2 down"); }) } as unknown as R2Bucket;
    await expect(runRetention({ ...base, FILES: bucket })).rejects.toThrow("R2 down");
    expect(calls.some((c) => c.url.pathname.endsWith("/r2_deletions") && c.method === "DELETE")).toBe(false);
  });
});
