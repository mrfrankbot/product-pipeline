import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Polaris UI library
          if (id.includes('@shopify/polaris')) {
            return 'vendor-polaris';
          }
          // React core + router
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/') ||
            id.includes('node_modules/react-router/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          // TanStack Query
          if (id.includes('@tanstack/react-query') || id.includes('@tanstack/query-core')) {
            return 'vendor-query';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3456',
      '/webhooks': 'http://localhost:3456',
      '/auth': 'http://localhost:3456',
      '/health': 'http://localhost:3456',
    },
  },
});
