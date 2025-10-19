// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/relogio-digital-app/", // caminho no GitHub Pages
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "icon-192-maskable.png",
        "icon-512-maskable.png",
      ],
      manifest: {
        name: "Relógio Digital Minimalista",
        short_name: "Relógio",
        description: "Relógio digital minimalista e responsivo",
        start_url: "/relogio-digital-app/",
        scope: "/relogio-digital-app/",
        display: "fullscreen",
        background_color: "#000000",
        theme_color: "#000000",
        orientation: "landscape",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,woff2,json,webmanifest}",
        ],
        navigateFallback: "/relogio-digital-app/index.html",
      },
      devOptions: {
        enabled: true, // permite testar o PWA no ambiente local
      },
    }),
  ],
});
