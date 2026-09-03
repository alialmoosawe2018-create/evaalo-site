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

/**
 * Wrap `:hover` rules in `@media (hover: hover)` at build time.
 *
 * On a touch device (iPad) a tap latches `:hover` and it stays until you tap
 * somewhere else, so buttons look stuck and feel dead. The stylesheets carry
 * ~940 hover rules with no hover-capability guard, so guard them here instead of
 * by hand. Notes:
 *   - Only the `:hover` selectors of a list move into the media query; the rest
 *     stay put, and the wrapper is inserted directly after the original rule, so
 *     cascade order is unchanged.
 *   - Rules that reveal something on hover (opacity / visibility / display) are
 *     left alone: on touch a tap SHOULD still surface the control they expose,
 *     and guarding them would hide it for good.
 */
function guardHoverForTouch() {
  return {
    postcssPlugin: 'evaalo-hover-media',
    Rule(rule, { AtRule }) {
      if (!rule.selector || !rule.selector.includes(':hover')) return
      for (let p = rule.parent; p; p = p.parent) {
        if (p.type === 'atrule' && p.name === 'media' && /hover\s*:/.test(p.params)) return
      }
      let reveals = false
      rule.walkDecls(/^(opacity|visibility|display)$/, () => {
        reveals = true
      })
      if (reveals) return

      const hoverSelectors = rule.selectors.filter((s) => s.includes(':hover'))
      if (!hoverSelectors.length) return
      const rest = rule.selectors.filter((s) => !s.includes(':hover'))

      const media = new AtRule({ name: 'media', params: '(hover: hover)' })
      media.append(rule.clone({ selectors: hoverSelectors }))
      rule.parent.insertAfter(rule, media)

      if (rest.length) rule.selectors = rest
      else rule.remove()
    },
  }
}
guardHoverForTouch.postcss = true

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
  css: {
    postcss: { plugins: [guardHoverForTouch()] },
  },
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

