import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/fhir': 'http://localhost:8099',
      '/auth': 'http://localhost:8099',
    },
  },
});
