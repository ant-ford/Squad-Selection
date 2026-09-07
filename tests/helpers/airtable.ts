import { vi } from "vitest";

/**
 * One fake Airtable REST API, shared by every worker test that needs to stub
 * `global.fetch`. Replaces the hand-rolled `installFakeAirtable()` copies
 * that used to live in each test file - same request shapes (see
 * worker/src/airtable.ts's airtableFindAll/FindById/Create/Update/Delete and
 * their batch variants), same response envelopes, one real (if small)
 * filterByFormula evaluator instead of each file's own regex guesswork.
 *
 * `tables` is mutated in place as records are created/updated/deleted, so a
 * test can assert on it directly afterwards (e.g. `expect(tables.people)`).
 */
export interface FakeRecord {
  id: string;
  fields: Record<string, unknown>;
}

export type FakeTables = Record<string, FakeRecord[]>;

export interface FakeAirtableHandle {
  /** Every request the code under test made, in order. */
  calls: { url: string; method: string }[];
  fetchMock: ReturnType<typeof vi.fn>;
}

/**
 * Evaluates the small subset of Airtable formula syntax this codebase
 * actually sends: `{Field}="value"` (case-insensitive), `{Field}=TRUE()` /
 * `=FALSE()`, and `OR(clause, clause, ...)`. An unrecognised formula matches
 * everything rather than silently hiding data a test would otherwise notice
 * is missing.
 */
function evaluateFormula(formula: string, record: FakeRecord): boolean {
  const or = formula.match(/^OR\((.*)\)$/s);
  if (or) return splitTopLevel(or[1]).some((clause) => evaluateFormula(clause, record));

  const eq = formula.match(/^\{([^}]+)\}="((?:[^"\\]|\\.)*)"$/);
  if (eq) {
    const [, field, value] = eq;
    return String(record.fields?.[field] ?? "").toLowerCase() === value.replace(/\\"/g, '"').toLowerCase();
  }

  const bool = formula.match(/^\{([^}]+)\}=(TRUE|FALSE)\(\)$/);
  if (bool) {
    const [, field, want] = bool;
    const actual = record.fields?.[field] === true;
    return want === "TRUE" ? actual : !actual;
  }

  return true;
}

/** Top-level comma split for OR(...) args - ignores commas inside nested quotes/parens. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inQuotes = !inQuotes;
    if (!inQuotes) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) {
        out.push(current);
        current = "";
        continue;
      }
    }
    current += c;
  }
  if (current) out.push(current);
  return out;
}

function tableNameFromUrl(url: string): string {
  return decodeURIComponent((url.match(/\/v0\/[^/]+\/([^/?]+)/) ?? [])[1] ?? "");
}

function recordIdFromUrl(url: string): string | null {
  const m = url.match(/\/(rec[A-Za-z0-9]+)(?:\?|$)/);
  return m ? m[1] : null;
}

export function fakeAirtable(tables: FakeTables): FakeAirtableHandle {
  let nextId = 1;
  const calls: { url: string; method: string }[] = [];

  const store = (table: string): FakeRecord[] => {
    if (!tables[table]) tables[table] = [];
    return tables[table];
  };

  const fetchMock = vi.fn((url: any, init?: any) => {
    const u = String(url);
    const method = (init?.method ?? "GET") as string;
    calls.push({ url: u, method });
    if (!u.includes("api.airtable.com")) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    const records = store(tableNameFromUrl(u));

    if (method === "POST") {
      const body = JSON.parse(init?.body ?? "{}");
      if (body.records) {
        const created = body.records.map((r: any) => ({ id: `recNew${nextId++}`, fields: r.fields }));
        records.push(...created);
        return Promise.resolve(new Response(JSON.stringify({ records: created }), { status: 200 }));
      }
      const created = { id: `recNew${nextId++}`, fields: body.fields };
      records.push(created);
      return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }));
    }

    if (method === "PATCH") {
      const id = recordIdFromUrl(u);
      const body = JSON.parse(init?.body ?? "{}");
      if (id) {
        const target = records.find((r) => r.id === id);
        if (target) target.fields = { ...target.fields, ...body.fields };
        return Promise.resolve(new Response(JSON.stringify(target ?? {}), { status: target ? 200 : 404 }));
      }
      const updated = (body.records ?? []).map((r: any) => {
        const target = records.find((x) => x.id === r.id);
        if (target) target.fields = { ...target.fields, ...r.fields };
        return target ?? { id: r.id, fields: r.fields };
      });
      return Promise.resolve(new Response(JSON.stringify({ records: updated }), { status: 200 }));
    }

    if (method === "DELETE") {
      const body = init?.body ? JSON.parse(init.body) : {};
      const singleId = recordIdFromUrl(u);
      const ids: string[] = body.records ?? (singleId ? [singleId] : []);
      for (const id of ids) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx >= 0) records.splice(idx, 1);
      }
      return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200 }));
    }

    // GET by id, or GET list (optionally filtered).
    const id = recordIdFromUrl(u);
    if (id) {
      const found = records.find((r) => r.id === id);
      return Promise.resolve(new Response(JSON.stringify(found ?? {}), { status: found ? 200 : 404 }));
    }
    const formula = new URLSearchParams(u.split("?")[1] ?? "").get("filterByFormula");
    const filtered = formula ? records.filter((r) => evaluateFormula(formula, r)) : records;
    return Promise.resolve(new Response(JSON.stringify({ records: filtered }), { status: 200 }));
  }) as any;

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
