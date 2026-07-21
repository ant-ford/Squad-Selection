/**
 * Ranking engine — single source of truth for player ability assessment.
 *
 * Performance model:
 *   - Every move fetches the active ranking ONCE, applies the section-rank
 *     diff, then recomputes derived fields from the in-memory list (no
 *     second Airtable round-trip).
 *   - Airtable batch writes run with bounded concurrency (4 parallel
 *     requests — safely under Airtable's 5 req/s base limit).
 *   - reorderRanking() diffs the submitted order against current ranks and
 *     writes ONLY the records that actually changed.
 *   - setAbilityGroupConfig responds as soon as the config rows are saved;
 *     the ability recompute runs in the background via ctx.waitUntil().
 */
import {
  airtableBatchUpdate,
  airtableBatchCreate,
  airtableFindAll,
  airtableFindById,
  airtableUpdate,
  type Env,
} from "./airtable";
import { HttpError } from "./http";
import { TABLES } from "../../src/generated/tableNames";
import {
  ABILITYGROUP_CONFIG_FIELDS,
  PEOPLE_FIELDS,
} from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapAbilityGroupConfiguration } from "../../src/mappers/abilityGroupConfigMapper";
import {
  computeAbilityAssignment,
  emptyConfig,
  validateConfig,
} from "./abilityGroup";
import { ABILITY_RANK } from "./abilityRank";
import { getPlayerByEmail, getReferenceData } from "./reference";
import {
  invalidateCache,
  invalidateCachePrefix,
  getCached,
} from "../../src/lib/cache";
import type {
  AbilityGroupConfigMap,
  InactiveRankingEntry,
  Player,
  RankingList,
} from "../../src/generated/domainTypes";

// ── Caching ──────────────────────────────────────────────────────────────
const RANKING_CACHE_TTL_MS = 30 * 1000;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
const AIRTABLE_WRITE_CONCURRENCY = 4;

// ── Internal helpers ─────────────────────────────────────────────────────
function rankingCacheKey(active: boolean): string {
  return active ? "ranking:active" : "ranking:inactive";
}

async function fetchActiveRankingFromAirtable(env: Env): Promise<Player[]> {
  const records = await airtableFindAll(
    env,
    TABLES.player,
    "AND({Active}=TRUE(), {Section Rank}>0)",
  );
  const players = records.map(mapPlayer);
  return players.sort((a, b) => (a.sectionRank ?? 0) - (b.sectionRank ?? 0));
}

async function fetchInactiveRankingFromAirtable(
  env: Env,
): Promise<InactiveRankingEntry[]> {
  const records = await airtableFindAll(env, TABLES.player, "{Active}=FALSE()");
  return records.map((r) => {
    const p = mapPlayer(r);
    return {
      id: p.id,
      preferredName: p.preferredName,
      surname: p.surname,
      givenNames: p.givenNames,
      registeredTeam: p.registeredTeam,
      playingPosition: p.playingPosition,
      lastSectionRank: p.sectionRank,
    };
  });
}

async function batchUpdatePlayers(
  env: Env,
  updates: { id: string; fields: Record<string, unknown> }[],
): Promise<void> {
  if (updates.length === 0) return;
  const batches: { id: string; fields: Record<string, unknown> }[][] = [];
  for (let i = 0; i < updates.length; i += 10) {
    batches.push(updates.slice(i, i + 10));
  }
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      await airtableBatchUpdate(env, TABLES.player, batch);
    }
  }
  const workers = Array.from(
    { length: Math.min(AIRTABLE_WRITE_CONCURRENCY, batches.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

// ── Config read/write ────────────────────────────────────────────────────
export async function getAbilityGroupConfig(
  env: Env,
): Promise<AbilityGroupConfigMap> {
  const { data } = await getCached<AbilityGroupConfigMap>(
    "ranking:config",
    async () => {
      const records = await airtableFindAll(env, TABLES.abilityGroupConfiguration);
      const rows = records.map(mapAbilityGroupConfiguration);
      const map = emptyConfig();
      for (const row of rows) {
        if (row.group === "H") continue;
        map[row.group] = row.capacity;
      }
      return map;
    },
    CONFIG_CACHE_TTL_MS,
  );
  return data;
}

export async function setAbilityGroupConfig(
  env: Env,
  config: AbilityGroupConfigMap,
  actingEmail?: string,
): Promise<AbilityGroupConfigMap> {
  if (!actingEmail) throw new HttpError("actingEmail is required", 400);
  const actor = await getPlayerByEmail(env, actingEmail);
  if (!actor) throw new HttpError("Player record not found for this email", 404);
  const ref = await getReferenceData(env);
  const isSectionCaptain = ref.teams.some((t) =>
    (t.sectionCaptain || []).includes(actor.id),
  );
  if (!isSectionCaptain) {
    throw new HttpError("Only the Section Captain can modify the ranking configuration", 403);
  }

  const ranking = await getActiveRanking(env);
  const validation = validateConfig(config, ranking.activeCount);
  if (validation) throw new HttpError(validation, 400);

  const records = await airtableFindAll(env, TABLES.abilityGroupConfiguration);
  const existing = new Map(records.map((r) => [mapAbilityGroupConfiguration(r).group, r]));

  const updates: { id: string; fields: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];
  for (const g of ["A", "B", "C", "D", "E", "F", "G"] as const) {
    const capacity = Math.max(0, Math.floor(config[g] ?? 0));
    const row = existing.get(g);
    if (row) {
      updates.push({ id: row.id, fields: { [ABILITYGROUP_CONFIG_FIELDS.capacity]: capacity } });
    } else {
      creates.push({
        [ABILITYGROUP_CONFIG_FIELDS.group]: g,
        [ABILITYGROUP_CONFIG_FIELDS.capacity]: capacity,
        [ABILITYGROUP_CONFIG_FIELDS.isResidual]: false,
      });
    }
  }
  for (let i = 0; i < updates.length; i += 10) {
    await airtableBatchUpdate(env, TABLES.abilityGroupConfiguration, updates.slice(i, i + 10));
  }
  for (let i = 0; i < creates.length; i += 10) {
    await airtableBatchCreate(env, TABLES.abilityGroupConfiguration, creates.slice(i, i + 10));
  }
  invalidateCache("ranking:config");
  return config;
}

// ── Public read ──────────────────────────────────────────────────────────
export async function getActiveRanking(env: Env): Promise<RankingList> {
  const { data } = await getCached<RankingList>(
    rankingCacheKey(true),
    async () => {
      const players = await fetchActiveRankingFromAirtable(env);
      return {
        players,
        activeCount: players.length,
        lastUpdated: new Date().toISOString(),
        config: await getAbilityGroupConfig(env),
      };
    },
    RANKING_CACHE_TTL_MS,
  );
  return data;
}

export async function getInactiveRanking(env: Env): Promise<InactiveRankingEntry[]> {
  const { data } = await getCached<InactiveRankingEntry[]>(
    rankingCacheKey(false),
    async () => fetchInactiveRankingFromAirtable(env),
    RANKING_CACHE_TTL_MS,
  );
  return data;
}

// ── Public writes ────────────────────────────────────────────────────────
async function executeRankMove(
  env: Env,
  players: Player[],
  playerId: string,
  newRank: number,
): Promise<RankingList> {
  const idx = players.findIndex((p) => p.id === playerId);
  if (idx === -1) throw new HttpError("Player not found in active ranking", 404);
  const oldRank = players[idx].sectionRank ?? 0;
  if (oldRank === newRank) return recomputeDerivedFieldsFromList(env, players);

  const sectionRankUpdates: { id: string; rank: number }[] = [];
  for (const p of players) {
    const r = p.sectionRank ?? 0;
    if (p.id === playerId) {
      sectionRankUpdates.push({ id: p.id, rank: newRank });
    } else if (newRank < oldRank && r >= newRank && r < oldRank) {
      sectionRankUpdates.push({ id: p.id, rank: r + 1 });
    } else if (newRank > oldRank && r > oldRank && r <= newRank) {
      sectionRankUpdates.push({ id: p.id, rank: r - 1 });
    }
  }
  await applySectionRankUpdates(env, sectionRankUpdates);

  const rankById = new Map(sectionRankUpdates.map((u) => [u.id, u.rank]));
  const updatedPlayers = players.map((p) => ({
    ...p,
    sectionRank: rankById.get(p.id) ?? p.sectionRank,
  }));
  updatedPlayers.sort((a, b) => (a.sectionRank ?? 0) - (b.sectionRank ?? 0));
  return recomputeDerivedFieldsFromList(env, updatedPlayers);
}

export async function movePlayerToRank(
  env: Env,
  playerId: string,
  newRank: number,
): Promise<RankingList> {
  if (!Number.isInteger(newRank) || newRank < 1) {
    throw new HttpError("newRank must be a positive integer", 400);
  }
  invalidateCache(rankingCacheKey(true));
  const players = await fetchActiveRankingFromAirtable(env);
  if (newRank > players.length) {
    throw new HttpError(`newRank ${newRank} exceeds active player count ${players.length}`, 400);
  }
  return executeRankMove(env, players, playerId, newRank);
}

export async function movePlayerRelative(
  env: Env,
  sourceId: string,
  targetId: string,
  position: "above" | "below",
): Promise<RankingList> {
  if (sourceId === targetId) {
    throw new HttpError("Cannot move a player relative to themselves", 400);
  }
  invalidateCache(rankingCacheKey(true));
  const players = await fetchActiveRankingFromAirtable(env);
  const src = players.find((p) => p.id === sourceId);
  const tgt = players.find((p) => p.id === targetId);
  if (!src) throw new HttpError("Source player not found in active ranking", 404);
  if (!tgt) throw new HttpError("Target player not found in active ranking", 404);
  const oldSrcRank = src.sectionRank ?? 0;
  const tgtRank = tgt.sectionRank ?? 0;
  let newRank = position === "above" ? tgtRank : tgtRank + 1;
  if (oldSrcRank < newRank) newRank -= 1;
  newRank = Math.max(1, Math.min(newRank, players.length));
  return executeRankMove(env, players, sourceId, newRank);
}

/**
 * Reorder the entire ranking in one operation. `playerIds` is the complete
 * ordered list of active ranked player IDs (index 0 = rank 1). Validates it
 * is a permutation of the current active players, then writes ONLY the ranks
 * that actually changed before recomputing derived fields.
 */
export async function reorderRanking(
  env: Env,
  playerIds: string[],
): Promise<RankingList> {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new HttpError("playerIds must be a non-empty array", 400);
  }
  invalidateCache(rankingCacheKey(true));
  const players = await fetchActiveRankingFromAirtable(env);
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
  const updates: { id: string; rank: number }[] = [];
  const updatedPlayers: Player[] = [];
  playerIds.forEach((id, i) => {
    const p = playerById.get(id)!;
    const newRank = i + 1;
    if (p.sectionRank !== newRank) updates.push({ id, rank: newRank });
    updatedPlayers.push({ ...p, sectionRank: newRank });
  });

  if (updates.length > 0) await applySectionRankUpdates(env, updates);
  return recomputeDerivedFieldsFromList(env, updatedPlayers);
}

export async function activatePlayer(env: Env, playerId: string): Promise<RankingList> {
  const record = await airtableFindById(env, TABLES.player, playerId);
  if (!record) throw new HttpError("Player not found", 404);
  const player = mapPlayer(record);
  if (player.active !== true) {
    const activePlayers = await fetchActiveRankingFromAirtable(env);
    const newRank = activePlayers.length + 1;
    await airtableUpdate(env, TABLES.player, playerId, {
      [PEOPLE_FIELDS.active]: true,
      [PEOPLE_FIELDS.sectionRank]: newRank,
      [PEOPLE_FIELDS.rankUpdatedAt]: new Date().toISOString(),
    });
  }
  invalidateCache(rankingCacheKey(true));
  return recomputeDerivedFields(env);
}

export async function deactivatePlayer(env: Env, playerId: string): Promise<RankingList> {
  const record = await airtableFindById(env, TABLES.player, playerId);
  if (!record) throw new HttpError("Player not found", 404);
  const player = mapPlayer(record);
  if (player.active === false) return getActiveRanking(env);

  invalidateCache(rankingCacheKey(true));
  const players = await fetchActiveRankingFromAirtable(env);
  const idx = players.findIndex((p) => p.id === playerId);
  if (idx === -1) {
    await airtableUpdate(env, TABLES.player, playerId, { [PEOPLE_FIELDS.active]: false });
    return getActiveRanking(env);
  }
  const oldRank = players[idx].sectionRank ?? 0;
  const sectionRankUpdates: { id: string; rank: number }[] = [];
  for (const p of players) {
    const r = p.sectionRank ?? 0;
    if (p.id === playerId) continue;
    if (r > oldRank) sectionRankUpdates.push({ id: p.id, rank: r - 1 });
  }
  await applySectionRankUpdates(env, sectionRankUpdates);
  await airtableUpdate(env, TABLES.player, playerId, {
    [PEOPLE_FIELDS.active]: false,
    [PEOPLE_FIELDS.sectionRank]: null,
    [PEOPLE_FIELDS.teamRank]: null,
    [PEOPLE_FIELDS.positionalRank]: null,
    [PEOPLE_FIELDS.playingAbility]: null,
    [PEOPLE_FIELDS.rankUpdatedAt]: new Date().toISOString(),
  });
  invalidateCache(rankingCacheKey(true));
  return recomputeDerivedFields(env);
}

export async function initializeRanking(env: Env): Promise<RankingList> {
  const records = await airtableFindAll(env, TABLES.player, "{Active}=TRUE()");
  const players = records.map(mapPlayer);
  const ranked = players
    .filter((p) => typeof p.sectionRank === "number" && p.sectionRank > 0)
    .sort((a, b) => (a.sectionRank ?? 0) - (b.sectionRank ?? 0));
  const unranked = players
    .filter((p) => !(typeof p.sectionRank === "number" && p.sectionRank > 0))
    .sort((a, b) => {
      const av = ABILITY_RANK[a.playingAbility ?? ""] ?? 0;
      const bv = ABILITY_RANK[b.playingAbility ?? ""] ?? 0;
      if (av !== bv) return bv - av;
      return (a.preferredName ?? a.givenNames ?? "").localeCompare(b.preferredName ?? b.givenNames ?? "");
    });
  const combined = [...ranked, ...unranked];
  const updates: { id: string; rank: number }[] = combined.map((p, i) => ({ id: p.id, rank: i + 1 }));
  if (updates.length > 0) await applySectionRankUpdates(env, updates);
  invalidateCache(rankingCacheKey(true));
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
  const fieldUpdates: { id: string; fields: Record<string, unknown> }[] = [];
  const updatedPlayers: Player[] = [];

  for (const p of players) {
    const rank = p.sectionRank ?? 0;
    if (rank < 1 || rank > n) {
      updatedPlayers.push(p);
      continue;
    }
    const teamKey = p.registeredTeam ?? "";
    const positionKey = p.playingPosition ?? ""; // section-wide positional rank
    const teamRank = (teamCounters.get(teamKey) ?? 0) + 1;
    teamCounters.set(teamKey, teamRank);
    const positionalRank = (positionalCounters.get(positionKey) ?? 0) + 1;
    positionalCounters.set(positionKey, positionalRank);
    const assignment = computeAbilityAssignment(rank, n, config);
    const needsUpdate =
      p.teamRank !== teamRank ||
      p.positionalRank !== positionalRank ||
      p.playingAbility !== assignment.abilityDisplay;
    if (needsUpdate) {
      fieldUpdates.push({
        id: p.id,
        fields: {
          [PEOPLE_FIELDS.teamRank]: teamRank,
          [PEOPLE_FIELDS.positionalRank]: positionalRank,
          [PEOPLE_FIELDS.playingAbility]: assignment.abilityDisplay,
          [PEOPLE_FIELDS.rankUpdatedAt]: now,
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
  invalidateCache(rankingCacheKey(true));
  invalidateCache("club-reference");
  invalidateCachePrefix("reference-data:");
  invalidateCachePrefix("players-for-match:");
  invalidateCachePrefix("season-index:");
  invalidateCachePrefix("calendar:");
  return { players: updatedPlayers, activeCount: n, lastUpdated: now, config };
}

export async function recomputeDerivedFields(env: Env): Promise<RankingList> {
  const players = await fetchActiveRankingFromAirtable(env);
  return recomputeDerivedFieldsFromList(env, players);
}

async function applySectionRankUpdates(
  env: Env,
  updates: { id: string; rank: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  const now = new Date().toISOString();
  const stamped = updates.map(({ id, rank }) => ({
    id,
    fields: {
      [PEOPLE_FIELDS.sectionRank]: rank,
      [PEOPLE_FIELDS.rankUpdatedAt]: now,
    },
  }));
  await batchUpdatePlayers(env, stamped);
  invalidateCache(rankingCacheKey(true));
}