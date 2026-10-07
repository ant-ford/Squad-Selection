/**
 * Web Push with WebCrypto only (no dependencies): VAPID signing (RFC 8292)
 * and payload encryption with aes128gcm (RFC 8291 over RFC 8188, one
 * record). Both the Worker and Node (the tests) provide crypto.subtle.
 *
 * The VAPID key is the VAPID_PRIVATE_KEY Worker secret: the JWK JSON of a
 * P-256 private key ({"kty":"EC","crv":"P-256","x":…,"y":…,"d":…}), as
 * scripts/vapid-keys.mjs makes it. x and y are the public key, so the app's
 * applicationServerKey is derived from the same secret.
 */

export interface VapidKey {
  /** The signing key. */
  privateKey: CryptoKey;
  /** The uncompressed public key (0x04 || x || y), base64url: the app's applicationServerKey and the k= of the header. */
  publicKey: string;
}

export interface PushTarget {
  endpoint: string;
  /** The device's public key (65 bytes uncompressed), base64url. */
  p256dh: string;
  /** The device's auth secret (16 bytes), base64url. */
  auth: string;
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── VAPID (RFC 8292) ─────────────────────────────────────────────────────

/** The key from the secret's JWK JSON. Throws on anything that isn't a P-256 private JWK. */
export async function importVapidKey(secret: string): Promise<VapidKey> {
  const jwk = JSON.parse(secret) as JsonWebKey;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error("VAPID_PRIVATE_KEY must be the JWK of a P-256 private key");
  }
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const publicKey = b64urlEncode(concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y)));
  return { privateKey, publicKey };
}

/**
 * The Authorization header for one push service: an ES256 JWT for the
 * endpoint's origin, valid for `ttlSeconds` (at most 24 h by RFC 8292).
 */
export async function vapidAuthorization(
  key: VapidKey,
  endpoint: string,
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = 12 * 3600,
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + ttlSeconds, sub: subject })));
  const input = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is r || s, which is what JWS ES256 wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, enc.encode(input));
  return `vapid t=${input}.${b64urlEncode(signature)}, k=${key.publicKey}`;
}

// ── Payload encryption (RFC 8291, aes128gcm) ─────────────────────────────

async function hkdf(salt: BufferSource, ikm: BufferSource, info: BufferSource, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** Fixed inputs for the RFC 8291 test vector; random otherwise. */
export interface EncryptOptions {
  salt?: Uint8Array<ArrayBuffer>;
  /** The application server's one-off ECDH key pair. */
  serverKeys?: CryptoKeyPair;
}

const RECORD_SIZE = 4096;

/** The encrypted body for one device: header (salt, rs, keyid) and one record. */
export async function encryptPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  plaintext: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Bad p256dh key");
  if (authSecret.length !== 16) throw new Error("Bad auth secret");
  // One record: the plaintext, the 0x02 last-record delimiter and the 16-byte tag must fit.
  if (plaintext.length + 1 + 16 > RECORD_SIZE - 86) throw new Error("Push payload too large");

  const serverKeys =
    options.serverKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", serverKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // "public" is the WebCrypto name (the Workers types spell it $public).
  const ecdh = { name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, serverKeys.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, record);
}

/**
 * What a push service is sent: headers and the encrypted body. Pass
 * `authorization` to reuse one VAPID header for every device on the same
 * push service (it depends only on the service's origin).
 */
export async function pushRequest(
  key: VapidKey,
  subject: string,
  target: PushTarget,
  payload: string,
  opts: { ttlSeconds: number; urgency: "very-low" | "low" | "normal" | "high"; topic?: string; authorization?: Promise<string> },
): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload(target, enc.encode(payload));
  const headers: Record<string, string> = {
    Authorization: await (opts.authorization ?? vapidAuthorization(key, target.endpoint, subject)),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttlSeconds),
    Urgency: opts.urgency,
  };
  // A later push with the same topic replaces one still waiting (32 url-safe chars at most).
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return { url: target.endpoint, init: { method: "POST", headers, body } };
}
