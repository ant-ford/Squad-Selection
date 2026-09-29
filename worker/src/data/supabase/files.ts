/**
 * Links to stored files (photos, documents) on the Supabase backend.
 *
 * Files live in a private R2 bucket. A link is minted only inside an
 * authenticated API response, is signed, carries nothing but the file row's
 * uuid, and expires within two hours - the access check is the request that
 * returned it. GET /api/files/:id serves the bytes after checking the
 * signature and expiry.
 *
 * The signing key is derived from the data project's secret key, so no new
 * secret is needed; rotating that key simply retires every link.
 */
import type { Env } from "../../env";

const HOUR = 60 * 60;

async function signingKey(env: Env): Promise<CryptoKey> {
  const secret = env.DATA_SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("DATA_SUPABASE_SECRET_KEY is not set");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, new TextEncoder().encode("eddy:file-links:v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A signed link to one file row. Expiry is rounded up to the next hour plus
 * one, so every response in the same hour hands out the same link (cacheable
 * by the browser) and a link is good for one to two hours.
 */
export async function fileLink(env: Env, fileId: string, now = Date.now()): Promise<string> {
  const exp = (Math.ceil(now / 1000 / HOUR) + 1) * HOUR;
  const sig = hex(await crypto.subtle.sign("HMAC", await signingKey(env), new TextEncoder().encode(`${fileId}.${exp}`)));
  const origin = (env.API_ORIGIN ?? "").replace(/\/+$/, "");
  return `${origin}/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

/** True when `sig` is this Worker's signature for the file and it has not expired. */
export async function verifyFileLink(env: Env, fileId: string, exp: string, sig: string, now = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(fileId) || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Number(exp) * 1000 < now) return false;
  const bytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await signingKey(env), bytes, new TextEncoder().encode(`${fileId}.${exp}`));
}
