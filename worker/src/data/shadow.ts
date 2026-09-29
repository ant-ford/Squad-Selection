/**
 * Shadow reads: serve from Airtable exactly as before, and in the background
 * run the same read against Supabase and compare. Turned on only in preview
 * (DATA_SHADOW_READ = "on") while the Supabase repositories are proven.
 *
 * What is logged: module, method, row counts, how many rows are missing,
 * extra or different, the NAMES of differing fields and a few record ids.
 * Never a value: the data is club members' personal details.
 */
import { inBackground } from "../requestContext";

/** Fields that legitimately differ between backends and are compared loosely or not at all. */
const IGNORED = new Set(["teamRank", "positionalRank"]); // derived, never stored (invariant 4)
const PRESENCE_ONLY = new Set(["photo", "url"]); // signed links differ by design; present vs absent must not

export interface ShadowSummary {
  calls: number;
  withDifferences: number;
  failed: number;
  lastDifference?: { method: string; missing: number; extra: number; changed: number; fields: string[] };
}
const summary = new Map<string, ShadowSummary>();

/** This isolate's comparison counts, for /health?deep=1. */
export function shadowSummary(): Record<string, ShadowSummary> {
  return Object.fromEntries(summary);
}

/** Test seam. */
export function resetShadowSummary(): void {
  summary.clear();
}

/** Empty in Airtable's sense: absent, null, false, "", [] all mean "nothing". */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0);
}

function canonical(v: unknown, key = ""): unknown {
  if (PRESENCE_ONLY.has(key)) return isEmpty(v) ? null : "present";
  if (isEmpty(v)) return null;
  if (Array.isArray(v)) {
    const items = v.map((x) => canonical(x));
    return items.every((x) => typeof x === "string") ? [...(items as string[])].sort() : items;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      if (IGNORED.has(k)) continue;
      const c = canonical(x, k);
      if (c !== null) out[k] = c;
    }
    return out;
  }
  return v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export interface Comparison { airtable: number; supabase: number; missing: number; extra: number; changed: number; fields: string[]; ids: string[] }

/** Compares two results: lists by row id (order ignored), anything else as a whole. */
export function compare(a: unknown, b: unknown): Comparison {
  const asRows = (x: unknown) => (Array.isArray(x) && x.every((r) => r && typeof r === "object" && "id" in r) ? (x as { id: string }[]) : null);
  const ra = asRows(a) ?? (a && typeof a === "object" && "id" in (a as object) ? [a as { id: string }] : null);
  const rb = asRows(b) ?? (b && typeof b === "object" && "id" in (b as object) ? [b as { id: string }] : null);
  if (!ra || !rb) {
    const equal = same(a, b);
    return { airtable: 1, supabase: 1, missing: 0, extra: 0, changed: equal ? 0 : 1, fields: equal ? [] : ["(value)"], ids: [] };
  }
  const bById = new Map(rb.map((r) => [r.id, r]));
  const fields = new Set<string>();
  const ids: string[] = [];
  let missing = 0;
  let changed = 0;
  for (const row of ra) {
    const other = bById.get(row.id);
    if (!other) { missing++; if (ids.length < 5) ids.push(row.id); continue; }
    bById.delete(row.id);
    const ca = canonical(row) as Record<string, unknown>;
    const cb = canonical(other) as Record<string, unknown>;
    let differs = false;
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      if (JSON.stringify(ca[k]) !== JSON.stringify(cb[k])) { fields.add(k); differs = true; }
    }
    if (differs) { changed++; if (ids.length < 5) ids.push(row.id); }
  }
  for (const id of bById.keys()) if (ids.length < 5) ids.push(id);
  return { airtable: ra.length, supabase: rb.length, missing, extra: bById.size, changed, fields: [...fields].sort(), ids };
}

const READ = /^(list|get|find)/;

/**
 * The Airtable repository, with each read also run against Supabase after
 * the response. Writes are never shadowed: they go to Airtable only.
 */
export function shadowed<T extends object>(module: string, primary: T, makeShadow: () => T): T {
  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string" || !READ.test(prop)) return value;
      return async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        void inBackground(async () => {
          const key = `${module}.${prop}`;
          const s = summary.get(key) ?? { calls: 0, withDifferences: 0, failed: 0 };
          summary.set(key, s);
          s.calls++;
          try {
            const shadow = makeShadow() as Record<string, (...a: unknown[]) => Promise<unknown>>;
            const other = await shadow[prop](...args);
            const c = compare(result, other);
            if (c.missing || c.extra || c.changed) {
              s.withDifferences++;
              s.lastDifference = { method: prop, missing: c.missing, extra: c.extra, changed: c.changed, fields: c.fields };
              console.warn("shadow " + JSON.stringify({ module, method: prop, ...c }));
            }
          } catch (err) {
            s.failed++;
            console.warn("shadow " + JSON.stringify({ module, method: prop, failed: err instanceof Error ? err.message.slice(0, 160) : "error" }));
          }
        });
        return result;
      };
    },
  });
}
