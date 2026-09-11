import { describe, it, expect } from "vitest";
import { normalizeEmail } from "../shared/normalizeEmail";
import { normalizeEmail as workerNormalizeEmail } from "../worker/src/auth";

// Every store in this system disagrees about case: Supabase holds whatever
// the account was created with, Airtable whatever an administrator typed,
// and a phone keyboard will capitalise the first letter as it is entered.
// One definition has to serve the browser and the Worker, or sign-in fails
// for reasons nobody can see.

describe("normalizeEmail", () => {
  it("lowercases, which is what a capitalising keyboard needs", () => {
    expect(normalizeEmail("John@HKFC.com")).toBe("john@hkfc.com");
    expect(normalizeEmail("ALL@CAPS.COM")).toBe("all@caps.com");
  });

  it("trims, which is what autofill and pasting need", () => {
    expect(normalizeEmail("  player@hkfc.com  ")).toBe("player@hkfc.com");
    expect(normalizeEmail("\tplayer@hkfc.com\n")).toBe("player@hkfc.com");
  });

  it("handles both at once", () => {
    expect(normalizeEmail("  John@HKFC.com ")).toBe("john@hkfc.com");
  });

  it("leaves an already-normal address untouched", () => {
    expect(normalizeEmail("player@hkfc.com")).toBe("player@hkfc.com");
  });

  it("is idempotent, so normalising twice is safe", () => {
    const once = normalizeEmail("  John@HKFC.com ");
    expect(normalizeEmail(once)).toBe(once);
  });

  // The Worker re-exports the shared function rather than keeping a second
  // copy. If those ever diverge, sign-in and the People lookup disagree.
  it("is the same function the Worker authorizes with", () => {
    expect(workerNormalizeEmail).toBe(normalizeEmail);
  });
});
