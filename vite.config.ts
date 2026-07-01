import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  // Load env files according to Vite's priority: .env.<mode>.local > .env.<mode> > .env.local > .env
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_IM_BASE_URL is the preferred var; VITE_BASE_URL_9085 is legacy fallback.
  const imProxyTarget = env.VITE_IM_BASE_URL || env.VITE_BASE_URL_9085 || ''

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3000,
      host: true,
      proxy: {
        // Dev: forward WS handshake on /rtmp-relay to local rtmp-relay container.
        // Prod: handled by nginx, so frontend always uses the same relative path.
        '/rtmp-relay': {
          target: 'ws://localhost:8080',
          ws: true,
          changeOrigin: true,
        },
        // Dev: proxy IM REST API to bypass browser CORS.
        // Target is read from env; skipped entirely when unconfigured so the
        // misconfiguration surfaces as a clear browser error.
        ...(imProxyTarget
          ? {
              '/im-api': {
                target: imProxyTarget,
                changeOrigin: true,
                secure: false,
                rewrite: (path: string) => path.replace(/^\/im-api/, ''),
              },
            }
          : {}),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/styles/variables" as *;`,
        },
      },
    },
  }
})
