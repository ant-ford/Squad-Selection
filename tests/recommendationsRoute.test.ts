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

import { getRecommendationsForMatch } from "../worker/src/recommendations";

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
    // B ability (20) -> 20/24*50=41.67, neutral position 20, same-team
    // proximity 20, full play-up headroom 10 => round(41.67+20+20+10)=92.
    expect(result.recommendations[0].score).toBe(92);
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
