/**
 * Automatic Re-registration Service.
 *
 * When a player records their 4th qualifying play-up appearance of the
 * current season, the player is automatically re-registered: their
 * `People.Registered Team` becomes the destination team determined by the
 * four triggering appearances.
 *
 * Destination algorithm (single rule, handles all frequency distributions):
 *   Select the team with the highest frequency among the four qualifying
 *   play-up appearances; if frequency is tied, select the lowest-ranked team
 *   using `Teams.Team Rank` ("lowest-ranked" = the LARGEST Team Rank number).
 *
 * Core properties:
 *  - Match Cards are the source of truth. Selections, availability and
 *    recommendations never trigger re-registration.
 *  - Goalkeeper status is per Match Card (`Match Cards.Goalkeeper`), never
 *    People.Playing Position: goalkeeper appearances never count toward the
 *    threshold, while a goalkeeper-positioned player's field-player play-ups
 *    count normally.
 *  - Never demotes: a qualifying play-up is an appearance for a higher-ranked
 *    team than the player's current Registered Team. Play-downs never count,
 *    and a non-upward destination is left for review instead of applied.
 *  - The fourth-play-up threshold is an EVENT, processed exactly once per
 *    player per season via the `Registration Events` Airtable table.
 *    It is never re-applied, so an administrator's later manual change of
 *    `People.Registered Team` always stands.
 *  - Historical Match Cards (including `Player Team` and `Team`) are never
 *    rewritten and the season-cumulative play-up count is never reset.
 *  - The eligibility engine stays a pure evaluation engine; it simply
 *    consumes the updated `People.Registered Team` on the next request.
 *
 * Airtable schema (created by the Section Captain / admin, following the
 * same convention as `Ranking Events`; the Worker degrades gracefully -
 * dry-run plans, no writes - until the table exists):
 *
 *   Registration Events
 *     Player                    link (People)
 *     Previous Registered Team  single line text
 *     New Registered Team       single line text
 *     Triggering Match Card     link (Match Cards)
 *     Season                    single line text   e.g. "2026-2027"
 *     Event Type                single select      "auto_reregister"
 *     Timestamp                 date/time (UTC)
 */

import {
  Env,
  airtableFindAll,
  airtableFindById,
  airtableCreate,
  airtableUpdate,
  escapeFormulaValue,
  linkId,
} from "./airtable";
import { getCached, invalidateCache, invalidateCachePrefix } from "../../src/lib/cache";
import { getReferenceData, invalidatePlayerByEmail } from "./reference";
import { getSeasonContext } from "./seasonContext";
import { currentSeason } from "./dashboard";
import { isQualifyingPlayUpCard } from "./playUp";
import { TABLES } from "../../src/generated/tableNames";
import { PEOPLE_FIELDS } from "../../src/generated/fieldMaps";
import type { Match, MatchCard, Player, Team } from "../../src/generated/domainTypes";

// ---------------------------------------------------------------------------
// Registration Events table
// ---------------------------------------------------------------------------

export const REGISTRATION_EVENTS_TABLE = "Registration Events";
export const REGISTRATION_EVENTS_FIELDS = {
  player: "Player",
  previousTeam: "Previous Registered Team",
  newTeam: "New Registered Team",
  triggeringCard: "Triggering Match Card",
  season: "Season",
  eventType: "Event Type",
  timestamp: "Timestamp",
} as const;

/** Single event type recorded by this service. */
export const REGISTRATION_EVENT_TYPE = "auto_reregister";

/** Fourth qualifying play-up appearance triggers re-registration. */
export const RE_REGISTRATION_THRESHOLD = 4;

/**
 * Codebase-wide sentinel for "no Team Rank" (see eligibility buildRankMap,
 * teamMapper, fixtures). A triggering team whose rank is missing, invalid or
 * equal to the sentinel can NOT participate in the destination calculation -
 * the player fails safely to a diagnostic instead of guessing (Spec S17).
 */
const UNRANKED_SENTINEL = 99;

// ---------------------------------------------------------------------------
// Planning (pure, deterministic - no Airtable access)
// ---------------------------------------------------------------------------

export interface TriggeringAppearance {
  cardId: string;
  matchId: string;
  matchDate: string;
  team: string;
}

export interface ReRegistrationPlan {
  playerId: string;
  playerName: string;
  currentRegisteredTeam: string;
  newRegisteredTeam: string;
  qualifyingCount: number;
  /** The four chronological triggering appearances (Spec S9). */
  triggeringAppearances: TriggeringAppearance[];
  frequencyByTeam: Record<string, number>;
  destinationReason: string;
  /** True when the People write would change the current registration. */
  wouldUpdate: boolean;
}

export type DiagnosticCode =
  | "UNRESOLVED_REGISTRATION"
  | "NON_UPWARD_DESTINATION"
  | "MISSING_MATCH_DATE"
  | "DUPLICATE_MATCH_CARD"
  | "MISSING_TEAM"
  | "UNKNOWN_TEAM"
  | "MISSING_TEAM_RANK"
  | "AMBIGUOUS_TEAM_RANK";

export interface ReconciliationDiagnostic {
  playerId: string;
  playerName: string;
  code: DiagnosticCode;
  detail: string;
}

export interface ReconciliationInput {
  players: Player[];
  matchCards: MatchCard[];
  matchesById: Map<string, Match>;
  teams: Team[];
  season: string;
  /** Player ids that already have an auto_reregister event for the season. */
  processedEventPlayerIds: Set<string>;
}

export interface ReconciliationPlanSet {
  plans: ReRegistrationPlan[];
  diagnostics: ReconciliationDiagnostic[];
  scanned: number;
  qualifyingPlayers: number;
  alreadyProcessed: number;
}

/**
 * Pure reconciliation planner. Deterministic and independent of input-array
 * order: qualifying cards are sorted chronologically by actual match date
 * with the Match Card id as secondary key (Spec S9).
 *
 * Fail-safe (Spec S17): any ambiguous or invalid data that could materially
 * affect the fourth appearance or the destination produces a diagnostic and
 * NO plan for that player - `People.Registered Team` is never guessed.
 */
export function planAutomaticReRegistrations(input: ReconciliationInput): ReconciliationPlanSet {
  const { players, matchCards, matchesById, teams, season, processedEventPlayerIds } = input;

  // Team Rank is authoritative (Spec S18). Only teams with a valid numeric
  // rank below the unranked sentinel may be destinations.
  const rankByName = new Map<string, number>();
  const knownTeamNames = new Set<string>();
  for (const t of teams) {
    if (!t.teamName) continue;
    knownTeamNames.add(t.teamName);
    if (typeof t.teamRank === "number" && t.teamRank > 0 && t.teamRank < UNRANKED_SENTINEL) {
      rankByName.set(t.teamName, t.teamRank);
    }
  }

  const cardsByPlayer = new Map<string, MatchCard[]>();
  for (const card of matchCards) {
    const playerId = linkId(card.player);
    if (!playerId) continue;
    const cards = cardsByPlayer.get(playerId);
    if (cards) cards.push(card);
    else cardsByPlayer.set(playerId, [card]);
  }

  const planSet: ReconciliationPlanSet = {
    plans: [],
    diagnostics: [],
    scanned: 0,
    qualifyingPlayers: 0,
    alreadyProcessed: 0,
  };

  const nameOf = (p: Player) =>
    [p.preferredName, p.surname].filter(Boolean).join(" ") || p.givenNames || "Player";
  const diagnose = (player: Player, code: DiagnosticCode, detail: string) => {
    planSet.diagnostics.push({ playerId: player.id, playerName: nameOf(player), code, detail });
  };

  for (const player of players) {
    if (player.active !== true) continue;
    planSet.scanned++;
    if (processedEventPlayerIds.has(player.id)) {
      planSet.alreadyProcessed++;
      continue; // Event processed once - never re-applied (Spec S12/S15).
    }

    // Base play-up shape: the single shared definition (Play Up? = true,
    // Goalkeeper = false, current season). Goalkeeper status is per Match
    // Card - never People.Playing Position - so a goalkeeper-positioned
    // player's field-player play-ups count normally.
    const shapeCards = (cardsByPlayer.get(player.id) ?? []).filter((card) =>
      isQualifyingPlayUpCard(card, season, matchesById),
    );
    if (shapeCards.length < RE_REGISTRATION_THRESHOLD) continue;

    // A qualifying play-up must be an appearance for a team HIGHER-ranked
    // than the player's current Registered Team. Without a resolvable
    // current-team rank, upward movement cannot be verified -> needsReview,
    // never a guess (Spec S17).
    const currentRegisteredTeam = (player.registeredTeam || "").trim();
    const currentRank = currentRegisteredTeam
      ? rankByName.get(currentRegisteredTeam)
      : undefined;
    if (currentRank === undefined) {
      diagnose(
        player,
        "UNRESOLVED_REGISTRATION",
        `Current Registered Team "${currentRegisteredTeam}" is empty or has no valid Team Rank; upward movement cannot be verified`,
      );
      continue;
    }

    // Chronological resolution: join each card to its match for the actual
    // match date. A missing match or date makes the "fourth appearance"
    // ambiguous -> fail safely.
    const resolved: { card: MatchCard; matchId: string; matchDate: string }[] = [];
    let missingDate = false;
    for (const card of shapeCards) {
      const matchId = linkId(card.match);
      const match = matchId ? matchesById.get(matchId) : undefined;
      const matchDate = match?.matchDate || "";
      if (!matchId || !match || !matchDate) {
        missingDate = true;
        break;
      }
      resolved.push({ card, matchId, matchDate });
    }
    if (missingDate) {
      diagnose(
        player,
        "MISSING_MATCH_DATE",
        "A qualifying Match Card has no resolvable Match or match date; chronological order of the four triggering appearances is ambiguous",
      );
      continue;
    }

    // Deterministic order: match date asc, then Match Card id asc. Never
    // rely on Airtable/API return order (Spec S9).
    resolved.sort(
      (a, b) => a.matchDate.localeCompare(b.matchDate) || a.card.id.localeCompare(b.card.id),
    );

    // Duplicate Match Cards for the same match are contradictory data that
    // could materially change the fourth appearance -> fail safely (S9).
    const seenMatches = new Set<string>();
    let duplicateMatchId: string | null = null;
    for (const r of resolved) {
      if (seenMatches.has(r.matchId)) {
        duplicateMatchId = r.matchId;
        break;
      }
      seenMatches.add(r.matchId);
    }
    if (duplicateMatchId) {
      diagnose(
        player,
        "DUPLICATE_MATCH_CARD",
        `Multiple qualifying Match Cards reference match ${duplicateMatchId}; the fourth appearance is ambiguous`,
      );
      continue;
    }

    // Classify every play-up-shaped card against the current registration.
    // A card whose team cannot be resolved could be a genuine play-up that
    // changes the fourth appearance -> fail safely to needsReview. Cards for
    // the player's own or a lower-ranked team are play-downs: never counted.
    const qualifying: { card: MatchCard; matchId: string; matchDate: string; team: string }[] = [];
    let classificationProblem: { code: DiagnosticCode; detail: string } | null = null;
    for (const r of resolved) {
      const team = (r.card.team || "").trim();
      if (!team) {
        classificationProblem = { code: "MISSING_TEAM", detail: `Match Card ${r.card.id} has no Team value; it cannot be classified as a play-up` };
        break;
      }
      if (!knownTeamNames.has(team)) {
        classificationProblem = { code: "UNKNOWN_TEAM", detail: `Match Card ${r.card.id} references team "${team}" which does not exist in Teams` };
        break;
      }
      const cardRank = rankByName.get(team);
      if (cardRank === undefined) {
        classificationProblem = { code: "MISSING_TEAM_RANK", detail: `Team "${team}" has no valid Team Rank; it cannot be classified as a play-up` };
        break;
      }
      if (cardRank < currentRank) qualifying.push({ ...r, team });
    }
    if (classificationProblem) {
      diagnose(player, classificationProblem.code, classificationProblem.detail);
      continue;
    }
    if (qualifying.length < RE_REGISTRATION_THRESHOLD) continue;
    planSet.qualifyingPlayers++;

    const firstFour = qualifying.slice(0, RE_REGISTRATION_THRESHOLD);
    const appearanceTeams = firstFour.map((r) => r.team);

    const frequencyByTeam: Record<string, number> = {};
    for (const team of appearanceTeams) {
      frequencyByTeam[team] = (frequencyByTeam[team] ?? 0) + 1;
    }

    // Rule 1 - highest frequency wins. Rule 2 - on a tie, the lowest-ranked
    // team (largest Team Rank number) wins. Deterministic (Spec S5-S8).
    let maxFrequency = 0;
    for (const count of Object.values(frequencyByTeam)) {
      if (count > maxFrequency) maxFrequency = count;
    }
    const tiedTeams = Object.keys(frequencyByTeam)
      .filter((team) => frequencyByTeam[team] === maxFrequency)
      .sort();
    const tiedCandidates = tiedTeams.map((team) => ({ team, rank: rankByName.get(team) as number }));
    let destination = tiedCandidates[0];
    let ambiguousRank = false;
    for (const candidate of tiedCandidates.slice(1)) {
      if (candidate.rank > destination.rank) destination = candidate;
      else if (candidate.rank === destination.rank) ambiguousRank = true;
    }
    if (ambiguousRank) {
      diagnose(
        player,
        "AMBIGUOUS_TEAM_RANK",
        `Tied teams ${tiedTeams.join(", ")} share the same Team Rank; the lowest-ranked team cannot be determined`,
      );
      continue;
    }

    // Never-demote safeguard (defense in depth): every qualifying card is
    // higher-ranked than the current registration, so the destination is
    // always an upward move. Guard anyway - a future refactor must never
    // turn this into an automatic demotion.
    if (!((rankByName.get(destination.team) as number) < currentRank)) {
      diagnose(
        player,
        "NON_UPWARD_DESTINATION",
        `Calculated destination "${destination.team}" is not a higher-ranked team than the current registration "${currentRegisteredTeam}"; automatic demotion is never performed`,
      );
      continue;
    }

    const destinationReason =
      tiedTeams.length > 1
        ? `Frequency tie at ${maxFrequency} of 4 between ${tiedTeams.join(", ")} - lowest-ranked team wins by Team Rank (${destination.team}, Team Rank ${destination.rank})`
        : `Highest frequency: ${destination.team} accounted for ${maxFrequency} of the 4 qualifying play-up appearances`;

    planSet.plans.push({
      playerId: player.id,
      playerName: nameOf(player),
      currentRegisteredTeam,
      newRegisteredTeam: destination.team,
      qualifyingCount: qualifying.length,
      triggeringAppearances: firstFour.map((r) => ({
        cardId: r.card.id,
        matchId: r.matchId,
        matchDate: r.matchDate,
        team: r.team,
      })),
      frequencyByTeam,
      destinationReason,
      wouldUpdate: destination.team !== currentRegisteredTeam,
    });
  }

  return planSet;
}

// ---------------------------------------------------------------------------
// Registration Events persistence helpers
// ---------------------------------------------------------------------------

export interface ProcessedRegistrationEvent {
  eventId: string;
  triggeringCardId: string | null;
}

const REGISTRATION_EVENTS_TTL_MS = 60 * 1000;

function registrationEventsCacheKey(season: string): string {
  return `registration-events:${season}`;
}

/** Build the Airtable formula for this season's auto_reregister events. */
function autoReRegistrationFormula(season: string): string {
  return `AND({${REGISTRATION_EVENTS_FIELDS.eventType}}="${REGISTRATION_EVENT_TYPE}",{${REGISTRATION_EVENTS_FIELDS.season}}="${escapeFormulaValue(season)}")`;
}

/** Uncached read of this season's auto_reregister events, by player id. */
async function fetchAutoReRegistrationEvents(
  env: Env,
  season: string,
): Promise<Map<string, ProcessedRegistrationEvent>> {
  const byPlayer = new Map<string, ProcessedRegistrationEvent>();
  try {
    const records = await airtableFindAll(env, REGISTRATION_EVENTS_TABLE, autoReRegistrationFormula(season));
    for (const record of records) {
      const playerId = linkId(record.fields?.[REGISTRATION_EVENTS_FIELDS.player]);
      if (playerId && !byPlayer.has(playerId)) {
        byPlayer.set(playerId, {
          eventId: record.id,
          triggeringCardId: linkId(record.fields?.[REGISTRATION_EVENTS_FIELDS.triggeringCard]) ?? null,
        });
      }
    }
  } catch (err) {
    // Table not created yet (or Airtable error) - degrade to "nothing
    // processed". Planning still works; apply mode will fail on the event
    // create and report an error rather than silently skipping.
    console.error("[Registration] Registration Events table unavailable:", err);
  }
  return byPlayer;
}

/** Cached (60s) read of processed auto_reregister events for the season. */
export async function getProcessedAutoReRegistrations(
  env: Env,
  season: string,
): Promise<Map<string, ProcessedRegistrationEvent>> {
  const { data } = await getCached<Map<string, ProcessedRegistrationEvent>>(
    registrationEventsCacheKey(season),
    () => fetchAutoReRegistrationEvents(env, season),
    REGISTRATION_EVENTS_TTL_MS,
  );
  return data;
}

export function invalidateRegistrationEventsCache(season: string): void {
  invalidateCache(registrationEventsCacheKey(season));
}

// ---------------------------------------------------------------------------
// Reconciliation orchestration
// ---------------------------------------------------------------------------

export type ReconciliationMode = "dry-run" | "apply";

export type ApplyOutcome =
  | "registered"
  | "event_recorded_no_change"
  | "skipped_already_processed"
  | "skipped_registration_changed"
  | "error";

export interface ApplyResult {
  playerId: string;
  playerName: string;
  outcome: ApplyOutcome;
  previousTeam?: string;
  newTeam?: string;
  detail?: string;
}

export interface ReconciliationReport {
  mode: ReconciliationMode;
  season: string;
  scanned: number;
  qualifyingPlayers: number;
  alreadyProcessed: number;
  plans: ReRegistrationPlan[];
  diagnostics: ReconciliationDiagnostic[];
  /** Present in apply mode only - one entry per processed plan. */
  results?: ApplyResult[];
}

export interface ReconcileOptions {
  mode?: ReconciliationMode;
  now?: Date;
}

/**
 * Run one reconciliation pass for the current season.
 *
 * dry-run (default): reports what WOULD happen; performs no Airtable writes.
 * apply: performs the People update + Registration Event create for each
 * plan, with a fresh pre-write check of both the player's registration and
 * the event ledger, then invalidates every cache that derives from
 * People.Registered Team.
 */
export async function reconcileRegistrations(
  env: Env,
  opts: ReconcileOptions = {},
): Promise<ReconciliationReport> {
  const mode: ReconciliationMode = opts.mode ?? "dry-run";
  const now = opts.now ?? new Date();

  const ref = await getReferenceData(env);
  const season = currentSeason();
  const seasonCtx = await getSeasonContext(env, season);
  const processed = await getProcessedAutoReRegistrations(env, season);

  const planSet = planAutomaticReRegistrations({
    players: ref.players,
    matchCards: seasonCtx.matchCards,
    matchesById: seasonCtx.matchesById,
    teams: ref.teams,
    season,
    processedEventPlayerIds: new Set(processed.keys()),
  });

  const report: ReconciliationReport = {
    mode,
    season,
    scanned: planSet.scanned,
    qualifyingPlayers: planSet.qualifyingPlayers,
    alreadyProcessed: planSet.alreadyProcessed,
    plans: planSet.plans,
    diagnostics: planSet.diagnostics,
  };

  if (mode === "dry-run") {
    console.log(
      `[Registration] dry-run season=${season} scanned=${planSet.scanned} qualifying=${planSet.qualifyingPlayers} planned=${planSet.plans.length} alreadyProcessed=${planSet.alreadyProcessed} diagnostics=${planSet.diagnostics.length}`,
    );
    return report;
  }

  const results: ApplyResult[] = [];
  for (const plan of planSet.plans) {
    results.push(await applyReRegistration(env, plan, season, now));
  }
  report.results = results;

  const registered = results.filter((r) => r.outcome === "registered").length;
  const recorded = results.filter((r) => r.outcome === "event_recorded_no_change").length;
  const errors = results.filter((r) => r.outcome === "error").length;
  console.log(
    `[Registration] apply season=${season} planned=${planSet.plans.length} registered=${registered} eventRecordedOnly=${recorded} skipped=${results.length - registered - recorded - errors} errors=${errors}`,
  );
  return report;
}

/**
 * Apply one re-registration plan:
 *  1. fresh People read - write paths never trust the 10-minute reference
 *     cache, and a concurrent administrator edit must never be clobbered;
 *  2. fresh Registration Events read - a concurrent Worker isolate may have
 *     processed the same fourth play-up between planning and applying;
 *  3. People.Registered Team update (only when it changes the value);
 *  4. Registration Event create (AFTER the People update succeeds, so a
 *     failed update never produces a "successful" event; a failed event
 *     create is reported as an error and self-heals on the next scan,
 *     because the fresh check sees registration already at the destination);
 *  5. targeted cache invalidation.
 */
async function applyReRegistration(
  env: Env,
  plan: ReRegistrationPlan,
  season: string,
  now: Date,
): Promise<ApplyResult> {
  try {
    const record = await airtableFindById(env, TABLES.player, plan.playerId);
    if (!record) {
      return { playerId: plan.playerId, playerName: plan.playerName, outcome: "error", detail: "Player record not found in Airtable" };
    }
    const currentTeam = String(record.fields?.[PEOPLE_FIELDS.registeredTeam] ?? "").trim();
    if (currentTeam !== plan.currentRegisteredTeam) {
      return {
        playerId: plan.playerId,
        playerName: plan.playerName,
        outcome: "skipped_registration_changed",
        detail: `Registered Team is now "${currentTeam}" but was "${plan.currentRegisteredTeam}" when planned - an administrator edit is likely; re-planned on the next scan`,
      };
    }

    const existing = await fetchAutoReRegistrationEvents(env, season);
    if (existing.has(plan.playerId)) {
      return {
        playerId: plan.playerId,
        playerName: plan.playerName,
        outcome: "skipped_already_processed",
        detail: `A ${REGISTRATION_EVENT_TYPE} event already exists for this player and season`,
      };
    }

    if (plan.wouldUpdate) {
      await airtableUpdate(env, TABLES.player, plan.playerId, {
        [PEOPLE_FIELDS.registeredTeam]: plan.newRegisteredTeam,
      });
    }

    await airtableCreate(env, REGISTRATION_EVENTS_TABLE, {
      [REGISTRATION_EVENTS_FIELDS.player]: [plan.playerId],
      [REGISTRATION_EVENTS_FIELDS.previousTeam]: plan.currentRegisteredTeam,
      [REGISTRATION_EVENTS_FIELDS.newTeam]: plan.newRegisteredTeam,
      [REGISTRATION_EVENTS_FIELDS.triggeringCard]: [plan.triggeringAppearances[plan.triggeringAppearances.length - 1].cardId],
      [REGISTRATION_EVENTS_FIELDS.season]: season,
      [REGISTRATION_EVENTS_FIELDS.eventType]: REGISTRATION_EVENT_TYPE,
      [REGISTRATION_EVENTS_FIELDS.timestamp]: now.toISOString(),
    });

    invalidateRegistrationCaches(season, String(record.fields?.[PEOPLE_FIELDS.email] ?? "").trim() || undefined);

    console.log(
      `[Registration] ${plan.wouldUpdate ? "re-registered" : "event recorded"} player=${plan.playerId} "${plan.currentRegisteredTeam}" -> "${plan.newRegisteredTeam}" triggeringCard=${plan.triggeringAppearances[plan.triggeringAppearances.length - 1].cardId} reason="${plan.destinationReason}"`,
    );
    return {
      playerId: plan.playerId,
      playerName: plan.playerName,
      outcome: plan.wouldUpdate ? "registered" : "event_recorded_no_change",
      previousTeam: plan.currentRegisteredTeam,
      newTeam: plan.newRegisteredTeam,
    };
  } catch (err) {
    console.error(`[Registration] failed to apply re-registration for player=${plan.playerId}:`, err);
    return {
      playerId: plan.playerId,
      playerName: plan.playerName,
      outcome: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Targeted invalidation after a successful registration change. Every cache
 * that derives from People.Registered Team:
 *  - club-reference (players + teamRankMap feed every eligibility view)
 *  - season-index (its suspension states are keyed by Registered Team)
 *  - players-for-match:<matchId>:<side> (heavy evaluation contexts)
 *  - player-by-email:<email>
 *  - ranking active/inactive lists (render Registered Team)
 *  - calendar feeds (player + team)
 * Selections, availability, matches and Match Cards caches are untouched -
 * registration changes none of that data.
 */
function invalidateRegistrationCaches(season: string, email?: string): void {
  invalidateCache("club-reference");
  invalidateRegistrationEventsCache(season);
  invalidateCache(`season-index:${season}`);
  invalidateCachePrefix("players-for-match:");
  if (email) invalidatePlayerByEmail(email);
  invalidateCache("ranking:active");
  invalidateCache("ranking:inactive");
  invalidateCachePrefix("calendar:player:");
  invalidateCachePrefix("calendar:team:");
}
