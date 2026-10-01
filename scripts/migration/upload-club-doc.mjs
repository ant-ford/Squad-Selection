#!/usr/bin/env node
// Puts a club document (shared/application.ts CLUB_DOCS) into Eddy's
// private file storage, where the app serves it to signed-in people only.
// Club documents stay out of the public repository: the New Members Info
// Sheet lists officers' personal mobile numbers.
//
//   node upload-club-doc.mjs --name=new-members-info-sheet --file="New Members Info Sheet.pdf"            eddy-files-preview
//   ... --target=production --i-understand-this-writes-production                                          eddy-files
//
// Uploading again replaces the document.

import fs from "node:fs";
import crypto from "node:crypto";
import { parseArgs, r2, targetDatabase } from "./lib.mjs";

/** The same keys as CLUB_DOCS in shared/application.ts. */
const CLUB_DOCS = { "new-members-info-sheet": "club/new-members-info-sheet.pdf" };

const args = parseArgs(process.argv.slice(2), { target: "preview" });
const key = CLUB_DOCS[args.name];
if (!key) throw new Error(`--name must be one of: ${Object.keys(CLUB_DOCS).join(", ")}`);
if (typeof args.file !== "string" || !fs.existsSync(args.file)) throw new Error("--file must be the PDF to upload");
const body = fs.readFileSync(args.file);
if (body.subarray(0, 5).toString() !== "%PDF-") throw new Error("That file isn't a PDF");

const { label, bucket } = targetDatabase(args);
const sha256 = crypto.createHash("sha256").update(body).digest("hex");
await r2().put(bucket, key, body, "application/pdf", sha256);
console.log(`Uploaded ${args.name} (${body.length} bytes) to ${bucket} for ${label}.`);
