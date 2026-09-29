import { afterEach, describe, expect, it, vi } from "vitest";
import { backendFor, pick, DATA_MODULES } from "../worker/src/data/backend";
import type { Env } from "../worker/src/env";

const env = (vars: Partial<Env> = {}) => ({ AIRTABLE_TOKEN: "t", AIRTABLE_BASE_ID: "app", ...vars }) as Env;

afterEach(() => vi.restoreAllMocks());

describe("backendFor", () => {
  it("is Airtable for every module when nothing is set", () => {
    for (const m of DATA_MODULES) expect(backendFor(env(), m)).toBe("airtable");
  });

  it("follows DATA_BACKEND for every module", () => {
    for (const m of DATA_MODULES) expect(backendFor(env({ DATA_BACKEND: "supabase" }), m)).toBe("supabase");
  });

  it("lets a per-module override win over the default, in either direction", () => {
    const e = env({ DATA_BACKEND: "supabase", DATA_BACKEND_OVERRIDES: " people = airtable , matches=supabase" });
    expect(backendFor(e, "people")).toBe("airtable");
    expect(backendFor(e, "matches")).toBe("supabase");
    expect(backendFor(e, "teams")).toBe("supabase");
    expect(backendFor(env({ DATA_BACKEND_OVERRIDES: "teams=supabase" }), "teams")).toBe("supabase");
    expect(backendFor(env({ DATA_BACKEND_OVERRIDES: "teams=supabase" }), "people")).toBe("airtable");
  });

  it("falls back to Airtable, loudly, on a value it does not understand", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(backendFor(env({ DATA_BACKEND: "postgres" }), "people")).toBe("airtable");
    expect(backendFor(env({ DATA_BACKEND_OVERRIDES: "peeple=supabase,teams=mysql" }), "teams")).toBe("airtable");
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("picks up a changed setting without a restart", () => {
    expect(backendFor(env({ DATA_BACKEND: "supabase" }), "people")).toBe("supabase");
    expect(backendFor(env({ DATA_BACKEND: "airtable" }), "people")).toBe("airtable");
  });
});

describe("pick", () => {
  it("builds the Airtable repository by default and the Supabase one when switched", () => {
    const airtable = () => ({ backend: "airtable" });
    const supabase = () => ({ backend: "supabase" });
    expect(pick(env(), "people", airtable, supabase)).toEqual({ backend: "airtable" });
    expect(pick(env({ DATA_BACKEND: "supabase" }), "people", airtable, supabase)).toEqual({ backend: "supabase" });
  });

  it("refuses, naming the module, when switched to Supabase before it has an implementation", () => {
    const airtableOnly = () => pick(env({ DATA_BACKEND_OVERRIDES: "commitments=supabase" }), "commitments", () => ({}));
    expect(airtableOnly).toThrow(/"commitments".*no Supabase implementation/);
  });
});
