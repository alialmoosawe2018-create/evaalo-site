import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Inject API base into index.html so production always targets api.evaalo.com. */
function injectRuntimeConfig(apiBase) {
  return {
    name: 'inject-runtime-config',
    transformIndexHtml(html) {
      const script = `<script>window.__EVAALO_API_BASE__=${JSON.stringify(apiBase)};</script>`
      return html.replace('</head>', `    ${script}\n</head>`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = (
    env.VITE_API_BASE_URL ||
    env.VITE_API_URL ||
    'https://api.evaalo.com'
  ).replace(/\/$/, '')

  return {
  // Custom domain deployment (www.evaalo.com) always serves from root
  base: '/',
  plugins: [react(), injectRuntimeConfig(apiBase)],
  server: {
    port: Number(process.env.PORT) || 3000,
    /** جميع واجهات الشبكة (الوصول من الأجهزة على نفس LAN) */
    host: '0.0.0.0',
    open: true,
    strictPort: false,
    /** Dev: forward /api to backend (port 5000) when VITE_API_BASE_URL is unset — avoids request_failed_404 on localhost:3000 */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    /** Sourcemaps only outside production — they expose the full source publicly. */
    sourcemap: mode !== 'production'
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      '@evaalo/job-catalog': path.resolve(__dirname, '../shared/jobCatalog/index.ts'),
    },
  },
  publicDir: 'public',
  // Copy audio-processor.js to public directory for AudioWorklet
  copyPublicDir: true,
  }
})

