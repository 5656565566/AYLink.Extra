import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    restoreMocks: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5501',
        changeOrigin: true
      },
      '/webrtc': {
        target: 'ws://127.0.0.1:5501',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../AYLink.Agent/www',
    emptyOutDir: true,
  },
})
