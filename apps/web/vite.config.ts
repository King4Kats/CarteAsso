/**
 * Configuration de Vite (l'outil qui lance le serveur de dev et construit le front).
 * On y active le support de React et on règle le serveur local : port d'écoute
 * et redirection (proxy) des appels /api vers l'API NestJS.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Adresse publique du site, injectée dans index.html (%VITE_SITE_URL% : canonical,
// Open Graph, JSON-LD). Même réglage que SITE_URL côté API : gemenskarte.fr tant
// que carteasso.fr n'est pas branché. Le build Docker la passe via SITE_URL.
process.env.VITE_SITE_URL = (process.env.VITE_SITE_URL || process.env.SITE_URL || "https://gemenskarte.fr").replace(/\/+$/, "");

// L'API NestJS tourne sur :3000. En dev, on proxifie /api pour éviter le CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
