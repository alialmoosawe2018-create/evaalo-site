---
description: Triage everything the live site has reported since the last check, and propose fixes (never applies them)
---

# /site-watch — read what the site reported, triage, propose

The site now records its own failures into the `site_errors` collection (frontend
crashes, rejected promises, failed API calls, backend route exceptions, 404s).
That collection fills up **whether or not Claude is running**, so this command is a
catch-up report: run it whenever you open a session and it covers the whole gap
since last time.

**Authority: report and propose only. Never apply a fix in this command.**
Show the proposed change as a diff and stop; the user decides.

## Steps

### 1. Read new errors
Query MongoDB (MongoDB MCP, `connectionId: "preconfigured"`, database `evaalo`,
collection `site_errors`):

- filter `{ status: "new" }`, sort `{ lastSeen: -1 }`, limit 50

If the MongoDB MCP is unavailable (it disconnects intermittently), say so plainly
and continue with steps 2-3 rather than reporting a clean bill of health — an
unreachable database is not the same as no errors.

### 2. Check the live surface
- `curl -s -o /dev/null -w '%{http_code}' https://api.evaalo.com/api/health/ready`
  — this is the honest gate (503 means Mongo is down). `/health` is liveness only.
- `curl -s -o /dev/null -w '%{http_code}' https://www.evaalo.com`

### 3. Check the last deploy
`ssh evaalo-vps 'tail -n 60 /root/evaalo-backend/ops/deploy.log'` — look for a
missing `deploy OK`, a rollback, or a health failure.

### 4. Rank
Order by **severity × distinct sessions affected × recency**. A 500 hit by many
sessions outranks a warn seen once. Group by `fingerprint` — one row is one bug no
matter how large its `count`.

### 5. Locate and explain each item
For each of the top items (cap at ~7 per run so the report stays readable):
- `graphify query "<error message>"` to find the owning code (per CLAUDE.md, this
  is the required first step for codebase questions)
- report `file:line`, the likely cause, and a **proposed diff — not applied**
- note how many sessions/how recent, so the user can judge urgency

### 6. Record
Append each triaged item to `docs/monitoring/FINDINGS.md` (severity, fingerprint,
location, proposed fix, status, date), then set those rows' `status` to `triaged`
so the next run does not repeat them.

## Output format

Lead with one line: how many new errors, how many distinct bugs, and whether the
site and last deploy are healthy. Then the ranked items. If nothing is new and
everything is up, say exactly that in one line — do not pad it.
