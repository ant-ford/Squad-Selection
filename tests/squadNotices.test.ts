import { describe, expect, it } from "vitest";
import { changedSinceNotice, previousSquad } from "../worker/src/squadNotices";
import type { Match } from "../shared/schema/domainTypes";

const m = (id: string, date: string, home: string, away: string, h: string[] = [], a: string[] = []) =>
  ({ id, matchDate: date, homeTeam: home, awayTeam: away, selectedPlayersHome: h, selectedPlayersAway: a, division: "", homeTeamScore: 0, awayTeamScore: 0, matchStatus: "Played" }) as Match;

describe("the coach's weekly loop", () => {
  it("knows whether the squad changed since it was sent", () => {
    expect(changedSinceNotice(null, ["a"])).toBe(false);
    expect(changedSinceNotice({ at: "x", squad: ["a", "b"] }, ["b", "a"])).toBe(false);
    expect(changedSinceNotice({ at: "x", squad: ["a", "b"] }, ["a", "c"])).toBe(true);
    expect(changedSinceNotice({ at: "x", squad: ["a", "b"] }, ["a"])).toBe(true);
  });

  it("finds the team's last squad before this fixture, whichever side they were", () => {
    const now = m("now", "2026-10-17T06:00:00Z", "HKFC C", "Valley B");
    const matches = [
      m("old", "2026-09-26T06:00:00Z", "HKFC C", "Punjab", ["p1"]),
      m("last", "2026-10-10T06:00:00Z", "Shaheen", "HKFC C", [], ["p2", "p3"]),
      m("empty", "2026-10-12T06:00:00Z", "HKFC C", "KCC", []),
      m("other", "2026-10-11T06:00:00Z", "HKFC D", "Valley D", ["x"]),
      m("later", "2026-10-24T06:00:00Z", "HKFC C", "Dragons", ["p9"]),
      now,
    ];
    expect(previousSquad(matches, now, "HKFC C")).toEqual({ matchId: "last", date: "2026-10-10T06:00:00Z", players: ["p2", "p3"] });
    expect(previousSquad([now], now, "HKFC C")).toBeNull();
  });
});
