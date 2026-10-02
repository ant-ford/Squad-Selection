import { describe, expect, it } from "vitest";
import type { AuthorizedUser } from "../worker/src/auth";
import { landsOnApplication } from "../worker/src/profile";

const player = { role: "player", officerRoles: [] } as unknown as AuthorizedUser;

describe("where an applicant lands when they sign in", () => {
  it("goes to the application while it is still to be sent", () => {
    expect(landsOnApplication("Applicant", "1. Trial Application", player)).toBe(true);
    expect(landsOnApplication("Applicant", "2. Section Captain Invitation", player)).toBe(true);
  });

  it("gets the player page once it's sent, in Eddy or in Fillout before the switch-over", () => {
    expect(landsOnApplication("Applicant", "3. Club Application (Signed)", player)).toBe(false);
    expect(landsOnApplication("Applicant", "6. Membership Officer (Signed)", player)).toBe(false);
  });

  it("always gets the player page when they hold an office or coach", () => {
    const officer = { role: "player", officerRoles: [{ office: "membershipOfficer" }] } as unknown as AuthorizedUser;
    const coach = { role: "coach", officerRoles: [] } as unknown as AuthorizedUser;
    expect(landsOnApplication("Applicant", "2. Section Captain Invitation", officer)).toBe(false);
    expect(landsOnApplication("Applicant", "2. Section Captain Invitation", coach)).toBe(false);
  });

  it("is never the application for members", () => {
    expect(landsOnApplication("Member", "Accepted", player)).toBe(false);
  });
});
