/**
 * Drawn signatures: a PNG from the screen's signature pad, checked and kept
 * in R2 (FILES) with a files row on the person it belongs to. Used by the
 * commitment reviews (the signer's own signature, kind 'signature') and the
 * waivers (a parent or guardian's, kind 'guardian_consent_signature', filed
 * on the player).
 */
import type { Env } from "./env";
import { HttpError } from "./http";
import { db } from "./data/supabase";

/** A drawn signature is a small PNG; anything larger is not one. */
const MAX_SIGNATURE_BYTES = 200_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A drawn signature (PNG data URL) as bytes, or a 400. */
export function signatureBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError("The signature is not a PNG image.", 400, "INVALID_INPUT");
  const bin = atob(m[1]);
  if (bin.length > MAX_SIGNATURE_BYTES) throw new HttpError("The signature image is too large.", 400, "INVALID_INPUT");
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) throw new HttpError("The signature is not a PNG image.", 400, "INVALID_INPUT");
  return bytes;
}

/** Stores a drawn signature on a person (people.id) and returns its files id. */
export async function storeSignature(
  env: Env,
  personUuid: string,
  dataUrl: string,
  kind: "signature" | "guardian_consent_signature",
): Promise<string> {
  const bytes = signatureBytes(dataUrl);
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const key = `signatures/${personUuid}/${crypto.randomUUID()}.png`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { sha256 } });
  const [file] = await db(env).insert<{ id: string }>("files", [{
    r2_key: key, kind, person_id: personUuid, filename: kind === "signature" ? "signature.png" : "guardian-signature.png",
    content_type: "image/png", bytes: bytes.length, sha256,
  }]);
  return file.id;
}
