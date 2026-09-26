/**
 * Season summaries for the Stats page (shared/clubStats.ts has the shape).
 *
 * A summary is built once from a season's Matches and Match Cards and kept:
 *   - past seasons under `stats-summary:v<N>:<season>` for thirty days (they
 *     do not change; a correction shows within a month, or at once by
 *     bumping SUMMARY_VERSION);
 *   - the current season under one fixed key that the webhook drops whenever
 *     Matches or Match Cards change.
 * Building a past season costs about thirty Airtable pages, inside the
 * Workers plan's fifty subrequests, which is why the page asks for one
 * season per request and adds seasons up itself.
 *
 * Other players' cards are never in a summary sent to the page (owner
 * decision, 2026-09-26); the stored summary keeps each player's card count
 * aside for their own career page.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import type { Match, MatchCard } from "../../shared/schema/domainTypes";
import { getShared } from "./cache";
import { HttpError } from "./http";
import { getAllMatches, getMatchCardsForSeason, currentSeason } from "./seasonContext";
import { airtableFindAll } from "./airtable";
import { TABLES } from "../../shared/schema/tableNames";
import { isFriendly } from "./playUp";
import { parseCardValue } from "./suspension";
import { STATS_CURRENT_KEY } from "./reference";
import { hkDateKey } from "../../shared/hkDateKey";
import {
  SUMMARY_VERSION,
  addWDL,
  emptyWDL,
  isHkfcTeam,
  type PlayerSeason,
  type PlayerTeamLine,
  type SeasonSummary,
  type TeamSeason,
  type UmpireSeason,
  type WDL,
} from "../../shared/clubStats";
import { buildNameDictionary, canonicalKey, parseUmpire, type ParsedUmpire } from "../../shared/umpires";

const PAST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A backstop only: the webhook drops the current season when a result or card changes. */
const CURRENT_TTL_MS = 6 * 60 * 60 * 1000;

export interface CardCount {
  yellow: number;
  red: number;
}

/** What is stored: the summary, plus each player's own cards, which are never sent to anyone else. */
export interface StoredSummary {
  summary: SeasonSummary;
  cardsByPlayer: Record<string, CardCount>;
}

const SEASON_RE = /^(\d{4})-(\d{4})$/;

type Outcome = "w" | "d" | "l";
const outcome = (forGoals: number, against: number): Outcome => (forGoals > against ? "w" : forGoals < against ? "l" : "d");
const bump = (r: WDL, o: Outcome) => {
  r[o] += 1;
};

/**
 * A match counts once it has been played: its status says so, or - older
 * seasons, before the status was kept - it has Match Cards and was not
 * cancelled or moved. Friendlies never count.
 */
function counts(m: Match, carded: Set<string>, today: string): boolean {
  if (isFriendly(m)) return false;
  if (!isHkfcTeam(m.homeTeam) && !isHkfcTeam(m.awayTeam)) return false;
  const status = (m.matchStatus || "").toLowerCase();
  if (status === "played") return true;
  if (status === "cancelled" || status === "rescheduled") return false;
  return carded.has(m.id) && (m.matchDate || "").slice(0, 10) <= today;
}

const newTeam = (team: string, division?: string): TeamSeason => ({
  team,
  division: division || undefined,
  played: 0,
  ...emptyWDL(),
  gf: 0,
  ga: 0,
  cleanSheets: 0,
  home: emptyWDL(),
  away: emptyWDL(),
  venues: {},
  opponents: {},
});

const newLine = (): PlayerTeamLine => ({ apps: 0, goals: 0, captain: 0, keeper: 0, playUps: 0, ...emptyWDL() });

export interface SummaryInput {
  season: string;
  matches: Match[];
  cards: MatchCard[];
  /** People id -> display name, for linked cards. */
  names: Record<string, string>;
  /**
   * canonicalKey(Given Name(s) + Surname) -> People id, for cards with no
   * People link: HKHA writes "SURNAME Given Names", which is the same words.
   * A name two people share maps to "" and is left unmatched.
   */
  byFullName?: Record<string, string>;
  /** "YYYY-MM-DD", Hong Kong. */
  today: string;
}

/** Pure: everything in, the stored summary out. */
export function buildSeasonSummary(input: SummaryInput): StoredSummary {
  const { season, matches, cards, names, byFullName = {}, today } = input;
  const carded = new Set(cards.flatMap((c) => c.match ?? []));
  const counted = matches.filter((m) => counts(m, carded, today));
  const byId = new Map(counted.map((m) => [m.id, m]));

  // ── Teams ──
  const teams = new Map<string, TeamSeason>();
  const sideResult = new Map<string, Outcome>(); // `${matchId}|${team}` -> result for that HKFC side
  let derbies = 0;
  for (const m of counted) {
    const sides: [string, number, number, string, "home" | "away"][] = [
      [m.homeTeam, m.homeTeamScore, m.awayTeamScore, m.awayTeam, "home"],
      [m.awayTeam, m.awayTeamScore, m.homeTeamScore, m.homeTeam, "away"],
    ];
    if (isHkfcTeam(m.homeTeam) && isHkfcTeam(m.awayTeam)) derbies += 1;
    for (const [team, gf, ga, opp, where] of sides) {
      if (!isHkfcTeam(team)) continue;
      const t = teams.get(team) ?? newTeam(team, m.division);
      if (!t.division && m.division) t.division = m.division;
      const o = outcome(gf, ga);
      t.played += 1;
      bump(t, o);
      t.gf += gf;
      t.ga += ga;
      if (ga === 0) t.cleanSheets += 1;
      bump(t[where], o);
      if (m.venue) bump((t.venues[m.venue] ??= emptyWDL()), o);
      const vs = (t.opponents[opp] ??= { ...emptyWDL(), gf: 0, ga: 0 });
      bump(vs, o);
      vs.gf += gf;
      vs.ga += ga;
      teams.set(team, t);
      sideResult.set(`${m.id}|${team}`, o);
    }
  }

  // ── Players ──
  const players = new Map<string, PlayerSeason>();
  const cardsByPlayer: Record<string, CardCount> = {};
  const cardsInMatch = new Map<string, number>();
  for (const c of cards) {
    const matchId = c.match?.[0];
    const team = c.team ?? "";
    const result = matchId ? sideResult.get(`${matchId}|${team}`) : undefined;
    if (!matchId || !byId.has(matchId) || !result) continue;
    const raw = (c.rawPlayerName ?? "").trim();
    // A card with no People link is matched by full name (owner decision,
    // 2026-09-26): a sixth of 2021-25's appearances have no link.
    const personId = c.player?.[0] ?? (raw ? byFullName[canonicalKey(raw)] || undefined : undefined);
    const key = personId ?? (raw ? `raw:${canonicalKey(raw)}` : "");
    if (!key) continue;
    const p = players.get(key) ?? { key, name: (personId && names[personId]) || raw || "Unknown player", teams: {} };
    const line = (p.teams[team] ??= newLine());
    line.apps += 1;
    line.goals += c.goals ?? 0;
    if (c.captain === true) line.captain += 1;
    if (c.goalkeeper === true) line.keeper += 1;
    if (c.playUp === true) line.playUps += 1;
    bump(line, result);
    players.set(key, p);

    for (const value of c.cards ?? []) {
      const card = parseCardValue(value);
      if (!card) continue;
      const own = (cardsByPlayer[key] ??= { yellow: 0, red: 0 });
      own[card.kind] += card.quantity;
      cardsInMatch.set(matchId, (cardsInMatch.get(matchId) ?? 0) + card.quantity);
    }
  }

  // ── Umpires ──
  const teamNames = new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]).filter(Boolean));
  const allValues = matches.flatMap((m) => [m.ump1, m.ump2]);
  const dictionary = buildNameDictionary(allValues, teamNames);
  const umpires = new Map<string, UmpireSeason>();
  const splits = { appointed: emptyWDL(), duty: emptyWDL(), unknown: emptyWDL() };
  for (const m of counted) {
    const derby = isHkfcTeam(m.homeTeam) && isHkfcTeam(m.awayTeam);
    const hkfcSide = isHkfcTeam(m.homeTeam) ? m.homeTeam : m.awayTeam;
    const result = derby ? undefined : sideResult.get(`${m.id}|${hkfcSide}`);
    const parsed: ParsedUmpire[] = [m.ump1, m.ump2].map((v) => parseUmpire(v, { teams: teamNames, names: dictionary }));
    if (result) {
      const kind = parsed.some((p) => p.kind === "appointed")
        ? "appointed"
        : parsed.some((p) => p.kind === "duty" || p.kind === "name")
          ? "duty"
          : "unknown";
      bump(splits[kind], result);
    }
    for (const p of parsed) {
      if (!p.key || !p.name) continue;
      const u = umpires.get(p.key) ?? {
        key: p.key,
        name: p.name,
        games: 0,
        appointed: 0,
        duty: 0,
        hkfc: emptyWDL(),
        derbies: 0,
        cardsToHkfc: 0,
      };
      u.games += 1;
      if (p.kind === "appointed") u.appointed += 1;
      if (p.kind === "duty") u.duty += 1;
      if (derby) u.derbies += 1;
      else if (result) bump(u.hkfc, result);
      u.cardsToHkfc += cardsInMatch.get(m.id) ?? 0;
      umpires.set(p.key, u);
    }
  }

  return {
    summary: {
      version: SUMMARY_VERSION,
      season,
      generatedAt: new Date().toISOString(),
      matches: counted.length,
      derbies,
      teams: [...teams.values()].sort((a, b) => a.team.localeCompare(b.team)),
      players: [...players.values()],
      umpires: [...umpires.values()],
      umpireSplits: splits,
    },
    cardsByPlayer,
  };
}

interface PlayerNames {
  names: Record<string, string>;
  byFullName: Record<string, string>;
}

/**
 * Two people shown under one name - a father and son, both "Shep
 * Shepherdson" - are told apart (owner request, 2026-09-26): the younger
 * gets "(Jr)", judged by Date of Birth. Without both birth dates, or with
 * three or more sharing a name, each gets their given names in brackets
 * instead. Birth dates are only compared here and never kept or sent.
 */
export function disambiguate(
  names: Record<string, string>,
  givenOf: Record<string, string>,
  bornOn: Record<string, string> = {},
): Record<string, string> {
  const ids = new Map<string, string[]>();
  for (const [id, name] of Object.entries(names)) ids.set(name, [...(ids.get(name) ?? []), id]);
  const out = { ...names };
  for (const [name, shared] of ids) {
    if (shared.length < 2) continue;
    const [a, b] = shared;
    if (shared.length === 2 && bornOn[a] && bornOn[b] && bornOn[a] !== bornOn[b]) {
      out[bornOn[a] > bornOn[b] ? a : b] = `${name} (Jr)`;
      continue;
    }
    for (const id of shared) {
      const given = givenOf[id];
      if (given && !name.toLowerCase().startsWith(`${given.toLowerCase()} `)) out[id] = `${name} (${given})`;
    }
  }
  return out;
}

/**
 * Everyone in People, by id and by full name - not only those with a linked
 * Match Card: a player whose every card is unlinked is who this is for. One
 * shared read of three name fields, kept a day: it is only used when a
 * season is built, and a name changed today can wait until tomorrow.
 */
async function getPlayerNames(env: Env): Promise<PlayerNames> {
  return getShared<PlayerNames>(
    env,
    "stats-player-names:v4",
    async () => {
      const records = await airtableFindAll(env, TABLES.player, undefined, undefined, [
        "Preferred Name",
        "Given Name(s)",
        "Surname",
        // Only to tell a father from a son who share a name; not stored.
        "Date of Birth",
      ]);
      const names: Record<string, string> = {};
      const givenOf: Record<string, string> = {};
      const bornOn: Record<string, string> = {};
      const byFullName: Record<string, string> = {};
      const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      for (const r of records) {
        const f = r.fields ?? {};
        const given = text(f["Given Name(s)"]);
        const surname = text(f.Surname);
        names[r.id] = [text(f["Preferred Name"]) || given, surname].filter(Boolean).join(" ") || "Unnamed";
        givenOf[r.id] = given;
        const dob = text(f["Date of Birth"]);
        if (/^\d{4}-\d{2}-\d{2}/.test(dob)) bornOn[r.id] = dob.slice(0, 10);
        if (!given || !surname) continue;
        const key = canonicalKey(`${given} ${surname}`);
        // Two people with the same full name: match neither.
        byFullName[key] = key in byFullName && byFullName[key] !== r.id ? "" : r.id;
      }
      return { names: disambiguate(names, givenOf, bornOn), byFullName };
    },
    24 * 60 * 60 * 1000,
  );
}

async function buildFor(env: Env, season: string): Promise<StoredSummary> {
  const [matches, cards, people] = await Promise.all([
    getAllMatches(env, season),
    getMatchCardsForSeason(env, season),
    getPlayerNames(env),
  ]);
  const today = hkDateKey(new Date().toISOString());
  return buildSeasonSummary({ season, matches, cards, names: people.names, byFullName: people.byFullName, today });
}

/** A season's stored summary, building it when it is not kept yet. */
export async function getStoredSummary(env: Env, season: string): Promise<StoredSummary> {
  const m = SEASON_RE.exec(season);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new HttpError("Unknown season.", 400, "INVALID_INPUT");
  const current = currentSeason();
  if (season > current) throw new HttpError("That season has not started.", 400, "INVALID_INPUT");
  if (season === current) {
    const stored = await getShared<StoredSummary>(env, STATS_CURRENT_KEY, () => buildFor(env, season), CURRENT_TTL_MS);
    // Across 1 July the fixed key may still hold last season's summary.
    if (stored.summary.season === season && stored.summary.version === SUMMARY_VERSION) return stored;
    return buildFor(env, season);
  }
  return getShared<StoredSummary>(env, `stats-summary:v${SUMMARY_VERSION}:${season}`, () => buildFor(env, season), PAST_TTL_MS);
}

/** The summary for the page: no cards, bar the signed-in player's own. */
export async function getSeasonStats(
  env: Env,
  user: AuthorizedUser,
  season: string,
): Promise<SeasonSummary & { myCards?: CardCount }> {
  const { summary, cardsByPlayer } = await getStoredSummary(env, season);
  const mine = user.personId ? cardsByPlayer[user.personId] : undefined;
  return mine ? { ...summary, myCards: mine } : summary;
}
