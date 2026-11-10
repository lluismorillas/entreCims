import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // El worker de MapLibre és un mòdul ES i s'ha d'empaquetar com a tal.
  worker: { format: "es" },
});
