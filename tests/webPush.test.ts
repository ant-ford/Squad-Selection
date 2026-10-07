import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, importVapidKey, pushRequest, vapidAuthorization } from "../worker/src/webPush";

// RFC 8291 Appendix A: fixed keys and salt, so the message is exact.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** A P-256 key pair from its uncompressed public key and private scalar. */
async function ecdhPair(publicB64: string, privateB64: string): Promise<CryptoKeyPair> {
  const pub = b64urlDecode(publicB64);
  const x = b64urlEncode(pub.slice(1, 33));
  const y = b64urlEncode(pub.slice(33, 65));
  const alg = { name: "ECDH", namedCurve: "P-256" };
  return {
    publicKey: await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y }, alg, true, []),
    privateKey: await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y, d: privateB64 }, alg, true, ["deriveBits"]),
  };
}

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: string | Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const infoBytes = typeof info === "string" ? enc.encode(info) : info;
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: infoBytes }, key, bytes * 8));
}

/** The device's side, written out from RFC 8291 independently of the module. */
async function decrypt(message: Uint8Array<ArrayBuffer>, ua: CryptoKeyPair, auth: Uint8Array<ArrayBuffer>): Promise<string> {
  const salt = message.slice(0, 16);
  const idlen = message[20];
  const asPublic = message.slice(21, 21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, message.slice(21 + idlen)));
  expect(plain[plain.length - 1]).toBe(2); // the last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("aes128gcm payload encryption (RFC 8291)", () => {
  it("matches the RFC 8291 Appendix A test vector exactly", async () => {
    const serverKeys = await ecdhPair(RFC.asPublic, RFC.asPrivate);
    const out = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, enc.encode(RFC.plaintext), {
      salt: b64urlDecode(RFC.salt),
      serverKeys,
    });
    expect(b64urlEncode(out)).toBe(RFC.message);
  });

  it("encrypts with a fresh key and salt each time, and the device can read it", async () => {
    const ua = await ecdhPair(RFC.uaPublic, RFC.uaPrivate);
    const a = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, enc.encode("hello"));
    const b = await encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, enc.encode("hello"));
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
    expect(new DataView(a.buffer).getUint32(16)).toBe(4096);
    expect(a[20]).toBe(65);
    expect(await decrypt(a, ua, b64urlDecode(RFC.auth))).toBe("hello");
  });

  it("refuses bad device keys and oversized payloads", async () => {
    await expect(encryptPayload({ p256dh: "AAAA", auth: RFC.auth }, enc.encode("x"))).rejects.toThrow(/p256dh/);
    await expect(encryptPayload({ p256dh: RFC.uaPublic, auth: "AAAA" }, enc.encode("x"))).rejects.toThrow(/auth/);
    await expect(encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new Uint8Array(4000))).rejects.toThrow(/too large/);
  });
});

async function generatedVapidJwk(): Promise<{ secret: string; verify: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { secret: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)), verify: pair.publicKey };
}

describe("VAPID (RFC 8292)", () => {
  it("derives the public key from the private JWK", async () => {
    const { secret, verify } = await generatedVapidJwk();
    const key = await importVapidKey(secret);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", verify));
    expect(key.publicKey).toBe(b64urlEncode(raw));
    expect(b64urlDecode(key.publicKey)).toHaveLength(65);
  });

  it("signs an ES256 JWT for the endpoint's origin that verifies with the public key", async () => {
    const { secret, verify } = await generatedVapidJwk();
    const key = await importVapidKey(secret);
    const header = await vapidAuthorization(key, "https://fcm.googleapis.com/fcm/send/abc", "mailto:x@example.com", 1_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m!;
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_000_000 + 12 * 3600,
      sub: "mailto:x@example.com",
    });
    expect(k).toBe(key.publicKey);
    const signature = b64urlDecode(sig);
    expect(signature).toHaveLength(64);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verify, signature, enc.encode(`${h}.${c}`))).toBe(true);
  });

  it("refuses a secret that isn't a P-256 private JWK", async () => {
    await expect(importVapidKey(JSON.stringify({ kty: "EC", crv: "P-256", x: "a", y: "b" }))).rejects.toThrow(/P-256 private/);
    await expect(importVapidKey("not json")).rejects.toThrow();
  });

  it("builds the push request with the headers push services need", async () => {
    const { secret } = await generatedVapidJwk();
    const key = await importVapidKey(secret);
    const { url, init } = await pushRequest(key, "mailto:x@example.com", { endpoint: "https://push.example/abc", p256dh: RFC.uaPublic, auth: RFC.auth }, "{}", {
      ttlSeconds: 43200,
      urgency: "high",
      topic: "squad:rec123/home!",
    });
    expect(url).toBe("https://push.example/abc");
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "43200", Urgency: "high", Topic: "squadrec123home" });
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(init.body).toBeInstanceOf(Uint8Array);
  });
});
