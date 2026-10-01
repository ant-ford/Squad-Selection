#!/usr/bin/env node
// Puts a blank PDF template (shared/pdf/templates.ts PDF_TEMPLATES) into
// Eddy's private file storage, where the PDF renderer reads it. Templates
// stay out of the public repository like the club documents do.
//
//   node upload-pdf-template.mjs --name=player-statement --file="Section_DSA_Player_Statement_Fillable.pdf"   eddy-files-preview
//   ... --target=production --i-understand-this-writes-production                                              eddy-files
//
// Uploading again replaces the template. The Sports Associate application
// was uploaded as a lighter copy (10.1 MB -> 2.1 MB): Illustrator's private
// editing data removed and the page 10-11 Direct Debit scan re-encoded at
// 200 dpi. Its fields are unchanged.

import fs from "node:fs";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { parseArgs, r2, targetDatabase } from "./lib.mjs";

/** The same keys and page counts as PDF_TEMPLATES in shared/pdf/templates.ts. */
const PDF_TEMPLATES = {
  "sports-associate-application": { key: "templates/sports-associate-application-2024-06.pdf", pages: 12 },
  "section-membership-levy": { key: "templates/section-membership-levy-2025-05.pdf", pages: 1 },
  "player-statement": { key: "templates/player-statement.pdf", pages: 2 },
  "commitment-pledge": { key: "templates/commitment-pledge-2026-04.pdf", pages: 2 },
  "u18-registration": { key: "templates/u18-registration.pdf", pages: 2 },
};

const args = parseArgs(process.argv.slice(2), { target: "preview" });
const template = PDF_TEMPLATES[args.name];
if (!template) throw new Error(`--name must be one of: ${Object.keys(PDF_TEMPLATES).join(", ")}`);
if (typeof args.file !== "string" || !fs.existsSync(args.file)) throw new Error("--file must be the PDF to upload");
const body = fs.readFileSync(args.file);
if (body.subarray(0, 5).toString() !== "%PDF-") throw new Error("That file isn't a PDF");
const pages = (await PDFDocument.load(body)).getPageCount();
if (pages !== template.pages) throw new Error(`Expected ${template.pages} pages for ${args.name}, found ${pages}`);

const { label, bucket } = targetDatabase(args);
const sha256 = crypto.createHash("sha256").update(body).digest("hex");
await r2().put(bucket, template.key, body, "application/pdf", sha256);
console.log(`Uploaded ${args.name} (${body.length} bytes, sha256 ${sha256.slice(0, 12)}) to ${bucket} for ${label}.`);
