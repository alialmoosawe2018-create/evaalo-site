# Site monitoring — findings log

Appended by `/site-watch` (error triage) and `/site-sweep` (browser pass).
Newest first. Status: `new` → `triaged` → `proposed` → `fixed` / `ignored`.

Errors are collected by the site itself into the `site_errors` MongoDB collection
and accumulate continuously — Claude does not need to be running for them to be
captured. Opening a session and running `/site-watch` reports the whole backlog.

| Date | Severity | Area | Finding | Location | Status |
|------|----------|------|---------|----------|--------|
| 2026-09-03 | — | setup | Observability pipeline deployed (ErrorBoundary, 404 route, Express error handler, `/api/site-errors`, `/health/ready`). Baseline: no findings yet. | — | fixed |
