import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { fileLink, photoLink, PHOTO_LINK_BUCKET, thumbKey } from "../worker/src/data/supabase/files";
import { handleFileRequest } from "../worker/src/files";
import { thumbnailBytes, uploadFile } from "../worker/src/details";
import { getActiveRanking } from "../worker/src/ranking";
import { invalidateAll } from "../worker/src/cache";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import { personRow, rankingDb } from "./helpers/rankingDb";
import { recId } from "./helpers/factories";

// ---------------------------------------------------------------------------
// Photo links (C6): signed only where a photo is shown, a day's link so a
// list's pictures are fetched once, and a 128 px thumbnail kept next to each
// photo (thumbKey) for the small avatars, asked for with ?v=thumb.
// ---------------------------------------------------------------------------

const API = "https://api.test";
const env = { ...SUPABASE_TEST_ENV, API_ORIGIN: API } as unknown as Env;
const FILE = "11111111-2222-3333-4444-555555555555";
const DAY = 24 * 3600;

/** An in-memory R2 bucket: put / get / delete (one key or several). */
function bucket(seed: Record<string, { body: string; type: string }> = {}) {
  const objects = new Map(Object.entries(seed));
  const deleted: string[] = [];
  const r2 = {
    async put(key: string, body: Uint8Array, opts: { httpMetadata?: { contentType?: string } } = {}) {
      objects.set(key, { body: new TextDecoder().decode(body), type: opts.httpMetadata?.contentType ?? "" });
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: o.body, httpMetadata: { contentType: o.type } } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        deleted.push(k);
        objects.delete(k);
      }
    },
  };
  return { r2: r2 as unknown as R2Bucket, objects, deleted };
}

const linkParts = (link: string) => {
  const u = new URL(link);
  return { exp: Number(u.searchParams.get("exp")), sig: u.searchParams.get("sig")!, url: u };
};

beforeEach(() => invalidateAll());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("photo links", () => {
  it("last a day's bucket (one to two days); documents keep the hour's", async () => {
    const now = Date.parse("2026-10-07T05:20:00Z");
    const photo = linkParts(await photoLink(env, FILE, now));
    expect(photo.exp % PHOTO_LINK_BUCKET).toBe(0);
    expect(photo.exp - now / 1000).toBeGreaterThan(DAY);
    expect(photo.exp - now / 1000).toBeLessThanOrEqual(2 * DAY);
    // The same link all day, so the browser and the service worker keep one copy.
    expect(await photoLink(env, FILE, now + 6 * 3600_000)).toBe(await photoLink(env, FILE, now));
    const doc = linkParts(await fileLink(env, FILE, now));
    expect(doc.exp - now / 1000).toBeLessThanOrEqual(2 * 3600);
  });
});

describe("GET /api/files/:id", () => {
  async function serve(r2: R2Bucket, link: string, contentType = "image/jpeg") {
    fakePostgrest({ tables: { files: [{ id: FILE, r2_key: "people/u1/photo/a.jpg", content_type: contentType, filename: "photo.jpg" }] } });
    const { url } = linkParts(link);
    return handleFileRequest({ ...env, FILES: r2 } as Env, FILE, url);
  }

  it("serves the thumbnail for ?v=thumb, readable from the app's origin, until the link expires", async () => {
    const { r2 } = bucket({ "people/u1/photo/a.jpg": { body: "PHOTO", type: "image/jpeg" }, [thumbKey("people/u1/photo/a.jpg")]: { body: "THUMB", type: "image/webp" } });
    const link = await photoLink(env, FILE);
    const res = await serve(r2, `${link}&v=thumb`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("THUMB");
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control")!)![1]);
    expect(maxAge).toBeGreaterThan(DAY - 60);
    expect(maxAge).toBeLessThanOrEqual(2 * DAY);
    // Without ?v=thumb, the photo.
    expect(await (await serve(r2, link)).text()).toBe("PHOTO");
  });

  it("falls back to the photo where there is no thumbnail yet, and never looks for one for a document", async () => {
    const { r2 } = bucket({ "people/u1/photo/a.jpg": { body: "PHOTO", type: "image/jpeg" } });
    expect(await (await serve(r2, `${await photoLink(env, FILE)}&v=thumb`)).text()).toBe("PHOTO");
    const get = vi.spyOn(r2, "get");
    await serve(r2, `${await fileLink(env, FILE)}&v=thumb`, "application/pdf");
    expect(get.mock.calls.map((c) => c[0])).toEqual(["people/u1/photo/a.jpg"]);
  });

  it("still refuses a link with a bad signature", async () => {
    const { r2 } = bucket({ "people/u1/photo/a.jpg": { body: "PHOTO", type: "image/jpeg" } });
    const link = await photoLink(env, FILE);
    expect((await serve(r2, `${link.replace(/sig=./, "sig=0")}&v=thumb`)).status).toBe(404);
  });
});

describe("uploading a photo with its thumbnail", () => {
  const user = { email: "p@x.com", personId: "recME", officerRoles: [] } as unknown as AuthorizedUser;
  const b64 = (s: string) => btoa(s);

  it("keeps the app's thumbnail next to the photo, and removes the old photo's with it", async () => {
    const pg = fakePostgrest({
      tables: {
        people: [{ id: "u1", api_id: "recME", hkid_hidden: false }],
        files: [{ id: "old-file", r2_key: "people/u1/photo/old.jpg", person_id: "u1", kind: "photo" }],
      },
    });
    const { r2, objects, deleted } = bucket();
    const out = await uploadFile({ ...env, FILES: r2 } as Env, user, "photo", {
      dataUrl: `data:image/jpeg;base64,${b64("PHOTO")}`,
      thumbDataUrl: `data:image/webp;base64,${b64("THUMB")}`,
    });
    const key = [...objects.keys()].find((k) => !k.endsWith(".thumb"))!;
    expect(objects.get(thumbKey(key))).toEqual({ body: "THUMB", type: "image/webp" });
    expect(deleted.sort()).toEqual(["people/u1/photo/old.jpg", thumbKey("people/u1/photo/old.jpg")].sort());
    // The link it hands back is a photo's (a day's).
    expect(linkParts(out.url!).exp - Date.now() / 1000).toBeGreaterThan(DAY - 60);
    expect(pg.problems).toEqual([]);
  });

  it("stores the photo without a thumbnail that isn't a small WebP or JPEG", () => {
    expect(thumbnailBytes(`data:image/webp;base64,${b64("x")}`)?.type).toBe("image/webp");
    expect(thumbnailBytes(`data:image/jpeg;base64,${b64("x")}`)?.type).toBe("image/jpeg");
    expect(thumbnailBytes(`data:image/png;base64,${b64("x")}`)).toBeNull();
    expect(thumbnailBytes(`data:image/webp;base64,${b64("x".repeat(70_000))}`)).toBeNull();
    expect(thumbnailBytes(undefined)).toBeNull();
  });
});

describe("photos signed where they're shown", () => {
  it("the ranking signs each player's photo (a day's link) and doesn't send the file id", async () => {
    rankingDb({
      people: [
        personRow("A1", { active: true, section_rank: 1, photo_file_id: FILE }),
        personRow("A2", { active: true, section_rank: 2, photo_file_id: null }),
      ],
    });
    const { players } = await getActiveRanking(env);
    const [a1, a2] = players;
    expect(a1.id).toBe(recId("A1"));
    expect(a1.photo).toBe(await photoLink(env, FILE));
    expect(a1).not.toHaveProperty("photoFileId");
    expect(a2.photo).toBeUndefined();
  });
});
