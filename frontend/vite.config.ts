import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "TM_");
  const target = env.TM_API_TARGET || "http://localhost:8010";
  // Same-origin proxy: the browser only ever talks to :5173, so the httpOnly session
  // cookie is first-party and the backend's Origin check sees http://localhost:5173.
  const proxy = { "/api": { target }, "/health": { target } };
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true, proxy },
    // Pre-bundle the lazily imported globe stack so the dev server doesn't reload the page on first use.
    optimizeDeps: { include: ["react-globe.gl", "three", "topojson-client"] },
    preview: { port: 4173, strictPort: true, proxy },
    // The lazy RouteGlobe chunk (three.js + react-globe.gl + world atlas, ~2.1 MB / ~590 kB gzip)
    // is only fetched when the globe mounts; the entry chunk stays well under this limit.
    build: { chunkSizeWarningLimit: 2400 },
  };
});
