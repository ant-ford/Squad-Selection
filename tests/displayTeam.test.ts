import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Selected Team display (optics) + player dashboard fixture categories
// ---------------------------------------------------------------------------

import { selectedDisplayTeam } from "../shared/displayTeam";
import { getActiveRanking } from "../worker/src/ranking";
import { getMyFixtures } from "../worker/src/fixtures";
import { invalidateAll } from "../worker/src/cache";
import type { Env } from "../worker/src/env";
import type { Player } from "../shared/schema/domainTypes";
import type { AuthorizedUser } from "../worker/src/auth";
import { useFakeRepos } from "./helpers/fakeRepos";
import { fakePostgrest, SUPABASE_TEST_ENV, type FakePostgrest } from "./helpers/postgrest";
import { match, person, recId, team } from "./helpers/factories";

const ENV = { ...SUPABASE_TEST_ENV } as Env;

function authUser(email: string): AuthorizedUser {
  return { email, personId: "", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] };
}

const db = useFakeRepos();
let pg: FakePostgrest;

beforeEach(() => {
  invalidateAll();
  // The player dashboard also asks Supabase directly whether this player
  // keeps volunteers, events or umpiring duties (volunteerAccess.ts,
  // eventAccess.ts, umpiring.ts). None of them: every table is empty.
  pg = fakePostgrest({
    tables: { api_offices: [], api_suspensions: [], people: [], offices: [], team_people: [], matches: [], umpire_assignments: [] },
  });
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

/** A People row as the old Airtable fixture had it: Active, a Player, Midfielder, ability B. */
function player(p: Partial<Player> & { id: string; suspended?: boolean }) {
  const { suspended, ...rest } = p;
  return person({
    preferredName: "Test",
    email: "p1@hkfc.com",
    playingPosition: "Midfielder",
    playingAbility: "B",
    status: "Player",
    isSuspended: suspended ?? false,
    ...rest,
  });
}

describe("ranking payload displays the Selected Team", () => {
  it("shows EOS/SOS/Registered fallback and groups T# by the displayed team", async () => {
    db.state.people.push(
      player({ id: recId("P1"), preferredName: "Alpha", registeredTeam: "D", selectedTeamEos: "B", sectionRank: 1 }),
      player({ id: recId("P2"), preferredName: "Beta", registeredTeam: "D", selectedTeamEos: "B", sectionRank: 2 }),
      player({ id: recId("P3"), preferredName: "Gamma", registeredTeam: "E", sectionRank: 3 }),
    );

    const list = await getActiveRanking(ENV);
    const byId = new Map(list.players.map((p) => [p.id, p]));

    expect(byId.get(recId("P1"))!.registeredTeam).toBe("B"); // EOS displayed
    expect(byId.get(recId("P2"))!.registeredTeam).toBe("B"); // EOS displayed
    expect(byId.get(recId("P3"))!.registeredTeam).toBe("E"); // falls back to Registered
    // T# is grouped by the DISPLAYED team, not the true registration.
    expect(byId.get(recId("P1"))!.teamRank).toBe(1);
    expect(byId.get(recId("P2"))!.teamRank).toBe(2);
    expect(byId.get(recId("P3"))!.teamRank).toBe(1);
  });
});

describe("player portal fixture categories (per-day, max three)", () => {
  const TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H"].map((name, i) => team({ id: recId(`T${name}`), teamName: name, teamRank: i + 1 }));
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const P1 = recId("P1");

  async function portal(opts: {
    registeredTeam: string;
    selectedTeamEos?: string;
    suspended?: boolean;
    matches: { id: string; homeTeam: string; day: number; selectedHome?: string[] }[];
  }) {
    db.reset({
      people: [
        player({
          id: P1,
          preferredName: "Jonny",
          email: "p1@hkfc.com",
          registeredTeam: opts.registeredTeam,
          selectedTeamEos: opts.selectedTeamEos,
          suspended: opts.suspended,
        }),
      ],
      teams: TEAMS,
      matches: opts.matches.map((m) =>
        match({
          id: m.id,
          matchDate: day(m.day),
          season: "2026-2027",
          division: "Division 3",
          competitionType: "League",
          homeTeam: m.homeTeam,
          awayTeam: "Opponent",
          selectedPlayersHome: m.selectedHome ?? [],
        }),
      ),
    });
    return getMyFixtures(ENV, authUser("p1@hkfc.com"));
  }

  it("Jonny (registered F, selected/display E, everything same day): E upcoming, D play-up, F support hidden (selected for E)", async () => {
    const out = await portal({
      registeredTeam: "F",
      selectedTeamEos: "E",
      matches: [
        { id: recId("ME"), homeTeam: "E", day: 1, selectedHome: [P1] },
        { id: recId("MD"), homeTeam: "D", day: 1 }, // one above display -> play-up
        { id: recId("MF"), homeTeam: "F", day: 1 }, // registered team, below display -> support
        { id: recId("MG"), homeTeam: "G", day: 1 }, // engine blocks (committee) -> hidden
        { id: recId("MH"), homeTeam: "H", day: 1 }, // engine blocks (committee) -> hidden
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
        { id: recId("ME"), homeTeam: "E", day: 1 },
        { id: recId("MD"), homeTeam: "D", day: 1 },
        { id: recId("MF"), homeTeam: "F", day: 1 },
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
        { id: recId("MD"), homeTeam: "D", day: 1, selectedHome: [P1] },
        { id: recId("MC"), homeTeam: "C", day: 1 },
        { id: recId("MB"), homeTeam: "B", day: 1 },
        { id: recId("MA"), homeTeam: "A", day: 1 },
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
        { id: recId("ME"), homeTeam: "E", day: 1, selectedHome: [P1] },
        { id: recId("MD"), homeTeam: "D", day: 2 },
        { id: recId("MF"), homeTeam: "F", day: 3 },
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
        { id: recId("MD"), homeTeam: "D", day: 1 },
        { id: recId("MC"), homeTeam: "C", day: 1 },
        { id: recId("MF"), homeTeam: "F", day: 1 },
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
        { id: recId("MD"), homeTeam: "D", day: 1 },
        { id: recId("MC"), homeTeam: "C", day: 1 },
        { id: recId("MF"), homeTeam: "F", day: 2 },
      ],
    });
    expect(out.fixtures.map((f) => f.hkfcTeam)).toEqual(["D"]);
    expect(out.playUpOpportunities ?? []).toHaveLength(0);
    expect(out.supportFixtures ?? []).toHaveLength(0);
  });

  it("asks Supabase about the officer screens, and a plain player gets none of them", async () => {
    const out = await portal({ registeredTeam: "D", matches: [{ id: recId("MD"), homeTeam: "D", day: 1 }] });
    expect(out.eddyProfile).toBe(true);
    expect(out.volunteers).toBe(false);
    expect(out.events).toBe(false);
    expect(out.umpiring).toBeNull();
    expect(pg.reads("api_offices")).toHaveLength(1);
    expect(pg.writes()).toHaveLength(0);
  });
});
