import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// HMR runs on a separate WebSocket. We derive its port from APP_PORT (set
// by start.sh as VITE_HMR_PORT = APP_PORT + 1000) so multiple forked
// projects can run concurrently without their HMR sockets colliding.
// Falls back to 24678 (Vite's default) when run outside start.sh.
const HMR_PORT = Number(process.env.VITE_HMR_PORT) || 24678;

// https://vite.dev/config/
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: {
    middlewareMode: true,
    hmr: {
      port: HMR_PORT,
    },
  },
  build: {
    outDir: path.resolve(__dirname, './dist'),
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-dev-runtime', 'react/jsx-runtime', 'recharts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
