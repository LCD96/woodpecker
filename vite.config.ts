import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // En GitHub Pages la app vive en /<repo>/; el workflow de despliegue pasa BASE_PATH
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Stockfish (~7 MB de wasm) se cachea al primer uso del análisis, no en la instalación
        globIgnores: ["**/stockfish/**"],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes("/stockfish/"),
          handler: "CacheFirst",
          options: { cacheName: "stockfish" },
        }],
      },
      manifest: {
        name: "Woodpecker",
        short_name: "Woodpecker",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        background_color: "#161512",
        theme_color: "#161512",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});