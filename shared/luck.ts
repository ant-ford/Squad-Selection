/**
 * Umpires and lucky charms for the Stats page, counted from season
 * summaries (shared/clubStats.ts).
 *
 * Results go back to 2015-16 but Match Cards - who played, and the cards
 * shown - only to 2021-22. Anything that needs players is counted over the
 * seasons that have them: a team's games "without" a player would otherwise
 * include every season before anyone was recorded, and an umpire's cards per
 * game every season before cards were.
 */
import { addWDL, emptyWDL, games, winPct, type SeasonSummary, type WDL } from "./clubStats";

const hasPlayers = (s: SeasonSummary) => s.players.length > 0;

// ── Umpires ──────────────────────────────────────────────────────────────

export interface UmpireRow {
  key: string;
  name: string;
  /** HKFC games they umpired. */
  games: number;
  appointed: number;
  duty: number;
  /** HKFC's results with them; HKFC-v-HKFC derbies are left out. */
  hkfc: WDL;
  derbies: number;
  /** Cards shown to HKFC players, over the games in seasons with Match Cards. */
  cards: number;
  cardGames: number;
}

/** Every umpire across the given seasons, most HKFC games first. The latest spelling of a name wins. */
export function umpireRows(summaries: SeasonSummary[]): UmpireRow[] {
  const rows = new Map<string, UmpireRow>();
  for (const s of [...summaries].sort((a, b) => a.season.localeCompare(b.season))) {
    for (const u of s.umpires) {
      const r = rows.get(u.key) ?? {
        key: u.key,
        name: u.name,
        games: 0,
        appointed: 0,
        duty: 0,
        hkfc: emptyWDL(),
        derbies: 0,
        cards: 0,
        cardGames: 0,
      };
      r.name = u.name;
      r.games += u.games;
      r.appointed += u.appointed;
      r.duty += u.duty;
      r.derbies += u.derbies;
      addWDL(r.hkfc, u.hkfc);
      if (hasPlayers(s)) {
        r.cards += u.cardsToHkfc;
        r.cardGames += u.games;
      }
      rows.set(u.key, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/** Cards per game, or null without enough games in seasons that record cards. */
export const cardsPerGame = (r: UmpireRow, minGames = 1): number | null =>
  r.cardGames >= minGames ? Math.round((r.cards / r.cardGames) * 100) / 100 : null;

/** HKFC's results by who umpired: appointed umpires, team (duty) umpires, or not recorded. */
export function umpireSplits(summaries: SeasonSummary[]): { appointed: WDL; duty: WDL; unknown: WDL } {
  const out = { appointed: emptyWDL(), duty: emptyWDL(), unknown: emptyWDL() };
  for (const s of summaries) {
    addWDL(out.appointed, s.umpireSplits.appointed);
    addWDL(out.duty, s.umpireSplits.duty);
    addWDL(out.unknown, s.umpireSplits.unknown);
  }
  return out;
}

// ── Lucky charms ─────────────────────────────────────────────────────────

/** Owner decision, 2026-09-26: at least ten team games with the player and five without. */
export const CHARM_MIN_WITH = 10;
export const CHARM_MIN_WITHOUT = 5;

export interface Charm {
  key: string;
  name: string;
  team: string;
  with: WDL;
  without: WDL;
  withPct: number;
  withoutPct: number;
  /** withPct - withoutPct, in percentage points: positive = the team wins more with them. */
  lift: number;
}

/**
 * For every player and every team they played for, the team's win rate in
 * games they played against games they did not. "Without" counts only the
 * seasons they played for that team at least once - games they missed while
 * part of it, not seasons before they joined or after they left. Only pairs
 * past both minimums count; best lift first.
 */
export function luckyCharms(
  summaries: SeasonSummary[],
  opts: { minWith?: number; minWithout?: number } = {},
): Charm[] {
  const minWith = opts.minWith ?? CHARM_MIN_WITH;
  const minWithout = opts.minWithout ?? CHARM_MIN_WITHOUT;
  const withs = new Map<string, { key: string; name: string; team: string; r: WDL; teamTotal: WDL }>();
  for (const s of [...summaries].filter(hasPlayers).sort((a, b) => a.season.localeCompare(b.season))) {
    const teamOf = new Map(s.teams.map((t) => [t.team, t]));
    for (const p of s.players) {
      for (const [team, line] of Object.entries(p.teams)) {
        const t = teamOf.get(team);
        if (!t || line.apps === 0) continue;
        const id = `${p.key}|${team}`;
        const e = withs.get(id) ?? { key: p.key, name: p.name, team, r: emptyWDL(), teamTotal: emptyWDL() };
        e.name = p.name;
        addWDL(e.r, line);
        // The team's whole season counts, as they were in it.
        addWDL(e.teamTotal, t);
        withs.set(id, e);
      }
    }
  }
  const out: Charm[] = [];
  for (const e of withs.values()) {
    const total = e.teamTotal;
    const without = { w: total.w - e.r.w, d: total.d - e.r.d, l: total.l - e.r.l };
    if (games(e.r) < minWith || games(without) < minWithout) continue;
    const withPct = winPct(e.r)!;
    const withoutPct = winPct(without)!;
    out.push({ key: e.key, name: e.name, team: e.team, with: e.r, without, withPct, withoutPct, lift: withPct - withoutPct });
  }
  return out.sort((a, b) => b.lift - a.lift || games(b.with) - games(a.with) || a.name.localeCompare(b.name));
}
