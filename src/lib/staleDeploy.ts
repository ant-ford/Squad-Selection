// Recovery from a stale client after a new deploy.
//
// Asset filenames are content-hashed, and a deploy removes the previous ones.
// A client still holding an old index.html - a tab left open across a deploy,
// or a page loaded by the previous service worker - therefore asks for chunk
// filenames that no longer exist. They 404 (web-shell/index.ts), the import
// rejects, and without recovery the Suspense skeleton stays on screen.
//
// A plain reload is tried first. By the time a chunk has gone missing the new
// service worker has normally taken over (skipWaiting + clientsClaim) and its
// precache holds the current index.html, and other navigations go to the
// network first (vite.config.ts). The same error also comes from a dropped
// connection, where clearing everything would leave nothing to load from.
//
// If the reload lands on the same failure, the cached shell itself is stale,
// so the second attempt drops the service worker and its caches before
// reloading. After that we stop and let the error surface.

const RECOVERY_FLAG = 'stale-deploy-recovered';

/** Value of RECOVERY_FLAG after the first step, kept across the reload. */
const RELOADED = 'reloaded';

/** Set once recovery has started in this page, so a failure reported by several listeners acts once. */
let recovering = false;

/** True for the "chunk came back as HTML, or never arrived" family of errors. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /expected a JavaScript(?:-or-Wasm)? module/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

/**
 * Reloads; on a second failure in the same tab, clears the service worker and
 * its caches first. At most those two reloads per tab: if the state is still
 * broken after both we stop rather than reload forever.
 *
 * Returns false when recovery has been used up, so the caller can show a real
 * error instead.
 */
export async function recoverFromStaleDeploy(): Promise<boolean> {
  // One failure reaches us from preloadError, unhandledrejection and the
  // route error element; only the first call may move recovery on a step.
  if (recovering) return true;

  let step: string | null;
  try {
    step = sessionStorage.getItem(RECOVERY_FLAG);
    // Any other value - including '1' from the version of this code that
    // cleared everything straight away - means both steps have been used.
    if (step !== null && step !== RELOADED) return false;
    sessionStorage.setItem(RECOVERY_FLAG, step === null ? RELOADED : 'cleared');
  } catch {
    // Storage blocked (private mode, embedded webview). Without the guard a
    // reload loop is possible, so do not attempt recovery at all.
    return false;
  }
  recovering = true;

  if (step === RELOADED) await clearServiceWorker();

  window.location.reload();
  return true;
}

async function clearServiceWorker(): Promise<void> {
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
}
