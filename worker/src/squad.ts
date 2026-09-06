import { Env, airtableFindAll, airtableFindById, airtableUpdate, escapeFormulaValue, linkId, airtableBatchCreate } from "./airtable";
import { getCached, invalidateCache, invalidateCachePrefix } from "../../src/lib/cache";
import { getReferenceData, getExceptionsForSeasons } from "./reference";
import { getScheduledMatches } from "./fixtures";
import { evaluatePlayerEligibility, computeCompletedLeagueMatchCounts, type EvaluationContext, type VirtualSelection } from "./eligibility";
import { computeSuspensionStates } from "./suspension";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import { AVAILABILITYEXCEPTIONS_FIELDS, MATCHCARDS_FIELDS, MATCHES_FIELDS, TEAMS_FIELDS } from "../../src/generated/fieldMaps";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapMatchCard } from "../../src/mappers/matchCardMapper";
import type { KitColour, Match, Player, MatchCard, Team, AvailabilityException } from "../../src/generated/domainTypes";
import { ABILITY_RANK } from "../../src/lib/abilityRank";
import {
  buildEvaluationContext,
  getAllMatches,
  getSeasonContext,
  getSameDayMatches,
} from "./seasonContext";
import { selectedDisplayTeam } from "../../src/lib/displayTeam";
import { effectiveAvailability, getAllAvailabilityRules, indexRulesByPlayer } from "./availabilityRules";

type MatchSide = "home" | "away";

// ── Cached match-record fetch (Performance Pass #1) ─────────────────────
//
// Short-TTL isolate cache for the raw match record. Only READ endpoints use
// it (getPlayersForMatch, getSquadForMatch). Every write path reads the
// record fresh from Airtable so no merge ever operates on stale data, and
// syncSquad invalidates `match:${matchId}` immediately after each write —
// so a coach can never be served stale selections post-update.
const MATCH_RECORD_TTL_MS = 30 * 1000;
const SELECTION_EVENTS_TABLE = "Selection Events";
const SELECTION_EVENTS_FIELDS = {
  player: "Player",
  match: "Match",
  team: "Team",
  action: "Action",
  actor: "Actor",
} as const;

async function getMatchRecord(env: Env, matchId: string): Promise<any> {
  const { data } = await getCached<any>(`match:${matchId}`, async () => {
    const rec = await airtableFindById(env, TABLES.match, matchId);
    if (!rec) throw new HttpError("Match not found", 404);
    return rec;
  }, MATCH_RECORD_TTL_MS);
  return data;
}

// ── HKFC side resolution ────────────────────────────────────────────────
function resolveHkfcSide(match: Match, rankMap: Record<string, number>, side?: MatchSide): MatchSide {
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  if (side === "home" && rankMap[home] !== undefined) return "home";
  if (side === "away" && rankMap[away] !== undefined) return "away";
  if (rankMap[home] !== undefined && rankMap[away] === undefined) return "home";
  if (rankMap[away] !== undefined && rankMap[home] === undefined) return "away";
  if (rankMap[home] !== undefined && rankMap[away] !== undefined) return side ?? "home";
  // Fallback for derby/edge cases: trust the URL side or default home
  if (side) return side;
  return "home";
}

function hkfcTeamName(match: Match, rankMap: Record<string, number>, side?: MatchSide): string {
  return resolveHkfcSide(match, rankMap, side) === "home" ? match.homeTeam || "" : match.awayTeam || "";
}

function getSelectedPlayerIds(match: Match, rankMap: Record<string, number>, side?: MatchSide): string[] {
  return resolveHkfcSide(match, rankMap, side) === "home" ? match.selectedPlayersHome || [] : match.selectedPlayersAway || [];
}

function getSelectionFieldName(match: Match, rankMap: Record<string, number>, side?: MatchSide): string {
  return resolveHkfcSide(match, rankMap, side) === "home" ? MATCHES_FIELDS.selectedPlayersHome : MATCHES_FIELDS.selectedPlayersAway;
}

// ── Public endpoints ────────────────────────────────────────────────────
export async function getPlayersForMatch(env: Env, matchId: string, side?: "home" | "away") {
  const ref = await getReferenceData(env);
  const { teamRankMap, teams } = ref;
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamName || "", t]));
  const matchRecord = await getMatchRecord(env, matchId);
  const match = mapMatch(matchRecord);
  const hkfcTeam = hkfcTeamName(match, teamRankMap, side);
  if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);

  const cacheKey = `players-for-match:${matchId}:${side ?? "auto"}`;
  const { data: heavyData } = await getCached(cacheKey, async () => {
    const { ctx, exceptionsRaw } = await buildEvaluationContext(env, match, teamRankMap, teamMap, ref.players, hkfcTeam);
    return { ctx, allPlayers: ref.players, allExceptions: exceptionsRaw };
  }, 5 * 60 * 1000);
  const { ctx, allPlayers, allExceptions } = heavyData;

  const matchExceptions = allExceptions.filter((e) => linkId(e.match) === matchId);
  const exceptionMap = new Map<string, any>();
  for (const exc of matchExceptions) {
    const pId = linkId(exc.player);
    if (pId) exceptionMap.set(pId, exc);
  }

  const selectedPlayerIds = new Set(getSelectedPlayerIds(match, teamRankMap, side));
  const rulesByPlayer = indexRulesByPlayer(await getAllAvailabilityRules(env));

  const matchDateKey = (match.matchDate || "").split("T")[0];
  const thisTeamRank = teamRankMap[hkfcTeam] ?? 99;

  const players = allPlayers.map((p) => {
    const isSelected = selectedPlayerIds.has(p.id);
    const exc = exceptionMap.get(p.id);
    // Standing rules supply the default for players who have not answered
    // this fixture. Coaches need to know which it is - "hasn't been asked"
    // reads very differently from "said no" - so the flag rides along.
    const playerRank = teamRankMap[p.registeredTeam || ""] ?? 99;
    const effective = effectiveAvailability(exc?.availabilityStatus, rulesByPlayer.get(p.id) ?? [], {
      date: matchDateKey,
      isPlayUp: thisTeamRank < playerRank,
      isSupport: thisTeamRank > playerRank,
    });
    const availabilityStatus = effective.status;
    const playerNotes = exc?.note || exc?.playerNotes || "";
    const eligibility = evaluatePlayerEligibility(p, match, ctx);
    const name = [p.preferredName, p.surname].filter(Boolean).join(" ") || p.givenNames || "Player";
    // Blocks carry the stable internal ruleId alongside the exact reason string.
    const blocks = eligibility.status === "blocked" && eligibility.reason
      ? [{ rule: eligibility.ruleId ?? "", reason: eligibility.reason }]
      : [];
    const conflicts: { type: string; team: string; matchId: string }[] = [];
    if (eligibility.selectedByTeam) conflicts.push({ type: "selected", team: eligibility.selectedByTeam, matchId: "" });
    if (eligibility.sameDayHigherTeam) conflicts.push({ type: "available", team: eligibility.sameDayHigherTeam, matchId: "" });
    // Soft coach signal: available for THIS fixture but marked Unavailable
    // for a same-day LOWER-ranked HKFC fixture (support duty). Presentation
    // only - computed from existing exceptions, no extra Airtable reads.
    const supportUnavailable: string[] = [];
    if (availabilityStatus !== "Unavailable") {
      const seenTeams = new Set<string>();
      for (const fx of ctx.sameDayFixtures) {
        if ((teamRankMap[fx.teamName] ?? 99) <= thisTeamRank) continue;
        if (seenTeams.has(fx.teamName)) continue;
        if (ctx.unavailablePlayerMatchKeys.has(`${p.id}:${fx.matchId}`)) {
          supportUnavailable.push(fx.teamName);
          seenTeams.add(fx.teamName);
        }
      }
    }
    return {
      id: p.id,
      preferredName: name,
      // Coaches build WhatsApp click-to-chat links in the browser, so the
      // number has to reach the client. This endpoint is coach-only; the
      // player-facing squad list (getSquadForMatch) never includes it.
      mobile: p.mobileNo || "",
      // Display value: Selected Team EOS -> SOS -> Registered Team (optics).
      // Eligibility above was computed from the true Registered Team.
      registeredTeam: selectedDisplayTeam(p),
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      availabilityStatus,
      /** True when the status came from a standing rule, not an explicit tap. */
      availabilityFromRule: effective.fromRule,
      supportUnavailable,
      playerNotes,
      playUpCount: eligibility.playUpCount,
      eligibilityStatus: eligibility.status,
      reason: eligibility.reason,
      blocks,
      warnings: eligibility.warnings,
      conflicts,
      selectedByTeam: eligibility.selectedByTeam,
      sameDayHigherTeam: eligibility.sameDayHigherTeam,
      isU21: p.u21Eligible || false,
      isVisitingPlayer: p.isVisitingPlayer || false,
      selectionStatus: isSelected ? "Selected" : "",
      selectionId: "",
    };
  });

  players.sort((a, b) => {
    if (a.selectionStatus && !b.selectionStatus) return -1;
    if (!a.selectionStatus && b.selectionStatus) return 1;
    const order = { eligible: 0, warning: 1, blocked: 2 } as const;
    return (order[a.eligibilityStatus] ?? 0) - (order[b.eligibilityStatus] ?? 0);
  });

  const teamsByName = new Map(teams.map((t) => [t.teamName || "", t]));
  const resolvedSide = resolveHkfcSide(match, teamRankMap, side);
  const matchInfo = {
    hkfcTeam,
    date: match.matchDate || "",
    homeTeam: match.homeTeam || "",
    awayTeam: match.awayTeam || "",
    division: match.division || "",
    competitionType: match.competitionType || "",
    venue: match.venue || "",
    targetSquadSize: teamsByName.get(hkfcTeam)?.targetSquadSize || 16,
    selectedCount: selectedPlayerIds.size,
    autoSelectEnabled: match.autoSelectEnabled ?? false,
    autoSelectPlayerIds: teamsByName.get(hkfcTeam)?.autoSelectPlayers || [],
    // Which side this screen is selecting, so the kit toggle writes the
    // right field. Uses the same resolver as the selection write path, so a
    // derby cannot end up reading one side's kit while writing the other's.
    side: resolvedSide,
    kit: ((resolvedSide === "away" ? match.awayKit : match.homeKit) || "") as KitColour,
  };
  return { match: matchInfo, players };
}

export async function syncSquad(env: Env, matchId: string, targetPlayerIds: string[], actingEmail?: string, side?: MatchSide) {
  if (!Array.isArray(targetPlayerIds)) throw new HttpError("selectedIds must be an array", 400);
  // WRITE PATH: always read the record fresh — never from the 30s cache —
  // so the derby-safety merge below operates on the current opposite side.
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const fieldName = getSelectionFieldName(match, ref.teamRankMap, side);
  const cleanIds = targetPlayerIds.filter((id) => typeof id === "string" && id.startsWith("rec"));

    // ── Server-side eligibility revalidation (INV-003) ──────────────────
  const currentSelectedBefore = getSelectedPlayerIds(match, ref.teamRankMap, side);
  const newlyAddedIds = cleanIds.filter((id) => !currentSelectedBefore.includes(id));
  
  if (newlyAddedIds.length > 0) {
    const teamMap = new Map<string, Team>(ref.teams.map((t) => [t.teamName || "", t]));
    const hkfcTeam = hkfcTeamName(match, ref.teamRankMap, side);
    if (!hkfcTeam) throw new HttpError("Cannot determine HKFC team for this match", 422);
    
    const { ctx } = await buildEvaluationContext(env, match, ref.teamRankMap, teamMap, ref.players, hkfcTeam);
    const playersById = new Map(ref.players.map((p) => [p.id, p]));
    
    const violations: string[] = [];
    for (const id of newlyAddedIds) {
      const player = playersById.get(id);
      if (!player) { violations.push(`${id}: player not found or inactive`); continue; }
      
      const eligibility = evaluatePlayerEligibility(player, match, ctx);
      if (eligibility.status === "blocked") {
        const name = player.preferredName || player.givenNames || id;
        violations.push(`${name}: ${eligibility.reason}`);
      }
    }
    
    if (violations.length > 0) {
      throw new HttpError(`Selection rejected — ineligible player(s): ${violations.join("; ")}`, 422);
    }
  }

  // Derby safety: ensure a player isn't selected for BOTH sides of the same match
  const updates: Record<string, string[]> = { [fieldName]: cleanIds };
  if (side === "home" || side === "away") {
    const oppositeField = side === "home" ? MATCHES_FIELDS.selectedPlayersAway : MATCHES_FIELDS.selectedPlayersHome;
    const oppositeCurrent = side === "home" ? match.selectedPlayersAway : match.selectedPlayersHome;
    updates[oppositeField] = (oppositeCurrent || []).filter((id) => !cleanIds.includes(id));
  }
  await airtableUpdate(env, TABLES.match, matchId, updates);

  // ── Selection event log (feeds "Recent Changes"; optional table, never blocks writes) ──
  try {
    const events: Record<string, unknown>[] = [];
    const push = (id: string, team: string, action: string) => {
      if (events.length >= 10) return;
      events.push({
        [SELECTION_EVENTS_FIELDS.player]: [id],
        [SELECTION_EVENTS_FIELDS.match]: [matchId],
        [SELECTION_EVENTS_FIELDS.team]: team,
        [SELECTION_EVENTS_FIELDS.action]: action,
        [SELECTION_EVENTS_FIELDS.actor]: actingEmail || "",
      });
    };
    const currentSelected = getSelectedPlayerIds(match, ref.teamRankMap, side);
    const targetTeam = hkfcTeamName(match, ref.teamRankMap, side);
    cleanIds.filter((id) => !currentSelected.includes(id)).forEach((id) => push(id, targetTeam, "Selected"));
    currentSelected.filter((id) => !cleanIds.includes(id)).forEach((id) => push(id, targetTeam, "Removed"));
    if (side === "home" || side === "away") {
      const oppositeTeam = side === "home" ? match.awayTeam || "" : match.homeTeam || "";
      const oppositeSelected = side === "home" 
        ? (match.selectedPlayersAway || []) 
        : (match.selectedPlayersHome || []);
        
      oppositeSelected
        .filter((id: string) => cleanIds.includes(id))
        .forEach((id: string) => push(id, oppositeTeam, "Removed"));
    }
    if (events.length > 0) airtableBatchCreate(env, SELECTION_EVENTS_TABLE, events).catch(() => {});
  } catch {
    /* Selection Events table not created yet — Recent Changes degrades to availability-only. */
  }

  // Invalidation fan-out (Invariant #11). Every cache that can now be stale:
  const season = match.season || "";
  const allMatchesInSeason = await getAllMatches(env, season);
  const affectedMatchIds = new Set([
    matchId,
    ...getSameDayMatches(allMatchesInSeason, match.matchDate || "").map((m) => m.id),
  ]);
  invalidateCache(`match:${matchId}`);
  invalidateCache(`season-index:${season}`);
  invalidateCache(`all-matches:${season}`);
  invalidateCache("scheduled-matches");
  for (const id of affectedMatchIds) {
    invalidateCachePrefix(`players-for-match:${id}:`);
  }
  invalidateCachePrefix("calendar:player:");
  invalidateCachePrefix("calendar:team:");
}

export async function selectPlayer(env: Env, input: { matchId: string; playerId: string; side?: MatchSide }) {
  const { matchId, playerId, side } = input;
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const currentSelected = getSelectedPlayerIds(match, ref.teamRankMap, side);
  if (!currentSelected.includes(playerId)) {
    await syncSquad(env, matchId, [...currentSelected, playerId], undefined, side);
  }
  return { success: true };
}

export async function toggleAutoSelect(env: Env, matchId: string, enabled: boolean, actingEmail?: string) {
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  await airtableUpdate(env, TABLES.match, matchId, {
    [MATCHES_FIELDS.autoSelectEnabled]: enabled,
  });
  invalidateCache(`match:${matchId}`);
  invalidateCachePrefix(`players-for-match:${matchId}:`);
  console.log(`[AutoSelect Audit] action=toggle matchId=${matchId} enabled=${enabled} actor=${actingEmail || "unknown"}`);
  return { success: true, autoSelectEnabled: enabled };
}

const KIT_COLOURS: readonly string[] = ["Blue", "White", ""];

/**
 * Set the shirt colour for one side of a fixture.
 *
 * Home and Away are separate fields so a derby (HKFC B v HKFC C) can have a
 * different colour per side; the caller says which side it is setting. An
 * empty string clears the choice back to "not yet decided".
 */
export async function setMatchKit(
  env: Env,
  matchId: string,
  side: "home" | "away",
  kit: string,
  actingEmail?: string,
) {
  if (side !== "home" && side !== "away") {
    throw new HttpError('side must be "home" or "away"', 400);
  }
  if (!KIT_COLOURS.includes(kit)) {
    throw new HttpError('kit must be "Blue", "White" or empty', 400);
  }
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);

  const field = side === "home" ? MATCHES_FIELDS.homeKit : MATCHES_FIELDS.awayKit;
  await airtableUpdate(env, TABLES.match, matchId, { [field]: kit });

  // Same invalidation set as the auto-select toggle: the fixture views and
  // the calendar feeds all read the kit off the cached match records.
  invalidateCache(`match:${matchId}`);
  invalidateCache("scheduled-matches");
  invalidateCachePrefix(`players-for-match:${matchId}:`);
  invalidateCachePrefix("calendar:");
  console.log(`[Kit Audit] matchId=${matchId} side=${side} kit=${kit || "(cleared)"} actor=${actingEmail || "unknown"}`);
  return { success: true, side, kit };
}

// ── Priority Player List Management ─────────────────────────────────────

export async function getTeamAutoSelectPlayers(env: Env, teamName: string) {
  if (!teamName) throw new HttpError("team name is required", 400);
  const ref = await getReferenceData(env);
  const team = ref.teams.find(t => t.teamName === teamName);
  if (!team) throw new HttpError("Team not found", 404);
  const playerIds = team.autoSelectPlayers || [];
  const players = ref.players
    .filter(p => playerIds.includes(p.id))
    .map(p => ({
      id: p.id,
      preferredName: [p.preferredName, p.surname].filter(Boolean).join(" ") || p.givenNames || "Player",
      registeredTeam: selectedDisplayTeam(p),
      playingPosition: p.playingPosition || "",
      playingAbility: p.playingAbility || "",
      active: p.active ?? true,
    }));
  return { teamName, playerIds, players };
}

export async function setTeamAutoSelectPlayers(env: Env, teamName: string, playerIds: string[], actingEmail?: string) {
  if (!teamName) throw new HttpError("team name is required", 400);
  if (!Array.isArray(playerIds)) throw new HttpError("playerIds must be an array", 400);

  const ref = await getReferenceData(env);
  const team = ref.teams.find(t => t.teamName === teamName);
  if (!team) throw new HttpError("Team not found", 404);

  const validIds = playerIds.filter(id => typeof id === "string" && id.startsWith("rec"));

  // Use team.id from reference data — avoids a redundant Airtable lookup
  await airtableUpdate(env, TABLES.team, team.id, {
    [TEAMS_FIELDS.autoSelectPlayers]: validIds,
  });

  // Invalidate reference data cache so match-info picks up the new list
  invalidateCache("club-reference");
  invalidateCache("team-coach-links");
  invalidateCachePrefix("players-for-match:");

  console.log(`[AutoSelect Audit] action=setPriorityPlayers team=${teamName} count=${validIds.length} actor=${actingEmail || "unknown"}`);
  return { success: true, teamName, playerIds: validIds };
}

export async function removeSelection(env: Env, input: { matchId: string; playerId: string; side?: MatchSide }) {
  const { matchId, playerId, side } = input;
  // WRITE PATH: fresh read (see syncSquad note).
  const matchRecord = await airtableFindById(env, TABLES.match, matchId);
  if (!matchRecord) throw new HttpError("Match not found", 404);
  const match = mapMatch(matchRecord);
  const ref = await getReferenceData(env);
  const currentSelected = getSelectedPlayerIds(match, ref.teamRankMap, side);
  const newSelected = currentSelected.filter((id) => id !== playerId);
  await syncSquad(env, matchId, newSelected, undefined, side);
  return { success: true };
}

/**
 * Availability exceptions for one match, for the 30s squad-page poll.
 *
 * Previously this scanned the whole Availability Exceptions table with
 * FIND("{id}", {Match}) on every poll tick. Now it resolves the match's
 * season (30s match-record cache), reuses the season-scoped exceptions
 * cache (5 min, invalidated by every availability write) and holds a 25s
 * per-match cache of its own - so steady-state polling makes zero Airtable
 * calls and the linked-field FIND fragility is gone entirely.
 */
const AVAILABILITY_FOR_MATCH_TTL_MS = 25 * 1000;

export async function getAvailabilityForMatch(env: Env, matchId: string) {
  const { data } = await getCached<{ exceptions: { playerId: string; status: string; notes: string }[] }>(
    `availability:${matchId}`,
    async () => {
      try {
        const matchRecord = await airtableFindById(env, TABLES.match, matchId);
        const season = matchRecord?.fields?.[MATCHES_FIELDS.season] || "";
        if (!season) return { exceptions: [] };
        const allExceptions = await getExceptionsForSeasons(env, [season]);
        return {
          exceptions: allExceptions
            .filter((e) => linkId(e.match) === matchId)
            .map((e) => ({
              playerId: linkId(e.player) || "",
              status: e.availabilityStatus || "Available",
              notes: e.note || "",
            })),
        };
      } catch (err) {
        // Never let the poll crash the app
        console.error("getAvailabilityForMatch error:", err);
        return { exceptions: [] };
      }
    },
    AVAILABILITY_FOR_MATCH_TTL_MS,
  );
  return data;
}
const POSITION_ORDER: Record<string, number> = { Goalkeeper: 0, Defender: 1, Midfielder: 2, Forward: 3 };

export async function getSquadForMatch(env: Env, matchId: string, side?: MatchSide) {
  if (!matchId) throw new HttpError("matchId is required", 400);
  // Scheduled matches are already cached (10 min, invalidated by syncSquad);
  // reuse that copy to avoid an extra Airtable round-trip for the common
  // case. Non-scheduled matches fall back to the per-match 30s cache.
  const scheduled = (await getScheduledMatches(env)).find((m) => m.id === matchId);
  const match = scheduled ?? mapMatch(await getMatchRecord(env, matchId));
  const ref = await getReferenceData(env);
  const selectedIds = getSelectedPlayerIds(match, ref.teamRankMap, side);
  const players = [] as { id: string; name: string; position: string; ability: string }[];
  const playersById = new Map(ref.players.map((player) => [player.id, player]));
  for (const playerId of selectedIds) {
    const player = playersById.get(playerId);
    if (!player) continue;
    const name = [player.preferredName, player.surname].filter(Boolean).join(" ") || player.givenNames || "Unknown";
    players.push({ id: player.id, name, position: player.playingPosition || "", ability: player.playingAbility || "" });
  }
  players.sort((a, b) => {
    const posA = POSITION_ORDER[a.position] ?? 99;
    const posB = POSITION_ORDER[b.position] ?? 99;
    if (posA !== posB) return posA - posB;
    return (ABILITY_RANK[b.ability] ?? 0) - (ABILITY_RANK[a.ability] ?? 0);
  });
  return { matchId, players };
}