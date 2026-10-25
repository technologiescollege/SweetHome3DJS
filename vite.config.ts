import { defineConfig } from 'vite'
import eslint from 'vite-plugin-eslint';
import { scratchomisedBridgePlugin } from './vite-plugin-scratchomised';

export default defineConfig(({ mode }: { mode: string }) => ({
  base: mode === 'production' ? '/SweetHome3DJS/' : '/',
  plugins: [
    // Ne pas faire échouer / noyer le serveur de dev sous les warnings ESLint du legacy JS
    eslint({
      emitWarning: false,
      failOnError: false,
      failOnWarning: false,
    }),
    // Bridge WebSocket Scratch ↔ SweetHome3DJS (port 55125)
    scratchomisedBridgePlugin(),
  ],
  define: {},
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    open: true,
  },
}))
