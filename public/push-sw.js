/*
 * Web Push for Eddy, loaded into the generated service worker through
 * Workbox importScripts (vite.config.ts). The Worker sends JSON
 * {title, body, url, tag} (worker/src/push.ts). A newer alert with the same
 * tag replaces the older one; a tap focuses an open Eddy window on the
 * alert's page, or opens one.
 */
/* eslint-disable no-restricted-globals */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Eddy";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/assets/apple-touch-icon.png",
      badge: "/assets/apple-touch-icon.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(target);
          } catch (_) {
            // An uncontrolled window can't be navigated: open a new one instead.
            await self.clients.openWindow(target);
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
