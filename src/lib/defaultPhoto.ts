import type { SyntheticEvent } from 'react';

/** Shown for anyone with no profile photo on file (owner, 2026-10-02). */
export const DEFAULT_PHOTO = '/assets/default-profile.png';

/**
 * The 128 px thumbnail of a stored photo, for an avatar: the same signed
 * link with ?v=thumb (the Worker serves the photo itself where no thumbnail
 * has been made yet). Anything else (no photo, a data URL) is returned as is.
 */
export function thumbOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /\/api\/files\/[0-9a-f-]{36}\?/.test(url) ? `${url}&v=thumb` : url;
}

/** A photo link that fails (expired or removed) falls back to the default once. */
export function fallBackToDefaultPhoto(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (!img.src.endsWith(DEFAULT_PHOTO)) img.src = DEFAULT_PHOTO;
}
