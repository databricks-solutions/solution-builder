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
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: path.resolve(uiRoot, "..", "__dist__"),
      emptyOutDir: true,
    },
  };
});
