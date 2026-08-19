import type { Match, MatchCard } from "../../src/generated/domainTypes";
import { linkId } from "./airtable";

/**
 * Automatic card-based suspension calculation.
 *
 * Yellow-card penalty points and suspension thresholds are defined by the
 * HockeyHKMS Competition Bye-Laws (July 2024), Bye-Law 16.3:
 *
 *   Y1 = 2, Y2 = 3, Y3 = 3, Y4 = 2, Y5 = 4, Y6 = 3, Y7 = 1 points.
 *
 * The Match Cards "Cards" field is a multi-select whose values may carry a
 * QUANTITY suffix - "Y2" is one Y2 card, "Y2 (2)" is two Y2 cards, "Y2 (3)" is
 * three Y2 cards. Points are therefore base points x quantity.
 *
 * Accumulation is per season (points reset at the season boundary, 1 July).
 * A player who reaches 5 points is suspended for 1 match, 10 points for 2
 * matches, 15 points for 3 matches plus referral to the Disciplinary
 * Committee. Excess points are retained: after serving the 5-point suspension
 * the accumulated total continues toward the next (10-point) threshold rather
 * than resetting to zero.
 *
 * Suspensions are EVENT/STATE based: each threshold crossing creates an event
 * with a length. Events are served SEQUENTIALLY and NON-OVERLAPPING - each
 * completed fixture of the serving team serves exactly one outstanding
 * suspension match (the earliest outstanding event first), so a single fixture
 * can never satisfy two suspension events at once.
 *
 * Serving team (HKFC application rule): a suspension is served by completed
 * fixtures of the player's REGISTERED TEAM, not by the team the player happened
 * to be playing for when the threshold was crossed. This matters because HKFC
 * players can move between teams and play up/down.
 *
 * A fixture counts as "completed" only when its Match Status is "Played".
 * Future, scheduled and rescheduled matches do not count. The suspended player
 * does not need their own Match Card for a team fixture to count.
 *
 * Red cards (R1-R7) are DETECTED but deliberately NOT converted into automatic
 * suspensions: their serving team can differ between Club and HockeyHK
 * representative teams (Bye-Law 16.10) and their length can be modified by a
 * Disciplinary Committee investigation (Bye-Law 16.7). They remain handled via
 * the manual People."Is Suspended" / "Matches To Serve" mechanism.
 *
 * Match Cards are the source of truth. This module is pure and derived; it
 * never mutates People."Is Suspended" / "Matches To Serve" during reads.
 */

/** Bye-Law 16.3 yellow-card penalty points. */
export const YELLOW_POINTS: Record<string, number> = {
  Y1: 2,
  Y2: 3,
  Y3: 3,
  Y4: 2,
  Y5: 4,
  Y6: 3,
  Y7: 1,
};

/** Bye-Law 16.3 accumulation thresholds, in ascending order. */
export const SUSPENSION_THRESHOLDS = [
  { points: 5, length: 1, dcReferral: false },
  { points: 10, length: 2, dcReferral: false },
  { points: 15, length: 3, dcReferral: true },
] as const;

export interface ParsedCard {
  kind: "yellow" | "red";
  code: string;
  quantity: number;
}

export type SuspensionServiceStatus = "served" | "active" | "indeterminate";

export interface CardSuspensionEvent {
  threshold: 5 | 10 | 15;
  length: number;
  dcReferral: boolean;
  /** The player's registered team (the serving team for this suspension). */
  servingTeam: string;
  /** Match date of the crossing card ("" when unknown). */
  triggerDate: string;
  /** Match id of the crossing card ("" when unknown). */
  triggerMatchId: string;
  /** True when the trigger match/date cannot be resolved (service indeterminate). */
  indeterminate: boolean;
  /** Human-readable diagnostic when `indeterminate` is true. */
  diagnostic?: string;
}

export interface CardSuspensionState {
  /** Current-season yellow points (resets at the season boundary). */
  points: number;
  /** All triggered suspension events (previous-season carry-over first). */
  events: CardSuspensionEvent[];
  /** True while any event has unserved matches. */
  active: boolean;
  /** Total unserved matches across active events. */
  remainingMatches: number;
  /** True when any event reached the 15-point Disciplinary Committee referral. */
  dcReferral: boolean;
  /** Serving team of the first active event (metadata for UI). */
  servingTeam: string | null;
  /** Overall service state (served / active / indeterminate). */
  serviceStatus: SuspensionServiceStatus;
  /** Diagnostic reasons for indeterminate (unresolvable) suspensions. */
  diagnostics: string[];
}

/**
 * Parse a raw Cards multi-select value into a card code and quantity.
 * Accepts clean codes ("Y2", "R3"), quantity suffixes ("Y2 (2)", "Y2 (3)") and
 * HTML-embedded values (the code sits at the end of the markup). Returns null
 * for empty, "[]", unknown or malformed values (fail safe: never guess a
 * quantity or a card code).
 */
export function parseCardValue(value: unknown): ParsedCard | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || s === "[]") return null;
  const codeMatch = s.match(/[YyRr][1-7]/);
  if (!codeMatch) return null;
  const code = codeMatch[0].toUpperCase();
  const rest = s.slice((codeMatch.index ?? 0) + codeMatch[0].length).trim();
  let quantity = 1;
  if (rest) {
    // A trailing parenthesised suffix must be a positive integer quantity;
    // anything else is malformed and fails safe (ignored).
    const qm = rest.match(/^\((\d+)\)$/);
    if (!qm) return null;
    quantity = parseInt(qm[1], 10);
    if (quantity < 1) return null;
  }
  return { kind: code[0] === "Y" ? "yellow" : "red", code, quantity };
}

/** Yellow points for a raw Cards value (base points x quantity); 0 otherwise. */
export function yellowPointsFor(value: unknown): number {
  const c = parseCardValue(value);
  if (!c || c.kind !== "yellow") return 0;
  return (YELLOW_POINTS[c.code] ?? 0) * c.quantity;
}

function completedMatchesOf(team: string, matchesById: Map<string, Match>): Match[] {
  const out: Match[] = [];
  for (const m of matchesById.values()) {
    // Airtable "Match Status" is a single-select constrained to exactly four
    // options: "Scheduled", "Played", "Rescheduled", "Cancelled". Only "Played"
    // (compared case-insensitively) counts as a completed fixture for serving a
    // suspension; every other status is ignored.
    if ((m.matchStatus || "").toLowerCase() !== "played") continue;
    if (m.homeTeam === team || m.awayTeam === team) out.push(m);
  }
  out.sort(
    (a, b) =>
      (a.matchDate || "").localeCompare(b.matchDate || "") ||
      (a.id || "").localeCompare(b.id || ""),
  );
  return out;
}

interface CardInput {
  season: string;
  points: number;
  matchId: string;
  date: string;
  cardId: string;
  indeterminate: boolean;
  /** Registered team snapshot at the time of this card (the serving team). */
  servingTeam: string;
}

function sortChronologically(inputs: CardInput[]): CardInput[] {
  return [...inputs].sort(
    (a, b) => a.date.localeCompare(b.date) || a.matchId.localeCompare(b.matchId),
  );
}

function accumulate(
  inputs: CardInput[],
): { points: number; events: CardSuspensionEvent[] } {
  const triggered = { 5: false, 10: false, 15: false };
  let points = 0;
  const events: CardSuspensionEvent[] = [];
  for (const ci of sortChronologically(inputs)) {
    points += ci.points;
    for (const t of SUSPENSION_THRESHOLDS) {
      if (points >= t.points && !triggered[t.points]) {
        triggered[t.points] = true;
        events.push({
          threshold: t.points,
          length: t.length,
          dcReferral: t.dcReferral,
          servingTeam: ci.servingTeam,
          triggerDate: ci.date,
          triggerMatchId: ci.matchId,
          indeterminate: ci.indeterminate,
          diagnostic: ci.indeterminate
            ? ci.matchId === ""
              ? `Match Card ${ci.cardId || "(unknown)"} has no Match link; service indeterminate.`
              : `Match Card ${ci.cardId || "(unknown)"} references Match ${ci.matchId} with no Match Date; service indeterminate.`
            : undefined,
        });
      }
    }
  }
  return { points, events };
}

/** True when `match` occurs strictly after the event's trigger match. */
function isAfterTrigger(match: Match, event: CardSuspensionEvent): boolean {
  return (
    (match.matchDate || "") > event.triggerDate ||
    ((match.matchDate || "") === event.triggerDate && match.id !== event.triggerMatchId)
  );
}

/**
 * Serve suspension events SEQUENTIALLY against the serving team's completed
 * fixtures, in chronological order. Each fixture serves exactly one match of
 * the earliest outstanding event, so a fixture is never counted twice.
 *
 * An event whose trigger date is unknown fails closed: it (and any later
 * event) is left unserved, so the player remains blocked.
 */
function computeRemaining(
  events: CardSuspensionEvent[],
  matchesById: Map<string, Match>,
): number[] {
  const remaining = events.map((e) => e.length);
  // Serve each serving team's events sequentially and independently: within a
  // team, each completed fixture serves exactly one match of the earliest
  // outstanding event; a fixture of a different team never serves this team.
  const byTeam = new Map<string, number[]>();
  for (let i = 0; i < events.length; i++) {
    const team = events[i].servingTeam || "";
    const arr = byTeam.get(team);
    if (arr) arr.push(i);
    else byTeam.set(team, [i]);
  }
  for (const [team, indices] of byTeam) {
    const completed = completedMatchesOf(team, matchesById);
    let idx = 0;
    for (const ei of indices) {
      const ev = events[ei];
      if (ev.triggerDate === "") continue; // indeterminate: cannot establish chronology
      while (idx < completed.length && !isAfterTrigger(completed[idx], ev)) idx++;
      while (remaining[ei] > 0 && idx < completed.length) {
        remaining[ei]--;
        idx++;
      }
    }
  }
  return remaining;
}

/**
 * Compute one player's automatic card-suspension state.
 *
 * `cards` should contain the player's cards across the current and previous
 * seasons; `matchesById` the matches for both seasons. `registeredTeam` is the
 * player's current canonical Registered Team name (the serving team).
 *
 * Accumulation includes ONLY cards whose season equals `currentSeason`.
 * Previous-season cards are used ONLY to carry an outstanding suspension into
 * the current season. Cards from any other (e.g. future) season are ignored.
 */
export function computeSuspensionState(opts: {
  cards: MatchCard[];
  matchesById: Map<string, Match>;
  currentSeason: string;
  previousSeason: string | null;
  playerId: string;
  registeredTeam: string;
}): CardSuspensionState {
  const { matchesById, currentSeason, previousSeason, playerId, registeredTeam } = opts;

  const inputs: CardInput[] = [];
  const seenRecords = new Set<string>();
  for (const card of opts.cards) {
    const pid = linkId(card.player);
    if (pid !== playerId) continue;
    const matchId = linkId(card.match) || "";
    const match = matchId ? matchesById.get(matchId) : undefined;
    const season = card.season || match?.season || currentSeason;
    const values = Array.isArray(card.cards) ? card.cards : card.cards ? [card.cards] : [];
    // De-duplicate duplicated Match Card RECORDS (same match + same card set).
    // Quantities are summed within a record, so "Y2 (2)" and ["Y2","Y2"] both
    // yield the same total, while a re-synced duplicate record is not counted twice.
    const recordKey = `${matchId || card.id || ""}:${[...new Set(values.map((v) => String(v).trim()))].sort().join("|")}`;
    if (seenRecords.has(recordKey)) continue;
    seenRecords.add(recordKey);
    const indeterminate = matchId === "" || (match?.matchDate || "") === "";
    for (const value of values) {
      const pts = yellowPointsFor(value);
      if (pts <= 0) continue;
      inputs.push({
        season,
        points: pts,
        matchId,
        date: match?.matchDate || "",
        cardId: card.id || "",
        indeterminate,
        // Snapshot the registered team at trigger time (the Match Card's
        // "Player Team"), falling back to the current registered team only
        // when the card does not carry one.
        servingTeam: card.playerTeam || registeredTeam || "",
      });
    }
  }

  const isCurrent = (i: CardInput) => i.season === currentSeason;
  const isPrevious = (i: CardInput) => previousSeason !== null && i.season === previousSeason;

  const current = accumulate(inputs.filter(isCurrent));
  const previous =
    previousSeason === null
      ? { points: 0, events: [] as CardSuspensionEvent[] }
      : accumulate(inputs.filter(isPrevious));

  // Previous-season events precede current-season events chronologically.
  const events = [...previous.events, ...current.events];

  const remaining = computeRemaining(events, matchesById);

  let active = false;
  let remainingMatches = 0;
  let dcReferral = false;
  let hasIndeterminate = false;
  let servingTeam: string | null = null;
  const diagnostics: string[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].dcReferral) dcReferral = true;
    if (remaining[i] > 0) {
      active = true;
      remainingMatches += remaining[i];
      if (servingTeam === null) servingTeam = events[i].servingTeam || null;
      if (events[i].indeterminate) {
        hasIndeterminate = true;
        const diag = events[i].diagnostic;
        if (diag) diagnostics.push(diag);
      }
    }
  }

  const serviceStatus: SuspensionServiceStatus = !active
    ? "served"
    : hasIndeterminate
      ? "indeterminate"
      : "active";

  return {
    points: current.points,
    events,
    active,
    remainingMatches,
    dcReferral,
    servingTeam,
    serviceStatus,
    diagnostics,
  };
}

/**
 * Compute automatic suspension states for every player referenced by the
 * given cards, in one pass (no N+1 queries - inputs are already in memory).
 *
 * `registeredTeamByPlayer` maps player id -> canonical Registered Team name.
 */
export function computeSuspensionStates(opts: {
  currentCards: MatchCard[];
  previousCards: MatchCard[];
  matchesById: Map<string, Match>;
  currentSeason: string;
  previousSeason: string | null;
  registeredTeamByPlayer: Map<string, string>;
}): Map<string, CardSuspensionState> {
  const allCards = [...opts.previousCards, ...opts.currentCards];
  const cardsByPlayer = new Map<string, MatchCard[]>();
  for (const c of allCards) {
    const pid = linkId(c.player);
    if (!pid) continue;
    const arr = cardsByPlayer.get(pid);
    if (arr) arr.push(c);
    else cardsByPlayer.set(pid, [c]);
  }
  const map = new Map<string, CardSuspensionState>();
  for (const [pid, cards] of cardsByPlayer) {
    map.set(
      pid,
      computeSuspensionState({
        cards,
        matchesById: opts.matchesById,
        currentSeason: opts.currentSeason,
        previousSeason: opts.previousSeason,
        playerId: pid,
        registeredTeam: opts.registeredTeamByPlayer.get(pid) || "",
      }),
    );
  }
  return map;
}
