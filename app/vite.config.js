import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev convenience: /api → the ANINA API server.
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
