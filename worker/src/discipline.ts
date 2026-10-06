/**
 * The Men's Convenor's suspensions (Supabase backend): red cards and
 * Disciplinary Committee decisions, which suspension.ts deliberately leaves
 * manual. Gated on the "discipline" section (auth.ts), which only the
 * Hockey Convenor office opens (owner, 6 Oct 2026).
 *
 * Each write is one SQL function (admin_save_suspension,
 * admin_clear_suspension) that also writes its activity_log row, field
 * names only. Serving is counted here and in eligibility by
 * suspension.ts manualSuspensionProgress.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, inList, SupabaseError } from "./data/supabase";
import { invalidateCachePrefix, invalidateShared } from "./cache";
import { invalidatePeople } from "./invalidation";
import { currentSeason, getSeasonContext, MANUAL_SUSPENSIONS_KEY } from "./seasonContext";
import { manualSuspensionProgress, servingFixtureDatesByTeam } from "./suspension";
import {
  CLEARED_DAYS,
  MAX_SUSPENSION_MATCHES,
  MAX_SUSPENSION_REASON,
  type CardSuspensionRow,
  type LegacySuspensionRow,
  type SuspensionRow,
  type SuspensionsBoard,
} from "../../shared/discipline";

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("Suspensions are on the Supabase backend only.", 409, "NOT_YET");
  }
}

interface ApiSuspension {
  id: string;
  player: string;
  matches: number | null;
  from_date: string;
  serving_team: string;
  reason: string;
  created_at: string;
  created_by: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  clear_reason: string | null;
}

interface PersonRow {
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  registered_team: string | null;
  is_suspended: boolean;
  matches_to_serve: number | null;
}

const nameOf = (p: PersonRow | undefined) =>
  (p && [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ")) || "(no name)";

/**
 * Open suspensions (served or not), those cleared in the last 90 days, the
 * automatic card suspensions in force, and any old hand-set flag still set.
 */
export async function getSuspensionsBoard(env: Env, now = new Date()): Promise<SuspensionsBoard> {
  requireSupabase(env);
  const d = db(env);
  // api_suspensions gives timestamps as ISO text, which compare in order.
  const since = new Date(now.getTime() - CLEARED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [rows, season] = await Promise.all([
    d.select<ApiSuspension>(
      "api_suspensions",
      `select=*&or=(cleared_at.is.null,cleared_at.gte.${encodeURIComponent(since)})&order=created_at.desc`,
    ),
    getSeasonContext(env, currentSeason(now)),
  ]);

  const cardStates = [...season.suspensionByPlayer].filter(([, s]) => s.active);
  const ids = new Set<string>();
  for (const r of rows) for (const id of [r.player, r.created_by, r.cleared_by]) if (id) ids.add(id);
  for (const [id] of cardStates) ids.add(id);
  const filters = ["is_suspended.is.true", "matches_to_serve.gt.0"];
  if (ids.size > 0) filters.unshift(`api_id.${inList([...ids])}`);
  const people = await d.select<PersonRow>(
    "people",
    `select=id,api_id,preferred_name,given_names,surname,registered_team,is_suspended,matches_to_serve&or=(${filters.join(",")})`,
  );
  const byId = new Map(people.map((p) => [p.api_id, p]));

  const datesByTeam = servingFixtureDatesByTeam([...season.previousMatches, ...season.allMatches]);
  const toRow = (r: ApiSuspension): SuspensionRow => {
    const progress = manualSuspensionProgress(
      { matches: r.matches, fromDate: r.from_date, servingTeam: r.serving_team },
      datesByTeam,
    );
    return {
      id: r.id,
      player: r.player,
      name: nameOf(byId.get(r.player)),
      servingTeam: r.serving_team,
      matches: r.matches,
      fromDate: r.from_date,
      reason: r.reason,
      served: progress.served,
      remaining: progress.remaining,
      active: !r.cleared_at && progress.active,
      createdAt: r.created_at,
      createdBy: r.created_by ? nameOf(byId.get(r.created_by)) : null,
      clearedAt: r.cleared_at,
      clearedBy: r.cleared_by ? nameOf(byId.get(r.cleared_by)) : null,
      clearReason: r.clear_reason,
    };
  };

  const open = rows.filter((r) => !r.cleared_at).map(toRow);
  const cleared = rows
    .filter((r) => r.cleared_at)
    .sort((a, b) => (b.cleared_at ?? "").localeCompare(a.cleared_at ?? ""))
    .map(toRow);
  const cards: CardSuspensionRow[] = cardStates
    .map(([player, s]) => ({
      player,
      name: nameOf(byId.get(player)),
      servingTeam: s.servingTeam,
      remainingMatches: s.remainingMatches,
      points: s.points,
      dcReferral: s.dcReferral,
      indeterminate: s.serviceStatus === "indeterminate",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const legacy: LegacySuspensionRow[] = people
    .filter((p) => p.is_suspended || (p.matches_to_serve ?? 0) > 0)
    .map((p) => ({
      player: p.api_id,
      name: nameOf(p),
      team: p.registered_team,
      isSuspended: p.is_suspended,
      matchesToServe: p.matches_to_serve,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { open, cleared, cards, legacy };
}

// ── Input ───────────────────────────────────────────────────────────────

const API_ID = /^[A-Za-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bad = (message: string) => new HttpError(message, 400, "INVALID_INPUT");

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
}

function parseMatches(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_SUSPENSION_MATCHES) {
    throw bad(`Matches: 1 to ${MAX_SUSPENSION_MATCHES}, or until cleared.`);
  }
  return v;
}

function parseReason(v: unknown): string {
  const reason = typeof v === "string" ? v.trim() : "";
  if (!reason) throw bad("Give a reason.");
  if (reason.length > MAX_SUSPENSION_REASON) throw bad(`Reason: at most ${MAX_SUSPENSION_REASON} characters.`);
  return reason;
}

function parseTeam(v: unknown): string {
  const team = typeof v === "string" ? v.trim() : "";
  if (!team || team.length > 60) throw bad("Choose the serving team.");
  return team;
}

function parseFromDate(v: unknown): string {
  if (!isDate(v)) throw bad("Choose the start date.");
  return v;
}

/** The SQL function's input for a new suspension. servingTeam defaults to the registered team. */
export function parseNewSuspension(body: Record<string, unknown>): Record<string, unknown> {
  const player = typeof body.playerId === "string" && API_ID.test(body.playerId) ? body.playerId : null;
  if (!player) throw bad("Choose a player.");
  if (!("matches" in body)) throw bad(`Matches: 1 to ${MAX_SUSPENSION_MATCHES}, or until cleared.`);
  const p: Record<string, unknown> = {
    player,
    matches: parseMatches(body.matches),
    fromDate: parseFromDate(body.fromDate),
    reason: parseReason(body.reason),
  };
  if (body.servingTeam !== undefined && body.servingTeam !== null && body.servingTeam !== "") {
    p.servingTeam = parseTeam(body.servingTeam);
  }
  return p;
}

/** The SQL function's input for a change: only the fields sent. */
export function parseSuspensionChange(id: string, body: Record<string, unknown>): Record<string, unknown> {
  if (!UUID.test(id)) throw new HttpError("Suspension not found.", 404, "NOT_FOUND");
  const p: Record<string, unknown> = { id };
  if ("matches" in body) p.matches = parseMatches(body.matches);
  if ("fromDate" in body) p.fromDate = parseFromDate(body.fromDate);
  if ("servingTeam" in body) p.servingTeam = parseTeam(body.servingTeam);
  if ("reason" in body) p.reason = parseReason(body.reason);
  if (Object.keys(p).length === 1) throw bad("Nothing to save.");
  return p;
}

// ── Writes ──────────────────────────────────────────────────────────────

/** Plain words for what the SQL functions refuse. */
function mapError(err: unknown): never {
  if (err instanceof SupabaseError) {
    if (err.code === "P0002") throw new HttpError("Suspension or player not found.", 404, "NOT_FOUND");
    if (err.code === "22023") throw bad("Choose the serving team.");
    if (err.code === "23503") throw bad("That team isn't one of ours.");
    if (["23514", "23502", "22P02", "22007", "22008", "22003"].includes(err.code ?? "")) throw bad("Check the details and try again.");
  }
  throw err;
}

/**
 * Eligibility reads the open suspensions through the season index; the
 * player lists are built from it. A new suspension can also clear an old
 * People flag, so that one drops the People caches too.
 */
async function invalidate(env: Env, peopleChanged: boolean): Promise<void> {
  await invalidateShared(env, [MANUAL_SUSPENSIONS_KEY]);
  if (peopleChanged) {
    await invalidatePeople(env);
  } else {
    invalidateCachePrefix("season-index:");
    invalidateCachePrefix("players-for-match:");
  }
}

export async function createSuspension(
  env: Env,
  actor: AuthorizedUser,
  body: Record<string, unknown>,
): Promise<{ ok: true; id: string }> {
  requireSupabase(env);
  const p = parseNewSuspension(body);
  const id = await db(env).rpc<string>("admin_save_suspension", { p, p_actor: actor.personId }).catch(mapError);
  await invalidate(env, true);
  return { ok: true, id };
}

export async function updateSuspension(
  env: Env,
  actor: AuthorizedUser,
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: true }> {
  requireSupabase(env);
  const p = parseSuspensionChange(id, body);
  await db(env).rpc<string>("admin_save_suspension", { p, p_actor: actor.personId }).catch(mapError);
  await invalidate(env, false);
  return { ok: true };
}

export async function clearSuspension(
  env: Env,
  actor: AuthorizedUser,
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: true }> {
  requireSupabase(env);
  if (!UUID.test(id)) throw new HttpError("Suspension not found.", 404, "NOT_FOUND");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > MAX_SUSPENSION_REASON) throw bad(`Reason: at most ${MAX_SUSPENSION_REASON} characters.`);
  await db(env)
    .rpc<null>("admin_clear_suspension", { p_id: id, p_actor: actor.personId, p_reason: reason || null })
    .catch(mapError);
  await invalidate(env, false);
  return { ok: true };
}
