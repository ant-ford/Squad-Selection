import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Selected Team display (optics) + player dashboard fixture categories
// ---------------------------------------------------------------------------

import { selectedDisplayTeam } from "../src/lib/displayTeam";
import { getActiveRanking } from "../worker/src/ranking";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../src/lib/cache";
import type { Player } from "../src/generated/domainTypes";

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

function installFakeAirtable(tables: Record<string, any[]>) {
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    if (!u.includes("api.airtable.com")) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    return Promise.resolve(
      new Response(JSON.stringify({ records: tables[table] ?? [] }), { status: 200 }),
    );
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
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

describe("player portal fixture categories", () => {
  const TEAMS = [
    fakeRecord("team", { id: "recT_A", teamName: "A", teamRank: 1 }),
    fakeRecord("team", { id: "recT_B", teamName: "B", teamRank: 2 }),
    fakeRecord("team", { id: "recT_C", teamName: "C", teamRank: 3 }),
    fakeRecord("team", { id: "recT_D", teamName: "D", teamRank: 4 }),
    fakeRecord("team", { id: "recT_E", teamName: "E", teamRank: 5 }),
    fakeRecord("team", { id: "recT_F", teamName: "F", teamRank: 6 }),
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
          preferredName: "Alpha",
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
    return getMyFixtures({ AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any, "p1@hkfc.com");
  }

  it("registered F, display D: My Team = D; play-ups = E and C; support = F", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "D",
      matches: [
        { id: "recM_D", homeTeam: "D", day: 1 },
        { id: "recM_B", homeTeam: "B", day: 1 }, // 2 above -> not advertised
        { id: "recM_C", homeTeam: "C", day: 2 }, // 3 above -> play-up team (after D is skipped)
        { id: "recM_E", homeTeam: "E", day: 3 }, // 1 above -> play-up team
        { id: "recM_F", homeTeam: "F", day: 4 }, // true team, below display -> support
      ],
    });
    expect(out.displayTeam).toBe("D");
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.fixtures[0].fixtureCategory).toBe("own");
    expect(out.fixtures[0].isPlayUp).toBeFalsy();
    // Play-up teams: E (1 above F) and C (after the display team D is skipped).
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["C", "E"]);
    expect(out.playUpOpportunities?.every((f) => f.isPlayUp)).toBe(true);
    expect(out.supportFixtures?.map((f) => f.hkfcTeam)).toEqual(["F"]);
    expect(out.supportFixtures?.every((f) => f.isPlayUp)).toBe(false);
  });

  it("already selected for the first team above: skip it and move further up", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: "recM_E", homeTeam: "E", day: 1, selectedHome: ["recP1"] }, // My Team + already selected
        { id: "recM_D", homeTeam: "D", day: 2 }, // play-up team 1
        { id: "recM_C", homeTeam: "C", day: 3 }, // play-up team 2
        { id: "recM_F", homeTeam: "F", day: 4 }, // support
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["E"]);
    // E is skipped (already selected / My Team) -> D and C are the two teams.
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["D", "C"]);
    expect(out.supportFixtures?.map((f) => f.hkfcTeam)).toEqual(["F"]);
  });

  it("same-day conflict with the My Team fixture removes the support fixture", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: "recM_E", homeTeam: "E", day: 1, selectedHome: ["recP1"] },
        { id: "recM_D", homeTeam: "D", day: 2 }, // play-up
        { id: "recM_F", homeTeam: "F", day: 2 }, // support candidate, same day as D
      ],
    });
    // The player is Available for their E fixture on the same day -> the F
    // support fixture is ineligible ("Available for E on same day") -> hidden.
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.supportFixtures ?? []).toHaveLength(0);
  });

  it("suspension removes play-up and support fixtures (My Team still shown)", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "D",
      suspended: true,
      matches: [
        { id: "recM_D", homeTeam: "D", day: 1 },
        { id: "recM_C", homeTeam: "C", day: 2 },
        { id: "recM_F", homeTeam: "F", day: 3 },
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["D"]); // My Team unaffected
    expect(out.playUpOpportunities ?? []).toHaveLength(0); // suspended -> blocked everywhere
    expect(out.supportFixtures ?? []).toHaveLength(0);
  });
});
