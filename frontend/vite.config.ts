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
    preview: { port: 4173, strictPort: true, proxy },
    build: { chunkSizeWarningLimit: 1600 },
  };
});
