// Photo thumbnails, as the app makes them (FileUpload.tsx) and the Worker
// keeps them (details.ts, data/supabase/files.ts thumbKey). Used by
// backfill-photo-thumbnails.mjs; tested by thumbnails.test.mjs.

import sharp from "sharp";

/** The shorter side, in pixels. */
export const THUMB_SIDE = 128;
/** The Worker refuses a thumbnail over this (details.ts THUMB_MAX_BYTES). */
export const THUMB_MAX_BYTES = 64 * 1024;

/** Where a photo's thumbnail sits in R2: next to the photo. */
export const thumbKey = (key) => `${key}.thumb`;

/** A photo's thumbnail: 128 px on the shorter side (never enlarged), upright, WebP under 64 KB. */
export async function makeThumbnail(photo) {
  for (const quality of [80, 60, 40]) {
    const out = await sharp(photo)
      .rotate() // EXIF orientation, as the browser shows it
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "outside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    if (out.length <= THUMB_MAX_BYTES) return out;
  }
  throw new Error("thumbnail over 64 KB");
}
