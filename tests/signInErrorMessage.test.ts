import { describe, it, expect } from "vitest";

// Imported from src/lib, not from the page: pulling it out of Login.tsx
// dragged in the Supabase client, which throws at module load without its
// environment variables. That passed locally and failed in CI.
import { signInErrorMessage } from "../src/lib/signInError";

// Supabase says "Token has expired or is invalid", which tells someone
// staring at a code they just typed nothing about what to do. A code is
// single-use and a new request replaces the previous one, so the answer is
// almost always "use the newest email".

describe("signInErrorMessage", () => {
  it("turns Supabase's expired-token wording into an instruction", () => {
    const out = signInErrorMessage(new Error("Token has expired or is invalid"));
    expect(out).toContain("Resend email");
    expect(out).not.toContain("Token");
  });

  it("catches the invalid wording too", () => {
    expect(signInErrorMessage(new Error("Invalid token"))).toContain("Resend email");
  });

  it("passes through anything it does not recognise, rather than hiding it", () => {
    expect(signInErrorMessage(new Error("Network request failed"))).toBe("Network request failed");
  });

  it("falls back to something sayable when there is no message at all", () => {
    expect(signInErrorMessage({})).toBe("Could not sign you in. Please try again.");
    expect(signInErrorMessage(new Error(""))).toBe("Could not sign you in. Please try again.");
  });
});
