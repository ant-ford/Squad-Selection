import { onTestFinished, vi } from "vitest";

/**
 * One fake PostgREST (Supabase's /rest/v1 API) behind `global.fetch`, for
 * business code that queries Supabase directly through data/supabase.ts's
 * db(env). Tables are plain arrays of rows (Postgres column names), mutated
 * in place by writes, so a test seeds them and asserts on them.
 *
 * Nothing unknown is guessed at: a filter
 * operator, select syntax, table, embed or RPC the fake does not know is a
 * PROBLEM. The request fails with HTTP 400 (as PostgREST would) and, because
 * code often catches a failed read and carries on, the test itself is failed
 * when it finishes. A narrowing filter can never silently match everything.
 *
 * Supported (what worker/src actually sends):
 *  - GET/HEAD: select (columns, `*`, `alias:column`, embedded resources
 *    `alias:table!hint!inner(cols)`), filters eq neq gt gte lt lte like ilike
 *    is in, `not.` before any of them, `or=(...)` / `and=(...)` with nesting,
 *    filters on an embed (`event.status=eq.x`), order (asc/desc,
 *    nullsfirst/nullslast, several columns), limit/offset, the Range header,
 *    Prefer count=exact (Content-Range), and the single-object Accept header.
 *  - POST insert (object or array), upsert (`on_conflict` + Prefer
 *    resolution=merge-duplicates|ignore-duplicates), PATCH and DELETE with
 *    filters, Prefer return=representation (with `select`).
 *  - POST /rest/v1/rpc/<fn>, answered by `rpc[fn]`.
 */

export type PgRow = Record<string, unknown>;

/** How an embed joins: parent[from] = child[to]. "one" gives an object or null, "many" an array. */
export interface Relation {
  table: string;
  from: string;
  to: string;
  kind: "one" | "many";
}

export interface PgRequest {
  method: string;
  /** The table, view or `rpc/<fn>` path after /rest/v1/. */
  table: string;
  url: URL;
  params: URLSearchParams;
  headers: Record<string, string>;
  /** The parsed JSON body, if any. */
  body: any;
}

export interface PostgrestOptions {
  /** Rows per table or view, by name. Every table the code reads must be here (use [] for none). */
  tables?: Record<string, PgRow[]>;
  /**
   * Embeds, keyed "<parent>.<name>" (e.g. "team_people.teams") or
   * "<parent>.<fkey hint>" (e.g. "offices.offices_person_id_fkey"). An embed
   * with no relation reads a value seeded inline on the parent row under its
   * output name (alias or table), which must then be present (null is fine).
   */
  relations?: Record<string, Relation>;
  /** SQL functions: the result is the response body. Throw an HttpError-like or return a Response to fail. */
  rpc?: Record<string, (args: any, db: FakePostgrest) => unknown>;
  /**
   * Per-table override: return a Response, or a body (sent as 200 JSON), or
   * undefined to let the fake answer as usual. For failure injection and
   * odd cases.
   */
  handlers?: Record<string, (req: PgRequest, db: FakePostgrest) => unknown>;
  /** Anything not under /rest/v1/ (auth, storage, Resend...). Without it such a request is a problem. */
  other?: (url: string, init: RequestInit) => Response | Promise<Response>;
  /** Columns filled on insert when missing (default: id, a uuid). */
  defaults?: Record<string, (row: PgRow) => PgRow>;
}

export interface PgCall {
  method: string;
  table: string;
  url: URL;
  params: URLSearchParams;
  headers: Record<string, string>;
  body: any;
}

export interface FakePostgrest {
  tables: Record<string, PgRow[]>;
  /** Every request, in order (rpc calls have table "rpc/<fn>"). */
  calls: PgCall[];
  /** Requests the fake could not answer faithfully. Non-empty fails the test. */
  problems: string[];
  fetchMock: ReturnType<typeof vi.fn>;
  /** GETs of one table. */
  reads(table: string): PgCall[];
  /** POST/PATCH/DELETE on one table (or every table). */
  writes(table?: string): PgCall[];
  /** Calls of one SQL function, as their argument objects. */
  rpcCalls(fn: string): any[];
  /** Rows of a table (created on first use). */
  table(name: string): PgRow[];
}

/** The env a Supabase-path test needs. Spread it into the test's env. */
export const SUPABASE_TEST_ENV = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
} as const;

class Problem extends Error {}

// ── Parsing ──────────────────────────────────────────────────────────────

/** Splits on commas outside brackets and double quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  return out.map((x) => x.trim());
}

interface SelectColumn {
  kind: "column";
  name: string;
  as: string;
}
interface SelectEmbed {
  kind: "embed";
  name: string;
  hint?: string;
  inner: boolean;
  as: string;
  select: SelectItem[];
}
type SelectItem = SelectColumn | SelectEmbed | { kind: "star" };

function parseSelect(s: string | null): SelectItem[] {
  if (!s) return [{ kind: "star" }];
  return splitTop(s).map((part): SelectItem => {
    if (part === "*") return { kind: "star" };
    const embed = /^(?:([A-Za-z_][\w]*):)?([A-Za-z_][\w]*)((?:![\w]+)*)\((.*)\)$/s.exec(part);
    if (embed) {
      const [, alias, name, bangs, inside] = embed;
      const marks = bangs.split("!").filter(Boolean);
      const inner = marks.includes("inner");
      const left = marks.includes("left");
      const hints = marks.filter((m) => m !== "inner" && m !== "left");
      if (hints.length > 1 || (inner && left)) throw new Problem(`select: cannot read the embed "${part}"`);
      return { kind: "embed", name, hint: hints[0], inner, as: alias ?? name, select: parseSelect(inside || "*") };
    }
    const col = /^(?:([A-Za-z_][\w]*):)?([A-Za-z_][\w]*)$/.exec(part);
    if (col) return { kind: "column", name: col[2], as: col[1] ?? col[2] };
    throw new Problem(`select: unsupported item "${part}" (casts, JSON paths and spreads are not faked)`);
  });
}

type Cond =
  | { kind: "leaf"; path: string[]; not: boolean; op: string; value: string }
  | { kind: "or" | "and"; not: boolean; items: Cond[] };

const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]);

/** "op.value" or "not.op.value" for the column at `path`. */
function parseLeaf(path: string[], expr: string): Cond {
  let not = false;
  let rest = expr;
  if (rest.startsWith("not.")) {
    not = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = dot < 0 ? rest : rest.slice(0, dot);
  if (!OPS.has(op)) throw new Problem(`filter: unsupported operator "${op}" in "${path.join(".")}=${expr}"`);
  return { kind: "leaf", path, not, op, value: dot < 0 ? "" : rest.slice(dot + 1) };
}

/** The inside of or=(...) / and=(...): "col.op.value", "and(...)", "not.or(...)". */
function parseLogic(kind: "or" | "and", not: boolean, inside: string, prefix: string[]): Cond {
  const items = splitTop(inside).map((part): Cond => {
    const nested = /^(not\.)?(and|or)\((.*)\)$/s.exec(part);
    if (nested) return parseLogic(nested[2] as "and" | "or", !!nested[1], nested[3], prefix);
    // col.op.value, or embed.col.op.value: the column path ends at the first operator.
    const segs = part.split(".");
    const at = segs.findIndex((s, i) => i > 0 && (OPS.has(s) || (s === "not" && OPS.has(segs[i + 1] ?? ""))));
    if (at < 0) throw new Problem(`filter: cannot read "${part}" inside ${kind}(...)`);
    return parseLeaf([...prefix, ...segs.slice(0, at)], segs.slice(at).join("."));
  });
  return { kind, not, items };
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseFilters(params: URLSearchParams): Cond[] {
  const out: Cond[] = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    const path = key.split(".");
    const last = path[path.length - 1];
    const notLogic = path.length >= 2 && path[path.length - 2] === "not" && (last === "or" || last === "and");
    if (last === "or" || last === "and") {
      const prefix = path.slice(0, notLogic ? -2 : -1);
      const m = /^\((.*)\)$/s.exec(value);
      if (!m) throw new Problem(`filter: ${key} needs (...)`);
      out.push(parseLogic(last, notLogic, m[1], prefix));
      continue;
    }
    if (key.endsWith(".limit") || key.endsWith(".order") || key.endsWith(".offset")) {
      throw new Problem(`"${key}": ordering or paging an embed is not faked`);
    }
    out.push(parseLeaf(path, value));
  }
  return out;
}

// ── Evaluating ───────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Compares a stored value with a filter's text the way Postgres would for that column's type. */
function compare(a: unknown, b: string): number {
  if (typeof a === "number") {
    const n = Number(b);
    if (Number.isNaN(n)) throw new Problem(`compare: "${b}" is not a number`);
    return a - n;
  }
  if (typeof a === "boolean") return Number(a) - Number(b === "true");
  const s = String(a);
  if (ISO_DATE.test(s) && ISO_DATE.test(b)) {
    const x = Date.parse(s);
    const y = Date.parse(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  }
  return s < b ? -1 : s > b ? 1 : 0;
}

/** Postgres array literal "{a,b}" for an array column. */
const arrayLiteral = (v: unknown[]) => `{${v.map(String).join(",")}}`;

function parseInList(value: string): string[] {
  const m = /^\((.*)\)$/s.exec(value);
  if (!m) throw new Problem(`filter: in. needs (...), got "${value}"`);
  if (m[1] === "") return [];
  return splitTop(m[1]).map((v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v));
}

const likeToRegex = (pattern: string, flags: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".")}$`, flags);

function testLeaf(op: string, v: unknown, value: string): boolean {
  if (op === "is") {
    if (value === "null") return v === null || v === undefined;
    if (value === "true") return v === true;
    if (value === "false") return v === false;
    if (value === "unknown") return v === null || v === undefined;
    throw new Problem(`filter: is.${value} is not null/true/false/unknown`);
  }
  // Any comparison with NULL is unknown, i.e. not a match (even neq).
  if (v === null || v === undefined) return false;
  const stored = Array.isArray(v) ? arrayLiteral(v) : v;
  switch (op) {
    case "eq":
      return Array.isArray(v) ? stored === value : compare(stored, value) === 0;
    case "neq":
      return Array.isArray(v) ? stored !== value : compare(stored, value) !== 0;
    case "gt":
      return compare(stored, value) > 0;
    case "gte":
      return compare(stored, value) >= 0;
    case "lt":
      return compare(stored, value) < 0;
    case "lte":
      return compare(stored, value) <= 0;
    case "like":
      return likeToRegex(value, "").test(String(stored));
    case "ilike":
      return likeToRegex(value, "i").test(String(stored));
    case "in":
      return parseInList(value).some((x) => compare(stored, x) === 0);
  }
  throw new Problem(`filter: unsupported operator "${op}"`);
}

/** Whether `table` knows `column`: some seeded row has it. An empty table knows everything. */
function checkColumn(rows: PgRow[], column: string, table: string, what: string) {
  if (rows.length > 0 && !rows.some((r) => column in r)) {
    throw new Problem(`${what}: column "${column}" is on no seeded ${table} row (seed it, null is fine, or fix the name)`);
  }
}

// ── The fake ─────────────────────────────────────────────────────────────

let uuidSeq = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++uuidSeq).padStart(12, "0")}`;

export function fakePostgrest(opts: PostgrestOptions = {}): FakePostgrest {
  const tables: Record<string, PgRow[]> = opts.tables ?? {};
  const calls: PgCall[] = [];
  const problems: string[] = [];

  const known = (name: string) => Object.prototype.hasOwnProperty.call(tables, name);
  const rowsOf = (name: string): PgRow[] => {
    if (!known(name)) throw new Problem(`table "${name}" is not in the fake's tables (add it, [] for none)`);
    return tables[name];
  };

  function relationFor(parent: string, e: SelectEmbed): Relation | undefined {
    const rel = opts.relations ?? {};
    return (e.hint && (rel[`${parent}.${e.name}!${e.hint}`] ?? rel[`${parent}.${e.hint}`])) || rel[`${parent}.${e.name}`];
  }

  /** The embedded value(s) for one parent row, before projection. */
  function embedded(parent: string, row: PgRow, e: SelectEmbed): { table: string; value: PgRow | PgRow[] | null } {
    const r = relationFor(parent, e);
    if (!r) {
      if (!(e.as in row)) {
        throw new Problem(
          `embed "${e.name}${e.hint ? `!${e.hint}` : ""}" on ${parent}: declare relations["${parent}.${e.hint ?? e.name}"] or seed "${e.as}" on the row`,
        );
      }
      return { table: e.name, value: row[e.as] as PgRow | PgRow[] | null };
    }
    const children = rowsOf(r.table).filter((c) => row[r.from] !== null && row[r.from] !== undefined && c[r.to] === row[r.from]);
    return { table: r.table, value: r.kind === "one" ? children[0] ?? null : children };
  }

  /** Applies filters to rows of `table`; filters with a path go to embeds. */
  function matches(table: string, row: PgRow, cond: Cond, embeds: Map<string, SelectEmbed>): boolean {
    let result: boolean;
    if (cond.kind === "leaf") {
      if (cond.path.length === 1) {
        checkColumn(tables[table] ?? [], cond.path[0], table, "filter");
        result = testLeaf(cond.op, row[cond.path[0]], cond.value);
      } else {
        // A filter inside or()/and() on an embedded column: test the embed's value.
        const [head, ...rest] = cond.path;
        const e = embeds.get(head);
        if (!e) throw new Problem(`filter "${cond.path.join(".")}": "${head}" is not embedded in the select`);
        const { table: child, value } = embedded(table, row, e);
        const kids = value === null ? [] : Array.isArray(value) ? value : [value];
        const sub: Cond = { ...cond, path: rest };
        result = kids.some((k) => matches(child, k, sub, embedsOf(e.select)));
      }
    } else {
      result = cond.kind === "or"
        ? cond.items.some((c) => matches(table, row, c, embeds))
        : cond.items.every((c) => matches(table, row, c, embeds));
    }
    return cond.not ? !result : result;
  }

  /** The stored row each selected row came from: order= sorts by columns the select may have left out. */
  const sourceOf = new WeakMap<PgRow, PgRow>();

  const embedsOf = (items: SelectItem[]) =>
    new Map(items.filter((i): i is SelectEmbed => i.kind === "embed").map((e) => [e.as, e]));

  /**
   * Rows of `table` with `select` applied and embeds resolved. Top-level
   * conditions with a dotted path filter the embed (and, for !inner, drop
   * the parent when nothing is left).
   */
  function query(table: string, rows: PgRow[], items: SelectItem[], conds: Cond[]): PgRow[] {
    const embeds = embedsOf(items);
    // A dotted top-level filter ("event.status=eq.x") filters that embed;
    // everything else (logic groups included) is tested against the row.
    const embedConds = new Map<string, Cond[]>();
    const topLevel: Cond[] = [];
    for (const c of conds) {
      if (c.kind === "leaf" && c.path.length > 1) {
        const e = embeds.get(c.path[0]);
        if (!e) throw new Problem(`filter "${c.path.join(".")}": "${c.path[0]}" is not embedded in the select`);
        embedConds.set(e.as, [...(embedConds.get(e.as) ?? []), { ...c, path: c.path.slice(1) }]);
      } else {
        topLevel.push(c);
      }
    }
    const out: PgRow[] = [];
    for (const row of rows) {
      if (!topLevel.every((c) => matches(table, row, c, embeds))) continue;
      const shaped: PgRow = {};
      let keep = true;
      for (const item of items) {
        if (item.kind === "star") Object.assign(shaped, structuredClone(row));
        else if (item.kind === "column") shaped[item.as] = structuredClone(row[item.name] ?? null);
        else {
          const { table: child, value } = embedded(table, row, item);
          const sub = embedConds.get(item.as) ?? [];
          if (Array.isArray(value)) {
            const kids = query(child, value, item.select, sub);
            if (item.inner && kids.length === 0) keep = false;
            shaped[item.as] = kids;
          } else if (value === null || value === undefined) {
            if (item.inner) keep = false;
            shaped[item.as] = null;
          } else {
            const [kid] = query(child, [value], item.select, sub);
            if (!kid && item.inner) keep = false;
            shaped[item.as] = kid ?? null;
          }
        }
      }
      if (keep) {
        sourceOf.set(shaped, row);
        out.push(shaped);
      }
    }
    return out;
  }

  function order(table: string, rows: PgRow[], spec: string | null): PgRow[] {
    if (!spec) return rows;
    const keys = spec.split(",").map((part) => {
      const [col, ...mods] = part.split(".");
      for (const m of mods) if (!["asc", "desc", "nullsfirst", "nullslast"].includes(m)) throw new Problem(`order: unknown modifier "${m}"`);
      checkColumn(tables[table] ?? [], col, table, "order");
      const desc = mods.includes("desc");
      // Postgres: nulls sort as larger than everything (last ascending, first descending).
      const nullsFirst = mods.includes("nullsfirst") ? true : mods.includes("nullslast") ? false : desc;
      return { col, desc, nullsFirst };
    });
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const x = (sourceOf.get(a) ?? a)[k.col];
        const y = (sourceOf.get(b) ?? b)[k.col];
        const xn = x === null || x === undefined;
        const yn = y === null || y === undefined;
        if (xn || yn) {
          if (xn && yn) continue;
          return xn === k.nullsFirst ? -1 : 1;
        }
        const c = typeof x === "number" || typeof x === "boolean" ? compare(x, String(y)) : compare(String(x), String(y));
        if (c !== 0) return k.desc ? -c : c;
      }
      return 0;
    });
  }

  function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  const prefers = (headers: Record<string, string>) =>
    new Set((headers["prefer"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  function project(table: string, rows: PgRow[], params: URLSearchParams): PgRow[] {
    return query(table, rows, parseSelect(params.get("select")), []);
  }

  function handle(req: PgRequest, db: FakePostgrest): Response {
    const { method, table, params, headers, body } = req;

    if (table.startsWith("rpc/")) {
      const fn = table.slice(4);
      const impl = opts.rpc?.[fn];
      if (!impl) throw new Problem(`rpc "${fn}" has no handler in the fake's rpc option`);
      const result = impl(body ?? Object.fromEntries(params), db);
      return result instanceof Response ? result : json(result ?? null);
    }

    const rows = rowsOf(table);
    const prefer = prefers(headers);
    const representation = prefer.has("return=representation");

    if (method === "GET" || method === "HEAD") {
      const items = parseSelect(params.get("select"));
      let out = order(table, query(table, rows, items, parseFilters(params)), params.get("order"));
      const total = out.length;
      const offset = Number(params.get("offset") ?? 0);
      let from = offset;
      let to = params.has("limit") ? offset + Number(params.get("limit")) - 1 : Infinity;
      const range = headers["range"];
      if (range) {
        const m = /^(\d+)-(\d*)$/.exec(range);
        if (!m) throw new Problem(`Range header "${range}" not understood`);
        from = offset + Number(m[1]);
        if (m[2] !== "") to = Math.min(to, offset + Number(m[2]));
      }
      out = out.slice(from, to === Infinity ? undefined : to + 1);
      const extra: Record<string, string> = {
        "Content-Range": `${out.length ? `${from}-${from + out.length - 1}` : "*"}/${prefer.has("count=exact") ? total : "*"}`,
      };
      if ((headers["accept"] ?? "").includes("application/vnd.pgrst.object+json")) {
        if (out.length !== 1) {
          return json({ code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned`, details: `${out.length} rows` }, 406);
        }
        return json(method === "HEAD" ? undefined : out[0], 200, extra);
      }
      return json(method === "HEAD" ? undefined : out, 200, extra);
    }

    if (method === "POST") {
      const incoming: PgRow[] = Array.isArray(body) ? body : [body];
      const conflict = params.get("on_conflict");
      const merge = prefer.has("resolution=merge-duplicates");
      const ignore = prefer.has("resolution=ignore-duplicates");
      const keyCols = conflict ? conflict.split(",") : ["id"];
      const written: PgRow[] = [];
      for (const raw of incoming) {
        const existing = (merge || ignore) && rows.find((r) => keyCols.every((k) => r[k] === raw[k]));
        if (existing) {
          if (merge) Object.assign(existing, structuredClone(raw));
          if (merge) written.push(existing);
          continue;
        }
        if (conflict && !merge && !ignore) {
          if (rows.some((r) => keyCols.every((k) => r[k] === raw[k]))) {
            return json({ code: "23505", message: `duplicate key value violates unique constraint on ${table} (${conflict})` }, 409);
          }
        }
        const fill = opts.defaults?.[table];
        const row: PgRow = fill ? fill(structuredClone(raw)) : { id: uuid(), ...structuredClone(raw) };
        rows.push(row);
        written.push(row);
      }
      return representation ? json(project(table, written, params), 201) : json(undefined, 201);
    }

    if (method === "PATCH" || method === "DELETE") {
      const filters = parseFilters(params);
      if (filters.length === 0) throw new Problem(`${method} ${table} without a filter`);
      const stored = rows.filter((r) => filters.every((c) => matches(table, r, c, new Map())));
      if (method === "PATCH") for (const r of stored) Object.assign(r, structuredClone(body ?? {}));
      else for (const r of stored) rows.splice(rows.indexOf(r), 1);
      return representation ? json(project(table, stored, params)) : json(undefined, 204);
    }

    throw new Problem(`method ${method} not faked`);
  }

  const fetchMock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const at = href.indexOf("/rest/v1/");
    if (at < 0) {
      if (opts.other) return opts.other(href, init);
      const msg = `fetch to ${href.split("?")[0]} is not PostgREST and there is no "other" handler`;
      problems.push(msg);
      throw new Error(`fakePostgrest: ${msg}`);
    }
    const url = new URL(href);
    const table = decodeURIComponent(url.pathname.slice(url.pathname.indexOf("/rest/v1/") + 9));
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const req: PgRequest = { method, table, url, params: url.searchParams, headers, body };
    calls.push({ method, table, url, params: url.searchParams, headers, body });
    try {
      const custom = opts.handlers?.[table]?.(req, db);
      if (custom instanceof Response) return custom;
      if (custom !== undefined) return json(custom);
      return handle(req, db);
    } catch (err) {
      if (!(err instanceof Problem)) throw err;
      const msg = `${method} ${table}?${url.searchParams.toString()}: ${err.message}`;
      problems.push(msg);
      return json({ code: "PGRST100", message: `fakePostgrest: ${msg}` }, 400);
    }
  });

  const db: FakePostgrest = {
    tables,
    calls,
    problems,
    fetchMock,
    reads: (table) => calls.filter((c) => c.table === table && (c.method === "GET" || c.method === "HEAD")),
    writes: (table) => calls.filter((c) => c.method !== "GET" && c.method !== "HEAD" && !c.table.startsWith("rpc/") && (!table || c.table === table)),
    rpcCalls: (fn) => calls.filter((c) => c.table === `rpc/${fn}`).map((c) => c.body),
    table: (name) => (tables[name] ??= []),
  };

  vi.stubGlobal("fetch", fetchMock);
  // A problem fails the test even when the code under test caught the error.
  try {
    onTestFinished(() => {
      if (problems.length) throw new Error(`fakePostgrest could not answer:\n  ${problems.join("\n  ")}`);
    });
  } catch {
    // Not inside a test or a beforeEach: the caller checks `problems` itself.
  }
  return db;
}
