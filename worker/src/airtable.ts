// Low-level Airtable REST client for the Worker.
import type { Env } from "./env";
import { recordAirtableCall } from "./requestContext";
import { TABLES } from "../../shared/schema/tableNames";
import {
  ABILITYGROUP_CONFIG_FIELDS,
  AVAILABILITYEXCEPTIONS_FIELDS,
  AVAILABILITYRULES_FIELDS,
  MATCHCARDS_FIELDS,
  MATCHES_FIELDS,
  PEOPLE_FIELDS,
  TEAMS_FIELDS,
} from "../../shared/schema/fieldMaps";

const AIRTABLE_API = "https://api.airtable.com/v0";

/**
 * Fields requested from each table on a list read.
 *
 * Without a projection Airtable returns every field of every record. People
 * is a 300-plus-field membership CRM (attachments, lookups, formulas, Fillout
 * links), and the app reads under thirty of them - so every reference-data
 * or ranking read was downloading the whole CRM, and got slower each time a
 * field was added for a purpose that had nothing to do with squads. The
 * projection is the field map itself, so a field the mapper starts reading
 * is requested automatically, and one it never reads is never sent.
 *
 * Tables without an entry (Ranking Events keeps its own field list in
 * rankingEvents.ts) are read in full unless the caller passes `fields`.
 */
const PROJECTIONS: Record<string, readonly string[]> = {
  [TABLES.player]: Object.values(PEOPLE_FIELDS),
  [TABLES.team]: Object.values(TEAMS_FIELDS),
  [TABLES.match]: Object.values(MATCHES_FIELDS),
  [TABLES.matchCard]: Object.values(MATCHCARDS_FIELDS),
  [TABLES.availabilityException]: Object.values(AVAILABILITYEXCEPTIONS_FIELDS),
  [TABLES.availabilityRule]: Object.values(AVAILABILITYRULES_FIELDS),
  [TABLES.abilityGroupConfiguration]: Object.values(ABILITYGROUP_CONFIG_FIELDS),
};

export function projectionFor(table: string): readonly string[] | undefined {
  return PROJECTIONS[table];
}

export class AirtableError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AirtableError";
    this.status = status;
  }
}

function tableUrl(env: Env, table: string) {
  return `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

const MAX_RATE_LIMIT_RETRIES = 2;

async function airtableFetch<T>(env: Env, url: string, init?: RequestInit): Promise<T | null> {
  let response: Response;
  let rateLimited = 0;
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;

    rateLimited += 1;
    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000;
    // Logged so contention from the base's OTHER consumers (Fillout, Make,
    // automations) is visible: from inside the Worker a 429 otherwise just
    // looks like a slow request.
    console.warn(`Airtable 429 on ${init?.method ?? "GET"} ${tableFromUrl(url)}; retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    recordAirtableCall(Date.now() - startedAt, body.length, rateLimited);
    throw new AirtableError(
      `Airtable ${init?.method ?? "GET"} ${url} failed (${response.status}): ${body}`,
      response.status
    );
  }

  if (response.status === 204) {
    recordAirtableCall(Date.now() - startedAt, 0, rateLimited);
    return null;
  }
  const text = await response.text();
  recordAirtableCall(Date.now() - startedAt, text.length, rateLimited);
  return JSON.parse(text) as T;
}

/** Table segment of an Airtable URL, for logs - never the base id or token. */
function tableFromUrl(url: string): string {
  const m = url.match(/\/v0\/[^/]+\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : "?";
}

/**
 * Single page of records (max 100, or whatever `params.pageSize` says).
 *
 * `fields` narrows the columns returned; when omitted the table's projection
 * (see PROJECTIONS) applies, and a table with neither is read in full.
 */
/**
 * Fields Airtable has told us do not exist, per table.
 *
 * `shared/schema/` is hand-maintained against the base (invariant 8), so it
 * can legitimately run ahead of it: a field is mapped in the code before an
 * administrator has added it, or someone renames one in Airtable. Because
 * the projection is derived from that map, either case would otherwise make
 * EVERY read of that table fail with 422 - the People table alone backs
 * authorization, so the whole app would go down over one absent checkbox.
 *
 * Instead the unknown field is dropped and the read retried, once per field
 * per isolate, with a loud log. A field the base does not have is one the
 * mapper reads as undefined, which is what it would have been anyway.
 */
const missingFields = new Map<string, Set<string>>();

/** Field name from Airtable's UNKNOWN_FIELD_NAME message, if that is the error. */
function unknownFieldFrom(err: unknown): string | null {
  if (!(err instanceof AirtableError) || err.status !== 422) return null;
  if (!err.message.includes("UNKNOWN_FIELD_NAME")) return null;
  // The name arrives inside the raw JSON body, so its quotes are still
  // backslash-escaped: Unknown field name: \"Opt-In Only\"
  const m = err.message.match(/Unknown field names?:\s*[\\"]*([^"\\]+)/i);
  return m ? m[1].trim() : null;
}

export async function airtableList(
  env: Env,
  table: string,
  params?: Record<string, string>,
  fields?: readonly string[],
): Promise<{ records: any[]; offset?: string }> {
  const requested = fields ?? PROJECTIONS[table] ?? [];

  for (let attempt = 0; ; attempt++) {
    const absent = missingFields.get(table);
    const search = new URLSearchParams(params);
    for (const field of requested) {
      if (absent?.has(field)) continue;
      search.append("fields[]", field);
    }
    try {
      const result = await airtableFetch<{ records: any[]; offset?: string }>(
        env,
        `${tableUrl(env, table)}?${search.toString()}`,
      );
      if (!result) throw new Error("Unexpected null Airtable response");
      return result;
    } catch (err) {
      const unknown = attempt < requested.length ? unknownFieldFrom(err) : null;
      // Only a field WE asked for is safe to drop. Anything else - a rename
      // inside a formula, say - is a real error and must still surface.
      if (!unknown || !requested.includes(unknown)) throw err;
      console.error(
        `Airtable has no field "${unknown}" on ${table}. Dropping it from the read and ` +
          `retrying; add it in Airtable or correct shared/schema/fieldMaps.ts.`,
      );
      const set = missingFields.get(table) ?? new Set<string>();
      set.add(unknown);
      missingFields.set(table, set);
    }
  }
}

/** Test seam: forget which fields Airtable said were missing. */
export function resetMissingFieldCache(): void {
  missingFields.clear();
}

/** Fetches every record matching an optional formula, following pagination. */
export async function airtableFindAll(
  env: Env,
  table: string,
  filterByFormula?: string,
  extraParams?: Record<string, string>,
  fields?: readonly string[],
): Promise<any[]> {
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { pageSize: "100" };
    if (filterByFormula) params.filterByFormula = filterByFormula;
    if (extraParams) Object.assign(params, extraParams);
    if (offset) params.offset = offset;
    const page = await airtableList(env, table, params, fields);
    records.push(...(page.records ?? []));
    offset = page.offset;
  } while (offset);
  return records;
}

export async function airtableFindById(
  env: Env,
  table: string,
  id: string
): Promise<any | null> {
  try {
    return await airtableFetch(env, `${tableUrl(env, table)}/${id}`);
  } catch (err) {
    if (err instanceof AirtableError && err.status === 404) return null;
    throw err;
  }
}

export async function airtableCreate(
  env: Env,
  table: string,
  fields: Record<string, unknown>
): Promise<any> {
  return airtableFetch(env, tableUrl(env, table), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export async function airtableUpdate(
  env: Env,
  table: string,
  id: string,
  fields: Record<string, unknown>
): Promise<any> {
  return airtableFetch(env, `${tableUrl(env, table)}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function airtableDelete(
  env: Env,
  table: string,
  id: string
): Promise<void> {
  await airtableFetch(env, `${tableUrl(env, table)}/${id}`, {
    method: "DELETE",
  });
}

/** Batch create up to 10 records in a single request. */
export async function airtableBatchCreate(
  env: Env,
  table: string,
  records: Record<string, unknown>[]
): Promise<any> {
  return airtableFetch(env, tableUrl(env, table), {
    method: "POST",
    body: JSON.stringify({ records: records.map(fields => ({ fields })) }),
  });
}

/** Batch update up to 10 records in a single request. */
export async function airtableBatchUpdate(
  env: Env,
  table: string,
  records: { id: string; fields: Record<string, unknown> }[]
): Promise<any> {
  return airtableFetch(env, tableUrl(env, table), {
    method: "PATCH",
    body: JSON.stringify({ records }),
  });
}

/** Batch delete up to 10 records in a single request. */
export async function airtableBatchDelete(
  env: Env,
  table: string,
  ids: string[]
): Promise<any> {
  // Airtable takes the ids as repeated QUERY parameters on a batch delete,
  // never as a JSON body. It ignores a body on DELETE entirely, so sending
  // one meant every batch delete came back 422 INVALID_RECORDS - "records
  // must be a non-empty array of record IDs" - against a URL with no query
  // string at all.
  //
  // The only caller is availability, where deleting the exception IS how a
  // player sets themselves Available. So that never worked for anyone.
  if (ids.length === 0) return null;
  const params = new URLSearchParams();
  for (const id of ids) params.append("records[]", id);
  return airtableFetch(env, `${tableUrl(env, table)}?${params.toString()}`, {
    method: "DELETE",
  });
}

/**
 * A request against the base itself rather than one of its tables - the
 * webhooks endpoints live at /v0/bases/{baseId}/webhooks/... (see
 * airtableWebhook.ts). Same auth, retry and instrumentation as table reads.
 */
export async function airtableBaseRequest<T>(env: Env, pathUnderBase: string, init?: RequestInit): Promise<T | null> {
  return airtableFetch<T>(env, `${AIRTABLE_API}/bases/${env.AIRTABLE_BASE_ID}/${pathUnderBase}`, init);
}

/** Guards against breaking a filterByFormula string via embedded quotes. */
export function escapeFormulaValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

// Re-export from the shared neutral module
export { linkId } from "../../shared/airtableValueUtils";