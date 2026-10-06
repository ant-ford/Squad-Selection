import { describe, expect, it } from "vitest";
import { checkRefusal, fixingValue, linkedNote, moveTargets, tabCounts, visibleTabs } from "../src/lib/dataChecks";
import { officerItems } from "../src/components/headerItems";
import type { DataChecks } from "../src/api/dataChecks";

const person = (id: string) => ({ id, name: `Person ${id}`, team: "HKFC C", active: true, status: "Member" });
const empty: DataChecks = { unlinkedCards: [], sharedRegisteredNames: [], reRegistrations: [], incomplete: [], duplicates: [], needsFixing: [] };

class FakeApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

describe("tabs", () => {
  it("hides empty tabs and counts the rest, in order", () => {
    const d: DataChecks = {
      ...empty,
      unlinkedCards: [{ id: "c1", rawName: "LEE Sam", team: "HKFC C", matchDate: null, opponent: null, suggestions: [] }],
      incomplete: [{ person: person("a"), missing: ["team"] }, { person: person("b"), missing: ["ability"] }],
    };
    expect(visibleTabs(d)).toEqual([
      { value: "cards", label: "Unlinked cards (1)" },
      { value: "incomplete", label: "Incomplete (2)" },
    ]);
    expect(tabCounts(d).duplicates).toBe(0);
  });

  it("has no tabs when there's nothing to fix", () => {
    expect(visibleTabs(empty)).toEqual([]);
  });
});

describe("re-registrations", () => {
  it("offers the suggested team first, then other play-up teams, never the current one", () => {
    expect(
      moveTargets({
        previousTeam: "HKFC D",
        suggestedTeam: "HKFC C",
        playUps: [
          { matchDate: null, team: "HKFC B" },
          { matchDate: null, team: "HKFC C" },
          { matchDate: null, team: "HKFC D" },
          { matchDate: null, team: null },
        ],
      }),
    ).toEqual(["HKFC C", "HKFC B"]);
  });

  it("offers only Keep when there's no team to move to", () => {
    expect(moveTargets({ previousTeam: "HKFC D", suggestedTeam: null, playUps: [] })).toEqual([]);
  });
});

describe("words", () => {
  it("maps each refusal to plain words", () => {
    expect(checkRefusal(new FakeApiError("x", 409, "ALREADY_LINKED"))).toMatch(/already linked/);
    expect(checkRefusal(new FakeApiError("x", 409, "NAME_TAKEN"))).toMatch(/already has this registered name/);
    expect(checkRefusal(new FakeApiError("x", 409, "NOT_A_MOVE_UP"))).toBe("Choose a team above their registered team.");
    expect(checkRefusal(new FakeApiError("x", 409, "TEAM_CHANGED"))).toMatch(/changed since/);
    expect(checkRefusal(new FakeApiError("stack trace", 500))).toMatch(/^Not saved/);
    expect(checkRefusal(new Error("Failed to fetch"))).toMatch(/^Not saved/);
  });

  it("says how many cards a link linked", () => {
    expect(linkedNote(1)).toBe("Linked");
    expect(linkedNote(4)).toBe("Linked · 4 cards");
  });

  it("shows a blank value as Blank", () => {
    expect(fixingValue("")).toBe("Blank");
    expect(fixingValue("On Hold")).toBe("On Hold");
  });

  it("puts Data checks last in the officers' menu, for its section", () => {
    expect(officerItems({ sections: ["registration", "people", "discipline", "dataChecks"] }).map((i) => i.label)).toEqual([
      "HKHA registration",
      "Suspensions",
      "People",
      "Data checks",
    ]);
  });
});
