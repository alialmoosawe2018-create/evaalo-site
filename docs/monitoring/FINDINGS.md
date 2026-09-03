# Site monitoring — findings log

Appended by `/site-watch` (error triage) and `/site-sweep` (browser pass).
Newest first. Status: `new` → `triaged` → `proposed` → `fixed` / `ignored`.

Errors are collected by the site itself into the `site_errors` MongoDB collection
and accumulate continuously — Claude does not need to be running for them to be
captured. Opening a session and running `/site-watch` reports the whole backlog.

| Date | Severity | Area | Finding | Location | Status |
|------|----------|------|---------|----------|--------|
| 2026-09-03 | broken | perf — every protected page | `/api/candidates` (**413 KB, 105 records, 39 fields each, ~2.8 s**) is downloaded on EVERY protected page — `/notifications`, `/account/members`, `/interview-templates`, `/search-history`, `/employees` — only to compute the notifications badge number. `useUnreadNotifications` is mounted by AppBottomNav on every route and lists `pathname` in the `refresh` deps, so it refetches the whole list on every navigation. Cost scales linearly with tenant size: a customer with 1,000 candidates pulls ~4 MB per page view. Measured on 11 protected routes. | `hooks/useUnreadNotifications.js:38,64` | open — proposal below, NOT applied |
| 2026-09-03 | rough edge | perf — every protected page | `/api/billing/status` is fetched **twice** per page load (~1.4 s each), on 10 of 11 routes. Cause: the effect depends on `activeOrgId`, which initialises to `window.Clerk?.organization?.id` — `null` on first render because Clerk has not loaded — then flips to the real id, re-running the effect. The two calls are ~1.25 s apart, matching Clerk's load time. | `contexts/BillingContext.jsx:81,237` | open — proposal below, NOT applied |
| 2026-09-03 | rough edge | auth race | Occasional genuine 401 then retry: on `/employees`, `/api/candidates` returned 401 at 486 ms and 200 at 3034 ms in the same load — the request fires before the Clerk token is attached. Self-healing, so no user-visible break, but it burns a round trip and logs a console error. | `hooks/useUnreadNotifications.js:38` | open |
| 2026-09-03 | polish | a11y — candidates | The select checkbox in the candidates table has no accessible name (no label, `aria-label`, or wrapping label). Every other input across the 11 protected pages is correctly labelled. | `pages/Candidates.jsx` | open |
| 2026-09-03 | verified | protected pages — 11 routes | Swept `/dashboard /workflow /candidates /ai-head-hunter /ai-cv-comparison /search-history /interview-templates /employees /notifications /account /account/billing /account/members /account/usage` signed in. **No page-level horizontal overflow (0 px) on any route at 375x812**, no missing `alt`, table rows render (105 candidates, first row at 434 ms). Two candidate false alarms were checked and dismissed: the console's 401/404 wall was my own diagnostic calls plus a cumulative buffer (per-load resource timing shows all 200), and the Arabic weekly-activity chart at `left:-367px` is the normal RTL scroll origin — `canScroll:true`, content fully reachable in both languages. | — | verified |
| 2026-09-03 | broken | React — head-hunter panel | `HeadHunterCandidatePanel` called six hooks (useState/useEffect/4x useMemo) AFTER `if (!candidate) return null`. Closing the panel (candidate -> null) changes the hook count between renders — the "Rendered fewer hooks than expected" crash. | `components/headhunter/HeadHunterCandidatePanel.jsx` | **fixed** (325eb79) — all hooks moved above the guard |
| 2026-09-03 | rough edge | i18n | `confirmPasswordLabel` and `errPasswordMismatch` were each defined twice in en/ar/ku; the later definition silently won, so editing the first did nothing. | `src/translations.js` | **fixed** (325eb79) — 6 dead lines removed, all 3 languages verified |
| 2026-09-03 | verified | auth — login page live | Login inputs and submit are enabled on production (`disabled: false`), confirming the Clerk-init freeze fix: the form no longer locks while the SDK loads. | `contexts/AuthContext.jsx`, `pages/Login.jsx` | verified |
| 2026-09-03 | note | deploy gate | `ops/deploy.sh` still gates on `/health` (always 200) rather than `/api/health/ready`. NOT changed: the file is mirror-owned (a local edit is wiped by `git reset --hard`), and the gate curls once, so a single-shot readiness check could roll back a good deploy if Mongo connects a moment late. Correct fix = move readiness INTO the retry loop, deliberately. | `ops/deploy.sh:18,56-65` (mirror repo) | open |
| 2026-09-03 | clean | a11y — `/` and `/pricing` | Checked programmatically: 0 links without an accessible name, 0 buttons without one, 0 images missing `alt`. An earlier reading of the accessibility tree suggested nameless links — that was a tool rendering artifact, verified false before reporting. | — | verified |
| 2026-09-03 | clean | mobile + RTL — `/` at 375x812 | No horizontal overflow in English or Arabic (`scrollWidth == 375` both). Elements reported past the viewport edge are decorative (gradient orbs, SVG rings) and clipped. Arabic hero verified by screenshot: the three icon labels render fully and centred. | — | verified |
| 2026-09-03 | verified | 404 page — live | `https://www.evaalo.com/no-such-page` renders "404 · Page not found · Back to home" instead of the previous blank shell. | `pages/NotFound.jsx` | verified |
| 2026-09-03 | broken | perf / public pages | Signed-out visitors poll two authed endpoints every 45s: `useUnreadNotifications` calls `getMyProfile()` + `GET /api/candidates` with no auth guard, so each cycle is 401 → token refresh → 401 again. It runs on every route because `AppBottomNav` calls the hook before its `if (!visible) return null`, and the nav is mounted in App.jsx for all routes. Wasted requests + backend load + console noise on marketing pages. NOT caught by /site-watch (401 is excluded there as normal control flow) — found by the first /site-sweep. | `hooks/useUnreadNotifications.js` (refresh + the 45s interval effect); mounted via `components/AppBottomNav.jsx:67`, `App.jsx:158` | **fixed** (c1a0e50) — verified live: 21s on a public page as a signed-out visitor now makes **0** API calls |
| 2026-09-03 | — | setup | Observability pipeline deployed (ErrorBoundary, 404 route, Express error handler, `/api/site-errors`, `/health/ready`). Baseline: no findings yet. | — | fixed |

## Proposed diffs — protected-page sweep, 2026-09-03 (NOT applied)

`/site-sweep` reports and proposes only. These two are the whole of the
site-wide request waste; both are small and independent.

### 1. Stop downloading 413 KB of candidates to draw a badge

`useUnreadNotifications` needs three things per candidate (created-at, stage
flags, pending-analysis state) and receives 39 fields including
`videoInterviewEvaluation` (~4 KB each). Two options, best first:

**(a) Server-side count.** Add `GET /api/candidates/unread-summary` returning
`{ items: [{ id, createdAt, stage, analysisReleaseAt }] }` — the fields
`countUnreadNotifications` and `withoutPendingAnalysis` actually read. Cuts the
payload from ~413 KB to roughly 8 KB and keeps the logic unchanged.

**(b) Frontend-only, if (a) is deferred.** The refetch-per-navigation is the
larger half of the waste and is fixable alone: `refresh` lists `pathname` in its
deps purely for the `isNotificationsTabActive(pathname)` early return, so every
route change rebuilds the callback and refires the effect. Read the pathname
from a ref inside `refresh` and drop it from the dep list, leaving the existing
mount + focus + 45 s cycle to drive it. One fetch per session instead of one per
page view.

### 2. Don't fetch billing status before Clerk knows the org

`contexts/BillingContext.jsx:81` seeds `activeOrgId` from
`window.Clerk?.organization?.id`, which is `null` on first render, and the fetch
effect lists `activeOrgId` in its deps — so the effect runs once with no org and
again ~1.25 s later when Clerk resolves.

The file already distinguishes a first resolution from a real org switch for the
socket, three lines above:

```js
if (prevOrgRef.current !== null && prevOrgRef.current !== activeOrgId) {
    reconnectEventsSocket();
}
```

Apply the same reasoning to the fetch: hold the initial `fetchStatus()` until
Clerk has loaded (`window.Clerk?.loaded`), so the null pass sets up the socket
and interval without issuing a request. Keep the refetch on a genuine org
change. Saves one ~1.4 s authenticated request on every protected page load.

Both are safe to verify the same way they were found: load any protected route
and read `performance.getEntriesByType('resource')` — the expected result is one
`/api/billing/status` and no `/api/candidates` on pages that show no candidates.
