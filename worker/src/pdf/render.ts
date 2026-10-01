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
import { db, eq } from "../data/supabase";
import { PDF_TEMPLATES, type PdfTemplate } from "./templates";

export type { RenderSpec } from "../../../supabase/functions/_shared/pdf";

export class PdfError extends Error {
  override name = "PdfError";
}

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

export interface RenderResult {
  pdf: ArrayBuffer;
  pages: number;
  warnings: string[];
}

/** Has the render-pdf function fill a document. */
export async function renderPdf(env: Env, spec: RenderSpec, assets: Record<string, Asset>): Promise<RenderResult> {
  if (!env.DATA_SUPABASE_URL || !env.PDF_RENDER_SECRET) throw new PdfError("PDF rendering is not configured (DATA_SUPABASE_URL / PDF_RENDER_SECRET)");
  const form = new FormData();
  form.append("spec", JSON.stringify(spec));
  for (const [name, a] of Object.entries(assets)) form.append(name, new Blob([a.bytes], { type: a.type }), name);
  const res = await fetch(`${env.DATA_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/render-pdf`, {
    method: "POST",
    headers: { "X-Render-Secret": env.PDF_RENDER_SECRET },
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
