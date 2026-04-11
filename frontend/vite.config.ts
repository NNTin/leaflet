import { createRequire } from 'node:module'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const bufferPolyfillPath = require.resolve('buffer/')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    resolve: {
      alias: {
        // using browser buffer polyfill, not the node built-in buffer
        buffer: bufferPolyfillPath,
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3001',
        '/auth': 'http://localhost:3001',
        '/admin/': 'http://localhost:3001',
        '/api-docs': 'http://localhost:3001',
        '/s/': 'http://localhost:3001',
      }
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
    },
  }
})
