/**
 * Links to stored files (photos, documents) on the Supabase backend.
 *
 * Files live in a private R2 bucket. A link is minted only inside an
 * authenticated API response, is signed, carries nothing but the file row's
 * uuid, and expires within two hours (two days for photos and posters,
 * photoLink) - the access check is the request that returned it. GET
 * /api/files/:id serves the bytes after checking the signature and expiry.
 *
 * The signing key is derived from the data project's secret key, so no new
 * secret is needed; rotating that key simply retires every link.
 */
import type { Env } from "../../env";

const HOUR = 60 * 60;

/**
 * Derived once per isolate and secret, not per link: a list of players signs
 * a photo link each, and re-deriving it every time was most of that CPU.
 */
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function signingKey(env: Env): Promise<CryptoKey> {
  const secret = env.DATA_SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("DATA_SUPABASE_SECRET_KEY is not set");
  if (cachedKey?.secret !== secret) {
    const key = (async () => {
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const derived = await crypto.subtle.sign("HMAC", base, new TextEncoder().encode("eddy:file-links:v1"));
      return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    })();
    // A failed derivation isn't kept.
    key.catch(() => {
      if (cachedKey?.key === key) cachedKey = null;
    });
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A signed link to one file row. Expiry is rounded up to the next bucket
 * plus one, so every response in the same bucket hands out the same link
 * (cacheable by the browser and the service worker) and a link is good for
 * one to two buckets: an hour for documents (an HKID copy, a statement).
 */
export async function fileLink(env: Env, fileId: string, now = Date.now(), bucket = HOUR): Promise<string> {
  const exp = (Math.ceil(now / 1000 / bucket) + 1) * bucket;
  const sig = hex(await crypto.subtle.sign("HMAC", await signingKey(env), new TextEncoder().encode(`${fileId}.${exp}`)));
  const origin = (env.API_ORIGIN ?? "").replace(/\/+$/, "");
  return `${origin}/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

/** Photos and posters: a day's bucket, so a list's pictures keep one link (one download) for a day. */
export const PHOTO_LINK_BUCKET = 24 * HOUR;

/**
 * A signed link to a photo or poster, good for one to two days. Sign it only
 * where the picture is shown: each link is an HMAC. `&v=thumb` on the same
 * link asks for the 128 px thumbnail (thumbKey), where there is one.
 */
export function photoLink(env: Env, fileId: string, now = Date.now()): Promise<string> {
  return fileLink(env, fileId, now, PHOTO_LINK_BUCKET);
}

/**
 * Where a photo's 128 px thumbnail is kept in R2: next to the photo, so it
 * goes wherever the photo's key goes (replaced, queued for deletion).
 */
export const thumbKey = (r2Key: string) => `${r2Key}.thumb`;

/** True when `sig` is this Worker's signature for the file and it has not expired. */
export async function verifyFileLink(env: Env, fileId: string, exp: string, sig: string, now = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(fileId) || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Number(exp) * 1000 < now) return false;
  const bytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await signingKey(env), bytes, new TextEncoder().encode(`${fileId}.${exp}`));
}
