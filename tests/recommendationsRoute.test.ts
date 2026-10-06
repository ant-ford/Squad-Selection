import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// getRecommendationsForMatch (worker/src/recommendations.ts)
//
// Regression for bug B4: `side` is undefined for a non-derby fixture, so
// `side === "away" ? match.awayTeam : match.homeTeam` silently fell back to
// match.homeTeam even when HKFC was the away side - scoring every candidate
// against the OPPONENT's (unknown) rank, defaulting to the magic rank 12.
// The fix uses match.hkfcTeam, which getPlayersForMatch already resolves
// correctly for both derby and non-derby fixtures.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getPlayersForMatch: vi.fn(),
  getReferenceData: vi.fn(),
}));

vi.mock("../worker/src/squad", () => ({ getPlayersForMatch: mocks.getPlayersForMatch }));
vi.mock("../worker/src/reference", () => ({ getReferenceData: mocks.getReferenceData }));

import { getRecommendationsForMatch, getTeamAvailabilityForMatch } from "../worker/src/recommendations";

const ENV = {} as any;

function player(id: string, registeredTeam: string) {
  return {
    id,
    preferredName: id,
    playingPosition: "Defender",
    playingAbility: "B",
    playUpCount: 0,
    registeredTeam,
    eligibilityStatus: "eligible",
    availabilityStatus: "Available",
    selectionStatus: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getReferenceData.mockResolvedValue({
    teamRankMap: { "HKFC D": 4 },
  });
});

describe("getRecommendationsForMatch: HKFC-away fixture", () => {
  it("scores candidates against the HKFC side's rank, not the (unranked) opponent's, and without the side query param", async () => {
    // Non-derby away fixture: HKFC D travels to an external club. The
    // frontend never sends ?side= for a non-derby fixture, so `side` here
    // is undefined - exactly the case the bug missed.
    mocks.getPlayersForMatch.mockResolvedValue({
      match: {
        hkfcTeam: "HKFC D",
        homeTeam: "Valley Hockey Club",
        awayTeam: "HKFC D",
      },
      players: [player("same", "HKFC D")],
    });

    const result = await getRecommendationsForMatch(ENV, "recM1", undefined, undefined, 10);

    // A candidate registered to the HKFC side gets full proximity credit
    // (distance 0) only if targetTeamRank correctly resolved to HKFC D's
    // rank (4). Under the old bug, the opponent's rank is undefined, so
    // teamRankMap[undefined-ish opponent] ?? 12 would be used instead,
    // making candidateTeamRank(4) - targetTeamRank(12) = -8 (play-down,
    // zero proximity credit) rather than the correct same-team match.
    expect(result.recommendations).toHaveLength(1);
    // B ability (20) -> 20/24*60=50, neutral position 20, same-team
    // proximity 10, full play-up headroom 10 => 90.
    expect(result.recommendations[0].score).toBe(90);
  });

  it("throws a 400 instead of fabricating rank 12 when the HKFC team's rank is unknown", async () => {
    mocks.getPlayersForMatch.mockResolvedValue({
      match: { hkfcTeam: "Unlisted Team", homeTeam: "Opponent", awayTeam: "Unlisted Team" },
      players: [player("p1", "Unlisted Team")],
    });
    await expect(getRecommendationsForMatch(ENV, "recM1", undefined, undefined, 10)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("recommendationOrder: the squad screen's ranking, with the players", () => {
  it("is the recommendations route's order (current squad ranked too, no limit), from the players given", async () => {
    mocks.getReferenceData.mockResolvedValue({ teamRankMap: { "HKFC C": 3, "HKFC D": 4 } });
    const data = {
      match: { hkfcTeam: "HKFC C", homeTeam: "HKFC C", awayTeam: "Valley Hockey Club" },
      players: [
        player("down", "HKFC D"),
        { ...player("picked", "HKFC C"), selectionStatus: "Selected" },
        { ...player("maybe", "HKFC C"), availabilityStatus: "Maybe" },
        { ...player("blocked", "HKFC C"), eligibilityStatus: "blocked" },
        { ...player("out", "HKFC C"), availabilityStatus: "Unavailable" },
        ...Array.from({ length: 12 }, (_, i) => player(`d${String(i).padStart(2, "0")}`, "HKFC D")),
      ],
    };
    mocks.getPlayersForMatch.mockResolvedValue(data);
    const { recommendationOrder } = await import("../worker/src/recommendations");

    const order = await recommendationOrder(ENV, data as never);
    const route = await getRecommendationsForMatch(ENV, "recM1", undefined, undefined, 500, true);
    expect(order).toEqual(route.recommendations.map((r) => r.id));
    expect(order[0]).toBe("picked");
    expect(order).toHaveLength(15); // all but the blocked and the unavailable, past the route's default 10
    // Worked from what it was handed: no second players-for-match.
    expect(mocks.getPlayersForMatch).toHaveBeenCalledTimes(1);
  });

  it("is empty for a team with no rank (the route's 400)", async () => {
    const { recommendationOrder } = await import("../worker/src/recommendations");
    const data = { match: { hkfcTeam: "Unlisted Team" }, players: [player("p1", "Unlisted Team")] };
    expect(await recommendationOrder(ENV, data as never)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Which team a candidate is RANKED as.
//
// getPlayersForMatch hands this module a pool whose `registeredTeam` is
// already the DISPLAY team (Selected Team EOS -> SOS -> Registered Team), and
// the proximity score is scored on it deliberately - see the comment on 2c in
// recommendations.ts. A player the Section Captain has moved up to HKFC C
// while People.Registered Team still reads HKFC D must rank as a C, because
// re-registration lags the actual move and the C coach expects them near the
// top of the list rather than buried among visiting Ds.
//
// buildRecommendations' own unit tests cannot pin this: a candidate carries
// one team field, so only the wiring here can say which team filled it.
// ---------------------------------------------------------------------------
describe("getRecommendationsForMatch: ranking basis", () => {
  it("ranks a player moved to HKFC C as a C, not as a D playing up", async () => {
    mocks.getReferenceData.mockResolvedValue({
      teamRankMap: { "HKFC C": 3, "HKFC D": 4 },
    });
    mocks.getPlayersForMatch.mockResolvedValue({
      match: { hkfcTeam: "HKFC C", homeTeam: "HKFC C", awayTeam: "Valley Hockey Club" },
      players: [
        // Registered HKFC D, Selected Team C - getPlayersForMatch has already
        // resolved the display team, so this is what the pool carries.
        player("moved-up", "HKFC C"),
        player("stayed-down", "HKFC D"),
      ],
    });

    const result = await getRecommendationsForMatch(ENV, "recM1", undefined, undefined, 10);

    const moved = result.recommendations.find((r) => r.id === "moved-up")!;
    const stayed = result.recommendations.find((r) => r.id === "stayed-down")!;

    // Same team as the fixture: full proximity credit (10) and full play-up
    // headroom (10) => 50 + 20 + 10 + 10 = 90.
    expect(moved.score).toBe(90);
    // One rank below: proximity 10 - 1*3 = 7, headroom still 10 (no play-ups
    // recorded) => 50 + 20 + 7 + 10 = 87.
    expect(stayed.score).toBe(87);
    expect(result.recommendations[0].id).toBe("moved-up");

    // The row shows the team the score was computed from, so the ordering is
    // explicable to the coach reading it.
    expect(moved.registeredTeam).toBe("HKFC C");

    // ... and only the genuine play-up carries the play-up tag.
    expect(moved.reasons).not.toContain("Play-Up Capacity");
    expect(stayed.reasons).toContain("Play-Up Capacity");
  });
});

// ---------------------------------------------------------------------------
// getTeamAvailabilityForMatch - the player-facing fixture sheet lists.
//
// Any signed-in player can read this, so besides the grouping it pins what
// is LEFT OUT: notes, ability, scores and the rest of the coach payload.
// ---------------------------------------------------------------------------
describe("getTeamAvailabilityForMatch", () => {
  function full(id: string, team: string, extra: Record<string, unknown> = {}) {
    return {
      ...player(id, team),
      shirtNo: "7",
      mobile: "+852 9000 0000",
      playerNotes: "private note",
      ...extra,
    };
  }

  beforeEach(() => {
    mocks.getReferenceData.mockResolvedValue({ teamRankMap: { "HKFC C": 3, "HKFC D": 4, "HKFC E": 5 } });
  });

  it("splits selected, rest of the team and the top five from other teams", async () => {
    mocks.getPlayersForMatch.mockResolvedValue({
      match: { hkfcTeam: "HKFC D", targetSquadSize: 16 },
      players: [
        full("sel-own", "HKFC D", { selectionStatus: "Selected", playingPosition: "Forward" }),
        full("sel-up", "HKFC E", { selectionStatus: "Selected", playingPosition: "Goalkeeper" }),
        full("own-no", "HKFC D", { availabilityStatus: "Unavailable" }),
        full("own-yes", "HKFC D"),
        full("own-maybe", "HKFC D", { availabilityStatus: "Maybe" }),
        ...["e1", "e2", "e3", "e4", "e5", "e6"].map((id) => full(id, "HKFC E")),
        full("e-out", "HKFC E", { availabilityStatus: "Unavailable", playingAbility: "A+" }),
        full("e-blocked", "HKFC E", { eligibilityStatus: "blocked", playingAbility: "A+" }),
      ],
    });

    const r = await getTeamAvailabilityForMatch(ENV, "recM1");

    expect(r.team).toBe("HKFC D");
    expect(r.targetSquadSize).toBe(16);
    // Selected: whatever team they came from, by position.
    expect(r.selected.map((p) => p.id)).toEqual(["sel-up", "sel-own"]);
    // Rest of the team: Available, then Maybe, then No.
    expect(r.restOfTeam.map((p) => p.id)).toEqual(["own-yes", "own-maybe", "own-no"]);
    // Five suggestions, none from this team, none unavailable or blocked.
    expect(r.suggestions).toHaveLength(5);
    expect(r.suggestions.every((p) => p.id.startsWith("e") && !["e-out", "e-blocked"].includes(p.id))).toBe(true);
  });

  it("returns only name, shirt number, position and status", async () => {
    mocks.getPlayersForMatch.mockResolvedValue({
      match: { hkfcTeam: "HKFC D", targetSquadSize: 16 },
      players: [full("own", "HKFC D"), full("sel", "HKFC D", { selectionStatus: "Selected" }), full("e", "HKFC E")],
    });

    const r = await getTeamAvailabilityForMatch(ENV, "recM1");

    for (const row of [...r.selected, ...r.restOfTeam, ...r.suggestions]) {
      expect(Object.keys(row).sort()).toEqual(["id", "name", "position", "shirtNo", "status"]);
    }
  });

  it("gives no suggestions for an unranked team instead of failing the sheet", async () => {
    mocks.getPlayersForMatch.mockResolvedValue({
      match: { hkfcTeam: "Unlisted", targetSquadSize: 16 },
      players: [full("own", "Unlisted"), full("e", "HKFC E")],
    });

    const r = await getTeamAvailabilityForMatch(ENV, "recM1");

    expect(r.restOfTeam.map((p) => p.id)).toEqual(["own"]);
    expect(r.suggestions).toEqual([]);
  });
});
