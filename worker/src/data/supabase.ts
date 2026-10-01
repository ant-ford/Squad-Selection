/**
 * The Worker's client for Eddy's data in Supabase: PostgREST over fetch.
 *
 * Plain fetch rather than a Postgres driver, because the Worker is on the
 * free plan (10 ms of CPU a request): an HTTP call costs waiting time, not
 * CPU, and needs no connection pool. Multi-row writes that must succeed or
 * fail together (a ranking reorder, a squad save) are SQL functions called
 * with rpc(), so each is one transaction.
 *
 * Authentication is the project's secret key, sent only in the apikey header
 * (Supabase refuses a secret key in Authorization). The key belongs to the
 * service role, which bypasses RLS; every table has RLS on with no
 * policies, so nothing else can read them.
 */
import type { Env } from "../env";
import { recordDbCall } from "../requestContext";

export class SupabaseError extends Error {
  status: number;
  /** PostgREST / Postgres error code, e.g. "23505" for a unique violation. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SupabaseError";
    this.status = status;
    this.code = code;
  }
}

/** PostgREST caps a response at this many rows (Supabase's default max_rows). */
const PAGE = 1000;

/**
 * Answers after which a read is tried again: the gateway ones, and 500. Preview
 * testing saw sign-in lookups fail now and then with a small 500 that the
 * same read a moment later answered; a read is safe to repeat.
 */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 200;

/**
 * A 401 whose body is a PostgREST token error (PGRST301/PGRST303): Supabase's
 * gateway turns the secret key into a short-lived token per request, and now
 * and then PostgREST rejects that token (seen on preview, 2026-10-01: "401
 * PGRST303" on a first request, the same request a moment later fine). The
 * request was refused before it ran, so it is safe to repeat even a write.
 */
const TOKEN_REJECTED = /"code"\s*:\s*"PGRST30[13]"/;
const TOKEN_RETRIES = 2;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Db {
  /** Rows matching a PostgREST query string (select=...&col=eq.value), every page. */
  select<T>(table: string, query: string): Promise<T[]>;
  /** At most one row; null when none. */
  one<T>(table: string, query: string): Promise<T | null>;
  /** Inserts, returning the new rows. */
  insert<T>(table: string, rows: object[]): Promise<T[]>;
  /** Insert or update on the given unique columns, returning the rows. */
  upsert<T>(table: string, rows: object[], onConflict: string): Promise<T[]>;
  /** Updates the rows matching `filter`, returning them. */
  update<T>(table: string, filter: string, patch: object): Promise<T[]>;
  /** Deletes the rows matching `filter`. A filter is required: there is no delete-everything. */
  remove(table: string, filter: string): Promise<void>;
  /** Calls a SQL function (one transaction). */
  rpc<T>(fn: string, args: object): Promise<T>;
}

/** A value for a PostgREST eq/neq filter, safe for the query string. */
export const eq = (value: string | number | boolean) => `eq.${encodeURIComponent(String(value))}`;

/** A value list for an in.(...) filter; values are quoted so commas and brackets inside them are safe. */
export const inList = (values: readonly (string | number)[]) =>
  `in.(${values.map((v) => `"${encodeURIComponent(String(v)).replace(/"/g, "%22")}"`).join(",")})`;

/**
 * The query with `id` as the last sort key. Pages are separate queries, so
 * without a total order Postgres may return a row on two pages and skip
 * another (seen on ranking events, ordered by a timestamp with ties). Every
 * table and api_* view has a unique `id`.
 */
export function withTotalOrder(query: string): string {
  const order = /(^|&)order=([^&]*)/.exec(query);
  if (!order) return `${query}&order=id`;
  const columns = order[2].split(",").map((c) => c.split(".")[0]);
  if (columns.includes("id")) return query;
  return query.replace(order[0], `${order[1]}order=${order[2]},id`);
}

export function db(env: Env): Db {
  const base = env.DATA_SUPABASE_URL;
  const key = env.DATA_SUPABASE_SECRET_KEY;
  if (!base || !key) {
    throw new Error("Supabase data is not configured: set DATA_SUPABASE_URL and the DATA_SUPABASE_SECRET_KEY secret");
  }
  const root = `${base.replace(/\/+$/, "")}/rest/v1`;

  async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<{ body: any; response: Response }> {
    // A read that fails in transit (a network error, or a gateway 502/503/504)
    // is tried once more. Writes are not: a write that timed out may have
    // landed, and repeating it could apply it twice.
    const attempts = (init.method ?? "GET") === "GET" ? 2 : 1;
    let response!: Response;
    let text!: string;
    let tokenRetries = 0;
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        response = await fetch(`${root}/${path}`, {
          ...init,
          headers: {
            apikey: key!,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(init.headers ?? {}),
          },
        });
        text = await response.text();
      } catch (err) {
        recordDbCall(Date.now() - startedAt, 0);
        if (attempt < attempts) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      recordDbCall(Date.now() - startedAt, text.length);
      if (response.status === 401 && tokenRetries < TOKEN_RETRIES && TOKEN_REJECTED.test(text)) {
        tokenRetries++;
        attempt--; // not counted against the transit retries
        await sleep(RETRY_DELAY_MS * 2 * tokenRetries);
        continue;
      }
      if (attempt < attempts && RETRYABLE_STATUS.has(response.status)) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      // PostgREST's message names the table/constraint, never row values.
      const message = typeof body === "object" && body ? body.message ?? body.hint ?? "" : String(body ?? "");
      throw new SupabaseError(
        `Supabase ${init.method ?? "GET"} ${path.split("?")[0]} failed (${response.status}): ${message}`,
        response.status,
        typeof body === "object" && body ? body.code : undefined,
      );
    }
    return { body, response };
  }

  const returning = { Prefer: "return=representation" };

  return {
    async select<T>(table: string, query: string) {
      const out: T[] = [];
      const ordered = withTotalOrder(query);
      for (let from = 0; ; from += PAGE) {
        const { body } = await call(`${table}?${ordered}`, {
          headers: { "Range-Unit": "items", Range: `${from}-${from + PAGE - 1}` },
        });
        const rows = (body ?? []) as T[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },

    async one<T>(table: string, query: string) {
      const { body } = await call(`${table}?${query}&limit=2`);
      const rows = (body ?? []) as T[];
      if (rows.length > 1) throw new SupabaseError(`Expected at most one ${table} row`, 500);
      return rows[0] ?? null;
    },

    async insert<T>(table: string, rows: object[]) {
      if (rows.length === 0) return [];
      const { body } = await call(table, { method: "POST", body: JSON.stringify(rows), headers: returning });
      return (body ?? []) as T[];
    },

    async upsert<T>(table: string, rows: object[], onConflict: string) {
      if (rows.length === 0) return [];
      const { body } = await call(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: "POST",
        body: JSON.stringify(rows),
        headers: { Prefer: "return=representation,resolution=merge-duplicates" },
      });
      return (body ?? []) as T[];
    },

    async update<T>(table: string, filter: string, patch: object) {
      if (!filter) throw new Error("update() needs a filter");
      const { body } = await call(`${table}?${filter}`, { method: "PATCH", body: JSON.stringify(patch), headers: returning });
      return (body ?? []) as T[];
    },

    async remove(table: string, filter: string) {
      if (!filter) throw new Error("remove() needs a filter");
      await call(`${table}?${filter}`, { method: "DELETE" });
    },

    async rpc<T>(fn: string, args: object) {
      const { body } = await call(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
      return body as T;
    },
  };
}
