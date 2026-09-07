import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Selected Team display (optics) + player dashboard fixture categories
// ---------------------------------------------------------------------------

import { selectedDisplayTeam } from "../shared/displayTeam";
import { getActiveRanking } from "../worker/src/ranking";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { Player } from "../shared/schema/domainTypes";
import type { AuthorizedUser } from "../worker/src/auth";
import { fakeAirtable, type FakeTables } from "./helpers/airtable";

function authUser(email: string): AuthorizedUser {
  return { email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false };
}

beforeEach(() => {
  invalidateAll();
  vi.unstubAllGlobals();
});

describe("selectedDisplayTeam fallback chain", () => {
  const base = { registeredTeam: "D" } as Pick<Player, "registeredTeam">;

  it("prefers Selected Team EOS", () => {
    expect(selectedDisplayTeam({ ...base, selectedTeamSos: "C", selectedTeamEos: "B" })).toBe("B");
  });

  it("falls back to Selected Team SOS when EOS is empty", () => {
    expect(selectedDisplayTeam({ ...base, selectedTeamSos: "C", selectedTeamEos: "" })).toBe("C");
  });

  it("falls back to the true Registered Team when both are empty", () => {
    expect(selectedDisplayTeam({ registeredTeam: "D", selectedTeamSos: "", selectedTeamEos: "" })).toBe("D");
  });

  it("returns an empty string when nothing is set", () => {
    expect(selectedDisplayTeam({ registeredTeam: "", selectedTeamSos: "", selectedTeamEos: "" })).toBe("");
  });
});

function fakeRecord(kind: "player" | "team" | "match", domain: any): any {
  if (kind === "player") {
    return {
      id: domain.id,
      fields: {
        "Preferred Name": domain.preferredName ?? "Test",
        Email: domain.email ?? "p1@hkfc.com",
        Active: true,
        "Registered Team": domain.registeredTeam,
        "Selected Team SOS": domain.selectedTeamSos,
        "Selected Team EOS": domain.selectedTeamEos,
        "Is Suspended": domain.suspended ?? false,
        "Playing Position": domain.playingPosition ?? "Midfielder",
        "Playing Ability": domain.playingAbility ?? "B",
        "Section Rank": domain.sectionRank,
        Status: domain.status ?? "Player",
        "Applicant Stage": domain.applicantStage ?? "",
      },
    };
  }
  if (kind === "team") {
    return {
      id: domain.id,
      fields: {
        "Team Name": domain.teamName,
        "Team Rank": domain.teamRank,
        Active: true,
        Coach: [],
        "Team Captain": [],
        "Section Captain": [],
        "Auto Select Players": [],
      },
    };
  }
  return {
    id: domain.id,
    fields: {
      Date: domain.matchDate,
      Season: "2026-2027",
      Division: "Division 3",
      "Competition Type": "League",
      "Home Team": domain.homeTeam,
      "Away Team": "Opponent",
        "Selected Players Home": domain.selectedHome ?? [],
      "Home Score": 0,
      "Away Score": 0,
      "Match Status": "Scheduled",
    },
  };
}

function installFakeAirtable(tables: FakeTables) {
  return fakeAirtable(tables);
}

describe("ranking payload displays the Selected Team", () => {
  it("shows EOS/SOS/Registered fallback and groups T# by the displayed team", async () => {
    installFakeAirtable({
      People: [
        fakeRecord("player", { id: "recP1", preferredName: "Alpha", registeredTeam: "D", selectedTeamEos: "B", sectionRank: 1 }),
        fakeRecord("player", { id: "recP2", preferredName: "Beta", registeredTeam: "D", selectedTeamEos: "B", sectionRank: 2 }),
        fakeRecord("player", { id: "recP3", preferredName: "Gamma", registeredTeam: "E", sectionRank: 3 }),
      ],
      "Ability Group Configuration": [],
    });

    const list = await getActiveRanking({ AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any);
    const byId = new Map(list.players.map((p) => [p.id, p]));

    expect(byId.get("recP1")!.registeredTeam).toBe("B"); // EOS displayed
    expect(byId.get("recP2")!.registeredTeam).toBe("B"); // EOS displayed
    expect(byId.get("recP3")!.registeredTeam).toBe("E"); // falls back to Registered
    // T# is grouped by the DISPLAYED team, not the true registration.
    expect(byId.get("recP1")!.teamRank).toBe(1);
    expect(byId.get("recP2")!.teamRank).toBe(2);
    expect(byId.get("recP3")!.teamRank).toBe(1);
  });
});

describe("player portal fixture categories (per-day, max three)", () => {
  const TEAMS = [
    fakeRecord("team", { id: "recT_A", teamName: "A", teamRank: 1 }),
    fakeRecord("team", { id: "recT_B", teamName: "B", teamRank: 2 }),
    fakeRecord("team", { id: "recT_C", teamName: "C", teamRank: 3 }),
    fakeRecord("team", { id: "recT_D", teamName: "D", teamRank: 4 }),
    fakeRecord("team", { id: "recT_E", teamName: "E", teamRank: 5 }),
    fakeRecord("team", { id: "recT_F", teamName: "F", teamRank: 6 }),
    fakeRecord("team", { id: "recT_G", teamName: "G", teamRank: 7 }),
    fakeRecord("team", { id: "recT_H", teamName: "H", teamRank: 8 }),
  ];
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  async function portal(opts: {
    registeredTeam: string;
    selectedTeamEos?: string;
    suspended?: boolean;
    matches: { id: string; homeTeam: string; day: number; selectedHome?: string[] }[];
  }) {
    installFakeAirtable({
      People: [
        fakeRecord("player", {
          id: "recP1",
          preferredName: "Jonny",
          email: "p1@hkfc.com",
          registeredTeam: opts.registeredTeam,
          selectedTeamEos: opts.selectedTeamEos,
          suspended: opts.suspended,
        }),
      ],
      Teams: TEAMS,
      Matches: opts.matches.map((m) =>
        fakeRecord("match", { id: m.id, matchDate: day(m.day), homeTeam: m.homeTeam, selectedHome: m.selectedHome }),
      ),
      "Availability Exceptions": [],
    });
    return getMyFixtures({ AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any, authUser("p1@hkfc.com"));
  }

  it("Jonny (registered F, selected/display E, everything same day): E upcoming, D play-up, F support hidden (selected for E)", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: "recM_E", homeTeam: "E", day: 1, selectedHome: ["recP1"] },
        { id: "recM_D", homeTeam: "D", day: 1 }, // one above display -> play-up
        { id: "recM_F", homeTeam: "F", day: 1 }, // registered team, below display -> support
        { id: "recM_G", homeTeam: "G", day: 1 }, // engine blocks (committee) -> hidden
        { id: "recM_H", homeTeam: "H", day: 1 }, // engine blocks (committee) -> hidden
      ],
    });
    expect(out.displayTeam).toBe("E");
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["E"]);
    expect(out.fixtures[0].fixtureCategory).toBe("own");
    expect(out.fixtures[0].isPlayUp).toBeFalsy();
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.playUpOpportunities?.every((f) => f.isPlayUp)).toBe(true);
    // Jonny is SELECTED for the higher E fixture on the same day -> per the
    // same-day rule he is ineligible for his own F team's fixture that day.
    expect(out.supportFixtures ?? []).toHaveLength(0);
  });

  it("registered F, display E, NOT selected for E: availability does not hide the F support fixture", async () => {
    // Same fixtures, but Jonny is merely available for E (not selected) ->
    // he remains selectable by his own F team (product decision 2026-09-03).
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: "recM_E", homeTeam: "E", day: 1 },
        { id: "recM_D", homeTeam: "D", day: 1 },
        { id: "recM_F", homeTeam: "F", day: 1 },
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["E"]);
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.supportFixtures?.map((f) => f.hkfcTeam)).toEqual(["F"]);
  });

  it("registered D player: D upcoming, C and B fill the play-up places, A capped out", async () => {
    const out = await portal({
      registeredTeam: "D",
      matches: [
        { id: "recM_D", homeTeam: "D", day: 1, selectedHome: ["recP1"] },
        { id: "recM_C", homeTeam: "C", day: 1 },
        { id: "recM_B", homeTeam: "B", day: 1 },
        { id: "recM_A", homeTeam: "A", day: 1 },
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["C", "B"]);
    expect(out.supportFixtures ?? []).toHaveLength(0); // registered == selected -> no support
    // The fourth option (A) is dropped by the three-fixture cap.
  });

  it("multi-day: each day is capped independently", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: "recM_E", homeTeam: "E", day: 1, selectedHome: ["recP1"] },
        { id: "recM_D", homeTeam: "D", day: 2 },
        { id: "recM_F", homeTeam: "F", day: 3 },
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["E"]);
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.supportFixtures?.map((f) => f.hkfcTeam)).toEqual(["F"]);
  });

  it("no Selected-Team fixture that day: registered support + play-ups fill the day", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: "recM_D", homeTeam: "D", day: 1 },
        { id: "recM_C", homeTeam: "C", day: 1 },
        { id: "recM_F", homeTeam: "F", day: 1 },
      ],
    });
    // No E fixture that day: support F shows (registered below display E)
    // and play-ups fill the remaining places with D then C.
    expect(out.fixtures ?? []).toHaveLength(0);
    expect(out.supportFixtures?.map((f) => f.hkfcTeam)).toEqual(["F"]);
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["D", "C"]);
  });

  it("suspension removes play-up and support fixtures (My Team still shown)", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "D",
      suspended: true,
      matches: [
        { id: "recM_D", homeTeam: "D", day: 1 },
        { id: "recM_C", homeTeam: "C", day: 1 },
        { id: "recM_F", homeTeam: "F", day: 2 },
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.playUpOpportunities ?? []).toHaveLength(0);
    expect(out.supportFixtures ?? []).toHaveLength(0);
  });
});
