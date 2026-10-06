// Shared plumbing for the loader scripts in this folder.
//
// Safety rules these scripts keep (see README.md in this folder):
//  - Secrets come from eddy-secrets.txt (or the environment) and are never
//    printed. Reports name tables, record ids and field names, never values.
//  - Writes are upserts. The only deletes are pruneStale()'s.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../..");
export const REPORT_DIR = path.join(here, "reports");

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

// ── Postgres ─────────────────────────────────────────────────────────────

export async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  // The database automations (status on acceptance, card linking, commitment
  // periods) stand aside for this session: a loader writes rows exactly as given.
  await client.query("set eddy.importing = 'on'");
  return client;
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/**
 * Upserts rows in batches: INSERT ... ON CONFLICT (conflict) DO UPDATE SET
 * every other column - but only where something actually differs, so a
 * re-run leaves unchanged rows untouched (no updated_at trigger firing, no
 * churn). Returns the number of rows sent.
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
      ? `do update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}` +
        ` where (${updates.map((c) => `t.${ident(c)}`).join(", ")}) is distinct from (${updates.map((c) => `excluded.${ident(c)}`).join(", ")})`
      : "do nothing";
    await db.query(
      `insert into ${table} as t (${cols.map(ident).join(",")}) values ${tuples.join(",")} on conflict (${conflict.map(ident).join(",")})${conflictWhere ? ` where ${conflictWhere}` : ""} ${set}`,
      values,
    );
  }
  return rows.length;
}

/**
 * For a table the import rebuilds from Airtable (link lists, People's column
 * groups): deletes the rows of the given owners that are not in `keep`, so a
 * re-run drops a link or detail Airtable no longer has. Rows of owners not
 * in the snapshot are never touched. `keys` are the row's unique columns,
 * owner first. Returns the number of rows deleted.
 */
export async function pruneStale(db, table, keys, ownerIds, keep, { countOnly = false } = {}) {
  const owners = [...new Set(ownerIds.filter(Boolean))];
  if (owners.length === 0) return 0;
  // Compared as one text key; concat_ws skips nulls, and so does keyOf.
  const keyOf = (row) => keys.map((k) => row[k]).filter((v) => v !== null && v !== undefined).map(String).join("\u001f");
  const where = `where ${ident(keys[0])} = any($1::uuid[])
       and not (concat_ws(chr(31), ${keys.map((k) => `${ident(k)}::text`).join(", ")}) = any($2::text[]))`;
  const params = [owners, keep.map(keyOf)];
  if (countOnly) return Number((await db.query(`select count(*) as n from ${table} ${where}`, params)).rows[0].n);
  const { rowCount } = await db.query(`delete from ${table} ${where}`, params);
  return rowCount ?? 0;
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
