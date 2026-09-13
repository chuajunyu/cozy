import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const backend = loadEnv(mode, '.', 'COZY_').COZY_BACKEND_URL ?? 'http://127.0.0.1:8000'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/health': backend,
        '/catalog': backend,
        '/ws': { target: backend, ws: true },
      },
    },
  }
})
