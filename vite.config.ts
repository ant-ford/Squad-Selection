import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

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
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "app-shell",
              // Slow connection at the side of a pitch: wait, then fall back.
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 1 },
            },
          },
        ],
        // The default plus the self-hosted font.
        globPatterns: ["**/*.{js,css,html,woff2}"],
        // Fetched on demand (unicode-range), only for names that need it.
        globIgnores: ["**/open-sans-latin-ext-*.woff2"],
      },
      manifest: {
        name: "HKFC Squad Selection",
        short_name: "HKFC Squad",
        description: "HKFC Men's Hockey squad selection, availability and ranking",
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
