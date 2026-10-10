import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Development: the browser calls /api on the Vite origin and Vite forwards it to the backend,
    // so there is no CORS round-trip and no backend URL baked into the bundle.
    // Production builds can point elsewhere with VITE_API_BASE_URL (see .env.example).
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
