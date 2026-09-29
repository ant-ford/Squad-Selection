#!/usr/bin/env node
// Copies the Airtable base into Supabase: typed tables, the raw JSON archive,
// and the attachments into R2. Idempotent (upserts on airtable_id, files keyed
// by attachment id) and resumable, so it can be run again and again.
//
//   node import-airtable.mjs                          dry run against eddy-preview (default)
//   node import-airtable.mjs --apply                  write to eddy-preview + eddy-files-preview
//   node import-airtable.mjs --apply --no-files       rows only
//   node import-airtable.mjs --use-cache              reuse the last Airtable snapshot
//   node import-airtable.mjs --rate=3                 Airtable requests per second (max 4, default 2)
//   node import-airtable.mjs --apply --target=production --i-understand-this-writes-production
//
// Reads Airtable with the READ-ONLY token. Never deletes anything. Prints and
// reports counts, table names, record ids and field names - never values.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  airtableClient, snapshot, connect, upsert, idMap, r2, targetDatabase, parseArgs, writeReport, pool, CACHE_DIR,
} from "./lib.mjs";
import {
  DIRECT, PEOPLE, SHIRT_NUMBERS, TEAMS, MATCHES, OFFICE_SOURCES, ALL_AIRTABLE_TABLES, AVAILABILITY_EXCEPTIONS,
  sharedEmails, dedupeExceptions, sharedShirts,
  familyRows, relativeRows, previousClubRows, applicantTrialRows, quizRows, kitRows, seasonPlanRow, courseRows,
  PERSON_FILES, FAMILY_FILES, COMMITMENT_FILES, fileSkipReason, importedFileKey, MEMBERSHIP_EVENT_FIELDS,
  links, text, ts,
} from "./mapping.mjs";

const args = parseArgs(process.argv.slice(2), { target: "preview", rate: 2 });
const apply = args.apply === true;
const withFiles = args.files !== false && !args.noFiles;
const target = targetDatabase(args);
const log = (...m) => console.log(...m);

const report = {
  startedAt: new Date().toISOString(),
  target: target.label,
  mode: apply ? "apply" : "dry-run",
  airtableCalls: 0,
  tables: {},
  warnings: [],
  files: { copied: 0, alreadyThere: 0, skipped: {}, failed: [] },
};
const warn = (kind, detail) => report.warnings.push({ kind, ...detail });

log(`Airtable -> ${target.label} (${report.mode})`);
log("Reading Airtable (read-only token):");
const at = airtableClient({ rate: args.rate });
const snap = await snapshot(at, ALL_AIRTABLE_TABLES, { useCache: args.useCache === true, log });

// ── Build rows (pure: no database needed, so a dry run checks everything) ─

/** Resolve a link to a uuid, or to a placeholder in a dry run. */
function makeResolver(maps) {
  return (field, recordId, value, targetTable, sourceTable) => {
    const ids = links(value);
    if (ids.length > 1) warn("several-links-first-kept", { table: sourceTable, record: recordId, field, count: ids.length });
    if (ids.length === 0) return null;
    const id = maps[targetTable]?.get(ids[0]);
    if (!id) {
      warn("link-to-missing-record", { table: sourceTable, record: recordId, field });
      return null;
    }
    return id;
  };
}

function directRow(def, rec, resolve, { skipLinks = [] } = {}) {
  const f = rec.fields ?? {};
  const row = { airtable_id: rec.id };
  for (const [col, [field, conv]] of Object.entries(def.columns)) row[col] = conv(f[field]);
  for (const [col, [field, targetTable]] of Object.entries(def.links)) {
    if (skipLinks.includes(col)) continue;
    row[col] = resolve(field, rec.id, f[field], targetTable, def.airtable);
  }
  return row;
}

// ── Apply ────────────────────────────────────────────────────────────────

const db = apply ? await connect(target.url) : null;

/** airtable id -> uuid per table; in a dry run, fake uuids for every record that exists in the snapshot. */
const maps = {};
async function refreshMap(table, airtableTables) {
  if (apply) {
    maps[table] = await idMap(db, table);
  } else {
    maps[table] = new Map(airtableTables.flatMap((t) => snap[t].map((r) => [r.id, `dry:${r.id}`])));
  }
}
const resolve = makeResolver(maps);
const count = (table, n) => { report.tables[table] = (report.tables[table] ?? 0) + n; };

async function write(table, rows, conflict) {
  count(table, rows.length);
  if (apply) await upsert(db, table, rows, conflict);
}

try {
  // 1. The raw archive: every record of every table, as Airtable returned it.
  const tableIds = new Map((await at.schema()).tables.map((t) => [t.name, t.id]));
  for (const name of ALL_AIRTABLE_TABLES) {
    const rows = snap[name].map((r) => ({
      airtable_id: r.id, table_id: tableIds.get(name) ?? "", table_name: name,
      created_time: r.createdTime ?? null, fields: JSON.stringify(r.fields ?? {}),
    }));
    await write("archive.airtable_records", rows, ["airtable_id"]);
  }
  log("Archived every record.");

  // 2. Shirt numbers, then people (office links come after the offices exist).
  await write("public.shirt_numbers", snap["Shirt Numbers"].map((r) => directRow(SHIRT_NUMBERS, r, resolve)), ["airtable_id"]);
  await refreshMap("public.shirt_numbers", ["Shirt Numbers"]);

  const emails = sharedEmails(snap.People);
  for (const g of emails.groups) warn("shared-email", { records: g.map((r) => r.id), importedWithoutEmail: g.filter((r) => emails.losers.has(r.id)).map((r) => r.id) });
  const shirtLosers = sharedShirts(snap.People);
  for (const [record, heldBy] of shirtLosers) warn("shirt-number-shared-second-dropped", { record, heldBy });
  const officeLinkCols = Object.keys(PEOPLE.links).filter((c) => c !== "shirt_number_id");
  const peopleRows = snap.People.map((r) => {
    const row = directRow(PEOPLE, r, resolve, { skipLinks: officeLinkCols });
    if (emails.losers.has(r.id)) row.email = null;
    if (shirtLosers.has(r.id)) row.shirt_number_id = null;
    return row;
  });
  await write("public.people", peopleRows, ["airtable_id"]);
  await refreshMap("public.people", ["People"]);

  // 3. Offices: six Airtable tables, one table here.
  const officeRows = OFFICE_SOURCES.flatMap(({ airtable, role, emailField }) =>
    snap[airtable].map((r) => ({
      airtable_id: r.id,
      role,
      person_id: resolve("Member", r.id, r.fields?.Member, "public.people", airtable),
      designation: text(r.fields?.Designation),
      status: text(r.fields?.Status) ?? "Active",
      office_email: emailField ? text(r.fields?.[emailField]) : null,
    })),
  );
  await write("public.offices", officeRows, ["airtable_id"]);
  await refreshMap("public.offices", OFFICE_SOURCES.map((s) => s.airtable));

  // People's office links, now that the offices have ids.
  const officeLinkRows = snap.People.map((r) => {
    const row = { airtable_id: r.id };
    for (const col of officeLinkCols) {
      const [field, table] = PEOPLE.links[col];
      row[col] = resolve(field, r.id, r.fields?.[field], table, "People");
    }
    return row;
  });
  // Only these columns are sent, so the update touches nothing else.
  if (apply) await upsert(db, "public.people", officeLinkRows, ["airtable_id"]);

  // 4. Per-person detail from People's numbered column groups.
  const personId = (recId) => maps["public.people"].get(recId);
  const children = { family: [], relatives: [], clubs: [], trials: [], quiz: [], kit: [], plans: [], courses: [] };
  for (const r of snap.People) {
    const f = r.fields ?? {};
    const pid = personId(r.id);
    if (!pid) continue;
    for (const { filesPrefix, ...row } of familyRows(f)) children.family.push({ person_id: pid, ...row });
    for (const row of relativeRows(f)) children.relatives.push({ person_id: pid, ...row });
    for (const row of previousClubRows(f)) children.clubs.push({ person_id: pid, ...row });
    for (const row of applicantTrialRows(f)) children.trials.push({ person_id: pid, ...row });
    for (const row of quizRows(f)) children.quiz.push({ person_id: pid, ...row });
    for (const row of kitRows(f)) children.kit.push({ person_id: pid, ...row });
    const plan = seasonPlanRow(f);
    if (plan) children.plans.push({ person_id: pid, ...plan });
    for (const row of courseRows(f)) children.courses.push({ person_id: pid, ...row });
  }
  await write("public.family_members", children.family, ["person_id", "relation", "ordinal"]);
  await write("public.relatives", children.relatives, ["person_id", "ordinal"]);
  await write("public.previous_clubs", children.clubs, ["person_id", "ordinal"]);
  await write("public.applicant_trials", children.trials, ["person_id", "ordinal"]);
  await write("public.quiz_scores", children.quiz, ["person_id", "quiz"]);
  await write("public.kit_sizes", children.kit, ["person_id", "supplier", "item"]);
  await write("public.season_plans", children.plans, ["person_id", "season"]);
  await write("public.course_signups", children.courses, ["person_id", "course"]);

  // 5. Teams and who coaches / captains them.
  await write("public.teams", snap.Teams.map((r) => directRow(TEAMS, r, resolve)), ["airtable_id"]);
  await refreshMap("public.teams", ["Teams"]);
  const teamPeople = snap.Teams.flatMap((r) =>
    Object.entries(TEAMS.memberLinks).flatMap(([role, field]) =>
      links(r.fields?.[field]).map((pid, i) => ({ team: r.id, person: pid, role, ordinal: i + 1 })),
    ),
  ).map(({ team, person, role, ordinal }) => {
    const person_id = maps["public.people"].get(person);
    if (!person_id) warn("link-to-missing-record", { table: "Teams", record: team, field: role });
    return { team_id: maps["public.teams"].get(team), person_id, role, ordinal };
  }).filter((r) => r.team_id && r.person_id);
  await write("public.team_people", teamPeople, ["team_id", "role", "person_id"]);

  // 6. Matches and their selections.
  await write("public.matches", snap.Matches.map((r) => directRow(MATCHES, r, resolve)), ["airtable_id"]);
  await refreshMap("public.matches", ["Matches"]);
  const selections = snap.Matches.flatMap((r) =>
    Object.entries(MATCHES.selectionLinks).flatMap(([side, field]) =>
      links(r.fields?.[field]).map((pid, i) => ({
        match_id: maps["public.matches"].get(r.id), side, person_id: maps["public.people"].get(pid), ordinal: i + 1, rec: r.id,
      })),
    ),
  ).filter((s) => {
    if (!s.person_id) warn("link-to-missing-record", { table: "Matches", record: s.rec, field: `Selected Players ${s.side}` });
    return s.match_id && s.person_id;
  }).map(({ rec, ...s }) => s);
  await write("public.match_selections", selections, ["match_id", "side", "person_id"]);

  // 7. Everything else that has its own records, in dependency order.
  for (const def of DIRECT.filter((d) => ![SHIRT_NUMBERS, PEOPLE, TEAMS, MATCHES].includes(d))) {
    let records = snap[def.airtable];
    if (def === AVAILABILITY_EXCEPTIONS) {
      const d = dedupeExceptions(records);
      for (const x of d.dropped) warn("duplicate-exception-older-dropped", x);
      records = d.kept;
    }
    await write(def.table, records.map((r) => directRow(def, r, resolve)), ["airtable_id"]);
    await refreshMap(def.table, [def.airtable]);
  }

  // 8. Membership Events into the activity log: who, what, which record, when - no values.
  const events = snap["Membership Events"].map((r) => {
    const type = text(r.fields?.["Event Type"]) ?? "Unknown";
    const person = links(r.fields?.Person)[0];
    return {
      airtable_id: r.id,
      occurred_at: ts(r.fields?.Timestamp) ?? r.createdTime,
      actor_person_id: resolve("Actor", r.id, r.fields?.Actor, "public.people", "Membership Events"),
      action: type.toLowerCase(),
      entity: "people",
      entity_id: person ? maps["public.people"].get(person) ?? null : null,
      fields: MEMBERSHIP_EVENT_FIELDS[type] ?? [],
    };
  });
  await write("public.activity_log", events, ["airtable_id"]);
  log("Rows done.");

  // 9. Attachments -> R2.
  if (withFiles) await copyFiles();
} finally {
  report.airtableCalls = at.calls;
  report.finishedAt = new Date().toISOString();
  const file = writeReport(`import-${target.label}`, report);
  if (db) await db.end();
  log("\nRows per table:");
  for (const [t, n] of Object.entries(report.tables)) log(`  ${t.padEnd(34)} ${n}`);
  const byKind = report.warnings.reduce((m, w) => ({ ...m, [w.kind]: (m[w.kind] ?? 0) + 1 }), {});
  log("Warnings:", Object.keys(byKind).length ? byKind : "none");
  if (withFiles) log("Files:", { ...report.files, failed: report.files.failed.length });
  log(`Report (ids and counts only): ${path.relative(process.cwd(), file)}`);
}

// ── Files ────────────────────────────────────────────────────────────────

async function copyFiles() {
  // Attachment URLs expire after a couple of hours: never use an old snapshot for files.
  const ageMin = (Date.now() - fs.statSync(path.join(CACHE_DIR, "People.json")).mtimeMs) / 60000;
  if (ageMin > 90) throw new Error("The snapshot is too old for attachment URLs; run without --use-cache for files.");

  const jobs = [];
  const add = (att, kind, owner, skip) => jobs.push({ att, kind, owner, skip });
  for (const r of snap.People) {
    const f = r.fields ?? {};
    for (const [field, kind] of Object.entries(PERSON_FILES)) {
      for (const att of f[field] ?? []) add(att, kind, { person: r.id }, fileSkipReason(kind, f));
    }
    for (const fam of familyRows(f)) {
      for (const [field, kind] of Object.entries(FAMILY_FILES)) {
        for (const att of f[`${fam.filesPrefix}${field}`] ?? []) add(att, kind, { person: r.id, family: [fam.relation, fam.ordinal] }, null);
      }
    }
  }
  for (const r of snap.Commitments) {
    for (const [field, kind] of Object.entries(COMMITMENT_FILES)) {
      for (const att of r.fields?.[field] ?? []) add(att, kind, { commitment: r.id }, null);
    }
  }

  for (const j of jobs.filter((j) => j.skip)) report.files.skipped[j.skip] = (report.files.skipped[j.skip] ?? 0) + 1;
  const todo = jobs.filter((j) => !j.skip);
  log(`Files: ${todo.length} to carry over, ${jobs.length - todo.length} skipped by rule.`);
  if (!apply) return;

  const store = r2();
  const existing = new Set((await db.query("select airtable_attachment_id from public.files where airtable_attachment_id is not null")).rows.map((r) => r.airtable_attachment_id));
  const famIds = new Map((await db.query("select id, person_id, relation, ordinal from public.family_members")).rows.map((r) => [`${r.person_id}|${r.relation}|${r.ordinal}`, r.id]));

  await pool(todo, 4, async ({ att, kind, owner }) => {
    if (existing.has(att.id)) { report.files.alreadyThere++; return; }
    try {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (typeof att.size === "number" && body.length !== att.size) throw new Error("size differs from Airtable's");
      const sha256 = crypto.createHash("sha256").update(body).digest("hex");
      const key = importedFileKey(att.id);
      await store.put(target.bucket, key, body, att.type || "application/octet-stream", sha256);

      const person_id = owner.person ? maps["public.people"].get(owner.person) ?? null : null;
      const family_member_id = owner.family ? famIds.get(`${person_id}|${owner.family[0]}|${owner.family[1]}`) ?? null : null;
      const commitment_id = owner.commitment ? maps["public.commitments"].get(owner.commitment) ?? null : null;
      await upsert(db, "public.files", [{
        r2_key: key, kind,
        person_id: family_member_id ? null : person_id, family_member_id, commitment_id,
        filename: att.filename ?? null, content_type: att.type ?? null, bytes: body.length, sha256,
        airtable_attachment_id: att.id,
      }], ["airtable_attachment_id"]);
      report.files.copied++;
    } catch (e) {
      report.files.failed.push({ attachment: att.id, kind, reason: String(e.message ?? e).slice(0, 120) });
    }
  });
}
