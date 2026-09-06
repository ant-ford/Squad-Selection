import { defineConfig } from "vite";
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
    ...(command === "build" ? [cloudflare()] : []),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["assets/favicon.svg", "assets/apple-touch-icon.png"],
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
}));
