import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

// UI root path
const uiRoot = path.resolve(__dirname, "src/demo_prompt_generator/ui");

export default defineConfig({
  root: uiRoot,
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
    outDir: path.resolve(uiRoot, "__dist__"),
    emptyOutDir: true,
  },
});
