# Site monitoring — findings log

Appended by `/site-watch` (error triage) and `/site-sweep` (browser pass).
Newest first. Status: `new` → `triaged` → `proposed` → `fixed` / `ignored`.

Errors are collected by the site itself into the `site_errors` MongoDB collection
and accumulate continuously — Claude does not need to be running for them to be
captured. Opening a session and running `/site-watch` reports the whole backlog.

| Date | Severity | Area | Finding | Location | Status |
|------|----------|------|---------|----------|--------|
| 2026-09-03 | broken | React — head-hunter panel | `HeadHunterCandidatePanel` called six hooks (useState/useEffect/4x useMemo) AFTER `if (!candidate) return null`. Closing the panel (candidate -> null) changes the hook count between renders — the "Rendered fewer hooks than expected" crash. | `components/headhunter/HeadHunterCandidatePanel.jsx` | **fixed** (325eb79) — all hooks moved above the guard |
| 2026-09-03 | rough edge | i18n | `confirmPasswordLabel` and `errPasswordMismatch` were each defined twice in en/ar/ku; the later definition silently won, so editing the first did nothing. | `src/translations.js` | **fixed** (325eb79) — 6 dead lines removed, all 3 languages verified |
| 2026-09-03 | verified | auth — login page live | Login inputs and submit are enabled on production (`disabled: false`), confirming the Clerk-init freeze fix: the form no longer locks while the SDK loads. | `contexts/AuthContext.jsx`, `pages/Login.jsx` | verified |
| 2026-09-03 | note | deploy gate | `ops/deploy.sh` still gates on `/health` (always 200) rather than `/api/health/ready`. NOT changed: the file is mirror-owned (a local edit is wiped by `git reset --hard`), and the gate curls once, so a single-shot readiness check could roll back a good deploy if Mongo connects a moment late. Correct fix = move readiness INTO the retry loop, deliberately. | `ops/deploy.sh:18,56-65` (mirror repo) | open |
| 2026-09-03 | clean | a11y — `/` and `/pricing` | Checked programmatically: 0 links without an accessible name, 0 buttons without one, 0 images missing `alt`. An earlier reading of the accessibility tree suggested nameless links — that was a tool rendering artifact, verified false before reporting. | — | verified |
| 2026-09-03 | clean | mobile + RTL — `/` at 375x812 | No horizontal overflow in English or Arabic (`scrollWidth == 375` both). Elements reported past the viewport edge are decorative (gradient orbs, SVG rings) and clipped. Arabic hero verified by screenshot: the three icon labels render fully and centred. | — | verified |
| 2026-09-03 | verified | 404 page — live | `https://www.evaalo.com/no-such-page` renders "404 · Page not found · Back to home" instead of the previous blank shell. | `pages/NotFound.jsx` | verified |
| 2026-09-03 | broken | perf / public pages | Signed-out visitors poll two authed endpoints every 45s: `useUnreadNotifications` calls `getMyProfile()` + `GET /api/candidates` with no auth guard, so each cycle is 401 → token refresh → 401 again. It runs on every route because `AppBottomNav` calls the hook before its `if (!visible) return null`, and the nav is mounted in App.jsx for all routes. Wasted requests + backend load + console noise on marketing pages. NOT caught by /site-watch (401 is excluded there as normal control flow) — found by the first /site-sweep. | `hooks/useUnreadNotifications.js` (refresh + the 45s interval effect); mounted via `components/AppBottomNav.jsx:67`, `App.jsx:158` | **fixed** (c1a0e50) — verified live: 21s on a public page as a signed-out visitor now makes **0** API calls |
| 2026-09-03 | — | setup | Observability pipeline deployed (ErrorBoundary, 404 route, Express error handler, `/api/site-errors`, `/health/ready`). Baseline: no findings yet. | — | fixed |
