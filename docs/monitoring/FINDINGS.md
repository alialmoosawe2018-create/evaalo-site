# Site monitoring — findings log

Appended by `/site-watch` (error triage) and `/site-sweep` (browser pass).
Newest first. Status: `new` → `triaged` → `proposed` → `fixed` / `ignored`.

Errors are collected by the site itself into the `site_errors` MongoDB collection
and accumulate continuously — Claude does not need to be running for them to be
captured. Opening a session and running `/site-watch` reports the whole backlog.

| Date | Severity | Area | Finding | Location | Status |
|------|----------|------|---------|----------|--------|
| 2026-09-03 | broken | perf / public pages | Signed-out visitors poll two authed endpoints every 45s: `useUnreadNotifications` calls `getMyProfile()` + `GET /api/candidates` with no auth guard, so each cycle is 401 → token refresh → 401 again. It runs on every route because `AppBottomNav` calls the hook before its `if (!visible) return null`, and the nav is mounted in App.jsx for all routes. Wasted requests + backend load + console noise on marketing pages. NOT caught by /site-watch (401 is excluded there as normal control flow) — found by the first /site-sweep. | `hooks/useUnreadNotifications.js` (refresh + the 45s interval effect); mounted via `components/AppBottomNav.jsx:67`, `App.jsx:158` | proposed |
| 2026-09-03 | — | setup | Observability pipeline deployed (ErrorBoundary, 404 route, Express error handler, `/api/site-errors`, `/health/ready`). Baseline: no findings yet. | — | fixed |
