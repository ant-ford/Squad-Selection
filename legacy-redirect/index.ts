/**
 * Rescue Worker for the retired *.workers.dev hostname.
 *
 * Deployed to the OLD Cloudflare account, whose Workers were deleted when
 * everything moved to eddy.global. Anyone still holding the old address -
 * a bookmark, a link in a WhatsApp thread, an app installed to their home
 * screen - currently gets nothing useful from it.
 *
 * A plain redirect only rescues half of them. The other half installed the
 * app, so a service worker on that origin still answers navigations from
 * its own cache: they see the old app shell, every API call fails against
 * an address that no longer exists, and the loading skeleton never
 * resolves. No redirect reaches them, because the network is never asked.
 *
 * So this serves two things:
 *
 *   /sw.js        a service worker whose whole job is to dismantle the one
 *                 already installed - it clears the caches, unregisters
 *                 itself, and sends any open window to the new address.
 *                 Browsers re-fetch this file when checking for updates,
 *                 which is the one moment a stranded client talks to us.
 *
 *   everything    302 to the same path on the new host.
 *   else
 *
 * A 302 rather than a 301: a permanent redirect is cached hard by browsers
 * and would be difficult to undo, and this hostname has already changed
 * hands once.
 */

const NEW_ORIGIN = "https://app.eddy.global";

/**
 * Replacement service worker. Installs, immediately takes over from the old
 * one, then removes itself. `clients.navigate` moves an already-open window
 * without the player having to know anything happened.
 */
const SELF_REMOVING_SERVICE_WORKER = `
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // The precached app shell is what was being served on a dead origin.
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));

    await self.registration.unregister();

    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) {
      try {
        await client.navigate(${JSON.stringify(NEW_ORIGIN + "/")});
      } catch {
        // Cross-origin navigate can be refused; the redirect below catches
        // them on their next load instead.
      }
    }
  })());
});

// Until this worker is gone, never answer from cache.
self.addEventListener('fetch', () => {});
`.trim();

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/sw.js") {
      return new Response(SELF_REMOVING_SERVICE_WORKER, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          // Must never be cached: this file only works if the browser
          // actually fetches it during an update check.
          "Cache-Control": "no-store",
          "Service-Worker-Allowed": "/",
        },
      });
    }

    return Response.redirect(NEW_ORIGIN + url.pathname + url.search, 302);
  },
};
