import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const configuredBase = (env.VITE_APP_BASE_PATH ?? '').trim().replace(/^\/+|\/+$/g, '')

  return {
    base: configuredBase ? `/${configuredBase}/` : '/',
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:2340',
          changeOrigin: true,
          xfwd: true,
        },
        '/media_gallery': {
          target: 'http://localhost:2340',
          changeOrigin: true,
          xfwd: true,
        },
      },
    },
  }
})
