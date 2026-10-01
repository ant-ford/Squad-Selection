/**
 * POST /functions/v1/render-pdf - fills a PDF template for the Worker
 * (../_shared/pdf.ts). Only the Worker calls it: the request must carry
 * this project's secret API key (X-Render-Key, the Worker's
 * DATA_SUPABASE_SECRET_KEY), and anything else is a bare 403. The key is
 * checked by asking the project's Data API for a table only the secret key
 * may read, so no extra secret is shared. Beyond that check it reads no
 * data and holds no storage keys; everything it draws arrives in the
 * request.
 *
 * Request: multipart/form-data with `spec` (RenderSpec as JSON) and one
 * file part per asset, named as the spec names it.
 * Response: the PDF, with X-Render-Pages and X-Render-Warnings (JSON,
 * URI-encoded); or 422 {error} when the spec cannot be rendered.
 */
import { renderDocument, RenderError, type RenderSpec } from "../_shared/pdf.ts";

/** Hashes of keys already shown to be this project's secret key, for this instance's life. */
const verified = new Set<string>();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * True when `key` is this project's secret key: only that key may read
 * public.files (no rows are asked for). A publishable key, a wrong key or
 * an outage all answer no.
 */
async function isSecretKey(key: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || key.length < 20 || !url) return false;
  const hash = await sha256(key);
  if (verified.has(hash)) return true;
  const res = await fetch(`${url}/rest/v1/files?select=id&limit=0`, { headers: { apikey: key } });
  await res.body?.cancel();
  if (!res.ok) return false;
  verified.add(hash);
  return true;
}

const MAX_REQUEST_BYTES = 40_000_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!(await isSecretKey(req.headers.get("x-render-key") ?? ""))) return new Response("Forbidden", { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });

  let spec: RenderSpec;
  const assets: Record<string, Uint8Array> = {};
  try {
    const form = await req.formData();
    spec = JSON.parse(String(form.get("spec") ?? ""));
    for (const [name, value] of form.entries()) {
      if (value instanceof File) assets[name] = new Uint8Array(await value.arrayBuffer());
    }
  } catch {
    return Response.json({ error: "Expected multipart form data with a JSON spec" }, { status: 400 });
  }

  try {
    const started = performance.now();
    const { pdf, pages, warnings } = await renderDocument(spec, assets);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "X-Render-Pages": String(pages),
        "X-Render-Ms": String(Math.round(performance.now() - started)),
        "X-Render-Warnings": encodeURIComponent(JSON.stringify(warnings.slice(0, 20))),
      },
    });
  } catch (err) {
    if (err instanceof RenderError) return Response.json({ error: err.message }, { status: 422 });
    console.error("render-pdf failed:", err instanceof Error ? err.stack : err);
    return Response.json({ error: "Rendering failed" }, { status: 500 });
  }
});
