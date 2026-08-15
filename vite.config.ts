import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["assets/favicon.svg", "assets/apple-touch-icon.png"],
      manifest: {
        name: "HKFC Squad Selection",
        short_name: "Squad Select",
        description: "HKFC Men's Hockey squad selection, availability and ranking",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/assets/apple-touch-icon.png", sizes: "512x512", type: "image/png" },
          { src: "/assets/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
