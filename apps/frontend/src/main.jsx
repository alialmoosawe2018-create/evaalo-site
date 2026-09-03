import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { API_BASE_URL } from './config/apiBase.js'
import { initErrorReporter, reportError } from './observability/errorReporter'
import './index.css'

// Helps verify production API routing after deploy (visible once in console).
console.info('[evaalo] API_BASE_URL =', API_BASE_URL)

// Before anything renders, so even a crash during the first paint is captured.
initErrorReporter()

/**
 * A deploy replaces every content-hashed chunk, so a tab opened beforehand can
 * request a lazy chunk that no longer exists. Pages answers those with index.html
 * (200, text/html) rather than a 404, so the import fails and the feature silently
 * breaks until the user reloads. Reloading picks up the current index.html, since
 * HTML is served must-revalidate. The timestamp keeps a chunk that is genuinely
 * broken from reloading in a loop, while still allowing recovery after a later
 * deploy in the same long-lived session.
 */
const CHUNK_RELOAD_KEY = 'evaalo:chunkReloadAt'
const CHUNK_RELOAD_COOLDOWN_MS = 60_000

window.addEventListener('vite:preloadError', (event) => {
  let lastReloadAt = 0
  try {
    lastReloadAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0
  } catch {
    /* storage unavailable (private mode) — treat as never reloaded */
  }
  reportError({
    message: `vite:preloadError ${event?.payload?.message || ''}`.trim(),
    severity: 'warn',
  })
  if (Date.now() - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) return
  event.preventDefault()
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

