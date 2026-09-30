#!/usr/bin/env node
// Loads a supplier's kit order (the CSV the Kit Convenor sent the supplier)
// into kit_orders and kit_sets: one set per shirt number, with the sizes as
// ordered and who it was ordered for. Idempotent: a re-run updates the sizes
// and names but never where a set is (holder), so it is safe after handing
// out has started.
//
//   node import-kit-order.mjs --file="2026-27 Kukri Kit Order 1 (2026.08.17).csv" \
//     --name="2026-27 Kukri order 1" --supplier=Kukri --ordered-on=2026-08-17        dry run, eddy-preview
//   ... --apply                                                                        write eddy-preview
//   ... --apply --target=production --i-understand-this-writes-production
//
// The file's columns: Name, Status, Shirt No., Socks Size, Shirt Size,
// Shorts Size, Goalie Smock Style, Goalie Smock Size (others are ignored).
// Prints counts and shirt numbers - never names.

import fs from "node:fs";
import { connect, parseArgs, targetDatabase } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { target: "preview" });
for (const k of ["file", "name", "supplier", "orderedOn"]) {
  if (typeof args[k] !== "string" || !args[k]) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.orderedOn)) throw new Error("--ordered-on must be YYYY-MM-DD");
const apply = args.apply === true;
const target = targetDatabase(args);

/** One CSV line into fields; quoted fields may hold commas. */
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { cur += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The sizes Eddy stores: the order files mix "XXL" and "2XL". */
function normaliseSize(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return v.replace(/^XXL$/i, "2XL").replace(/^XXS$/i, "2XS");
}

const lines = fs.readFileSync(args.file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
const header = splitCsv(lines[0]).map((h) => h.trim());
const rows = lines.slice(1).map((l) => Object.fromEntries(splitCsv(l).map((v, i) => [header[i], v.trim()])));
for (const col of ["Name", "Shirt No.", "Shirt Size"]) if (!header.includes(col)) throw new Error(`The file has no "${col}" column`);

const numbers = rows.map((r) => Number(r["Shirt No."]));
const bad = rows.filter((r, i) => !Number.isInteger(numbers[i]) || numbers[i] <= 0).length;
const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
if (bad || dupes.length) throw new Error(`${bad} rows without a shirt number; repeated numbers: ${[...new Set(dupes)].join(", ") || "none"}`);

console.log(`${args.file}: ${rows.length} sets -> ${target.label} (${apply ? "apply" : "dry run"})`);
const db = await connect(target.url);
try {
  const nums = new Map((await db.query("select id, shirt_no from public.shirt_numbers")).rows.map((r) => [r.shirt_no, r.id]));
  const people = (await db.query(
    `select id, shirt_number_id, lower(trim(coalesce(nullif(preferred_name, ''), given_names, '') || ' ' || coalesce(surname, ''))) as a,
            lower(trim(coalesce(given_names, '') || ' ' || coalesce(surname, ''))) as b from public.people`,
  )).rows;
  const byName = (name) => {
    const n = name.toLowerCase().replace(/\s+/g, " ").trim();
    const hits = people.filter((p) => p.a === n || p.b === n);
    return hits.length === 1 ? hits[0] : null;
  };

  const missing = numbers.filter((n) => !nums.has(n));
  if (missing.length) throw new Error(`Shirt numbers not in Shirt Numbers: ${missing.join(", ")}`);

  const sets = rows.map((r) => {
    const n = Number(r["Shirt No."]);
    const person = byName(r.Name);
    return {
      shirt_no: n,
      shirt_number_id: nums.get(n),
      ordered_for_name: r.Name || null,
      ordered_for_id: person?.id ?? null,
      shirt: normaliseSize(r["Shirt Size"]),
      shorts: normaliseSize(r["Shorts Size"]),
      socks: normaliseSize(r["Socks Size"]),
      goalie_smock: normaliseSize(r["Goalie Smock Size"]),
      goalie_smock_style: normaliseSize(r["Goalie Smock Style"]),
      // Whether the number is still theirs, for the report.
      stillTheirs: !!person && person.shirt_number_id === nums.get(n),
      nowFree: !people.some((p) => p.shirt_number_id === nums.get(n)),
    };
  });
  const unmatched = sets.filter((s) => !s.ordered_for_id).map((s) => s.shirt_no);
  const moved = sets.filter((s) => s.ordered_for_id && !s.stillTheirs && !s.nowFree).map((s) => s.shirt_no);
  const spares = sets.filter((s) => s.nowFree).map((s) => s.shirt_no);
  console.log(`  matched to a person: ${sets.length - unmatched.length}; not matched: ${unmatched.length}${unmatched.length ? ` (${unmatched.join(", ")})` : ""}`);
  console.log(`  number now held by someone else: ${moved.length}${moved.length ? ` (${moved.join(", ")})` : ""}`);
  console.log(`  number now free, so the set is a spare: ${spares.length}${spares.length ? ` (${spares.join(", ")})` : ""}`);
  console.log(`  goalkeeper sets (with a smock): ${sets.filter((s) => s.goalie_smock).length}`);

  if (!apply) {
    console.log("Dry run: nothing written. Add --apply to write.");
  } else {
    await db.query("begin");
    const order = (await db.query(
      `insert into public.kit_orders (supplier, name, ordered_on) values ($1, $2, $3)
       on conflict (name) do update set supplier = excluded.supplier, ordered_on = excluded.ordered_on
       returning id`,
      [args.supplier, args.name, args.orderedOn],
    )).rows[0];
    let written = 0;
    for (const s of sets) {
      const r = await db.query(
        `insert into public.kit_sets (order_id, shirt_number_id, ordered_for_name, ordered_for_id, shirt, shorts, socks, goalie_smock, goalie_smock_style)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (order_id, shirt_number_id) do update set
           ordered_for_name = excluded.ordered_for_name, ordered_for_id = excluded.ordered_for_id,
           shirt = excluded.shirt, shorts = excluded.shorts, socks = excluded.socks,
           goalie_smock = excluded.goalie_smock, goalie_smock_style = excluded.goalie_smock_style
         where (kit_sets.ordered_for_name, kit_sets.ordered_for_id, kit_sets.shirt, kit_sets.shorts, kit_sets.socks, kit_sets.goalie_smock, kit_sets.goalie_smock_style)
           is distinct from (excluded.ordered_for_name, excluded.ordered_for_id, excluded.shirt, excluded.shorts, excluded.socks, excluded.goalie_smock, excluded.goalie_smock_style)`,
        [order.id, s.shirt_number_id, s.ordered_for_name, s.ordered_for_id, s.shirt, s.shorts, s.socks, s.goalie_smock, s.goalie_smock_style],
      );
      written += r.rowCount;
    }
    const extra = (await db.query(
      "select count(*)::int as n from public.kit_sets where order_id = $1 and not (shirt_number_id = any ($2::uuid[]))",
      [order.id, sets.map((s) => s.shirt_number_id)],
    )).rows[0].n;
    await db.query("commit");
    console.log(`Written: ${written} sets new or changed. Sets in the order that the file no longer has (left alone): ${extra}.`);
  }
} catch (err) {
  await db.query("rollback").catch(() => {});
  throw err;
} finally {
  await db.end();
}
