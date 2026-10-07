import { defineConfig, normalizePath, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { filterPrecacheManifest, precacheSet, type PrecacheChunk } from "./scripts/precache-set";

// Decides what the service worker precaches; see precachePlayerView below.
const precache = precachePlayerView();

/**
 * The cloudflare() plugin is applied to BUILDS ONLY.
 *
 * In dev its ProxyController deadlocks on Windows: two "pause" messages are
 * sent during startup, the second never resolves, so the mutex is never
 * released and the "play" that would un-pause the proxy can never run. The
 * dev server then accepts connections and answers none - no error, no log,
 * just a hang. Reproduced on wrangler 4.107/4.129 and plugin 1.43/1.54, and
 * not caused by workerd, miniflare, proxy env vars, the inspector, the dev
 * registry or the bind address (all eliminated individually).
 *
 * Nothing is lost by skipping it in dev: the root wrangler.jsonc is
 * assets-only (no `main`), and the API runs separately via `npm run dev:api`
 * with VITE_API_URL pointing at it. Builds and deploys are unaffected - the
 * plugin still emits dist/wrangler.json.
 *
 * If the API ever moves into this Worker, dev will need the plugin back and
 * this will have to be revisited.
 */
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    preloadFont(),
    precache.plugin,
    ...(command === "build" ? [cloudflare()] : []),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "assets/favicon.svg",
        "assets/apple-touch-icon.png",
        "assets/logo-plain.svg",
        "assets/logo-animated.svg",
      ],
      workbox: {
        // Drop precaches from previous deploys instead of leaving them to be
        // served alongside the current one.
        cleanupOutdatedCaches: true,
        // Never answer an asset or API request with the cached index.html.
        // The Worker already falls back to index.html for unknown paths, so
        // a missing chunk would otherwise be handed back as HTML twice over.
        navigateFallbackDenylist: [/^\/assets\//, /^\/api\//],
        // Navigations go to the network first, falling back to the cached
        // shell only when it genuinely cannot be reached.
        //
        // Answering every navigation from the precache is what let a phone
        // sit on a previous deploy indefinitely: the browser never saw the
        // current index.html, so it kept asking for chunk filenames that no
        // longer exist and the loading skeleton never resolved. A laptop that
        // had visited more recently was fine - exactly the shape of the
        // reports, and not something the client could recover from, because
        // the recovery code lives in the bundle it could not load.
        //
        // The trade is that a cold start with no connection now fails instead
        // of showing a shell. That shell was never usable offline anyway:
        // every screen behind it needs the API.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Built files outside the precache: every screen other than
            // sign-in and Player view, and the Latin Extended font. Names are
            // content-hashed, so a cached copy is never stale. Only a 200 is
            // kept: a file from an old deploy is a 404 (web-shell/index.ts),
            // which must reach the import as a failure so that
            // src/lib/staleDeploy.ts can reload onto the new deploy. Precached
            // files never get here: the precache route is checked first.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /^\/assets\/[^/]+-[\w-]{8}\.(?:js|css|woff2)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "eddy-assets",
              expiration: { maxEntries: 150, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "app-shell",
              // Slow connection at the side of a pitch: wait, then fall back.
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 1 },
            },
          },
          {
            // Stored files: photos, thumbnails and posters, by their signed
            // link. A link names one file and stays the same for its bucket
            // (a day for photos, data/supabase/files.ts), and a new link
            // means a new expiry, so a cached copy is never stale: answer
            // from the cache. Documents' links change hourly, so they
            // mostly miss, and expire out of here within two days.
            urlPattern: ({ url }) => /\/api\/files\/[0-9a-f-]{36}$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "eddy-files",
              expiration: { maxEntries: 400, maxAgeSeconds: 2 * 24 * 60 * 60, purgeOnQuotaError: true },
              // Fetched with CORS (the Worker allows it), so what is kept is
              // a readable 200 rather than an opaque response, which browsers
              // count as megabytes of quota each.
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  requestWillFetch: async ({ request }) => new Request(request.url, { mode: "cors", credentials: "omit" }),
                },
              ],
            },
          },
        ],
        // The default plus the self-hosted font...
        globPatterns: ["**/*.{js,css,html,woff2}"],
        // ...but not the Latin Extended font: fetched on demand
        // (unicode-range), only for names that need it.
        globIgnores: ["**/open-sans-latin-ext-*.woff2"],
        // ...and of the built JS and CSS, only what sign-in and Player view
        // load. Officer and coach screens go through the "eddy-assets" rule
        // above, the first time they are opened.
        manifestTransforms: [precache.manifestTransform],
        // Web Push: shows Eddy's alerts and opens them (public/push-sw.js).
        importScripts: ["push-sw.js"],
      },
      manifest: {
        name: "Eddy",
        short_name: "Eddy",
        description: "HKFC men's hockey: availability, squads and the section's admin",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/assets/apple-touch-icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          { src: "/assets/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  // A new id per build: data kept on the phone by an older build is dropped (src/lib/queryClient.ts).
  define: { __EDDY_BUILD__: JSON.stringify(Date.now().toString(36)) },
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the dependencies out of the app chunk.
         *
         * Everything was landing in one ~660 kB file, so each deploy invalidated
         * the whole thing and a phone on a pitch-side connection re-downloaded
         * React and the Supabase client to pick up a copy change. These barely
         * move between releases; keeping them separate means a deploy usually
         * only reissues the small app chunk, and the rest is served from cache.
         *
         * Only the big libraries every load needs are named. Everything else is
         * left to Rollup, which puts it next to whatever imports it: drag and
         * drop goes with the ranking page, the QR code with event check-in, the
         * list virtualiser with the coach lists, confetti with birthdays. A
         * catch-all "vendor" chunk put all of that on every player's first load.
         */
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return;
          if (id.includes("/node_modules/@supabase/")) return "vendor-supabase";
          if (/\/node_modules\/react-router(-dom)?\//.test(id)) return "vendor-router";
          // Not /@tanstack/: react-virtual is only used by coach lists.
          if (/\/node_modules\/@tanstack\/(react-query|query-core)\//.test(id)) return "vendor-query";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          // Still lazy (two coach pages share it); named so it isn't "index".
          if (/\/node_modules\/@tanstack\/(react-virtual|virtual-core)\//.test(id)) return "vendor-virtual";
        },
      },
    },
  },
}));

/**
 * Preloads the self-hosted font from index.html. Its file name is hashed, so it
 * is only known once the bundle is written. Fails the build if the font goes
 * missing rather than quietly dropping the preload.
 */
function preloadFont(): Plugin {
  return {
    name: "preload-font",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((file) => /open-sans-latin-wght-.*\.woff2$/.test(file));
        if (!font) throw new Error("preload-font: no open-sans .woff2 in the bundle");
        return [
          {
            tag: "link",
            attrs: { rel: "preload", href: `/${font}`, as: "font", type: "font/woff2", crossorigin: true },
            injectTo: "head",
          },
        ];
      },
    },
  };
}

/**
 * Works out which built JS and CSS the service worker precaches: sign-in and
 * Player view, and nothing an officer or coach screen alone needs. The walk
 * itself is scripts/precache-set.ts; this feeds it the bundle and hands the
 * result to Workbox, which runs after the bundle is written.
 *
 * The roots are the player-view screens. They are listed by module, not by
 * how App.tsx imports them, so making one of them lazy keeps it precached.
 * Every other import() in App.tsx is a screen the precache leaves out.
 */
function precachePlayerView() {
  const src = (file: string) => normalizePath(path.resolve(__dirname, "src", file));
  const rules = {
    roots: [src("pages/Login.tsx"), src("pages/PlayerDashboard.tsx"), src("components/AccessNotActive.tsx")],
    routeTable: src("App.tsx"),
  };
  let keep: Set<string> | undefined;
  let entryFile: string | undefined;

  const plugin: Plugin = {
    name: "precache-player-view",
    apply: "build",
    generateBundle(_options, bundle) {
      // The browser build only, not the Worker's (cloudflare plugin).
      if (this.environment.name !== "client") return;
      const chunks: PrecacheChunk[] = [];
      const dynamicImports = new Map<string, readonly string[]>();
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        chunks.push({
          fileName: file.fileName,
          isEntry: file.isEntry,
          moduleIds: file.moduleIds,
          imports: file.imports,
          css: [...(file.viteMetadata?.importedCss ?? [])],
        });
        if (file.isEntry) entryFile = file.fileName;
      }
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (info?.dynamicallyImportedIds.length) dynamicImports.set(id, info.dynamicallyImportedIds);
      }
      keep = precacheSet({ chunks, dynamicImports }, rules);
    },
  };

  // Workbox runs once the browser bundle is written, so the set is known by
  // then; filterPrecacheManifest fails the build if it is not.
  const manifestTransform = <T extends { url: string }>(manifest: T[]) => ({
    manifest: filterPrecacheManifest(manifest, keep, entryFile),
    warnings: [] as string[],
  });

  return { plugin, manifestTransform };
}
