import { describe, it, expect } from "vitest";
import { sortSquadList, compareSelected, type SortablePlayer } from "../src/lib/squadSort";

function player(overrides: Partial<SortablePlayer> = {}): SortablePlayer {
  return {
    id: "p1",
    preferredName: "Player One",
    playingPosition: "Midfielder",
    playingAbility: "C",
    selectionStatus: "",
    eligibilityStatus: "eligible",
    availabilityStatus: "Available",
    ...overrides,
  };
}

const selected = (overrides: Partial<SortablePlayer>) =>
  player({ selectionStatus: "Selected", ...overrides });

const ids = (players: SortablePlayer[]) => players.map((p) => p.id);

describe("sortSquadList", () => {
  it("puts the selected squad first, in GK, DEF, MID, FWD, FLEX order", () => {
    const squad = [
      selected({ id: "fwd", playingPosition: "Forward" }),
      selected({ id: "gk", playingPosition: "Goalkeeper" }),
      selected({ id: "flex", playingPosition: "Flexible/Varies" }),
      selected({ id: "mid", playingPosition: "Midfielder" }),
      selected({ id: "def", playingPosition: "Defender" }),
    ];
    expect(ids(sortSquadList(squad, new Map()))).toEqual(["gk", "def", "mid", "fwd", "flex"]);
  });

  it("sorts strongest first within a position", () => {
    const squad = [
      selected({ id: "weak", playingPosition: "Defender", playingAbility: "D" }),
      selected({ id: "strong", playingPosition: "Defender", playingAbility: "A" }),
    ];
    expect(ids(sortSquadList(squad, new Map()))).toEqual(["strong", "weak"]);
  });

  it("keeps the unselected in the recommendation engine's order, ignoring position", () => {
    const pool = [
      player({ id: "third", playingPosition: "Goalkeeper" }),
      player({ id: "first", playingPosition: "Forward" }),
      player({ id: "second", playingPosition: "Defender" }),
    ];
    const ranks = new Map([["first", 0], ["second", 1], ["third", 2]]);
    expect(ids(sortSquadList(pool, ranks))).toEqual(["first", "second", "third"]);
  });

  it("sinks the unavailable and blocked below every ranked candidate", () => {
    const pool = [
      player({ id: "blocked", eligibilityStatus: "blocked", playingAbility: "A+" }),
      player({ id: "unavailable", availabilityStatus: "Unavailable", playingAbility: "A+" }),
      player({ id: "ranked", playingAbility: "F" }),
    ];
    const sorted = sortSquadList(pool, new Map([["ranked", 0]]));
    expect(sorted[0].id).toBe("ranked");
  });

  it("holds a just-deselected player above the unavailable despite having no rank", () => {
    // Recommendations are computed server-side and exclude whoever was
    // selected at the last save, so a player taken out of the squad in this
    // session has no rank until the next sync.
    const pool = [
      player({ id: "unavailable", availabilityStatus: "Unavailable", playingAbility: "A+" }),
      player({ id: "deselected", playingAbility: "C" }),
      player({ id: "ranked", playingAbility: "F" }),
    ];
    expect(ids(sortSquadList(pool, new Map([["ranked", 0]])))).toEqual([
      "ranked",
      "deselected",
      "unavailable",
    ]);
  });

  it("orders the whole list selected-before-unselected", () => {
    const pool = [
      player({ id: "top-pick" }),
      selected({ id: "picked", playingPosition: "Flexible/Varies" }),
    ];
    expect(ids(sortSquadList(pool, new Map([["top-pick", 0]])))).toEqual(["picked", "top-pick"]);
  });
});

describe("compareSelected", () => {
  it("sorts an unrecognised position after FLEX", () => {
    const squad = [
      player({ id: "unknown", playingPosition: "Sweeper" }),
      player({ id: "flex", playingPosition: "Flexible/Varies" }),
    ].sort(compareSelected);
    expect(ids(squad)).toEqual(["flex", "unknown"]);
  });
});
