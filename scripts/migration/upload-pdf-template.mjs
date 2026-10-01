#!/usr/bin/env node
// Puts a blank PDF template, or the Chinese font, (worker/src/pdf/templates.ts)
// into Eddy's private file storage, where the PDF renderer reads it.
// Templates stay out of the public repository like the club documents do.
//
//   node upload-pdf-template.mjs --name=player-statement --file="Section_DSA_Player_Statement_Fillable.pdf"   eddy-files-preview
//   ... --target=production --i-understand-this-writes-production                                              eddy-files
//
// Uploading again replaces the file. The Sports Associate application was
// uploaded as a lighter copy (10.1 MB -> 2.1 MB): Illustrator's private
// editing data removed and the page 10-11 Direct Debit scan re-encoded at
// 200 dpi. Its fields are unchanged. The Chinese font (--name=cjk-font) is
// Noto Sans TC Regular as a static TrueType cut down to Big5-HKSCS, with
// every glyph padded to an even length: pdf-lib's subsetter halves glyph
// offsets, so one odd-length glyph garbles every glyph after it.

import fs from "node:fs";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { parseArgs, r2, targetDatabase } from "./lib.mjs";

/** The same keys and page counts as worker/src/pdf/templates.ts. */
const PDF_TEMPLATES = {
  "sports-associate-application": { key: "templates/sports-associate-application-2024-06.pdf", pages: 12 },
  "section-membership-levy": { key: "templates/section-membership-levy-2025-05.pdf", pages: 1 },
  "player-statement": { key: "templates/player-statement.pdf", pages: 2 },
  "commitment-pledge": { key: "templates/commitment-pledge-2026-04.pdf", pages: 2 },
  "u18-registration": { key: "templates/u18-registration.pdf", pages: 2 },
};
const FONTS = { "cjk-font": { key: "templates/fonts/noto-sans-tc-regular.ttf" } };

const args = parseArgs(process.argv.slice(2), { target: "preview" });
const template = PDF_TEMPLATES[args.name];
const font = FONTS[args.name];
if (!template && !font) throw new Error(`--name must be one of: ${[...Object.keys(PDF_TEMPLATES), ...Object.keys(FONTS)].join(", ")}`);
if (typeof args.file !== "string" || !fs.existsSync(args.file)) throw new Error("--file must be the file to upload");
const body = fs.readFileSync(args.file);

if (template) {
  if (body.subarray(0, 5).toString() !== "%PDF-") throw new Error("That file isn't a PDF");
  const pages = (await PDFDocument.load(body)).getPageCount();
  if (pages !== template.pages) throw new Error(`Expected ${template.pages} pages for ${args.name}, found ${pages}`);
} else {
  if (body.readUInt32BE(0) !== 0x00010000) throw new Error("That file isn't a TrueType font");
  if (!evenGlyphs(body)) throw new Error("The font's glyphs are not padded to an even length (save it with fontTools glyf.padding = 4)");
}

/** True when every glyph offset in the font's loca table is even. */
function evenGlyphs(font) {
  const tables = {};
  for (let i = 0, n = font.readUInt16BE(4); i < n; i++) {
    const at = 12 + i * 16;
    tables[font.toString("latin1", at, at + 4)] = { offset: font.readUInt32BE(at + 8), length: font.readUInt32BE(at + 12) };
  }
  const { head, loca } = tables;
  if (!head || !loca) return false;
  if (font.readInt16BE(head.offset + 50) === 0) return true; // short loca stores offsets halved
  for (let at = loca.offset; at < loca.offset + loca.length; at += 4) if (font.readUInt32BE(at) % 2) return false;
  return true;
}

const { label, bucket } = targetDatabase(args);
const sha256 = crypto.createHash("sha256").update(body).digest("hex");
const { key } = template ?? font;
await r2().put(bucket, key, body, template ? "application/pdf" : "font/ttf", sha256);
console.log(`Uploaded ${args.name} (${body.length} bytes, sha256 ${sha256.slice(0, 12)}) to ${bucket} for ${label}.`);
