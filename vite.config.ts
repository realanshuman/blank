import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed port and ignores vite's fallback behaviour.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5183 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // Tauri targets a modern webview; iOS Safari 14 is the oldest we care about.
  build: {
    target: ['es2021', 'chrome100', 'safari14'],
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      // Three pages: the marketing site at /, the install guide at /install,
      // and the writing app at /app.
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app.html', import.meta.url)),
        install: fileURLToPath(new URL('./install.html', import.meta.url)),
      },
    },
  },
})
