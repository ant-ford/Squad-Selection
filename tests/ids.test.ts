import { describe, expect, it } from "vitest";
import { isRowId } from "../worker/src/data/ids";

const AIRTABLE = { DATA_BACKEND: "airtable" } as const;
const SUPABASE = { DATA_BACKEND: "supabase" } as const;
const REC = "recAfcgxZQ3GWcu3I";
const UUID = "a0818f1e-7782-40cd-9b25-8b55e49a3059";

describe("isRowId", () => {
  it("accepts imported and Eddy-created ids on Supabase", () => {
    expect(isRowId(SUPABASE, "people", REC)).toBe(true);
    expect(isRowId(SUPABASE, "people", UUID)).toBe(true);
  });

  it("accepts only record ids on Airtable, where the id goes into a formula", () => {
    expect(isRowId(AIRTABLE, "people", REC)).toBe(true);
    expect(isRowId(AIRTABLE, "people", UUID)).toBe(false);
  });

  it("follows the module's own backend", () => {
    const mixed = { DATA_BACKEND: "airtable", DATA_BACKEND_OVERRIDES: "commitments=supabase" };
    expect(isRowId(mixed, "commitments", UUID)).toBe(true);
    expect(isRowId(mixed, "people", UUID)).toBe(false);
  });

  it("refuses anything else", () => {
    for (const bad of [undefined, null, 42, "", "rec123", `${REC}x`, UUID.toUpperCase(), `${UUID}"`, "a0818f1e778240cd9b258b55e49a3059"]) {
      expect(isRowId(SUPABASE, "people", bad)).toBe(false);
    }
  });
});
