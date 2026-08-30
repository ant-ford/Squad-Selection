import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Selected Team display (optics)
//
// The app displays People."Selected Team EOS" (fallback "Selected Team SOS",
// then the true Registered Team). All business rules keep using the true
// People.Registered Team. These tests pin the substitution at the payload
// boundaries and the fallback chain.
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

describe("player portal displays the Selected Team", () => {
  it("shows the Selected Team while fixtures stay categorised by the true team", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    installFakeAirtable({
      People: [
        fakeRecord("player", { id: "recP1", preferredName: "Alpha", email: "p1@hkfc.com", registeredTeam: "D", selectedTeamEos: "B" }),
      ],
      Teams: [
        fakeRecord("team", { id: "recT_D", teamName: "D", teamRank: 4 }),
        fakeRecord("team", { id: "recT_B", teamName: "B", teamRank: 2 }),
      ],
      Matches: [fakeRecord("match", { id: "recM1", matchDate: future, homeTeam: "D" })],
      "Availability Exceptions": [],
    });

    const out = await getMyFixtures({ AIRTABLE_TOKEN: "***", AIRTABLE_BASE_ID: "b" } as any, "p1@hkfc.com");

    // Header shows the optics team...
    expect(out.registeredTeam).toBe("B");
    // ...while the fixture list is still the TRUE team's fixtures (own, not a play-up).
    expect(out.fixtures).toHaveLength(1);
    expect(out.fixtures[0].hkfcTeam).toBe("D");
    expect(out.fixtures[0].isPlayUp).toBeFalsy();
  });
});
