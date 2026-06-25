/**
 * Renderer-only Vite config — used for (a) a fast browser preview of the UI via
 * `npm run web`, and (b) numeric verification with vite-node (alias resolution).
 * The Electron build itself is driven separately by electron.vite.config.ts.
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@core': resolve(__dirname, 'src/renderer/src/core'),
      '@state': resolve(__dirname, 'src/renderer/src/state'),
      '@data': resolve(__dirname, 'src/renderer/src/data'),
      '@components': resolve(__dirname, 'src/renderer/src/components')
    }
  },
  server: { port: 5273, strictPort: false },
  plugins: [react()]
})
