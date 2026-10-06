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
import { verifyFileLink } from "./data/supabase/files";
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
  if (!doc || !object) return json({ error: "That document isn't in Eddy yet.", code: "NOT_FOUND" }, 404, origin);
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
  const object = await env.FILES.get(row.r2_key);
  if (!object) {
    console.error(`File row ${id} points at a missing R2 object`);
    return notFound();
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${headerFilename(row.filename)}"`,
      // The link expires within two hours; the browser may keep it that long, nothing shared may.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
