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
      '/api': {
        target: 'http://localhost:6002',
        changeOrigin: true
      },
      '/ws-upload': {
        target: 'ws://localhost:6002',
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
