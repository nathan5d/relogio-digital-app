import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Novo: Injeta o script de registro automaticamente.
      injectRegister: "auto",

      manifest: {
        name: "Relógio Digital Minimalista",
        short_name: "ClockPWA",
        theme_color: "#000000",
        background_color: "#000000",
        display: "fullscreen",

        // CORRIGIDO: Garante a orientação (landscape-primary)
        orientation: "landscape",

        // CORRIGIDO: Define a URL de início para o subdiretório
        start_url: "/relogio-digital-app/",

        // CRÍTICO 2: Definir o 'scope' (escopo do app) para o subdiretório
        scope: "/relogio-digital-app/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          // Idealmente, adicione ícones maskable aqui para Android
          // Exemplo:
          {
            src: "/icons/icon-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          }, {
            src: "/icons/icon-192-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      // NOVO: Configuração Workbox para cache e fallback
      workbox: {
        // Aumenta o limite de tamanho do arquivo para 5MB
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Define quais arquivos devem ser precacheados
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,woff,woff2,json,webmanifest}",
        ],
        // CRÍTICO para subdiretórios: Garante que todas as navegações voltem para o index.
        navigateFallback: "/relogio-digital-app/index.html",
      },
    }),
  ],
  base: "/relogio-digital-app/",
});
