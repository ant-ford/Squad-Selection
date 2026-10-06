/**
 * Ranking engine — single source of truth for player ability assessment.
 */
import type { Env } from "./env";
import { HttpError } from "./http";
import { people, type PersonPatch } from "./data/people";
import { abilityGroups } from "./data/abilityGroups";
import { computeAbilityAssignment, emptyConfig, validateConfig } from "../../shared/abilityGroup";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import type { AuthorizedUser } from "./auth";
import {
  validateJustification,
  selectRankingEventChanges,
  invalidateRankingEventsCache,
  recordRankingEvents,
} from "./rankingEvents";
import { getShared, invalidateShared } from "./cache";
import type {
  AbilityGroupConfigMap,
  InactiveRankingEntry,
  Player,
  RankingList,
} from "../../shared/schema/domainTypes";

// ── In-memory derived-rank annotation ────────────────────────────────────
/** Next 1-based occurrence count for `key`, advancing `counters` in place. */
function nextCount(counters: Map<string, number>, key: string): number {
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  return n;
}

function annotateWithDerivedRanks(players: Player[]): Player[] {
  const teamCounters = new Map<string, number>();
  const posCounters = new Map<string, number>();
  return players.map((p) => {
    // Team blocks are grouped by the DISPLAYED team (Selected Team EOS ->
    // SOS -> Registered) so T# stays consistent with the optics. The cached
    // player object keeps the true Registered Team for business rules.
    const teamRank = nextCount(teamCounters, selectedDisplayTeam(p));
    const positionalRank = nextCount(posCounters, p.playingPosition ?? "");
    return { ...p, teamRank, positionalRank };
  });
}

// ── Caching ──────────────────────────────────────────────────────────────
const RANKING_CACHE_TTL_MS = 30 * 1000;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Internal helpers ─────────────────────────────────────────────────────
function rankingCacheKey(active: boolean): string {
  return active ? "ranking:active" : "ranking:inactive";
}

const RANKING_CONFIG_KEY = "ranking:config";

/**
 * Drop the ranking lists and config in this isolate. Other isolates hold
 * their copies for 30 s at most (cache.ts getShared).
 */
async function invalidateRankingCaches(env: Env): Promise<void> {
  await invalidateShared(env, [rankingCacheKey(true), rankingCacheKey(false), RANKING_CONFIG_KEY]);
}

async function fetchActiveRanking(env: Env): Promise<Player[]> {
  const players = await people(env).listRankingPool();
  return players.sort((a, b) => (a.sectionRank ?? 0) - (b.sectionRank ?? 0));
}

async function fetchInactiveRanking(
  env: Env,
): Promise<InactiveRankingEntry[]> {
  const players = await people(env).listInactiveRankable();
  return players.map((p) => {
    return {
      id: p.id,
      preferredName: p.preferredName,
      surname: p.surname,
      givenNames: p.givenNames,
      // Display-only list: show the Selected Team (optics).
      registeredTeam: selectedDisplayTeam(p),
      playingPosition: p.playingPosition,
      lastSectionRank: p.sectionRank,
      status: p.status,
      applicantStage: p.applicantStage,
    };
  });
}

async function batchUpdatePlayers(
  env: Env,
  updates: { id: string; patch: PersonPatch }[],
): Promise<void> {
  if (updates.length === 0) return;
  await people(env).updateMany(updates);
}

// ── Config read/write ────────────────────────────────────────────────────
export async function getAbilityGroupConfig(
  env: Env,
): Promise<AbilityGroupConfigMap> {
  return getShared<AbilityGroupConfigMap>(
    env,
    RANKING_CONFIG_KEY,
    async () => {
      const rows = await abilityGroups(env).list();
      const map = emptyConfig();
      for (const row of rows) {
        if (row.group === "H") continue;
        map[row.group] = row.capacity;
      }
      return map;
    },
    CONFIG_CACHE_TTL_MS,
  );
}

export async function setAbilityGroupConfig(
  env: Env,
  config: AbilityGroupConfigMap,
  user: AuthorizedUser,
): Promise<RankingList> {
  if (!user.isSectionCaptain) {
    throw new HttpError("Only the Section Captain can modify the ranking configuration", 403);
  }

  const ranking = await getActiveRanking(env);
  const validation = validateConfig(config, ranking.activeCount);
  if (validation) throw new HttpError(validation, 400);

  const capacities: Partial<Record<keyof AbilityGroupConfigMap, number>> = {};
  for (const g of ["A", "B", "C", "D", "E", "F", "G"] as const) {
    capacities[g] = Math.max(0, Math.floor(config[g] ?? 0));
  }
  await abilityGroups(env).saveCapacities(capacities);

  await invalidateRankingCaches(env);
  return recomputeDerivedFields(env);
}

// ── Public read ──────────────────────────────────────────────────────────
export async function getActiveRanking(env: Env): Promise<RankingList> {
  const data = await getShared<RankingList>(
    env,
    rankingCacheKey(true),
    async () => {
      const raw = await fetchActiveRanking(env);
      const players = annotateWithDerivedRanks(raw);
      return {
        players,
        activeCount: players.length,
        lastUpdated: new Date().toISOString(),
        config: await getAbilityGroupConfig(env),
        version: Date.now(),
      };
    },
    RANKING_CACHE_TTL_MS,
  );
  return forClients(data);
}

/**
 * Display substitution at the response boundary: the cache keeps the true
 * Registered Team for business rules; clients see the Selected Team. Every
 * ranking response goes through here, reads and writes alike, or the screen
 * would switch a player's team after a save.
 */
function forClients(data: RankingList): RankingList {
  return { ...data, players: data.players.map((p) => ({ ...p, registeredTeam: selectedDisplayTeam(p) })) };
}

export async function getInactiveRanking(env: Env): Promise<InactiveRankingEntry[]> {
  return getShared<InactiveRankingEntry[]>(
    env,
    rankingCacheKey(false),
    async () => fetchInactiveRanking(env),
    RANKING_CACHE_TTL_MS,
  );
}

// ── Public writes ────────────────────────────────────────────────────────
export async function reorderRanking(
  env: Env,
  playerIds: string[],
  actingEmail?: string,
  justification?: string,
): Promise<RankingList> {
  const note = validateJustification(justification);
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new HttpError("playerIds must be a non-empty array", 400);
  }
  await invalidateRankingCaches(env);
  const players = await fetchActiveRanking(env);
  const n = players.length;
  if (playerIds.length !== n) {
    throw new HttpError(
      `Ranking is stale: expected ${n} players, got ${playerIds.length}. Refresh and try again.`,
      409,
    );
  }

  const known = new Set(players.map((p) => p.id));
  const seen = new Set<string>();
  for (const id of playerIds) {
    if (!known.has(id)) throw new HttpError(`Unknown player ID: ${id}`, 400);
    if (seen.has(id)) throw new HttpError(`Duplicate player ID: ${id}`, 400);
    seen.add(id);
  }

  const playerById = new Map(players.map((p) => [p.id, p]));
  const updates: { id: string; rank: number; oldRank: number }[] = [];
  const updatedPlayers: Player[] = [];
  
  playerIds.forEach((id, i) => {
    const p = playerById.get(id)!;
    const newRank = i + 1;
    if (p.sectionRank !== newRank) updates.push({ id, rank: newRank, oldRank: p.sectionRank ?? 0 });
    updatedPlayers.push({ ...p, sectionRank: newRank });
  });

  if (updates.length > 0) {
    await applySectionRankUpdates(env, updates, actingEmail, "reorder", note);
  }
  return recomputeDerivedFieldsFromList(env, updatedPlayers);
}

export async function activatePlayer(env: Env, playerId: string, actingEmail?: string): Promise<RankingList> {
  const player = await people(env).getById(playerId);
  if (!player) throw new HttpError("Player not found", 404);

  if (player.active !== true) {
    const activePlayers = await fetchActiveRanking(env);
    // An Applicant can already appear in this pool with a Section Rank of
    // their own (fetchActiveRanking includes non-rejected
    // Applicants alongside Active players). Keep that rank - appending at
    // length+1 would leave a hole at their old rank and push them past the
    // end of the list.
    const existing = activePlayers.find((p) => p.id === playerId);
    const hasExistingRank = typeof existing?.sectionRank === "number" && existing.sectionRank > 0;
    const newRank = hasExistingRank ? existing!.sectionRank! : activePlayers.length + 1;

    console.log(`[Ranking Audit] ${new Date().toISOString()} | User: ${actingEmail || 'system'} | Player: ${playerId} | Old Rank: N/A | New Rank: ${newRank} (Activated)`);
    await people(env).update(playerId, {
      active: true,
      sectionRank: newRank,
      rankUpdatedAt: new Date().toISOString(),
    });
    invalidateRankingEventsCache();
    await recordRankingEvents(env, [
      { playerId, actorEmail: actingEmail, kind: "activate", oldRank: hasExistingRank ? newRank : null, newRank },
    ]);

    // Safety net: renumber the whole pool to a contiguous 1..N, the same
    // batch-update machinery reorderRanking uses. A no-op when already
    // contiguous (the common case after the fix above).
    await invalidateRankingCaches(env);
    const afterActivation = await fetchActiveRanking(env);
    const contiguousUpdates: { id: string; rank: number; oldRank: number }[] = [];
    afterActivation.forEach((p, i) => {
      const wantRank = i + 1;
      if ((p.sectionRank ?? 0) !== wantRank) {
        contiguousUpdates.push({ id: p.id, rank: wantRank, oldRank: p.sectionRank ?? 0 });
      }
    });
    if (contiguousUpdates.length > 0) {
      await applySectionRankUpdates(env, contiguousUpdates, actingEmail, "reorder", undefined, false);
    }
  }

  await invalidateRankingCaches(env);
  return recomputeDerivedFields(env);
}

export async function deactivatePlayer(env: Env, playerId: string, actingEmail?: string): Promise<RankingList> {
  const player = await people(env).getById(playerId);
  if (!player) throw new HttpError("Player not found", 404);
  if (player.active === false) return getActiveRanking(env);

  await invalidateRankingCaches(env);
  const players = await fetchActiveRanking(env);
  const idx = players.findIndex((p) => p.id === playerId);
  
  if (idx === -1) {
    await people(env).update(playerId, { active: false });
    return getActiveRanking(env);
  }

  const oldRank = players[idx].sectionRank ?? 0;
  console.log(`[Ranking Audit] ${new Date().toISOString()} | User: ${actingEmail || 'system'} | Player: ${playerId} | Old Rank: ${oldRank} | New Rank: N/A (Deactivated)`);
  
  const sectionRankUpdates: { id: string; rank: number; oldRank: number }[] = [];
  for (const p of players) {
    const r = p.sectionRank ?? 0;
    if (p.id === playerId) continue;
    if (r > oldRank) sectionRankUpdates.push({ id: p.id, rank: r - 1, oldRank: r });
  }
  
  await applySectionRankUpdates(env, sectionRankUpdates, actingEmail, "move", undefined, false);
  await people(env).update(playerId, {
    active: false,
    sectionRank: null,
    playingAbility: null,
    rankUpdatedAt: new Date().toISOString(),
  });

  invalidateRankingEventsCache();
  await recordRankingEvents(env, [
    { playerId, actorEmail: actingEmail, kind: "deactivate", oldRank, newRank: null },
  ]);

  await invalidateRankingCaches(env);
  return recomputeDerivedFields(env);
}

// ── Recompute derived fields ─────────────────────────────────────────────
async function recomputeDerivedFieldsFromList(
  env: Env,
  players: Player[],
): Promise<RankingList> {
  const config = await getAbilityGroupConfig(env);
  const n = players.length;
  const teamCounters = new Map<string, number>();
  const positionalCounters = new Map<string, number>();
  const now = new Date().toISOString();
  const fieldUpdates: { id: string; patch: PersonPatch }[] = [];
  const updatedPlayers: Player[] = [];

  for (const p of players) {
    const rank = p.sectionRank ?? 0;
    if (rank < 1 || rank > n) {
      updatedPlayers.push(p);
      continue;
    }
    
    // Same display-team grouping as annotateWithDerivedRanks (optics).
    const teamRank = nextCount(teamCounters, selectedDisplayTeam(p));
    const positionalRank = nextCount(positionalCounters, p.playingPosition ?? "");

    const assignment = computeAbilityAssignment(rank, n, config);
    const needsUpdate = p.playingAbility !== assignment.abilityDisplay;
    
    if (needsUpdate) {
      fieldUpdates.push({
        id: p.id,
        patch: {
          playingAbility: assignment.abilityDisplay,
          rankUpdatedAt: now,
        },
      });
    }
    
    updatedPlayers.push({
      ...p,
      teamRank,
      positionalRank,
      playingAbility: assignment.abilityDisplay,
      rankUpdatedAt: needsUpdate ? now : p.rankUpdatedAt,
    });
  }

  await batchUpdatePlayers(env, fieldUpdates);
  await invalidateRankingCaches(env);

  return forClients({ players: updatedPlayers, activeCount: n, lastUpdated: now, config, version: Date.now() });
}

export async function recomputeDerivedFields(env: Env): Promise<RankingList> {
  const players = await fetchActiveRanking(env);
  return recomputeDerivedFieldsFromList(env, players);
}

async function applySectionRankUpdates(
  env: Env,
  updates: { id: string; rank: number; oldRank?: number }[],
  actingEmail?: string,
  kind: "move" | "reorder" = "move",
  justification?: string,
  recordEvents = true,
): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  
  for (const u of updates) {
    console.log(`[Ranking Audit] ${now} | User: ${actingEmail || 'system'} | Player: ${u.id} | Old Rank: ${u.oldRank ?? '?'} | New Rank: ${u.rank}`);
  }
  
  const stamped = updates.map(({ id, rank }) => ({
    id,
    patch: {
      sectionRank: rank,
      rankUpdatedAt: now,
    },
  }));
  
  await batchUpdatePlayers(env, stamped);
  await invalidateRankingCaches(env);

  // Ranking history: fire-and-forget, after the commit succeeded. The
  // browser never stamps time - every event gets a server timestamp here.
  if (recordEvents && actingEmail) {
    const events = selectRankingEventChanges(updates).map((u) => ({
      playerId: u.id,
      actorEmail: actingEmail,
      kind,
      oldRank: u.oldRank,
      newRank: u.newRank,
      justification,
    }));
    invalidateRankingEventsCache();
    await recordRankingEvents(env, events);
  }
}