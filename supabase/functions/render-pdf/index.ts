/**
 * POST /functions/v1/render-pdf - fills a PDF template for the Worker
 * (../_shared/pdf.ts). Only the Worker calls it: the request must carry
 * the shared PDF_RENDER_SECRET, and anything else is a bare 403. It reads
 * no database and holds no storage keys; everything it draws arrives in
 * the request.
 *
 * Request: multipart/form-data with `spec` (RenderSpec as JSON) and one
 * file part per asset, named as the spec names it.
 * Response: the PDF, with X-Render-Pages and X-Render-Warnings (JSON,
 * URI-encoded); or 422 {error} when the spec cannot be rendered.
 */
import { renderDocument, RenderError, type RenderSpec } from "../_shared/pdf.ts";

/** Compares two secrets without leaking where they differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const MAX_REQUEST_BYTES = 40_000_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("PDF_RENDER_SECRET");
  if (!secret || !sameSecret(req.headers.get("x-render-secret") ?? "", secret)) return new Response("Forbidden", { status: 403 });
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
