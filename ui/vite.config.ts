// ui/vite.config.ts
// Builds the single page and, in development, forwards /api to the api service so
// the page talks to the same origin it will be served from in production.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: API_URL, changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
