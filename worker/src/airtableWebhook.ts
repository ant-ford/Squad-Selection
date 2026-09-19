/**
 * Airtable change notifications -> targeted cache invalidation.
 *
 * Until now an edit made directly in Airtable (a result entered, a player
 * moved between teams, an availability row corrected) reached the app only
 * when a cache expired, so every raw table read lived for five or ten
 * minutes and was then re-read in full - on a base where People alone is a
 * three-hundred-field CRM. With a webhook announcing those edits the TTLs
 * can be hours (cache.ts rawReadTtl) and a table is re-read when it changes.
 *
 * How Airtable webhooks work, in the parts that matter here:
 *
 *   - Airtable POSTs a small "ping" - base id, webhook id, timestamp - and
 *     nothing about WHAT changed. The ping is signed: X-Airtable-Content-MAC
 *     carries an HMAC-SHA256 of the raw body under the webhook's MAC secret.
 *   - The changes themselves are fetched from the payloads endpoint with a
 *     cursor, which advances as payloads are consumed. Each payload names the
 *     changed tables by id (TABLE_IDS maps them back to names).
 *   - A webhook expires seven days after its last refresh, so it is
 *     refreshed on every ping and once a day from the cron trigger.
 *
 * Set-up is scripts/register-airtable-webhook.mjs; the ids it prints go in
 * AIRTABLE_WEBHOOK_ID (a var) and AIRTABLE_WEBHOOK_SECRET (a secret).
 * Without both the route answers 404 and nothing here runs.
 */
import { airtableBaseRequest } from "./airtable";
import { invalidateCachePrefix, invalidateShared } from "./cache";
import type { Env } from "./env";
import { TABLE_IDS, TABLES } from "../../shared/schema/tableNames";
import { inBackground } from "./requestContext";

export const WEBHOOK_ROUTE = "/api/internal/airtable-webhook";
const CURSOR_KEY = "airtable-webhook:cursor";
const MAC_HEADER = "X-Airtable-Content-MAC";

export function webhookConfigured(env: Env): boolean {
  return Boolean(env.AIRTABLE_WEBHOOK_ID && env.AIRTABLE_WEBHOOK_SECRET);
}

/** HMAC-SHA256 of `body` under the base64 MAC secret, as lowercase hex. */
export async function signWebhookBody(secretBase64: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cache keys and prefixes each table's edit invalidates. Shared entries are
 * dropped in KV as well; in-isolate-only derived structures (season index,
 * per-match player lists, calendar feeds, the 25 s poll cache) are dropped
 * here and rebuilt from the freshly re-read raw tables.
 */
const INVALIDATION: Record<string, { keys?: string[]; sharedPrefixes?: string[]; localPrefixes?: string[] }> = {
  [TABLES.player]: {
    keys: ["club-reference", "ranking:active", "ranking:inactive"],
    sharedPrefixes: ["player-by-email:"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:", "ranking-events:"],
  },
  [TABLES.team]: {
    keys: ["club-reference", "team-coach-links"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:"],
  },
  [TABLES.match]: {
    keys: ["scheduled-matches"],
    sharedPrefixes: ["all-matches:", "played-matches:"],
    localPrefixes: ["match:", "players-for-match:", "season-index:", "calendar:", "availability:"],
  },
  [TABLES.matchCard]: {
    sharedPrefixes: ["match-cards:"],
    localPrefixes: ["players-for-match:", "season-index:", "calendar:"],
  },
  [TABLES.availabilityException]: {
    sharedPrefixes: ["exceptions:"],
    localPrefixes: ["availability:", "players-for-match:", "season-index:", "calendar:"],
  },
  [TABLES.availabilityRule]: {
    keys: ["availability-rules"],
    localPrefixes: ["players-for-match:", "calendar:"],
  },
  [TABLES.abilityGroupConfiguration]: {
    keys: ["ranking:config", "ranking:active"],
  },
  "Ranking Events": {
    localPrefixes: ["ranking-events:"],
  },
};

/** Drop every cache an edit to these tables can have made stale. */
export async function invalidateForTables(env: Env, tables: Iterable<string>): Promise<void> {
  const keys = new Set<string>();
  const sharedPrefixes = new Set<string>();
  for (const table of tables) {
    const rule = INVALIDATION[table];
    if (!rule) continue;
    for (const k of rule.keys ?? []) keys.add(k);
    for (const p of rule.sharedPrefixes ?? []) sharedPrefixes.add(p);
    for (const p of rule.localPrefixes ?? []) invalidateCachePrefix(p);
  }
  if (keys.size === 0 && sharedPrefixes.size === 0) return;
  await invalidateShared(env, [...keys], [...sharedPrefixes]);
}

interface PayloadPage {
  payloads?: { changedTablesById?: Record<string, unknown>; createdTablesById?: Record<string, unknown>; destroyedTableIds?: string[] }[];
  cursor?: number;
  mightHaveMore?: boolean;
}

/**
 * Consume every payload since the stored cursor and return the names of the
 * tables they touched. Tables the app does not cache (the CRM side of the
 * base) come back too and are simply ignored by invalidateForTables.
 */
export async function fetchChangedTables(env: Env): Promise<Set<string>> {
  const kv = env.CACHE;
  let cursor = 1;
  if (kv) {
    const stored = (await kv.get(CURSOR_KEY, { type: "json" })) as number | null;
    if (typeof stored === "number" && stored > 0) cursor = stored;
  }
  const changed = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const result = await airtableBaseRequest<PayloadPage>(
      env,
      `webhooks/${env.AIRTABLE_WEBHOOK_ID}/payloads?cursor=${cursor}&limit=50`,
    );
    if (!result) break;
    for (const payload of result.payloads ?? []) {
      for (const id of [
        ...Object.keys(payload.changedTablesById ?? {}),
        ...Object.keys(payload.createdTablesById ?? {}),
        ...(payload.destroyedTableIds ?? []),
      ]) {
        changed.add(TABLE_IDS[id] ?? id);
      }
    }
    if (typeof result.cursor === "number") cursor = result.cursor;
    if (!result.mightHaveMore) break;
  }
  if (kv) {
    // No TTL: the cursor must outlive every cache entry.
    await kv.put(CURSOR_KEY, JSON.stringify(cursor));
  }
  return changed;
}

/** Push the webhook's expiry out another seven days. */
export async function refreshAirtableWebhook(env: Env): Promise<void> {
  if (!webhookConfigured(env)) return;
  try {
    await airtableBaseRequest(env, `webhooks/${env.AIRTABLE_WEBHOOK_ID}/refresh`, { method: "POST" });
  } catch (err) {
    console.error("Airtable webhook refresh failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * The notification endpoint. Verifies the signature, works out which tables
 * changed, drops their caches, and refreshes the webhook in the background.
 *
 * Answers 200 as soon as the invalidation is done: Airtable retries a ping
 * it could not deliver, and a retry storm on a slow handler would only make
 * things worse. If the payloads cannot be read at all, every cached table is
 * dropped instead - a full re-read is the pre-webhook behaviour, so it is
 * the safe fallback.
 */
export async function handleAirtableWebhook(request: Request, env: Env): Promise<Response> {
  if (!webhookConfigured(env)) return new Response("Not Found", { status: 404 });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await request.text();
  const header = request.headers.get(MAC_HEADER) || "";
  const presented = header.replace(/^hmac-sha256=/i, "").trim().toLowerCase();
  const expected = await signWebhookBody(env.AIRTABLE_WEBHOOK_SECRET!, body);
  if (!presented || !constantTimeEqual(presented, expected)) {
    console.warn("Airtable webhook: rejected ping with a bad or missing signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let ping: { webhook?: { id?: string } } = {};
  try {
    ping = JSON.parse(body);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (ping.webhook?.id && ping.webhook.id !== env.AIRTABLE_WEBHOOK_ID) {
    console.warn(`Airtable webhook: ping for ${ping.webhook.id}, configured for ${env.AIRTABLE_WEBHOOK_ID}`);
    return new Response("Unauthorized", { status: 401 });
  }

  let tables: Set<string>;
  try {
    tables = await fetchChangedTables(env);
  } catch (err) {
    console.error("Airtable webhook: payload read failed, invalidating every table:", err instanceof Error ? err.message : err);
    tables = new Set(Object.keys(INVALIDATION));
  }
  const cached = [...tables].filter((t) => t in INVALIDATION);
  await invalidateForTables(env, cached);
  console.log(`Airtable webhook: invalidated ${JSON.stringify(cached)}`);

  void inBackground(() => refreshAirtableWebhook(env));
  return new Response(JSON.stringify({ invalidated: cached }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
