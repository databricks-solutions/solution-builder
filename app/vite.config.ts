import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

// UI root path
const uiRoot = path.resolve(__dirname, "src/demo_prompt_generator/ui");

export default defineConfig(({ mode: _mode }) => {
  const isElectron = process.env.ELECTRON_BUILD === "1";

  return {
    root: uiRoot,
    // Use relative paths for Electron (file:// protocol)
    base: isElectron ? "./" : "/",
    plugins: [
      TanStackRouterVite({
        routesDirectory: path.resolve(uiRoot, "routes"),
        generatedRouteTree: path.resolve(uiRoot, "routeTree.gen.ts"),
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": uiRoot,
      },
    },
    define: {
      // Expose API base URL to the frontend
      __API_BASE_URL__: JSON.stringify(
        isElectron ? "http://127.0.0.1:8765" : ""
      ),
      __IS_ELECTRON__: JSON.stringify(isElectron),
    },
    server: {
      // Listen port. Override with VITE_PORT to run a second instance in
      // parallel (dev.sh's PORT_OFFSET sets this + VITE_BACKEND_URL together).
      port: Number(process.env.VITE_PORT) || 5173,
      proxy: {
        "/api": {
          // Backend origin. Override with VITE_BACKEND_URL when the backend
          // runs on a non-default port (e.g. 8000 is taken by another app).
          target: process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000",
          changeOrigin: true,
          // Forward WebSocket upgrades too — the live-collab room connects to
          // /api/projects/{id}/collab. Without this, dev-mode WS upgrades on
          // /api are dropped by Vite and the room never connects (cursors /
          // live edits silently do nothing behind the proxy). Agent traffic is
          // SSE (plain HTTP), so this only affects the collab socket.
          ws: true,
        },
        // Preview iframe + its proxied HTTP/WS/SSE traffic to the child app.
        // Match `/preview/<uuid>[/...]` only — NOT Vite's own module requests
        // like `/preview/AppPreviewTab.tsx` (source under ui/preview/).
        "^/preview/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/.*)?$": {
          target: process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000",
          changeOrigin: true,
          ws: true, // forward WebSocket upgrades (Vite HMR in the child)
        },
      },
    },
    build: {
      outDir: path.resolve(uiRoot, "..", "__dist__"),
      emptyOutDir: true,
    },
  };
});
