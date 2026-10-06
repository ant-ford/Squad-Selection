#!/usr/bin/env node
// Makes the 128 px WebP thumbnail of every person's photo that hasn't got
// one, next to the photo in R2 (`<photo key>.thumb`, thumbKey in
// worker/src/data/supabase/files.ts). The app makes one with each new photo
// (FileUpload.tsx); this covers the photos uploaded before that, and the ones
// imported from Airtable. Until a photo has one, /api/files serves the photo
// itself for ?v=thumb, so running this only makes the lists lighter.
//
//   node backfill-photo-thumbnails.mjs                         dry run, eddy-preview / eddy-files-preview
//   node backfill-photo-thumbnails.mjs --apply                 make them on preview
//   node backfill-photo-thumbnails.mjs --apply --target=production --i-understand-this-writes-production
//
// Options: --limit=N (at most N thumbnails this run), --concurrency=N (default 4).
// Re-running is safe: a photo whose thumbnail is there is skipped. Nothing in
// the database changes (it is only read). The report names counts and file
// ids only.

import { connect, parseArgs, pool, r2, targetDatabase, writeReport } from "./lib.mjs";
import { makeThumbnail, thumbKey } from "./thumbnails.mjs";

const args = parseArgs(process.argv.slice(2), { target: "preview", concurrency: "4" });
const { label, url, bucket } = targetDatabase(args);
const apply = args.apply === true;
const limit = args.limit ? Number(args.limit) : Infinity;

const db = await connect(url);
// People's own photos (the lists show no one else's), one per R2 object.
const { rows } = await db.query(
  `select distinct on (r2_key) id, r2_key from public.files
   where kind = 'photo' and person_id is not null and family_member_id is null
     and coalesce(content_type, '') like 'image/%'
   order by r2_key, created_at desc`,
);
await db.end();

const store = r2();
const report = { target: label, bucket, apply, photos: rows.length, alreadyHad: 0, made: 0, wouldMake: 0, failed: [] };
let budget = limit;
await pool(rows, Math.max(1, Number(args.concurrency) || 4), async (row) => {
  try {
    if (await store.exists(bucket, thumbKey(row.r2_key))) {
      report.alreadyHad++;
      return;
    }
    if (budget-- <= 0) return;
    if (!apply) {
      report.wouldMake++;
      return;
    }
    const thumb = await makeThumbnail(await store.get(bucket, row.r2_key));
    await store.put(bucket, thumbKey(row.r2_key), thumb, "image/webp", "");
    report.made++;
  } catch (err) {
    report.failed.push({ fileId: row.id, error: err instanceof Error ? err.message : String(err) });
  }
});

const file = writeReport("photo-thumbnails", report);
console.log(
  `${label}: ${report.photos} photos, ${report.alreadyHad} had a thumbnail, ` +
    (apply ? `${report.made} made` : `${report.wouldMake} would be made (dry run: add --apply)`) +
    `, ${report.failed.length} failed. Report: ${file}`,
);
if (report.failed.length) process.exitCode = 1;
