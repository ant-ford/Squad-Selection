import type { SyntheticEvent } from 'react';

/** Shown for anyone with no profile photo on file (owner, 2026-10-02). */
export const DEFAULT_PHOTO = '/assets/default-profile.png';

/** A photo link that fails (expired or removed) falls back to the default once. */
export function fallBackToDefaultPhoto(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (!img.src.endsWith(DEFAULT_PHOTO)) img.src = DEFAULT_PHOTO;
}
