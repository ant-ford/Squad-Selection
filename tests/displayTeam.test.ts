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

describe("player portal fixture categories (display team = D, true team = F)", () => {
  async function portal() {
    const day1 = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const day2 = new Date(Date.now() + 8 * 86_400_000).toISOString();
    installFakeAirtable({
      People: [
        fakeRecord("player", { id: "recP1", preferredName: "Alpha", email: "p1@hkfc.com", registeredTeam: "F", selectedTeamEos: "D" }),
      ],
      Teams: [
        fakeRecord("team", { id: "recT_A", teamName: "A", teamRank: 1 }),
        fakeRecord("team", { id: "recT_B", teamName: "B", teamRank: 2 }),
        fakeRecord("team", { id: "recT_C", teamName: "C", teamRank: 3 }),
        fakeRecord("team", { id: "recT_D", teamName: "D", teamRank: 4 }),
        fakeRecord("team", { id: "recT_F", teamName: "F", teamRank: 6 }),
      ],
      Matches: [
        fakeRecord("match", { id: "recM_D", matchDate: day1, homeTeam: "D" }), // My Team
        fakeRecord("match", { id: "recM_B", matchDate: day1, homeTeam: "B" }), // 2 above -> NOT advertised
        fakeRecord("match", { id: "recM_C", matchDate: day2, homeTeam: "C" }), // next team up -> play-up (no date requirement)
        fakeRecord("match", { id: "recM_A", matchDate: day2, homeTeam: "A" }), // 3 above -> NOT advertised
        fakeRecord("match", { id: "recM_F", matchDate: day2, homeTeam: "F" }), // true team, lower -> support
      ],
      "Availability Exceptions": [],
    });
    return getMyFixtures({ AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any, "p1@hkfc.com");
  }

  it("shows the Selected Team as My Team and classifies by Team Rank", async () => {
    const out = await portal();
    expect(out.displayTeam).toBe("D");
    expect(out.registeredTeam).toBe("D");
    // My Team: fixtures for the displayed team only.
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.fixtures[0].fixtureCategory).toBe("own");
    expect(out.fixtures[0].isPlayUp).toBeFalsy(); // own fixture is NEVER a play-up
    // Play-Up Opportunities: ONLY the team immediately above the display team.
    expect(out.playUpOpportunities?.map((f) => f.hkfcTeam)).toEqual(["C"]);
    expect(out.playUpOpportunities![0].isPlayUp).toBe(true);
    // Distant higher teams (B, A) are not advertised.
    expect(out.playUpOpportunities?.some((f) => f.hkfcTeam === "B")).toBe(false);
    expect(out.playUpOpportunities?.some((f) => f.hkfcTeam === "A")).toBe(false);
    // Support Fixtures: lower-ranked teams (includes the true Registered Team).
    expect(out.supportFixtures?.map((f) => f.hkfcTeam)).toEqual(["F"]);
    expect(out.supportFixtures![0].isPlayUp).toBeFalsy();
    // Regression: C is advertised even though D has NO fixture on that date.
    const cFixture = out.playUpOpportunities![0];
    const dDates = out.fixtures.map((f) => f.date.split("T")[0]);
    expect(dDates.includes(cFixture.date.split("T")[0])).toBe(false);
  });
});
