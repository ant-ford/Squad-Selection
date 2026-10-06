import { describe, expect, it } from "vitest";
import { ACTION_LABELS, actionLabel, fieldLabel } from "../shared/history";

describe("history labels", () => {
  it("names every admin action the design lists", () => {
    for (const action of [
      "admin-membership", "admin-stage", "admin-squad", "admin-junior-route",
      "admin-suspension-set", "admin-suspension-edit", "admin-suspension-clear",
      "admin-office", "admin-person-create", "admin-team", "admin-team-role",
      "admin-card-link", "admin-reregistration-move", "admin-reregistration-keep",
    ]) {
      expect(ACTION_LABELS[action], action).toBeTruthy();
    }
  });

  it("labels known actions and words unknown ones from their name", () => {
    expect(actionLabel("admin-membership")).toBe("Membership details changed");
    expect(actionLabel("deactivate")).toBe("Made inactive");
    expect(actionLabel("joiner-invite")).toBe("Invited to apply");
    expect(actionLabel("admin-something-new")).toBe("Something new");
    expect(actionLabel("odd_thing")).toBe("Odd thing");
  });

  it("labels columns, and roles with their team or retirement", () => {
    expect(fieldLabel("membership_no")).toBe("Membership number");
    expect(fieldLabel("applicant_stage")).toBe("Stage");
    expect(fieldLabel("coach:HKFC A")).toBe("Coach, HKFC A");
    expect(fieldLabel("team_captain:HKFC H")).toBe("Captain, HKFC H");
    expect(fieldLabel("sponsor:retired")).toBe("Sponsor, retired");
    expect(fieldLabel("hockey_convenor")).toBe("Men's Convenor");
    expect(fieldLabel("section_chair")).toBe("Chairman");
    expect(fieldLabel("some_new_column")).toBe("Some new column");
  });
});
