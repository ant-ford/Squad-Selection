/**
 * GET /api/files/:id?exp=&sig= - one stored file (a photo, a document).
 * Public in the sense that the calendar feeds are: it
 * needs no session, because the link itself is the permission - minted only
 * inside an authenticated response, signed, and expiring within two hours
 * (data/supabase/files.ts). Anything wrong with the link is a plain 404, so a
 * probe learns nothing about which files exist.
 */
import type { Env } from "./env";
import { db, eq } from "./data/supabase";
import { thumbKey, verifyFileLink } from "./data/supabase/files";
import { corsHeaders, json } from "./http";
import { CLUB_DOCS } from "../../shared/application";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** A filename safe for a Content-Disposition header (ASCII, no quotes or control characters). */
function headerFilename(name: string | null): string {
  const safe = (name ?? "file").normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\\r\n]/g, "").trim();
  return safe || "file";
}

/** A club document (CLUB_DOCS) to a signed-in person; the caller checks the sign-in. */
export async function serveClubDoc(env: Env, name: string, origin: string): Promise<Response> {
  const doc = (CLUB_DOCS as Record<string, { title: string; key: string }>)[name];
  const object = doc && env.FILES ? await env.FILES.get(doc.key) : null;
  if (!doc || !object) return json({ error: "That document hasn't been uploaded yet.", code: "NOT_FOUND" }, 404, origin);
  return new Response(object.body, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${headerFilename(`${doc.title}.pdf`)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleFileRequest(env: Env, id: string, url: URL): Promise<Response> {
  const exp = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!env.FILES || !env.DATA_SUPABASE_SECRET_KEY) return notFound();
  if (!(await verifyFileLink(env, id, exp, sig))) return notFound();

  const row = await db(env).one<{ r2_key: string; content_type: string | null; filename: string | null }>(
    "files",
    `select=r2_key,content_type,filename&id=${eq(id)}`,
  );
  if (!row) return notFound();
  // ?v=thumb: the 128 px thumbnail of a photo, where there is one; otherwise
  // the photo itself (not yet backfilled). The same link opens both: a
  // thumbnail shows nothing the photo doesn't.
  const thumb = url.searchParams.get("v") === "thumb" && (row.content_type ?? "").startsWith("image/")
    ? await env.FILES.get(thumbKey(row.r2_key))
    : null;
  const object = thumb ?? (await env.FILES.get(row.r2_key));
  if (!object) {
    console.error(`File row ${id} points at a missing R2 object`);
    return notFound();
  }
  // Until the link expires (at most two days); the browser may keep it that long, nothing shared may.
  const maxAge = Math.max(0, Math.min(2 * 24 * 3600, Number(exp) - Math.floor(Date.now() / 1000)));
  return new Response(object.body, {
    headers: {
      "Content-Type": (thumb ? thumb.httpMetadata?.contentType : row.content_type) || "application/octet-stream",
      "Content-Disposition": `inline; filename="${headerFilename(row.filename)}"`,
      "Cache-Control": `private, max-age=${maxAge}`,
      "X-Content-Type-Options": "nosniff",
      // The app's service worker keeps pictures (CacheFirst, vite.config.ts):
      // it fetches them with CORS, so they're stored as readable responses,
      // not opaque ones. The link is the permission, from any origin.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
