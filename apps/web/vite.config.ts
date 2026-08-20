import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Lets an ngrok/tunnel hostname (or a LAN IP) through Vite's Host
    // header check — needed for cross-machine/tunnel access; harmless
    // for plain localhost dev.
    allowedHosts: true,
    // Proxied server-side by Vite (not the browser), so the API can stay
    // plain HTTP even when the web app is served over HTTPS via a tunnel
    // — otherwise the browser blocks it as mixed content. Also means no
    // second tunnel and no CORS config needed for tunnel/LAN access: the
    // browser only ever talks to one origin. See VITE_API_BASE_URL.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  resolve: {
    preserveSymlinks: true,
  },
  // @loyalty/api-client is a workspace package pointing straight at raw
  // .ts source (see its package.json) — Vite transforms that on every
  // request regardless, so excluding it from dependency pre-bundling just
  // means edits are always picked up live instead of needing a cache
  // clear. @loyalty/shared is NOT excluded: it resolves to compiled
  // CommonJS (dist/index.js), which still needs Vite's pre-bundling step
  // to convert it into real ES module exports for the browser.
  optimizeDeps: {
    exclude: ['@loyalty/api-client'],
  },
});
