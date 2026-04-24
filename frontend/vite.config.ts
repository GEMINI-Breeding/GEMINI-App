import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // Dev proxy: /api/* HTTP requests forward to the GEMINIbase REST API
      // so the frontend can keep using relative URLs (avoids WebKit
      // cross-origin issues with localhost:PORT). 7777 is the default
      // GEMINI_REST_API_PORT.
      "/api": {
        target: "http://127.0.0.1:7777",
        changeOrigin: true,
        // Proxy WebSockets under the same prefix so wsManager can subscribe
        // to /api/jobs/{id}/progress using the same origin as HTTP calls.
        ws: true,
      },
    },
  },
})
