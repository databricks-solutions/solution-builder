/**
 * vite.standalone.config — builds the self-contained architecture HTML
 * (one inlined file, no asset server) from the SAME app code as the in-app
 * Architecture tab. Driven twice (ARCH_MODE=viewer | editor) by
 * `scripts/build-arch-standalone.sh`.
 *
 *   ARCH_MODE=viewer vite build --config vite.standalone.config.ts
 *
 * Differences from vite.config.ts: no TanStack router plugin (the standalone
 * mounts <PlatformDiagram> directly, no routes), the singlefile plugin inlines
 * JS+CSS into the one HTML, and `__ARCH_STANDALONE__` makes file-icons embed
 * their SVGs as data-URIs.
 */
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { defineConfig } from "vite";

const uiRoot = path.resolve(__dirname, "src/demo_prompt_generator/ui");
const MODE = process.env.ARCH_MODE === "editor" ? "editor" : "viewer";

export default defineConfig({
  root: uiRoot,
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": uiRoot } },
  define: {
    __ARCH_MODE__: JSON.stringify(MODE),
    __ARCH_STANDALONE__: JSON.stringify(true),
    // Stubs so the shared app code (custom-api/config) compiles outside the app.
    __API_BASE_URL__: JSON.stringify(""),
    __IS_ELECTRON__: JSON.stringify(false),
  },
  build: {
    // Temp out dir per mode; the build script copies the HTML out.
    outDir: path.resolve(__dirname, `.arch-standalone-build/${MODE}`),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(uiRoot, "standalone.html"),
    },
  },
});
