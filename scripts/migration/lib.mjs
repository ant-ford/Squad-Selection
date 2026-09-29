// Shared plumbing for the Airtable import and the parity check.
//
// Safety rules these scripts keep (see README.md in this folder):
//  - Airtable is only ever READ, with the read-only token.
//  - Secrets come from eddy-secrets.txt (or the environment) and are never
//    printed. Reports name tables, record ids and field names, never values.
//  - Writes are upserts; nothing is deleted.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../..");
export const CACHE_DIR = path.join(REPO, ".migration-cache");
export const REPORT_DIR = path.join(here, "reports");

export const BASE_ID = "appG6amyHthm3Nnde";
export const R2_ACCOUNT_ID = "c04da0bddfb69252c9f837a37305cd30";

// ── Secrets ──────────────────────────────────────────────────────────────

const SECRETS_FILE = process.env.EDDY_SECRETS_FILE ?? path.join(REPO, "..", "Squad-Selections", "eddy-secrets.txt");

/** One named value from the environment, else eddy-secrets.txt (KEY=value per line). */
export function secret(name) {
  if (process.env[name]) return process.env[name];
  const file = fs.existsSync(SECRETS_FILE) ? SECRETS_FILE : path.join(REPO, "eddy-secrets.txt");
  if (!fs.existsSync(file)) throw new Error(`No ${name} in the environment and no eddy-secrets.txt found`);
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
  }
  throw new Error(`${name} is not in ${path.basename(file)}`);
}

// ── Command line ─────────────────────────────────────────────────────────

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unrecognised argument: ${arg}`);
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = m[2] === undefined ? true : m[2];
  }
  return out;
}

/**
 * The database a run writes to or checks. Production needs both flags, so a
 * slip of the keyboard cannot reach it.
 */
export function targetDatabase(args) {
  if (args.target === "production") {
    if (!args.iUnderstandThisWritesProduction) {
      throw new Error("--target=production also needs --i-understand-this-writes-production");
    }
    return { label: "eddy-production", url: secret("PROD_DB_URL"), bucket: "eddy-files" };
  }
  if (args.target && args.target !== "preview") throw new Error(`--target must be preview or production, not ${args.target}`);
  return { label: "eddy-preview", url: secret("PREVIEW_DB_URL"), bucket: "eddy-files-preview" };
}

// ── Airtable (read-only) ─────────────────────────────────────────────────

export function airtableClient({ rate = 2 } = {}) {
  const token = secret("AIRTABLE_READONLY_TOKEN");
  const gap = 1000 / Math.min(Math.max(Number(rate) || 2, 0.5), 4); // never faster than 4 req/s
  let last = 0;
  let calls = 0;

  async function get(url) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      calls++;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429) {
        await sleep(30_000); // Airtable asks for 30 s after a 429
        continue;
      }
      if (res.status >= 500) {
        await sleep(2_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Airtable GET ${new URL(url).pathname} -> ${res.status}`);
      return res.json();
    }
    throw new Error(`Airtable GET ${new URL(url).pathname} kept failing`);
  }

  return {
    get calls() { return calls; },
    async schema() {
      return get(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`);
    },
    /** Every record of a table (all fields), following pagination. */
    async listAll(table) {
      const records = [];
      let offset;
      do {
        const p = new URLSearchParams({ pageSize: "100" });
        if (offset) p.set("offset", offset);
        const page = await get(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${p}`);
        records.push(...page.records);
        offset = page.offset;
      } while (offset);
      return records;
    },
  };
}

/** Cached snapshot of every table, so a run can resume or be re-checked without re-reading Airtable. */
export async function snapshot(at, tables, { useCache = false, log = console.log } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = {};
  for (const table of tables) {
    const file = path.join(CACHE_DIR, `${table.replace(/[^A-Za-z0-9]+/g, "_")}.json`);
    if (useCache && fs.existsSync(file)) {
      out[table] = JSON.parse(fs.readFileSync(file, "utf8"));
      log(`  ${table}: ${out[table].length} records (cached)`);
      continue;
    }
    out[table] = await at.listAll(table);
    fs.writeFileSync(file, JSON.stringify(out[table]));
    log(`  ${table}: ${out[table].length} records`);
  }
  return out;
}

// ── Postgres ─────────────────────────────────────────────────────────────

export async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/**
 * Upserts rows in batches: INSERT ... ON CONFLICT (conflict) DO UPDATE SET
 * every other column. Returns the number of rows sent.
 */
export async function upsert(db, table, rows, conflict, { batch = 200, conflictWhere = "" } = {}) {
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const updates = cols.filter((c) => !conflict.includes(c));
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const values = [];
    const tuples = slice.map((row) => `(${cols.map((c) => {
      values.push(row[c] ?? null);
      return `$${values.length}`;
    }).join(",")})`);
    const set = updates.length
      ? `do update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`
      : "do nothing";
    await db.query(
      `insert into ${table} (${cols.map(ident).join(",")}) values ${tuples.join(",")} on conflict (${conflict.map(ident).join(",")})${conflictWhere ? ` where ${conflictWhere}` : ""} ${set}`,
      values,
    );
  }
  return rows.length;
}

/** airtable_id -> uuid for a table. */
export async function idMap(db, table) {
  const { rows } = await db.query(`select airtable_id, id from ${table} where airtable_id is not null`);
  return new Map(rows.map((r) => [r.airtable_id, r.id]));
}

// ── R2 ───────────────────────────────────────────────────────────────────

export function r2() {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: secret("R2_FILES_ACCESS_KEY_ID"), secretAccessKey: secret("R2_FILES_SECRET_ACCESS_KEY") },
  });
  return {
    async exists(bucket, key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (e) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return false;
        throw e;
      }
    },
    async put(bucket, key, body, contentType, sha256) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: { sha256 } }));
    },
    async get(bucket, key) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    },
  };
}

// ── Small helpers ────────────────────────────────────────────────────────

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function writeReport(name, data) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Runs `fn` over `items` with at most `n` in flight. */
export async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
