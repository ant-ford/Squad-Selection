import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_FIELDS,
  historyDetail,
  membershipChange,
  membershipDraft,
  membershipProblem,
  personChip,
  removedPeriodsNote,
  saveRefusal,
  searchable,
  stageGroups,
  stageMoveNeedsConfirm,
} from "../src/lib/peopleAdmin";
import { officerItems } from "../src/components/headerItems";
import type { PersonMembership } from "../src/api/adminPeople";

const saved: PersonMembership = {
  memberType: "Main",
  categoryType: "Sports Preferred",
  membershipNo: "A123",
  joinDate: "2024-09-01",
  commitmentEndDate: null,
};

class FakeApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

describe("membership form", () => {
  it("offers the application form's member types and categories", () => {
    const options = (key: string) => MEMBERSHIP_FIELDS.find((f) => f.key === key)?.options ?? [];
    expect(options("memberType")).toContain("Child");
    expect(options("categoryType")).toContain("Junior (under 21)");
  });

  it("sends nothing when nothing changed, whitespace included", () => {
    const draft = membershipDraft(saved);
    expect(membershipChange(saved, draft)).toBeNull();
    expect(membershipChange(saved, { ...draft, membershipNo: " A123 " })).toBeNull();
  });

  it("sends only the changed fields, each with what the screen read", () => {
    const draft = { ...membershipDraft(saved), joinDate: "2024-10-01", commitmentEndDate: "2027-09-30" };
    expect(membershipChange(saved, draft)).toEqual({
      joinDate: "2024-10-01",
      commitmentEndDate: "2027-09-30",
      expect: { joinDate: "2024-09-01", commitmentEndDate: null },
    });
  });

  it("clears a field as null", () => {
    const draft = { ...membershipDraft(saved), membershipNo: "  " };
    expect(membershipChange(saved, draft)).toEqual({ membershipNo: null, expect: { membershipNo: "A123" } });
  });

  it("refuses a commitment end on or before the join date", () => {
    const draft = membershipDraft(saved);
    expect(membershipProblem({ ...draft, commitmentEndDate: "2024-09-01" })).toMatch(/after the join date/);
    expect(membershipProblem({ ...draft, commitmentEndDate: "2027-09-01" })).toBeNull();
    expect(membershipProblem({ ...draft, joinDate: "" , commitmentEndDate: "2020-01-01" })).toBeNull();
  });

  it("words the removed periods briefly", () => {
    expect(removedPeriodsNote(0)).toBeNull();
    expect(removedPeriodsNote(1)).toBe("1 commitment period removed");
    expect(removedPeriodsNote(3)).toBe("3 commitment periods removed");
  });
});

describe("refused saves", () => {
  it("asks to acknowledge a shared membership number, with the API's words", () => {
    const r = saveRefusal(new FakeApiError("Membership number A1 is already used by Jo Bloggs.", 409, "SHARED_MEMBERSHIP_NO"));
    expect(r).toEqual({ kind: "shared", message: "Membership number A1 is already used by Jo Bloggs." });
  });

  it("says someone else saved first, for CHANGED and STAGE_CHANGED", () => {
    expect(saveRefusal(new FakeApiError("x", 409, "CHANGED")).kind).toBe("changed");
    const stage = saveRefusal(new FakeApiError("x", 409, "STAGE_CHANGED"));
    expect(stage.kind).toBe("changed");
    expect(stage.message).toMatch(/stage changed/i);
  });

  it("never shows a server or network failure's own text", () => {
    expect(saveRefusal(new FakeApiError("TypeError: boom", 500)).message).toMatch(/^Not saved/);
    expect(saveRefusal(new Error("Failed to fetch")).message).toMatch(/^Not saved/);
    expect(saveRefusal(new FakeApiError("Choose a category from the list.", 400, "INVALID_INPUT")).message).toBe(
      "Choose a category from the list.",
    );
  });
});

describe("stage moves", () => {
  it("groups the pipeline apart from Rejected and Temporary", () => {
    const targets = ["1. Trial Application", "3. Club Application (Signed)", "Rejected", "Temporary"];
    expect(stageGroups(targets)).toEqual([
      { label: "Stages", options: ["1. Trial Application", "3. Club Application (Signed)"] },
      { label: "Off the pipeline", options: ["Rejected", "Temporary"] },
    ]);
  });

  it("drops an empty group (a Temporary player is not offered Rejected)", () => {
    expect(stageGroups(["2. Section Captain Invitation"])).toEqual([{ label: "Stages", options: ["2. Section Captain Invitation"] }]);
    expect(stageGroups([])).toEqual([]);
  });

  it("asks before Rejected only", () => {
    expect(stageMoveNeedsConfirm("Rejected")).toBe(true);
    expect(stageMoveNeedsConfirm("Temporary")).toBe(false);
    expect(stageMoveNeedsConfirm("4. Sponsor (Signed)")).toBe(false);
  });
});

describe("list chips and search", () => {
  it("shows applicants by stage number, then parked stages, then inactive", () => {
    expect(personChip({ status: "Applicant", stage: "4. Sponsor (Signed)", active: true })).toEqual({ label: "Applicant · stage 4", tone: "info" });
    expect(personChip({ status: "Member", stage: "Temporary", active: true })?.label).toBe("Temporary");
    expect(personChip({ status: "Member", stage: "Accepted", active: false })).toEqual({ label: "Inactive", tone: "neutral" });
    expect(personChip({ status: "Member", stage: "Accepted", active: true })).toBeNull();
  });

  it("searches only what the API accepts", () => {
    expect(searchable("a")).toBeNull();
    expect(searchable("  O'Neil  ")).toBe("O'Neil");
    expect(searchable("Chan Tai-man")).toBe("Chan Tai-man");
    expect(searchable("x*")).toBeNull();
    expect(searchable("黃家")).toBe("黃家");
  });

  it("words a history row without values", () => {
    expect(historyDetail({ actor: "Pat Lee", fields: ["Member type", "Join date"] })).toBe("Member type, Join date · by Pat Lee");
    expect(historyDetail({ actor: null, fields: [] })).toBe("");
  });

  it("puts People in the menu for the people section only", () => {
    expect(officerItems({ sections: ["people"] }).map((i) => i.to)).toEqual(["/people"]);
    expect(officerItems({ sections: ["registration"] }).map((i) => i.to)).toEqual(["/registration"]);
  });
});
