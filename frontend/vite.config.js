import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api/ws-ssl-log': {
        target: 'ws://127.0.0.1:6002',
        ws: true,
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:6002',
        changeOrigin: true
      },
      '/ws-upload': {
        target: 'ws://127.0.0.1:6002',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: './dist',
    emptyOutDir: true
  }
})
