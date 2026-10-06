import { describe, expect, it } from "vitest";
import {
  OFFICE_LABELS,
  canReactivate,
  clubRefusal,
  groupOffices,
  handoverFrom,
  newPersonProblem,
  squadSize,
  teamChange,
  teamDraft,
  teamSummary,
  withHolder,
} from "../src/lib/club";
import { officerItems } from "../src/components/headerItems";
import type { OfficeView, TeamAdminView } from "../src/api/club";

const office = (id: string, o: OfficeView["office"], name: string, status: OfficeView["status"] = "Active"): OfficeView => ({
  id,
  office: o,
  designation: null,
  officeEmail: null,
  status,
  holder: { id: `p-${id}`, name },
});

class FakeApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

const team: TeamAdminView = {
  id: "t1",
  name: "HKFC C",
  rank: 3,
  active: true,
  targetSquadSize: 16,
  coaches: [{ id: "c1", name: "Ann Coach" }],
  captains: [],
  sectionCaptains: [{ id: "s1", name: "Sam Captain" }],
};

describe("offices", () => {
  it("uses the glossary's names", () => {
    expect(OFFICE_LABELS.sectionChair).toBe("Chairman");
    expect(OFFICE_LABELS.hockeyConvenor).toBe("Men's Convenor");
    expect(OFFICE_LABELS.assistantDirector).toBe("Assistant Director of Hockey");
  });

  it("lists every office in order, holders by name, retired apart", () => {
    const groups = groupOffices([
      office("a", "sponsor", "Zed"),
      office("b", "sectionCaptain", "Gwen"),
      office("c", "sectionCaptain", "Ant"),
      office("d", "sectionCaptain", "Old", "Retired"),
    ]);
    expect(groups.map((g) => g.office)).toEqual([
      "sectionCaptain",
      "sectionChair",
      "membershipOfficer",
      "hockeyConvenor",
      "kitConvenor",
      "assistantDirector",
      "umpireCoordinator",
      "sponsor",
    ]);
    expect(groups[0].active.map((o) => o.holder?.name)).toEqual(["Ant", "Gwen"]);
    expect(groups[0].retired.map((o) => o.id)).toEqual(["d"]);
    expect(groups[1].active).toEqual([]);
  });

  it("hands over the Membership Officer and Chairman only", () => {
    const [sc, chair, mo] = groupOffices([office("a", "membershipOfficer", "Pat"), office("b", "sectionCaptain", "Gwen")]);
    expect(handoverFrom(mo)?.id).toBe("a");
    expect(handoverFrom(chair)).toBeNull();
    expect(handoverFrom(sc)).toBeNull();
  });

  it("doesn't offer reactivating a one-holder office while it's held", () => {
    const [sc, chair, mo] = groupOffices([
      office("a", "membershipOfficer", "Pat"),
      office("b", "membershipOfficer", "Old", "Retired"),
      office("c", "sectionChair", "Old", "Retired"),
    ]);
    expect(canReactivate(mo)).toBe(false);
    expect(canReactivate(chair)).toBe(true);
    expect(canReactivate(sc)).toBe(true);
  });

  it("words each refusal plainly and keeps the code", () => {
    expect(clubRefusal(new FakeApiError("x", 409, "ONE_HOLDER"))).toEqual({ code: "ONE_HOLDER", message: "This office has one holder at a time." });
    expect(clubRefusal(new FakeApiError("x", 409, "LAST_SECTION_CAPTAIN")).message).toMatch(/always be a Section Captain/);
    expect(clubRefusal(new FakeApiError("x", 409, "ALREADY_HOLDS")).message).toBe("They already hold this office.");
    expect(clubRefusal(new FakeApiError("x", 409, "EMAIL_TAKEN")).message).toMatch(/already has this email/);
    expect(clubRefusal(new FakeApiError("boom", 500)).message).toMatch(/^Not saved/);
  });

  it("needs a surname and an email for someone new", () => {
    expect(newPersonProblem({ surname: "", email: "a@b.co" })).toBe("Enter their surname.");
    expect(newPersonProblem({ surname: "Lee", email: "nope" })).toBe("Enter their email address.");
    expect(newPersonProblem({ surname: "Lee", email: " pat@example.com " })).toBeNull();
  });
});

describe("teams", () => {
  it("takes squad sizes 1 to 40 only", () => {
    expect(squadSize("16")).toBe(16);
    expect(squadSize("0")).toBeNull();
    expect(squadSize("41")).toBeNull();
    expect(squadSize("1.5")).toBeNull();
  });

  it("sends only what changed", () => {
    const d = teamDraft(team);
    expect(teamChange(team, d)).toBeNull();
    expect(teamChange(team, { ...d, targetSquadSize: "18" })).toEqual({ targetSquadSize: 18 });
    expect(teamChange(team, { ...d, captains: [{ id: "k1", name: "Kim" }] })).toEqual({ captainIds: ["k1"] });
    expect(teamChange(team, { ...d, coaches: [] })).toEqual({ coachIds: [] });
    expect(teamChange(team, { ...d, targetSquadSize: "99" })).toBeNull();
  });

  it("adds a person once", () => {
    const list = withHolder(team.coaches, { id: "c1", name: "Ann Coach" });
    expect(list).toHaveLength(1);
    expect(withHolder(list, { id: "c2", name: "Bo" }).map((h) => h.id)).toEqual(["c1", "c2"]);
  });

  it("sums a team up in one line", () => {
    expect(teamSummary(team)).toBe("Coach: Ann Coach · No captain · Squad 16");
  });

  it("puts Offices and teams after People, for the club section", () => {
    expect(officerItems({ sections: ["people", "club"] }).map((i) => i.label)).toEqual(["People", "Offices and teams"]);
  });
});
