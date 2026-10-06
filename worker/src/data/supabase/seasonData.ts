/**
 * season_context(p_season, p_player) -> SeasonData: positional arrays in,
 * the domain shapes the Worker's season code reads out, with the same
 * blanks-as-unset rules as mappers.ts toMatch / toMatchCard / toException.
 * The columns season_context leaves out (kit, umpires, fixture ids, answer
 * ids) are not read from the season context by anything.
 */
import type { Env } from "../../env";
import { db } from "../supabase";
import type { SeasonData, SeasonDataRepo } from "../seasonData";
import type { AvailabilityException, Match, MatchCard } from "../../../../shared/schema/domainTypes";
import type { ManualSuspension } from "../../suspension";

type Json = unknown;
/** [id, matchDate, division, competitionType, home, away, status, homeScore, awayScore, venue, homeSel?, awaySel?, cardTeams?, cardCount?] */
type MatchRow = [string, string | null, string | null, string | null, string | null, string | null, string | null, number | null, number | null, string | null, ...Json[]];
/** [person, match, team, playerTeam, flags, goals, cards, cardId, rawName] (prevCards: [person, match, team, playerTeam, flags, cards, cardId]) */
type CardRow = Json[];

export interface SeasonContextPayload {
  v: number;
  season: string;
  prev: string;
  people: string[];
  matches: MatchRow[];
  cards: CardRow[];
  exceptions: [number, number, string, string | null, string | null][];
  prevMatches: MatchRow[];
  prevCards: CardRow[];
  suspensions: [string, string, number | null, string, string, string][];
}

const STATUS: Record<string, AvailabilityException["availabilityStatus"]> = { A: "Available", M: "Maybe", U: "Unavailable" };
const str = (v: Json): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: Json): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);

/** The decoded season data, from season_context's JSON. */
export function decodeSeasonContext(p: SeasonContextPayload): SeasonData {
  const person = (i: Json): string | undefined => (typeof i === "number" ? p.people[i] : undefined);
  const toMatch = (r: MatchRow, season: string, withSelections: boolean): Match => ({
    id: r[0],
    matchDate: r[1] || "",
    season,
    division: r[2] || "",
    competitionType: r[3] || "",
    homeTeam: r[4] || "",
    awayTeam: r[5] || "",
    matchStatus: r[6] || "",
    homeTeamScore: r[7] || 0,
    awayTeamScore: r[8] || 0,
    venue: r[9] || "",
    fixtureId: "",
    selectedPlayersHome: withSelections ? ((r[10] as number[]) ?? []).map((i) => p.people[i]) : [],
    selectedPlayersAway: withSelections ? ((r[11] as number[]) ?? []).map((i) => p.people[i]) : [],
    autoSelectEnabled: false,
    homeKit: "",
    awayKit: "",
    ump1: "",
    ump2: "",
  });
  const matches = p.matches.map((r) => toMatch(r, p.season, true));
  const previousMatches = p.prevMatches.map((r) => toMatch(r, p.prev, false));

  const flags = (f: Json) => (typeof f === "number" ? f : 0);
  const cardValues = (v: Json): string[] | undefined => (Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined);
  const cards: MatchCard[] = p.cards.map((r) => {
    const playerId = person(r[0]);
    return {
      id: str(r[7]) ?? "",
      player: playerId ? [playerId] : undefined,
      match: [matches[r[1] as number].id],
      team: str(r[2]),
      playerTeam: str(r[3]),
      playUp: flags(r[4]) & 2 ? true : undefined,
      goalkeeper: flags(r[4]) & 1 ? true : undefined,
      goals: int(r[5]),
      cards: cardValues(r[6]),
      season: p.season,
      rawPlayerName: str(r[8]),
    };
  });
  const previousCards: MatchCard[] = p.prevCards.map((r) => {
    const playerId = person(r[0]);
    return {
      id: str(r[6]) ?? "",
      player: playerId ? [playerId] : undefined,
      match: [previousMatches[r[1] as number].id],
      team: str(r[2]),
      playerTeam: str(r[3]),
      playUp: flags(r[4]) & 2 ? true : undefined,
      goalkeeper: flags(r[4]) & 1 ? true : undefined,
      cards: cardValues(r[5]),
      season: p.prev,
    };
  });
  const exceptions: AvailabilityException[] = p.exceptions.map(([pi, mi, s, note, id]) => ({
    id: id ?? "",
    player: [p.people[pi]],
    match: [matches[mi].id],
    availabilityStatus: STATUS[s] ?? "Available",
    note: note ?? "",
    season: p.season,
  }));
  const suspensions: ManualSuspension[] = p.suspensions.map(([id, player, n, fromDate, servingTeam, createdAt]) => ({
    id,
    player,
    matches: n,
    fromDate,
    servingTeam,
    createdAt,
  }));
  const cardSummary = new Map<string, { teams: string[]; count: number }>();
  for (const r of p.matches) {
    const count = typeof r[13] === "number" ? r[13] : 0;
    if (count > 0) cardSummary.set(r[0], { teams: (r[12] as string[]) ?? [], count });
  }
  return { matches, cards, exceptions, previousMatches, previousCards, suspensions, cardSummary };
}

export function supabaseSeasonData(env: Env): SeasonDataRepo {
  return {
    async load(season, player) {
      const payload = await db(env).rpcRead<SeasonContextPayload>("season_context", { p_season: season, p_player: player ?? null });
      return decodeSeasonContext(payload);
    },
  };
}
