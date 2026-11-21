import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    // Output goes into processor/public — Express serves it as static files
    outDir:      '../processor/public',
    emptyOutDir: true,

    rollupOptions: {
      output: {
        // Split large vendor libraries into separate cached chunks.
        // Browser can cache them independently — only app code re-downloads on update.
        manualChunks: {
          'vendor-react':    ['react', 'react-dom'],
          'vendor-recharts': ['recharts'],
        },
      },
    },
  },

  server: {
    port: 5173,
    // In dev mode, proxy API calls to the running processor server
    proxy: {
      '/api': {
        target:       'https://localhost:3000',  // HTTPS — matches processor TLS
        changeOrigin: true,
        secure:       false,                     // accept self-signed cert
      },
    },
  },
});
