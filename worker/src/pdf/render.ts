/**
 * Filled PDFs: the Worker gathers a template and the images a document
 * needs from the file store, has the render-pdf Edge Function fill them
 * (supabase/functions/_shared/pdf.ts), and keeps the result as a files row
 * like any other document, so the screens that list a person's or a
 * commitment's files show it, and a signed link can hand it to Resend.
 *
 * The Worker only moves bytes here; the CPU-heavy work is the function's.
 */
import type { Env } from "../env";
import type { RenderSpec } from "../../../supabase/functions/_shared/pdf";
import { db, eq, inList } from "../data/supabase";
import { CJK_FONT_KEY, PDF_TEMPLATES, type PdfTemplate } from "./templates";

/** The renderer's name for the Chinese font asset (CJK_FONT in _shared/pdf.ts, which the Worker does not bundle). */
const CJK_FONT = "cjk-font";

export type { DocumentPart, ImageItem, RenderSpec, TextItem } from "../../../supabase/functions/_shared/pdf";

export class PdfError extends Error {
  override name = "PdfError";
}

/**
 * Whether this Worker makes PDFs: the render-pdf function is deployed to
 * its data project (PDFS = "on" in wrangler.toml, set once CI deploys it).
 */
export const pdfsEnabled = (env: Env) => env.PDFS === "on" && !!env.DATA_SUPABASE_SECRET_KEY && !!env.FILES;

export interface Asset {
  bytes: ArrayBuffer;
  type: string;
}

function files(env: Env): R2Bucket {
  if (!env.FILES) throw new PdfError("File storage is not configured");
  return env.FILES;
}

/** A blank template from the file store. */
export async function templateAsset(env: Env, name: PdfTemplate): Promise<Asset> {
  const object = await files(env).get(PDF_TEMPLATES[name].key);
  if (!object) throw new PdfError(`The ${PDF_TEMPLATES[name].title} template is not in the file store`);
  return { bytes: await object.arrayBuffer(), type: "application/pdf" };
}

/** A stored file (a signature, a photo, an ID) by its files id. */
export async function fileAsset(env: Env, fileId: string): Promise<Asset> {
  const row = await db(env).one<{ r2_key: string; content_type: string | null }>("files", `select=r2_key,content_type&id=${eq(fileId)}`);
  if (!row) throw new PdfError(`File ${fileId} was not found`);
  const object = await files(env).get(row.r2_key);
  if (!object) throw new PdfError(`File ${fileId} is missing from the file store`);
  return { bytes: await object.arrayBuffer(), type: row.content_type ?? "application/octet-stream" };
}

/**
 * Several stored files at once: one database call for all their keys, then
 * a file-store read each (those don't count towards the Worker's 50 outside
 * calls). A family's application has a dozen or more images and documents,
 * and a lookup each took it over the limit.
 */
export async function fileAssets(env: Env, fileIds: string[]): Promise<Map<string, Asset>> {
  const ids = [...new Set(fileIds.filter(Boolean))];
  const out = new Map<string, Asset>();
  if (!ids.length) return out;
  const rows = await db(env).select<{ id: string; r2_key: string; content_type: string | null }>("files", `select=id,r2_key,content_type&id=${inList(ids)}`);
  await Promise.all(
    rows.map(async (row) => {
      const object = await files(env).get(row.r2_key);
      if (!object) throw new PdfError(`File ${row.id} is missing from the file store`);
      out.set(row.id, { bytes: await object.arrayBuffer(), type: row.content_type ?? "application/octet-stream" });
    }),
  );
  for (const id of ids) if (!out.has(id)) throw new PdfError(`File ${id} was not found`);
  return out;
}

/**
 * Whether any text in the spec is beyond Latin-1 and the punctuation the
 * renderer turns into plain characters, so the Chinese font must go too.
 */
export function needsCjkFont(spec: RenderSpec): boolean {
  return /[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201b\u201c\u201d\u2026]/.test(JSON.stringify(spec));
}

export interface RenderResult {
  pdf: ArrayBuffer;
  pages: number;
  warnings: string[];
}

/** Has the render-pdf function fill a document. */
export async function renderPdf(env: Env, spec: RenderSpec, assets: Record<string, Asset>): Promise<RenderResult> {
  if (!env.DATA_SUPABASE_URL || !env.DATA_SUPABASE_SECRET_KEY) throw new PdfError("PDF rendering is not configured (DATA_SUPABASE_URL / DATA_SUPABASE_SECRET_KEY)");
  if (needsCjkFont(spec) && !assets[CJK_FONT]) {
    const font = await files(env).get(CJK_FONT_KEY);
    if (font) assets = { ...assets, [CJK_FONT]: { bytes: await font.arrayBuffer(), type: "font/ttf" } };
    else console.warn("The Chinese font is not in the file store; Chinese text is left out");
  }
  const form = new FormData();
  form.append("spec", JSON.stringify(spec));
  for (const [name, a] of Object.entries(assets)) form.append(name, new Blob([a.bytes], { type: a.type }), name);
  const res = await fetch(`${env.DATA_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/render-pdf`, {
    method: "POST",
    // The function checks this is the project's secret key (render-pdf/index.ts).
    headers: { "X-Render-Key": env.DATA_SUPABASE_SECRET_KEY },
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new PdfError(`The PDF was not made (${res.status}${body.error ? `: ${String(body.error).slice(0, 200)}` : ""})`);
  }
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(decodeURIComponent(res.headers.get("X-Render-Warnings") ?? "%5B%5D"));
  } catch {
    // warnings are diagnostics only
  }
  return { pdf: await res.arrayBuffer(), pages: Number(res.headers.get("X-Render-Pages") ?? 0), warnings };
}

export interface StoredDocument {
  kind: string;
  filename: string;
  /** Exactly the owners the files row needs: a person (people.id) and/or a commitment (commitments.id). */
  personId?: string;
  commitmentId?: string;
}

/** Keeps a filled PDF in the file store with a files row; returns the row's id. */
export async function storeDocument(env: Env, pdf: ArrayBuffer, doc: StoredDocument): Promise<string> {
  const key = `documents/${doc.kind}/${crypto.randomUUID()}.pdf`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", pdf))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await files(env).put(key, pdf, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { sha256 } });
  const [row] = await db(env).insert<{ id: string }>("files", [{
    r2_key: key,
    kind: doc.kind,
    person_id: doc.personId ?? null,
    commitment_id: doc.commitmentId ?? null,
    filename: doc.filename,
    content_type: "application/pdf",
    bytes: pdf.byteLength,
    sha256,
  }]);
  return row.id;
}

/** A filename safe everywhere: letters, digits, spaces and dashes. */
export function documentFilename(title: string, name: string): string {
  const clean = (s: string) => s.normalize("NFKD").replace(/[^A-Za-z0-9 -]/g, "").replace(/\s+/g, " ").trim();
  return `${[clean(title), clean(name)].filter(Boolean).join(" - ") || "Document"}.pdf`;
}
