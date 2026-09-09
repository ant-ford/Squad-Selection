// Recovery from a stale client after a new deploy.
//
// Asset filenames are content-hashed, and a deploy removes the previous ones.
// A client still holding an old index.html - from the service worker precache,
// or a tab left open across a deploy - therefore asks for chunk filenames that
// no longer exist. The Worker serves static assets with SPA fallback, so those
// requests do not 404: they return index.html with status 200 and a HTML
// content type. The browser then tries to parse HTML as JavaScript, the lazy
// route never resolves, and the Suspense skeleton stays on screen forever.
//
// Reloading alone does not fix it, because the same stale precache answers the
// next load the same way. Recovery has to drop the service worker and its
// caches first, then reload to fetch a current index.html.

const RECOVERY_FLAG = 'stale-deploy-recovered';

/** True for the "chunk came back as HTML, or never arrived" family of errors. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /expected a JavaScript(?:-or-Wasm)? module/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

/**
 * Clears the service worker and its caches, then reloads - at most once per
 * tab. The guard matters: if the reload lands on the same broken state we must
 * stop and let the error surface, rather than reload forever.
 *
 * Returns false when recovery has already been attempted, so the caller can
 * show a real error instead.
 */
export async function recoverFromStaleDeploy(): Promise<boolean> {
  try {
    if (sessionStorage.getItem(RECOVERY_FLAG)) return false;
    sessionStorage.setItem(RECOVERY_FLAG, '1');
  } catch {
    // Storage blocked (private mode, embedded webview). Without the guard a
    // reload loop is possible, so do not attempt recovery at all.
    return false;
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
  } catch {
    // Best effort: a failure here still leaves the cache clear worth trying.
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Same: fall through to the reload regardless.
  }

  window.location.reload();
  return true;
}
