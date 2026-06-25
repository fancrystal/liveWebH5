import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
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
      // Prod: handled by nginx (see nginx.conf), so frontend always uses the
      // same relative path `/rtmp-relay` and never needs environment switches.
      '/rtmp-relay': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      // Dev: proxy IM REST API to bypass browser CORS on port 9085.
      // TencentIMService derives the URL from sassUrl at runtime, so this
      // proxy is only active in local dev — prod goes through nginx.
      '/im-api': {
        target: 'https://qdd-test.lxi-tech.com:9085',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/im-api/, ''),
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables" as *;`,
      },
    },
  },
})
