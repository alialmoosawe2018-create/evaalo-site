---
description: Drive the browser across the site and report the small details — console noise, slow/failed requests, accessibility, mobile and RTL layout breaks
---

# /site-sweep — the browser pass

`/site-watch` reports what the site *recorded*. This command catches what leaves
**no technical trace**: a heading that overflows in Arabic, a button that is
oversized on a phone, an input with no label, an image with no `alt`, a request
that quietly takes four seconds. Those never throw, so nothing collects them.

**Authority: report and propose only. Never apply a fix here.**
Write findings + a proposed diff, then stop.

Argument (optional): a route, a group name (`public`, `auth`, `interview`,
`protected`), or nothing — default is the public group.

## Route groups (from `apps/frontend/src/App.jsx`)

**public** (marketing + legal): `/` `/about` `/contact` `/pricing` `/head-hunter`
`/privacy` `/terms` `/data-security` `/overview` `/demo`

**auth**: `/login` `/signup` `/forgot-password`

**interview** (candidate-facing, usually reached by share link — expect an
empty/invalid-link state without one, and report only real breakage, not the
"missing token" state): `/form` `/interview` `/screening-call`
`/video-screening-call` `/voice-interview` `/reception` `/video-interview-call`

**protected** (~20 routes: `/dashboard` `/candidates` `/workflow`
`/ai-head-hunter` `/ai-cv-comparison` `/interview-templates` `/employees`
`/notifications` `/account` and the `/account/*` pages): these need a signed-in
browser. Ask the user to sign in once in the Claude browser, then continue.
**Never type or handle the password.**

Also sweep `/no-such-page` once to confirm the 404 page renders.

## Per page

1. `navigate` to the route on the live site (`https://www.evaalo.com`) unless the
   user asks for local.
2. `read_console_messages` — errors and warnings (React key warnings, failed
   images, deprecations).
3. `read_network_requests` — 4xx/5xx, anything slow, anything surprisingly large.
4. `read_page` (accessibility tree) — inputs without labels, images without
   `alt`, broken heading order, buttons with no accessible name.
5. `resize_window` to mobile **375x812**, screenshot, then back to desktop.
   Look for overflow, overlap, and text clipped or covered by decoration.
6. **RTL pass** — the site is Arabic/English/Kurdish and this is where most of the
   small breakage lives. Switch to Arabic, re-check the same page on mobile, and
   look for: text overflowing its container, icons/arrows pointing the wrong way,
   left/right padding that should have been logical (`inline-start/end`), and
   decoration that sits over the text once mirrored.

## Output

Group findings by page. For each: severity (blocker / broken / rough edge /
polish), what is wrong, where it is in the code (use `graphify query`), and a
proposed diff — **not applied**. Append to `docs/monitoring/FINDINGS.md`.

Be honest about coverage: say which routes were swept and which were skipped
(e.g. protected pages when not signed in). Do not imply a clean sweep of pages
that were never opened.
