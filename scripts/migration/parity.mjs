#!/usr/bin/env node
// Checks that Supabase holds exactly what Airtable holds, after the import.
//
//   node parity.mjs                  fresh read of Airtable vs eddy-preview
//   node parity.mjs --use-cache      compare with the snapshot the last import used
//   node parity.mjs --files=all      checksum every file in R2 (default: a sample of 40)
//   node parity.mjs --target=production --i-understand-this-writes-production   (reads only)
//
// Compares every row, not a sample: counts, every mapped field, every link,
// the child rows built from People's column groups, the join tables, the
// formula replacements (views), the raw archive, and the files. A difference
// the import makes on purpose (shared emails, duplicate availability answers,
// files skipped by rule) is listed as explained. Anything else fails the run.
// Reports name tables, record ids and column names - never values.

import crypto from "node:crypto";
import pg from "pg";
import {
  airtableClient, snapshot, connect, r2, targetDatabase, parseArgs, writeReport,
} from "./lib.mjs";
import {
  DIRECT, PEOPLE, TEAMS, MATCHES, OFFICE_SOURCES, ALL_AIRTABLE_TABLES, AVAILABILITY_EXCEPTIONS,
  familyRows, relativeRows, previousClubRows, applicantTrialRows, quizRows, kitRows, seasonPlanRow, courseRows,
  PERSON_FILES, FAMILY_FILES, COMMITMENT_FILES, fileSkipReason, sharedEmails, dedupeExceptions, sharedShirts,
  links, text, int, num, bool,
} from "./mapping.mjs";

// Dates as plain strings, never shifted through a local time zone.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const args = parseArgs(process.argv.slice(2), { target: "preview", rate: 2 });
const target = targetDatabase(args);
const log = (...m) => console.log(...m);

const unexplained = [];
const explained = [];
const counts = {};
const diff = (kind, detail) => unexplained.push({ kind, ...detail });
const ok = (kind, detail) => explained.push({ kind, ...detail });

log(`Parity: Airtable vs ${target.label}`);
const at = airtableClient({ rate: args.rate });
const snap = await snapshot(at, ALL_AIRTABLE_TABLES, { useCache: args.useCache === true, log });
const db = await connect(target.url);

const rows = async (sql) => (await db.query(sql)).rows;
const byAirtable = async (table) => new Map((await rows(`select * from ${table} where airtable_id is not null`)).map((r) => [r.airtable_id, r]));

/** Normalises a Postgres value and the expected value to one comparable form. */
function norm(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return JSON.stringify([...v].sort());
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return v;
}
const same = (a, b) => norm(a) === norm(b);

try {
  // Maps airtable id -> uuid, for checking links.
  const uuid = {};
  for (const t of ["people", "offices", "shirt_numbers", "teams", "matches", "commitments", "message_templates"]) {
    uuid[`public.${t}`] = new Map((await rows(`select airtable_id, id from public.${t} where airtable_id is not null`)).map((r) => [r.airtable_id, r.id]));
  }
  const emails = sharedEmails(snap.People);
  const shirtLosers = sharedShirts(snap.People);
  const exceptions = dedupeExceptions(snap[AVAILABILITY_EXCEPTIONS.airtable]);
  for (const x of exceptions.dropped) ok("duplicate-exception-older-not-imported", x);

  // ── 1-3. Every table with its own records: count, every field, every link.
  for (const def of DIRECT) {
    const expected = def === AVAILABILITY_EXCEPTIONS ? exceptions.kept : snap[def.airtable];
    const actual = await byAirtable(def.table);
    counts[def.table] = { airtable: expected.length, supabase: actual.size };
    for (const rec of expected) {
      const row = actual.get(rec.id);
      if (!row) { diff("missing-row", { table: def.table, record: rec.id }); continue; }
      const f = rec.fields ?? {};
      for (const [col, [field, conv]] of Object.entries(def.columns)) {
        let want = conv(f[field]);
        if (def === PEOPLE && col === "email" && emails.losers.has(rec.id)) { ok("shared-email-imported-blank", { record: rec.id }); want = null; }
        if (!same(row[col], want)) diff("field", { table: def.table, record: rec.id, column: col });
      }
      for (const [col, [field, targetTable]] of Object.entries(def.links)) {
        const first = links(f[field])[0];
        let want = first ? uuid[targetTable]?.get(first) ?? null : null;
        if (col === "shirt_number_id" && shirtLosers.has(rec.id)) { ok("shared-shirt-number-second-dropped", { record: rec.id }); want = null; }
        if (first && !want) diff("link-target-not-imported", { table: def.table, record: rec.id, column: col });
        else if (!same(row[col], want)) diff("link", { table: def.table, record: rec.id, column: col });
        if (links(f[field]).length > 1) ok("several-links-first-kept", { table: def.table, record: rec.id, column: col });
      }
    }
    const ids = new Set(expected.map((r) => r.id));
    for (const id of actual.keys()) if (!ids.has(id)) diff("row-not-in-airtable", { table: def.table, record: id });
  }

  // Offices: six tables, one here.
  const offices = await byAirtable("public.offices");
  let officeCount = 0;
  for (const { airtable, role, emailField } of OFFICE_SOURCES) {
    for (const rec of snap[airtable]) {
      officeCount++;
      const row = offices.get(rec.id);
      if (!row) { diff("missing-row", { table: "public.offices", record: rec.id }); continue; }
      const f = rec.fields ?? {};
      if (row.role !== role) diff("field", { table: "public.offices", record: rec.id, column: "role" });
      if (!same(row.designation, text(f.Designation))) diff("field", { table: "public.offices", record: rec.id, column: "designation" });
      if (!same(row.status, text(f.Status) ?? "Active")) diff("field", { table: "public.offices", record: rec.id, column: "status" });
      if (emailField && !same(row.office_email, text(f[emailField]))) diff("field", { table: "public.offices", record: rec.id, column: "office_email" });
      const m = links(f.Member)[0];
      if (!same(row.person_id, m ? uuid["public.people"].get(m) ?? null : null)) diff("link", { table: "public.offices", record: rec.id, column: "person_id" });
    }
  }
  counts["public.offices"] = { airtable: officeCount, supabase: offices.size };

  // ── 4. Child rows built from People's numbered column groups.
  const personOf = new Map([...uuid["public.people"]].map(([a, u]) => [u, a]));
  const CHILDREN = [
    ["public.family_members", (f) => familyRows(f).map(({ filesPrefix, ...r }) => r), (r) => `${r.relation}|${r.ordinal}`],
    ["public.relatives", relativeRows, (r) => `${r.ordinal}`],
    ["public.previous_clubs", previousClubRows, (r) => `${r.ordinal}`],
    ["public.applicant_trials", applicantTrialRows, (r) => `${r.ordinal}`],
    ["public.quiz_scores", quizRows, (r) => r.quiz],
    ["public.kit_sizes", kitRows, (r) => `${r.supplier}|${r.item}`],
    ["public.season_plans", (f) => [seasonPlanRow(f)].filter(Boolean), (r) => r.season],
    ["public.course_signups", courseRows, (r) => r.course],
  ];
  for (const [table, build, key] of CHILDREN) {
    const have = new Map();
    for (const r of await rows(`select * from ${table}`)) have.set(`${personOf.get(r.person_id)}|${key(r)}`, r);
    let want = 0;
    for (const rec of snap.People) {
      for (const exp of build(rec.fields ?? {})) {
        want++;
        const k = `${rec.id}|${key(exp)}`;
        const row = have.get(k);
        if (!row) { diff("missing-child-row", { table, record: rec.id, key: key(exp) }); continue; }
        for (const [col, v] of Object.entries(exp)) if (!same(row[col], v)) diff("field", { table, record: rec.id, key: key(exp), column: col });
        have.delete(k);
      }
    }
    for (const k of have.keys()) diff("child-row-not-in-airtable", { table, key: k.split("|").slice(1).join("|"), record: k.split("|")[0] });
    counts[table] = { airtable: want, supabase: want + have.size };
  }

  // ── 5. Join tables.
  const joinCheck = async (table, expected, keyOf) => {
    const got = new Set((await rows(`select * from ${table}`)).map(keyOf));
    const exp = new Set(expected);
    for (const k of exp) if (!got.has(k)) diff("missing-link-row", { table, key: k });
    for (const k of got) if (!exp.has(k)) diff("link-row-not-in-airtable", { table, key: k });
    counts[table] = { airtable: exp.size, supabase: got.size };
  };
  await joinCheck("public.team_people",
    snap.Teams.flatMap((r) => Object.entries(TEAMS.memberLinks).flatMap(([role, field]) => links(r.fields?.[field]).map((p) => `${uuid["public.teams"].get(r.id)}|${role}|${uuid["public.people"].get(p)}`))),
    (r) => `${r.team_id}|${r.role}|${r.person_id}`);
  await joinCheck("public.match_selections",
    snap.Matches.flatMap((r) => Object.entries(MATCHES.selectionLinks).flatMap(([side, field]) => links(r.fields?.[field]).map((p) => `${uuid["public.matches"].get(r.id)}|${side}|${uuid["public.people"].get(p)}`))),
    (r) => `${r.match_id}|${r.side}|${r.person_id}`);

  // ── 6. Formula replacements: the views must say what Airtable's formulas say.
  const formula = async (view, airtable, checks) => {
    const got = new Map((await rows(`select * from ${view} where airtable_id is not null`)).map((r) => [r.airtable_id, r]));
    for (const rec of snap[airtable]) {
      const row = got.get(rec.id);
      if (!row) continue;
      for (const [col, field, conv] of checks) {
        const raw = rec.fields?.[field];
        const want = conv(raw);
        if (same(row[col], want)) continue;
        if (raw && typeof raw === "object" && "error" in raw) {
          // Airtable's own formula failed here (e.g. a 29 February anniversary); Eddy's view gives a value.
          ok("airtable-formula-error", { view, record: rec.id, column: col });
        } else if (typeof row[col] === "string" && typeof want === "string" && row[col] === want.replace(/\s+/g, " ")) {
          // Airtable's formula kept stray spaces from the source text; the import trims them.
          ok("formula-whitespace-from-source", { view, record: rec.id, column: col });
        } else {
          diff("formula", { view, record: rec.id, column: col });
        }
      }
    }
  };
  await formula("public.matches_v", "Matches", [["season", "Season", text], ["competition_type", "Competition Type", text]]);
  await formula("public.match_cards_v", "Match Cards", [["play_up", "Play Up?", bool]]);
  await formula("public.people_v", "People", [
    ["name", "Name", text], ["full_name", "Full Name", text], ["first_name", "First Name", text],
    ["age", "Age", int], ["age_band", "Age Band", text], ["u21_eligible", "U21 Eligible", bool],
    ["ever_registered_to_premier", "Ever Registered To Premier", bool], ["next_period_end_days", "Next Period End", num],
  ]);
  await formula("public.commitments_v", "Commitments", [["period", "Period", text]]);

  // ── 7. The raw archive holds every record.
  const archived = new Set((await rows("select airtable_id from archive.airtable_records")).map((r) => r.airtable_id));
  let total = 0;
  for (const t of ALL_AIRTABLE_TABLES) for (const r of snap[t]) { total++; if (!archived.has(r.id)) diff("not-archived", { table: t, record: r.id }); }
  counts["archive.airtable_records"] = { airtable: total, supabase: archived.size };

  // ── 8. Files: every attachment carried over (or skipped by rule), same size, intact in R2.
  const fileKey = (att, kind, p, fam, c) => [att, kind, p ?? "", fam ?? "", c ?? ""].join("|");
  const fileRows = await rows("select * from public.files where airtable_attachment_id is not null");
  const files = new Map(fileRows.map((r) => [fileKey(r.airtable_attachment_id, r.kind, r.person_id, r.family_member_id, r.commitment_id), r]));
  const famId = new Map((await rows("select id, person_id, relation, ordinal from public.family_members")).map((r) => [`${r.person_id}|${r.relation}|${r.ordinal}`, r.id]));
  let expectedFiles = 0;
  const expectFile = (att, kind, skip, owner) => {
    if (skip) { ok("file-skipped-by-rule", { attachment: att.id, reason: skip }); return; }
    expectedFiles++;
    const row = files.get(fileKey(att.id, kind, owner.person, owner.family, owner.commitment));
    if (!row) diff("file-missing", { attachment: att.id, kind });
    else {
      if (typeof att.size === "number" && Number(row.bytes) !== att.size) diff("file-size", { attachment: att.id, kind });
      files.delete(fileKey(att.id, kind, owner.person, owner.family, owner.commitment));
    }
  };
  for (const r of snap.People) {
    const f = r.fields ?? {};
    const person = uuid["public.people"].get(r.id);
    for (const [field, kind] of Object.entries(PERSON_FILES)) for (const att of f[field] ?? []) expectFile(att, kind, fileSkipReason(kind, f), { person });
    for (const fam of familyRows(f)) {
      const family = famId.get(`${person}|${fam.relation}|${fam.ordinal}`);
      for (const [field, kind] of Object.entries(FAMILY_FILES)) for (const att of f[`${fam.filesPrefix}${field}`] ?? []) expectFile(att, kind, null, { family });
    }
  }
  for (const r of snap.Commitments) {
    const commitment = uuid["public.commitments"].get(r.id);
    for (const [field, kind] of Object.entries(COMMITMENT_FILES)) for (const att of r.fields?.[field] ?? []) expectFile(att, kind, null, { commitment });
  }
  for (const row of files.values()) diff("file-row-not-in-airtable", { attachment: row.airtable_attachment_id, kind: row.kind });
  counts["public.files"] = { airtable: expectedFiles, supabase: fileRows.length };

  const store = r2();
  // One check per stored object (several rows can share one).
  const all = [...new Map(fileRows.map((r) => [r.r2_key, r])).values()];
  const sample = args.files === "all" ? all : all.sort(() => Math.random() - 0.5).slice(0, 40);
  for (const row of sample) {
    try {
      const body = await store.get(target.bucket, row.r2_key);
      const sha = crypto.createHash("sha256").update(body).digest("hex");
      if (sha !== row.sha256) diff("file-checksum", { attachment: row.airtable_attachment_id });
    } catch {
      diff("file-not-in-r2", { attachment: row.airtable_attachment_id });
    }
  }
  counts["files checksummed"] = { supabase: sample.length };
} finally {
  await db.end();
}

const summary = unexplained.reduce((m, d) => ({ ...m, [d.kind]: (m[d.kind] ?? 0) + 1 }), {});
const explainedSummary = explained.reduce((m, d) => ({ ...m, [d.kind]: (m[d.kind] ?? 0) + 1 }), {});
const file = writeReport(`parity-${target.label}`, { at: new Date().toISOString(), target: target.label, counts, summary, explained: explainedSummary, unexplained, explainedDetail: explained });
log("\nCounts (Airtable / Supabase):");
for (const [t, c] of Object.entries(counts)) log(`  ${t.padEnd(34)} ${c.airtable ?? "-"} / ${c.supabase ?? "-"}`);
log("Explained differences:", Object.keys(explainedSummary).length ? explainedSummary : "none");
log("UNEXPLAINED differences:", Object.keys(summary).length ? summary : "none");
log(`Report (ids and column names only): ${file}`);
process.exitCode = unexplained.length ? 1 : 0;
