import { describe, expect, it } from "vitest";
import { squadChange, squadDraft, squadFields, withCurrent } from "../src/lib/peopleAdmin";
import type { PersonSquad } from "../src/api/adminPeople";

const teams = ["HKFC A", "HKFC B", "HKFC C"];
const saved: PersonSquad = { registeredTeam: "HKFC C", selectedTeamSos: "HKFC C", selectedTeamEos: null, playingPosition: "Defender" };

describe("squad fields", () => {
  it("offers the registered team to the Men's Convenor only", () => {
    expect(squadFields({ squad: true, registeredTeam: true }, teams).map((f) => f.key)).toEqual([
      "registeredTeam",
      "selectedTeamSos",
      "selectedTeamEos",
      "playingPosition",
    ]);
    expect(squadFields({ squad: true, registeredTeam: false }, teams).map((f) => f.key)).toEqual([
      "selectedTeamSos",
      "selectedTeamEos",
      "playingPosition",
    ]);
    expect(squadFields({ squad: false, registeredTeam: false }, teams)).toEqual([]);
  });

  it("uses the API's active teams and the profile's positions", () => {
    const fields = squadFields({ squad: true, registeredTeam: false }, teams);
    expect(fields.find((f) => f.key === "selectedTeamSos")?.options).toEqual(teams);
    const position = fields.find((f) => f.key === "playingPosition");
    expect(position?.options).toContain("Goalkeeper");
    expect(position?.options).toContain("Flexible/Varies");
  });
});

describe("squad save", () => {
  const all = ["registeredTeam", "selectedTeamSos", "selectedTeamEos", "playingPosition"] as const;

  it("sends nothing when nothing changed", () => {
    expect(squadChange(saved, squadDraft(saved), all)).toBeNull();
  });

  it("sends only the changed fields with what the screen read", () => {
    const draft = { ...squadDraft(saved), selectedTeamEos: "HKFC B", playingPosition: "" };
    expect(squadChange(saved, draft, all)).toEqual({
      selectedTeamEos: "HKFC B",
      playingPosition: null,
      expect: { selectedTeamEos: null, playingPosition: "Defender" },
    });
  });

  it("never sends a field that isn't offered (a Section Captain's registered team)", () => {
    const draft = { ...squadDraft(saved), registeredTeam: "HKFC A", playingPosition: "Forward" };
    expect(squadChange(saved, draft, ["selectedTeamSos", "selectedTeamEos", "playingPosition"])).toEqual({
      playingPosition: "Forward",
      expect: { playingPosition: "Defender" },
    });
  });

  it("keeps a stored value the list no longer has choosable", () => {
    expect(withCurrent(teams, "HKFC Old")).toEqual(["HKFC Old", ...teams]);
    expect(withCurrent(teams, "HKFC B")).toEqual(teams);
    expect(withCurrent(teams, "")).toEqual(teams);
  });
});
