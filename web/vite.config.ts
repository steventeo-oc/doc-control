import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the /api mount to the Spring Boot backend so the
// browser sees a single origin — session cookies just work, no CORS.
// (In production the web container's nginx does the same job; see
// web/nginx.conf and docker-compose.yml.)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
