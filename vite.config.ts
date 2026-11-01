import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // relative base so the build works inside the Capacitor WebView and on any sub path
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 5000,
  },
  optimizeDeps: {
    exclude: ['web-ifc'],
  },
  test: {
    environment: 'node',
  },
} as any);
