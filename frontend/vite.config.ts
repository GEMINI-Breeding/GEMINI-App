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
    fs: {
      // Allow serving from anywhere the workspace can resolve files
      // from. In the worktree dev setup, frontend/node_modules is a
      // symlink whose realpath is outside the worktree root; the
      // default Vite fs.allow would 403 anything served from there
      // (e.g. Leaflet's marker images via @fs/...).
      strict: false,
    },
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
      // Litestar exposes its OpenAPI schema at /schema (not /api/schema),
      // so the dev proxy needs an explicit forwarder for it. Without this
      // BackendStatus's compatibility check fetches the Vite SPA fallback
      // (index.html) and fails to parse as JSON.
      "/schema": {
        target: "http://127.0.0.1:7777",
        changeOrigin: true,
      },
      // Same reason: /healthz lives at the Litestar root.
      "/healthz": {
        target: "http://127.0.0.1:7777",
        changeOrigin: true,
      },
      // TiTiler runs in the GEMINIbase compose stack at :8091 and serves COG
      // tiles for the orthomosaic overlay on the boundary map. Same proxy
      // pattern as /api so the frontend can use relative URLs.
      //
      // Out-of-footprint tile requests are unavoidable: drone orthos are
      // non-rectangular within their bounding box, and Leaflet's animated
      // zoom transitions request buffer tiles around the viewport that
      // TiTiler 404s on. We rewrite those 404s to a 200 transparent PNG
      // so the browser's network log stays quiet and the e2e console-
      // error guard doesn't fire on legitimate use.
      "/titiler": {
        target: "http://127.0.0.1:8091",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/titiler/, ""),
        // selfHandleResponse so the proxyRes listener can intercept the
        // upstream response before headers are written to the client.
        // Without this, http-proxy auto-pipes proxyRes → res and our
        // status-rewrite is too late (headers already flushed).
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, req, res) => {
            const isTileRequest = req.url?.includes("/cog/tiles/")
            if (proxyRes.statusCode === 404 && isTileRequest) {
              // Rewrite TiTiler's 404 (out-of-footprint tile) to a 200
              // transparent PNG so the browser/console stays quiet.
              const transparent = Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
                "base64",
              )
              res.writeHead(200, {
                "Content-Type": "image/png",
                "Content-Length": String(transparent.length),
                // no-store so Safari doesn't keep negative-caching the
                // earlier 404 response across reloads.
                "Cache-Control": "no-store",
              })
              res.end(transparent)
              proxyRes.resume()
              return
            }
            // Pass-through for all other responses.
            res.writeHead(
              proxyRes.statusCode ?? 200,
              proxyRes.headers as Record<string, string | string[]>,
            )
            proxyRes.pipe(res)
          })
        },
      },
    },
  },
})
