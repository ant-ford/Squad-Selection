// node --test (npm test in this folder).
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeThumbnail, thumbKey, THUMB_MAX_BYTES } from "./thumbnails.mjs";

const photo = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } } }).jpeg().toBuffer();

test("a portrait photo becomes a 128 px-wide WebP, under the Worker's 64 KB", async () => {
  const out = await makeThumbnail(await photo(1200, 1600));
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 128);
  assert.equal(meta.height, 171);
  assert.ok(out.length <= THUMB_MAX_BYTES);
});

test("a small photo is never enlarged", async () => {
  const meta = await sharp(await makeThumbnail(await photo(100, 80))).metadata();
  assert.deepEqual([meta.width, meta.height], [100, 80]);
});

test("the thumbnail sits next to the photo, as the Worker looks for it", () => {
  assert.equal(thumbKey("people/u1/photo/a.jpg"), "people/u1/photo/a.jpg.thumb");
});
