import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  //worker MapLibre és mòdul ES i s'ha d'empaquetar com a tal
  worker: { format: "es" },
  //API (uvicorn, port 8000).
  server: { proxy: { "/api": "http://localhost:8000" } },
});
