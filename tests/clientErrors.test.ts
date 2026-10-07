import { describe, expect, it, vi } from "vitest";

// What a crash report says about the error (src/lib/clientErrors.ts). A
// rejected value that isn't an Error can be anything, a request body
// included, so only its type is reported.

vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { describeError } from "../src/lib/clientErrors";

describe("describeError", () => {
  it("keeps an Error's name, message and stack", () => {
    const err = new TypeError("x is undefined");
    expect(describeError(err)).toEqual({ message: "TypeError: x is undefined", stack: err.stack });
  });

  it("keeps a string as it is", () => {
    expect(describeError("boom")).toEqual({ message: "boom", stack: "" });
  });

  it("names any other value by its type, never its contents", () => {
    const body = { email: "someone@hkfc.com", hkid: "A123456(7)", mobile: "91234567" };
    const { message } = describeError(body);
    expect(message).toBe("Non-Error Object");
    expect(message).not.toMatch(/hkfc|A123456|9123/);
    expect(describeError(new Map([["k", "v"]])).message).toBe("Non-Error Map");
    expect(describeError(42).message).toBe("Non-Error number");
    expect(describeError(Object.create(null)).message).toBe("Non-Error Object");
    expect(describeError(undefined).message).toBe("undefined");
  });
});
