import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
});
