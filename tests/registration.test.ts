import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Automatic re-registration (worker/src/registration.ts)
//
// Part 1 exercises the pure, deterministic planner (destination algorithm,
// qualification, chronological triggering, fail-safe diagnostics).
// Part 2 drives the full reconciliation path against a fake Airtable REST
// API to prove the real mutation, idempotency and cache-invalidation
// behaviour - including the registration-event ledger.
// ---------------------------------------------------------------------------

import {
  planAutomaticReRegistrations,
  reconcileRegistrations,
  REGISTRATION_EVENTS_TABLE,
  type ReconciliationInput,
} from "../worker/src/registration";
import { isFriendly, isQualifyingPlayUpCard } from "../worker/src/playUp";
import { evaluatePlayerEligibility, type EvaluationContext } from "../worker/src/eligibility";
import { invalidateAll, getCached } from "../src/lib/cache";
import type { Match, MatchCard, Player, Team } from "../src/generated/domainTypes";

const SEASON = "2026-2027";
const NOW = new Date("2026-08-28T02:00:00.000Z");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function team(name: string, rank: number, isPremier = false): Team {
  return { id: `recT_${name.toLowerCase()}`, teamName: name, teamRank: rank, isPremier, active: true };
}

// Team hierarchy: A=1 (Premier) ... E=5. Deliberately NOT alphabetical.
const TEAMS: Team[] = [team("A", 1, true), team("B", 2), team("C", 3), team("D", 4), team("E", 5), team("F", 6)];

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "recP1",
    active: true,
    registeredTeam: "F",
    playingPosition: "Midfielder",
    playingAbility: "B",
    isVisitingPlayer: false,
    isSuspended: false,
    matchesToServe: 0,
    everRegisteredToPremier: false,
    u21Eligible: false,
    preferredName: "Test",
    ...overrides,
  };
}

const DATES = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];

function matchesFor(count: number): Match[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `recM${i + 1}`,
    matchDate: DATES[i],
    season: SEASON,
    division: "Division 2",
    competitionType: "League",
    homeTeam: "B",
    awayTeam: "Opponent",
    homeTeamScore: 0,
    awayTeamScore: 0,
    matchStatus: "Scheduled",
  }));
}

function card(opts: {
  matchId: string;
  team?: string | undefined;
  playUp?: boolean;
  goalkeeper?: boolean;
  season?: string | undefined;
  id?: string;
  playerId?: string;
}): MatchCard {
  return {
    id: opts.id ?? `recC_${opts.matchId}`,
    player: [opts.playerId ?? "recP1"],
    match: [opts.matchId],
    team: opts.team,
    playerTeam: "C",
    playUp: opts.playUp ?? true,
    goalkeeper: opts.goalkeeper ?? false,
    season: opts.season ?? SEASON,
  };
}

/** n play-up cards for the given teams, in order, on distinct dates. */
function playUpCards(teamNames: string[]): MatchCard[] {
  return teamNames.map((t, i) => card({ matchId: `recM${i + 1}`, team: t, id: `recC${i + 1}` }));
}

function buildInput(opts: {
  players?: Player[];
  cards?: MatchCard[];
  matchCount?: number;
  teams?: Team[];
  processed?: string[];
}): ReconciliationInput {
  return {
    players: opts.players ?? [player()],
    matchCards: opts.cards ?? [],
    matchesById: new Map(matchesFor(opts.matchCount ?? (opts.cards?.length ?? 0)).map((m) => [m.id, m])),
    teams: opts.teams ?? TEAMS,
    season: SEASON,
    processedEventPlayerIds: new Set(opts.processed ?? []),
  };
}

// ---------------------------------------------------------------------------
// Part 1 - the pure planner
// ---------------------------------------------------------------------------

describe("destination algorithm", () => {
  const cases: [string[], string][] = [
    [["B", "B", "B", "B"], "B"], // 4 + 0
    [["B", "B", "D", "B"], "B"], // acceptance example 1: 3 + 1, scattered order
    [["B", "B", "B", "C"], "B"], // 3 + 1
    [["B", "B", "C", "D"], "B"], // 2 + 1 + 1
    [["B", "B", "C", "C"], "C"], // 2 + 2 tie -> lowest-ranked (C = rank 3)
    [["C", "C", "B", "B"], "C"], // same multiset, different input order
    [["B", "C", "D", "E"], "E"], // 1 + 1 + 1 + 1 tie -> lowest-ranked (E = 5)
  ];
  for (const [appearances, expected] of cases) {
    it(`registers ${appearances.join(",")} -> ${expected}`, () => {
      const planSet = planAutomaticReRegistrations(buildInput({
        cards: playUpCards(appearances),
        matchCount: appearances.length,
      }));
      expect(planSet.plans).toHaveLength(1);
      expect(planSet.plans[0].newRegisteredTeam).toBe(expected);
      expect(planSet.diagnostics).toHaveLength(0);
    });
  }

  it("produces the same destination regardless of input-array order", () => {
    const appearances = ["B", "C", "B", "C"];
    const orders = [appearances, [...appearances].reverse(), ["C", "B", "C", "B"], ["B", "B", "C", "C"]];
    const destinations = orders.map((order) => {
      const planSet = planAutomaticReRegistrations(buildInput({ cards: playUpCards(order), matchCount: 4 }));
      return planSet.plans[0]?.newRegisteredTeam;
    });
    expect(destinations).toEqual(["C", "C", "C", "C"]);
  });

  it("uses Team Rank, never alphabetical team-name order", () => {
    // Alpha = rank 2, Zulu = rank 3. 2+2 tie -> lowest-ranked = Zulu.
    // Alphabetical ordering would (wrongly) select Alpha.
    const teams = [team("Alpha", 2), team("Zulu", 3), team("Golf", 4)];
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [player({ registeredTeam: "Golf" })],
      teams,
      cards: playUpCards(["Alpha", "Alpha", "Zulu", "Zulu"]),
      matchCount: 4,
    }));
    expect(planSet.plans[0].newRegisteredTeam).toBe("Zulu");
    expect(planSet.plans[0].destinationReason).toContain("Team Rank");
  });

  it("reports the frequency breakdown and destination reason", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      cards: playUpCards(["B", "B", "C", "D"]),
      matchCount: 4,
    }));
    expect(planSet.plans[0].frequencyByTeam).toEqual({ B: 2, C: 1, D: 1 });
    expect(planSet.plans[0].destinationReason).toContain("Highest frequency");
  });
});

describe("qualification", () => {
  it("does not count goalkeeper appearances", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", goalkeeper: true }), // exempt
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recM4", team: "B" }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 }));
    expect(planSet.plans).toHaveLength(0); // only 3 qualifying
    expect(planSet.qualifyingPlayers).toBe(0);
  });

  it("does not count non-play-up appearances", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", playUp: false }),
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recM4", team: "B" }),
    ];
    expect(planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 })).plans).toHaveLength(0);
  });

  it("does not count previous-season play-ups", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", season: "2025-2026" }),
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recM4", team: "B" }),
    ];
    expect(planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 })).plans).toHaveLength(0);
  });

  it("processes a goalkeeper-positioned player's four field-player play-ups", () => {
    // Goalkeeper status is per Match Card - People.Playing Position never
    // disqualifies a player from automatic re-registration.
    const gk = player({ playingPosition: "Goalkeeper" });
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [gk],
      cards: playUpCards(["B", "B", "B", "B"]),
      matchCount: 4,
    }));
    expect(planSet.plans).toHaveLength(1);
    expect(planSet.plans[0].newRegisteredTeam).toBe("B");
    expect(planSet.diagnostics).toHaveLength(0);
  });

  it("counts zero qualifying play-ups when every play-up card is a goalkeeper appearance", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", goalkeeper: true }),
      card({ matchId: "recM2", team: "B", goalkeeper: true }),
      card({ matchId: "recM3", team: "B", goalkeeper: true }),
      card({ matchId: "recM4", team: "B", goalkeeper: true }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [player({ playingPosition: "Goalkeeper" })],
      cards,
      matchCount: 4,
    }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.qualifyingPlayers).toBe(0);
  });

  it("mixed appearances: only Play Up? = true AND Goalkeeper = false count", () => {
    // field, GK, field, field, field -> the 4th field play-up triggers.
    const cards = [
      card({ matchId: "recM1", team: "B", goalkeeper: false }),
      card({ matchId: "recM2", team: "B", goalkeeper: true }),
      card({ matchId: "recM3", team: "B", goalkeeper: false }),
      card({ matchId: "recM4", team: "B", goalkeeper: false }),
      card({ matchId: "recM5", team: "B", goalkeeper: false }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [player({ playingPosition: "Goalkeeper" })],
      cards,
      matchCount: 5,
    }));
    expect(planSet.plans).toHaveLength(1);
    expect(planSet.plans[0].qualifyingCount).toBe(4);
    expect(planSet.plans[0].triggeringAppearances.map((a) => a.matchId)).toEqual([
      "recM1", "recM3", "recM4", "recM5",
    ]);
  });

  it("treats an appearance for a lower-ranked team as a play-down, not a play-up", () => {
    // Registered to B: appearances for C are play-downs and never count.
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [player({ registeredTeam: "B" })],
      cards: playUpCards(["C", "C", "C", "C"]),
      matchCount: 4,
    }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics).toHaveLength(0);
    expect(planSet.qualifyingPlayers).toBe(0);
  });

  it("does not count same-team appearances as play-ups", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [player({ registeredTeam: "B" })],
      cards: playUpCards(["B", "B", "B", "B"]),
      matchCount: 4,
    }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.qualifyingPlayers).toBe(0);
  });

  it("fails safely to review when the current registration cannot be resolved", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      players: [player({ registeredTeam: "Nowhere" })],
      cards: playUpCards(["B", "B", "B", "B"]),
      matchCount: 4,
    }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics).toHaveLength(1);
    expect(planSet.diagnostics[0].code).toBe("UNRESOLVED_REGISTRATION");
  });

  it("fails safely when a triggering card has no Team", () => {
    const cards = [
      card({ matchId: "recM1", team: undefined }),
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recM4", team: "B" }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics[0].code).toBe("MISSING_TEAM");
  });

  it("fails safely when a triggering team does not exist in Teams", () => {
    const cards = [
      card({ matchId: "recM1", team: "Mystery FC" }),
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recM4", team: "B" }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics[0].code).toBe("UNKNOWN_TEAM");
  });

  it("fails safely when a triggering team has no valid Team Rank", () => {
    const teams = [...TEAMS, { id: "recT_g", teamName: "G", active: true } as Team]; // no rank
    const cards = [
      card({ matchId: "recM1", team: "G" }),
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recM4", team: "B" }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ teams, cards, matchCount: 4 }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics[0].code).toBe("MISSING_TEAM_RANK");
  });

  it("fails safely when a qualifying card has no resolvable match date", () => {
    const cards = [
      card({ matchId: "recM1", team: "B" }),
      card({ matchId: "recM2", team: "B" }),
      card({ matchId: "recM3", team: "B" }),
      card({ matchId: "recMISSING", team: "B" }), // match not in the season index
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ cards, matchCount: 3 }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics[0].code).toBe("MISSING_MATCH_DATE");
  });

  it("fails safely on duplicate Match Cards for the same match", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", id: "recC1" }),
      card({ matchId: "recM1", team: "B", id: "recC2" }), // duplicate
      card({ matchId: "recM3", team: "B", id: "recC3" }),
      card({ matchId: "recM4", team: "B", id: "recC4" }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.diagnostics[0].code).toBe("DUPLICATE_MATCH_CARD");
  });
});

describe("triggering", () => {
  it("does not trigger on the third qualifying play-up", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      cards: playUpCards(["B", "B", "B"]),
      matchCount: 3,
    }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.qualifyingPlayers).toBe(0);
  });

  it("triggers on the fourth qualifying play-up", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      cards: playUpCards(["B", "B", "B", "B"]),
      matchCount: 4,
    }));
    expect(planSet.plans).toHaveLength(1);
    expect(planSet.plans[0].qualifyingCount).toBe(4);
  });

  it("ignores fifth and sixth cards for the destination (first four win)", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      cards: playUpCards(["B", "B", "B", "B", "D", "D"]),
      matchCount: 6,
    }));
    expect(planSet.plans).toHaveLength(1);
    expect(planSet.plans[0].newRegisteredTeam).toBe("B");
    expect(planSet.plans[0].qualifyingCount).toBe(6);
    expect(planSet.plans[0].triggeringAppearances).toHaveLength(4);
  });

  it("identifies the triggering appearances chronologically regardless of input order", () => {
    const cards = [
      card({ matchId: "recM4", team: "B", id: "recC4" }),
      card({ matchId: "recM1", team: "B", id: "recC1" }),
      card({ matchId: "recM3", team: "C", id: "recC3" }),
      card({ matchId: "recM2", team: "B", id: "recC2" }),
    ];
    const planSet = planAutomaticReRegistrations(buildInput({ cards, matchCount: 4 }));
    expect(planSet.plans[0].triggeringAppearances.map((a) => a.matchId)).toEqual([
      "recM1", "recM2", "recM3", "recM4",
    ]);
    expect(planSet.plans[0].triggeringAppearances[3].cardId).toBe("recC4");
    expect(planSet.plans[0].triggeringAppearances.map((a) => a.matchDate)).toEqual(DATES.slice(0, 4));
  });

  it("skips players that already have a processed event for the season", () => {
    const planSet = planAutomaticReRegistrations(buildInput({
      cards: playUpCards(["B", "B", "B", "B"]),
      matchCount: 4,
      processed: ["recP1"],
    }));
    expect(planSet.plans).toHaveLength(0);
    expect(planSet.alreadyProcessed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Part 2 - reconciliation against a fake Airtable REST API
// ---------------------------------------------------------------------------

type Rec = { id: string; fields: Record<string, unknown> };

interface FakeStore {
  people: Rec[];
  teams: Rec[];
  cards: Rec[];
  matches: Rec[];
  exceptions: Rec[];
  events: Rec[];
}

function fakeRecord(kind: "player" | "team" | "card" | "match", domain: any): Rec {
  if (kind === "player") {
    return {
      id: domain.id,
      fields: {
        "Preferred Name": domain.preferredName ?? "Test",
        Email: domain.email ?? "p1@hkfc.com",
        Active: domain.active ?? true,
        "Registered Team": domain.registeredTeam ?? "F",
        "Playing Position": domain.playingPosition ?? "Midfielder",
        "Playing Ability": domain.playingAbility ?? "B",
        "Is Visiting Player": false,
        "Is Suspended": false,
        "Matches To Serve": 0,
        "Ever Registered To Premier": false,
        "U21 Eligible": false,
      },
    };
  }
  if (kind === "team") {
    return {
      id: domain.id,
      fields: {
        "Team Name": domain.teamName,
        "Team Rank": domain.teamRank,
        "Is Premier": domain.isPremier ?? false,
        Active: true,
      },
    };
  }
  if (kind === "card") {
    return {
      id: domain.id,
      fields: {
        Player: [domain.playerId ?? "recP1"],
        Match: [domain.matchId],
        Team: domain.team,
        "Player Team": domain.playerTeam ?? "C",
        "Play Up?": domain.playUp ?? true,
        Goalkeeper: domain.goalkeeper ?? false,
        Season: domain.season ?? SEASON,
      },
    };
  }
  return {
    id: domain.id,
    fields: {
      Date: domain.matchDate,
      Season: SEASON,
      Division: "Division 2",
      "Competition Type": "League",
      "Home Team": "B",
      "Away Team": "Opponent",
      "Home Score": 0,
      "Away Score": 0,
      "Match Status": "Scheduled",
    },
  };
}

function installFakeAirtable(store: FakeStore, opts: { failPatchPeople?: boolean; failCreateEvent?: boolean } = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u });
    if (!u.includes("api.airtable.com")) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    const table = decodeURIComponent((u.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
    const tableRecords = (): Rec[] => {
      if (table === "People") return store.people;
      if (table === "Teams") return store.teams;
      if (table === "Match Cards") return store.cards;
      if (table === "Matches") return store.matches;
      if (table === "Availability Exceptions") return store.exceptions;
      if (table === REGISTRATION_EVENTS_TABLE) return store.events;
      return [];
    };

    if (method === "POST") {
      if (table === REGISTRATION_EVENTS_TABLE && opts.failCreateEvent) {
        return Promise.resolve(new Response("Airtable 500", { status: 500 }));
      }
      const body = JSON.parse(init.body);
      const incoming: any[] = body.records ?? [body];
      const created = incoming.map((r: any, i: number) => ({
        id: `recEvent${store.events.length + 1 + i}`,
        fields: r.fields ?? r,
      }));
      store.events.push(...created);
      return Promise.resolve(new Response(JSON.stringify({ records: created }), { status: 200 }));
    }

    if (method === "PATCH") {
      if (table === "People" && opts.failPatchPeople) {
        return Promise.resolve(new Response("Airtable 500", { status: 500 }));
      }
      const id = (u.match(/\/rec[A-Za-z0-9]+$/) ?? [])[0]?.slice(1);
      const body = JSON.parse(init.body);
      const target = tableRecords().find((r) => r.id === id);
      if (target) target.fields = { ...target.fields, ...body.fields };
      return Promise.resolve(new Response(JSON.stringify(target ?? {}), { status: 200 }));
    }

    // GET by id
    const byId = u.match(/\/rec[A-Za-z0-9]+$/);
    if (byId) {
      const id = byId[0].slice(1);
      const found = tableRecords().find((r) => r.id === id);
      if (!found) return Promise.resolve(new Response("Not found", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(found), { status: 200 }));
    }

    // GET list (formulas ignored - the planner filters in memory)
    return Promise.resolve(new Response(JSON.stringify({ records: tableRecords() }), { status: 200 }));
  }) as any;
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function seedStore(): FakeStore {
  const store: FakeStore = {
    people: [fakeRecord("player", { id: "recP1", registeredTeam: "F" })],
    teams: TEAMS.map((t) => fakeRecord("team", t)),
    cards: [],
    matches: [],
    exceptions: [],
    events: [],
  };
  return store;
}

function seedFourPlayUps(store: FakeStore, teamNames: string[] = ["B", "B", "B", "B"]) {
  store.matches.push(...matchesFor(teamNames.length).map((m) => fakeRecord("match", m)));
  teamNames.forEach((t, i) => {
    store.cards.push(
      fakeRecord("card", { id: `recC${i + 1}`, matchId: `recM${i + 1}`, team: t }),
    );
  });
}

beforeEach(() => {
  invalidateAll();
  vi.unstubAllGlobals();
});

describe("apply mode - Airtable mutation", () => {
  it("updates People.Registered Team and records the event (B,B,B,B -> B)", async () => {
    const store = seedStore();
    seedFourPlayUps(store, ["B", "B", "B", "B"]);
    const { calls } = installFakeAirtable(store);

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    expect(report.mode).toBe("apply");
    expect(report.plans).toHaveLength(1);
    expect(report.results).toHaveLength(1);
    expect(report.results![0].outcome).toBe("registered");

    const person = store.people[0];
    expect(person.fields["Registered Team"]).toBe("B"); // People updated (21)

    const event = store.events[0];
    expect(event.fields["Event Type"]).toBe("auto_reregister");
    expect(event.fields["Previous Registered Team"]).toBe("F"); // (22)
    expect(event.fields["New Registered Team"]).toBe("B");
    expect(event.fields["Player"]).toEqual(["recP1"]);
    expect(event.fields["Triggering Match Card"]).toEqual(["recC4"]); // 4th chronological (20)
    expect(event.fields["Season"]).toBe(SEASON);
    expect(event.fields["Timestamp"]).toBe(NOW.toISOString());
    expect(calls.some((c) => c.method === "POST" && c.url.includes(encodeURIComponent(REGISTRATION_EVENTS_TABLE)))).toBe(true);
  });

  it("leaves historical Match Cards untouched (Team, Player Team, everything)", async () => {
    const store = seedStore();
    seedFourPlayUps(store, ["B", "B", "C", "C"]);
    const before = JSON.parse(JSON.stringify(store.cards));
    installFakeAirtable(store);

    await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, { mode: "apply", now: NOW });

    expect(JSON.parse(JSON.stringify(store.cards))).toEqual(before); // (23, 24, 25)
    expect(store.people[0].fields["Registered Team"]).toBe("C"); // 2+2 tie -> C
  });

  it("re-registers a goalkeeper-positioned player on their fourth field-player play-up", async () => {
    const store = seedStore();
    store.people[0].fields["Playing Position"] = "Goalkeeper";
    seedFourPlayUps(store, ["B", "B", "B", "B"]);
    installFakeAirtable(store);

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    expect(report.results![0].outcome).toBe("registered");
    expect(store.people[0].fields["Registered Team"]).toBe("B");
    expect(store.events).toHaveLength(1);
  });

  it("never demotes: play-down appearances do not change the registration", async () => {
    const store = seedStore();
    store.people[0].fields["Registered Team"] = "B";
    seedFourPlayUps(store, ["C", "C", "C", "C"]);
    const { calls } = installFakeAirtable(store);

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    expect(report.plans).toHaveLength(0);
    expect(store.people[0].fields["Registered Team"]).toBe("B"); // no demotion
    expect(store.events).toHaveLength(0);
    expect(calls.filter((x) => x.method === "PATCH" || x.method === "POST")).toHaveLength(0);
  });



});

describe("idempotency", () => {
  it("creates exactly one event across repeated scans and one People update", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    const { calls } = installFakeAirtable(store);
    const env = { AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any;

    await reconcileRegistrations(env, { mode: "apply", now: NOW });
    await reconcileRegistrations(env, { mode: "apply", now: NOW });

    expect(store.events).toHaveLength(1); // (27)
    const peoplePatches = calls.filter((c) => c.method === "PATCH" && c.url.includes("People"));
    expect(peoplePatches).toHaveLength(1); // (28)
  });

  it("never overwrites a later administrator override", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    installFakeAirtable(store);
    const env = { AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any;

    await reconcileRegistrations(env, { mode: "apply", now: NOW });
    expect(store.people[0].fields["Registered Team"]).toBe("B");

    // Administrator manually reverts B -> F after the automatic event.
    store.people[0].fields["Registered Team"] = "F";

    const report = await reconcileRegistrations(env, { mode: "apply", now: NOW });
    expect(store.people[0].fields["Registered Team"]).toBe("F"); // (29) untouched
    expect(report.plans).toHaveLength(0);
    expect(report.alreadyProcessed).toBe(1);
    expect(store.events).toHaveLength(1);
  });

  it("detects a concurrent event between planning and applying (fresh re-check)", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    installFakeAirtable(store);
    const env = { AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any;

    // Simulate a concurrent isolate: the (stale, cached) planning view saw no
    // events, but by apply time another Worker has already written the event.
    await getCached(`registration-events:${SEASON}`, async () => new Map(), 60_000);
    store.events.push({
      id: "recConcurrent",
      fields: {
        Player: ["recP1"],
        "Previous Registered Team": "F",
        "New Registered Team": "B",
        "Triggering Match Card": ["recC4"],
        Season: SEASON,
        "Event Type": "auto_reregister",
        Timestamp: NOW.toISOString(),
      },
    });

    const report = await reconcileRegistrations(env, { mode: "apply", now: NOW });
    expect(report.results![0].outcome).toBe("skipped_already_processed"); // (35)
    expect(store.events).toHaveLength(1);
    expect(store.people[0].fields["Registered Team"]).toBe("F");
  });
});

describe("cache invalidation", () => {
  it("invalidates every cache derived from People.Registered Team after a mutation", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    installFakeAirtable(store);

    // club-reference and season-index are populated by the run itself;
    // pre-seed only caches the reconcile path does not read.
    await getCached("players-for-match:m1:auto", async () => "STALE", 60_000);
    await getCached("ranking:active", async () => "STALE", 60_000);
    await getCached("player-by-email:p1@hkfc.com", async () => "STALE", 60_000);

    await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    for (const key of ["club-reference", `season-index:${SEASON}`, "players-for-match:m1:auto", "ranking:active", "player-by-email:p1@hkfc.com"]) {
      const { data, fromCache } = await getCached(key, async () => "FRESH");
      expect(fromCache).toBe(false); // (30)
      expect(data).toBe("FRESH");
    }
  });
});

describe("failure handling", () => {
  it("dry-run performs no Airtable writes", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    const { calls } = installFakeAirtable(store);

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "dry-run",
      now: NOW,
    });

    expect(report.mode).toBe("dry-run");
    expect(report.plans).toHaveLength(1);
    expect(calls.filter((c) => c.method === "PATCH" || c.method === "POST")).toHaveLength(0);
    expect(store.people[0].fields["Registered Team"]).toBe("F");
    expect(store.events).toHaveLength(0);
  });

  it("does not create an event when the People update fails", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    installFakeAirtable(store, { failPatchPeople: true });

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    expect(report.results![0].outcome).toBe("error"); // (36)
    expect(store.events).toHaveLength(0);
  });

  it("reports an error (not success) when the event creation fails", async () => {
    const store = seedStore();
    seedFourPlayUps(store);
    installFakeAirtable(store, { failCreateEvent: true });

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    expect(report.results![0].outcome).toBe("error"); // (37)
  });

  it("surfaces fail-safe diagnostics without planning a write (apply mode)", async () => {
    const store = seedStore();
    store.matches.push(fakeRecord("match", matchesFor(1)[0]));
    store.cards.push(
      fakeRecord("card", { id: "recC1", matchId: "recM1", team: "B" }),
      fakeRecord("card", { id: "recC2", matchId: "recM1", team: "B" }), // duplicate
      fakeRecord("card", { id: "recC3", matchId: "recM1", team: "B" }),
      fakeRecord("card", { id: "recC4", matchId: "recM1", team: "B" }),
    );
    const { calls } = installFakeAirtable(store);

    const report = await reconcileRegistrations({ AIRTABLE_TOKEN: "x", AIRTABLE_BASE_ID: "b" } as any, {
      mode: "apply",
      now: NOW,
    });

    expect(report.plans).toHaveLength(0); // (38)
    expect(report.diagnostics[0].code).toBe("DUPLICATE_MATCH_CARD");
    expect(calls.filter((c) => c.method === "PATCH" || c.method === "POST")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Part 3 - eligibility integration
// ---------------------------------------------------------------------------

describe("eligibility integration", () => {
  function eligibilityCtx(cards: MatchCard[]): { ctx: EvaluationContext; matchB: Match; matchA: Match } {
    const teamMap = new Map(TEAMS.map((t) => [t.teamName || "", t]));
    const rankMap: Record<string, number> = {};
    for (const t of TEAMS) rankMap[t.teamName || ""] = t.teamRank ?? 99;
    const matches = matchesFor(4);
    const matchB = { ...matches[0], homeTeam: "B", awayTeam: "Opponent" };
    const matchA = { ...matches[1], homeTeam: "A", awayTeam: "Opponent" };
    const players = [player()];
    return {
      matchB,
      matchA,
      ctx: {
        teamMap,
        rankMap,
        targetTeam: undefined,
        sameDayMatches: [],
        sameDayFixtures: [],
        allSelections: [],
        selectionsByPlayer: new Map(),
        sameDaySelectionsByTeam: new Map(),
        allExceptions: [],
        unavailablePlayerMatchKeys: new Set(),
        matchCards: cards,
        matchCardsByPlayer: new Map(cards.map((c) => ["recP1", cards])),
        matchesById: new Map(matches.map((m) => [m.id, m])),
        currentSeason: SEASON,
        playersById: new Map(players.map((p) => [p.id, p])),
        completedLeagueMatchesByTeam: new Map(),
      },
    };
  }

  it("does not block a successfully re-registered player selected for the destination team", () => {
    const cards = playUpCards(["B", "B", "B", "B"]);
    const { ctx, matchB } = eligibilityCtx(cards);

    // Before re-registration: selecting for B is blocked with the fail-safe reason.
    const before = evaluatePlayerEligibility(player({ registeredTeam: "C" }), matchB, ctx);
    expect(before.reason).toBe("Play-up limit reached \u2014 re-registration required");

    // After automatic re-registration (Registered Team now B): the same four
    // historical cards no longer block selection for the destination team.
    const after = evaluatePlayerEligibility(player({ registeredTeam: "B" }), matchB, ctx);
    expect(after.status).not.toBe("blocked"); // (31, 34)
    expect(after.reason).toBeNull();
    expect(after.playUpCount).toBe(4); // (32) history retained, never reset
  });

  it("keeps blocking further play-ups above the new registration (fail-safe retained)", () => {
    const cards = playUpCards(["B", "B", "B", "B"]);
    const { ctx, matchA } = eligibilityCtx(cards);
    // Both teams completed > 3 league matches so Step 5 (Premier movement)
    // passes and Step 6 (play-up limit) is what blocks the A-selection.
    ctx.completedLeagueMatchesByTeam = new Map([["A", 5], ["B", 5]]);
    const result = evaluatePlayerEligibility(player({ registeredTeam: "B" }), matchA, ctx);
    expect(result.reason).toBe("Play-up limit reached \u2014 re-registration required");
  });

  it("leaves unrelated eligibility rules untouched", () => {
    const { ctx, matchB } = eligibilityCtx(playUpCards(["B", "B", "B", "B"]));
    const result = evaluatePlayerEligibility(player({ registeredTeam: "B", isSuspended: true }), matchB, ctx);
    expect(result.reason).toBe("Suspended");
  });
});

// ---------------------------------------------------------------------------
// Part 4 - single qualifying play-up definition
// ---------------------------------------------------------------------------

describe("single authoritative play-up definition", () => {
  function countCtx(cards: MatchCard[]): EvaluationContext {
    const teamMap = new Map(TEAMS.map((t) => [t.teamName || "", t]));
    const rankMap: Record<string, number> = {};
    for (const t of TEAMS) rankMap[t.teamName || ""] = t.teamRank ?? 99;
    const matches = matchesFor(6);
    return {
      teamMap,
      rankMap,
      sameDayMatches: [],
      sameDayFixtures: [],
      allSelections: [],
      selectionsByPlayer: new Map(),
      sameDaySelectionsByTeam: new Map(),
      allExceptions: [],
      unavailablePlayerMatchKeys: new Set(),
      matchCards: cards,
      matchCardsByPlayer: new Map(cards.map((c) => ["recP1", cards])),
      matchesById: new Map(matches.map((m) => [m.id, m])),
      currentSeason: SEASON,
      playersById: new Map([player()].map((p) => [p.id, p])),
      completedLeagueMatchesByTeam: new Map(),
    };
  }

  it("agrees with the eligibility engine's play-up count on mixed fixtures", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", playUp: true, goalkeeper: false }),
      card({ matchId: "recM2", team: "B", playUp: true, goalkeeper: true }), // GK exempt
      card({ matchId: "recM3", team: "B", playUp: false }), // not a play-up
      card({ matchId: "recM4", team: "B", season: "2025-2026" }), // previous season
      card({ matchId: "recM5", team: "B", playUp: true }),
      card({ matchId: "recM6", team: "B", playUp: true }),
    ];
    const ctx = countCtx(cards);
    const engineCount = evaluatePlayerEligibility(player(), matchesFor(6)[0], ctx).playUpCount;
    const helperCount = cards.filter((c) => isQualifyingPlayUpCard(c, SEASON, ctx.matchesById)).length;
    expect(engineCount).toBe(3);
    expect(helperCount).toBe(engineCount);
  });

  // Friendlies are not competitive fixtures. Four qualifying play-ups force
  // automatic re-registration, so counting a friendly could move a player to
  // a higher team off the back of a warm-up game.
  it("excludes friendlies from the play-up count, in the engine and the helper", () => {
    const cards = [
      card({ matchId: "recM1", team: "B", playUp: true }),
      card({ matchId: "recM2", team: "B", playUp: true }),
    ];
    const ctx = countCtx(cards);
    const friendly = ctx.matchesById.get("recM2");
    expect(friendly).toBeDefined();
    friendly!.competitionType = "FRIENDLY";

    const engineCount = evaluatePlayerEligibility(player(), matchesFor(6)[0], ctx).playUpCount;
    const helperCount = cards.filter((c) => isQualifyingPlayUpCard(c, SEASON, ctx.matchesById)).length;
    expect(helperCount).toBe(1);
    expect(engineCount).toBe(1);
  });

  it("recognises only FRIENDLY as a friendly, whatever the casing", () => {
    const match = (competitionType: string) => ({ ...matchesFor(1)[0], competitionType });
    expect(isFriendly(match("FRIENDLY"))).toBe(true);
    expect(isFriendly(match("friendly"))).toBe(true); // formula output is upper-case; be tolerant
    expect(isFriendly(match("LEAGUE"))).toBe(false);
    expect(isFriendly(match("KNOCKOUT"))).toBe(false);
    expect(isFriendly(match(""))).toBe(false); // unmapped division: not assumed friendly
    expect(isFriendly(undefined)).toBe(false);
  });
});
