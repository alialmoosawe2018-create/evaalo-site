# n8n workflows — what actually runs, and what only looks like it does

n8n is **not** in the GitOps path. Nothing here is deployed by CI; these files are a
**recovery baseline** and a way to review changes that otherwise exist only inside n8n.

## Why this directory was rebuilt (2026-09-10)

It previously held only `*-secure-draft.json` — 6–7 node exports taken 2026-08-15.
The live Compare workflows carry **14–15 nodes**. Roughly **eight nodes had no
representation in the repo at all**: the whole email branch, the report-PDF
attachment, the decision actions, the routing, and the inbound/email secret guards.

Three consequences, all real:

1. **If n8n were lost, those eight nodes were unrecoverable.** Nothing here described them.
2. The drafts read as the source of truth and were **four weeks stale**.
3. ⚠️ **The drafts predate the 2026-09-07 security fix.** They have no
   `Validate Email Secret` node — the guard that stops an unauthenticated caller
   making the system send arbitrary mail with an attacker-supplied PDF attachment.
   They are safe only because they are `active: false`. **Do not activate them.**

## `live/` — the baseline

A snapshot of every ACTIVE workflow, taken 2026-09-10 straight from n8n.
All nine were scanned for credential material before being committed; credentials in
n8n are referenced by id, never inlined, and the scan came back clean.

| File | Workflow | id | nodes | webhook |
|---|---|---|---|---|
| `stage1-screening--Stage_1_v2` | Stage 1 v.2 — CV/written screening | `93b459bc…` | 29 | `cc4f6e33` |
| `stage2-voice--stage_2_v2` | stage 2 v.2 — voice interview scoring | `BB87WRQQ…` | 18 | `c7ab59d7` |
| `stage3-video--stage_3_v2` | stage 3 v.2 — video interview scoring | `dWJzDwAd…` | 17 | `2414e184` |
| `compare-stage1--…` | Campaign Compare — Stage 1 (Secure ) | `tk2tAop5…` | 14 | `9391209e` |
| `compare-stage2--…` | Campaign Compare — Stage 2 (Secure) | `3W02FGgY…` | 14 | `cceec6bc` |
| `compare-stage3--…` | Campaign Compare — Stage 3 (Secure ) | `amxEfky3…` | 15 | `b1a5a3ea` |
| `headhunter--AI_Head_hunter` | AI Head hunter | `GlhDGC23…` | 43 | `c92f31a7` |
| `cv-comparison--CV_Comparison` | CV Comparison | `hmPyS1Hy…` | 17 | `5a2e23d9` |
| `log-alerts--Evaalo_Log_Alerts` | Evaalo Log Alerts | `lubD2hXc…` | 2 | `evaalo-log-alerts` |
| `stage1-failure-alert--Stage_1_Failure_Alert` | Stage 1 Failure Alert — Error Trigger → Gmail to the owner | `kVGT46me…` | 2 | — (error workflow) |

**Stage 1 failure alert (2026-09-26).** Stage 1 answers "Accepted" to the backend before it
evaluates, so a run that dies later was invisible: no verdict, no retry, no signal. Stage 1's
`settings.errorWorkflow` now points at `kVGT46meJL5BUQP2`, which emails the owner the workflow,
execution id, link, failed node and error — never candidate data. Proven end to end on
execution 1963 → alert 1964. n8n does **not** fire an error workflow for manual runs. If the
alert workflow is ever recreated under a new id, update Stage 1's setting too.

**Stage 1 refreshed 2026-09-26** to live version `030e2370` (was `a7bef750` of 2026-09-06,
which no longer matched what runs): +2 nodes (`Email Validity Gate`, `Note Email Typo`),
the weighted scorer with the role-fit floor, must-haves and the experience cap, the
"evidence comes from the record" prompt, the salary line reading `expectedSalary`, and
the callback's `red_flags` / `status` fields. Scanned: no credential values, no personal data.

**Stage 1 claim guard published 2026-09-26 00:06Z → version `fade64a7`** (29 nodes: + `Stage 1
Claim Guard` between the Assessment LLM and Scoring, + 16 prompt edits). The baseline here was
built as the archived pre-guard version (`archive/…--ec1f1214-before-claim-guard.json`) plus the
patch in `pending/`, and matches the published workflow by fingerprint (nodes `85a12226748f865e`,
connections `9c80cc89cdfb6da4`, computed on both sides). Rollback: re-import
`/root/s1_backup_before_phase1_final_20260926.json` on the VPS, publish, restart n8n.

**Stage 1 spam gate v2 published 2026-09-26 17:26Z → version `90c8211f`** (still 29 nodes;
only `Basic LLM Chain` changed). `live/` was built as the archived `fade64a7`
(`archive/…--fade64a7-before-spam-gate.json`) plus `pending/stage1-spam-gate.patch.json`. It matches
the ACTIVE version on the server by fingerprint: nodes `0acd8fd584196bdf` and connections `9c80cc89cdfb6da4`,
computed on both sides from `workflow_history` at `activeVersionId`. On the server the active gate
hashes to sys `7a9fafee…` and text `6ab18784…`, and the claim guard and Scoring are unchanged. n8n was
down for 28 s during the restart, with no interview and no execution running, and all 9 webhook
workflows re-registered. Rollback: re-import `/root/s1_backup_before_spamgate_20260926.json` (= `fade64a7`)
on the VPS, publish, restart n8n.

## `pending/` — proposed changes, NOT live

A change to a live workflow that has been designed and tested but not published.
Stored as a **patch against a `live/` baseline** (find/replace anchors + any new node's
code in its own file), never as an importable workflow: a full export would carry the
live id and webhook path and recreate the decoy hazard described below.

| File | What | Base version | Test |
|---|---|---|---|
| `stage1-claim-guard.patch.json` + `stage1-claim-guard.node.js` | **PUBLISHED 2026-09-26 (`fade64a7`) — kept because the test rebuilds the live workflow from the archived base + this patch.** Stage 1 claim guard: a verifiable criterion supported only by an application field or the cover letter scores 0 (`not_assessed`); the job applied for never raises an integrity concern (S24); employer-written custom criteria are audit-only; FAILS CLOSED — unreadable criteria, unparseable evaluator output (S26) or an internal error stop the run with no verdict, and the stop message names the candidate / campaign / application ids for the alert email. ⚠️ The node's own header comment still reads "PROPOSED, NOT LIVE": it is part of the published code, so it changes only with the next publish | `ec1f1214` | `npm run test:stage1-claim-guard` |
| `stage1-spam-gate.patch.json` | **PUBLISHED 2026-09-26 17:26Z (`90c8211f`) — kept because the test rebuilds the live workflow from the archived fade64a7 + this patch.** Edits only the anti-spam gate `Basic LLM Chain`. Once S0 sends the typed fields, the old gate rejected 3 of 28 real applicants (15/140 replay runs; a gate reject is stored as 0/Reject). The patch gives the job line a neutral label, because on `?pub=` links the applicant picks it. It removes the cover letter from the gate, limits contradictions to the applicant's own fields, and lists what is never spam. Pre-registered replay (v2): 0/140 rejections on the S0 bodies (the old gate, same harness: 18-22/140); 0/40 on held-out honest cases; 0/140 on today's traffic; every one of the 13 non-cover-letter spam cases still caught; and 13 harder probes (Arabic-script spam, fluent bot text, spam in a single field such as location or LinkedIn, planted instructions in skills) all caught 5/5. v1 listed only some fields in the reject rule, and spam placed only in location, company or LinkedIn slipped to 3-4 of 5, so v2 names every field. Pretest on a temporary copy (execution 1985): the patch applied by hash to the server export, and the real runtime rendered the gate prompt byte-identical to the replay harness. Publish with the server-side recipe below; archive `fade64a7` and point the test's base at it in the same commit that refreshes `live/` | `fade64a7` | `npm run test:stage1-spam-gate` |

### Re-sending a Stage 1 application the guard stopped

Stage 1 answers "Accepted" before it evaluates, so when the guard stops a run the backend has
already marked that dispatch `delivered` — and a delivered row is never picked up again
(`flushStage1EvaluationOutboxEntry` claims only `pending`/`failed` rows under 5 attempts;
`stage1-redispatch-one` prints "NOTHING SENT" for it; `verify-stage1-victims` counts only
applications with NO row). The alert email's `Error:` line names the ids. Put the row back in
the queue; the 5-minute sweep (`processPendingStage1EvaluationOutbox`) re-sends it:

```bash
docker exec -i evaalo-api node - <<'EOF'
const { MongoClient } = require('mongodb');
(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const r = await c.db().collection('stage1_evaluation_outbox').updateMany(
    { candidateId: '<candidate id>', campaignId: '<campaign id>', status: 'delivered' },
    { $set: { status: 'pending', attempts: 0, lastError: 'reset after a Stage 1 guard stop' } });
  console.log('rows reset', r.modifiedCount); await c.close();
})();
EOF
```

Verified 2026-09-26: the connection, database (`evaalo`) and collection resolve from inside
`evaalo-api` (read-only count). The update itself has not been run against a real stop yet.
Fix the cause first — a criteria-read failure (the backend's swallowed campaign lookup, F6)
may be transient; a deterministic one will stop again. The durable fix is backend work:
`sendToN8NImpl` should refuse to send when a campaign is named but cannot be loaded, so the
outbox retries on its own instead of shipping a request with no criteria.

### Re-evaluating an applicant the anti-spam gate rejected by mistake

A gate reject is a real callback, not a stop. `Reject Application` posts `overall_score` 0,
`recommendation` Reject and `rejectCode` `ai_spam`. The backend then sets the application's `status`
to `rejected` and appends `[n8n:ai_spam] <reason>` to its notes (`applyN8nRejectHandling`,
`stageWebhookMerge.ts`).

The applicant cannot fix it by applying again: a second submission is refused with 400
`APPLICATION_EXISTS`. The outbox row is `delivered`, so it is never re-sent on its own.

**Procedure:**
1. Find the application: its notes carry `[n8n:ai_spam]` and its written evaluation scores 0.
2. Take its `candidateId` and `campaignId`.
3. Run the **same reset** as above, with `lastError: 'reset: re-evaluate after a wrong gate reject'`.
4. Within 5 minutes the sweep re-sends it, and it is evaluated with the CURRENT gate.

**Why the reject is replaced:** the success callback (`HTTP Request` node) sends `status` = the
Scoring status (`scored` / `manual_review` / `insufficient_data`).
- `applyN8nRejectHandling` sets `rejected` only when the callback carries NO status.
- `server.ts` then writes `updateData.status = data.status`, which replaces `rejected`.
- `mergeEval` overwrites the stored score, recommendation and narratives with the new evaluation.

**What stays, and what it costs:**
- The old `[n8n:ai_spam]` line stays in the notes; remove it by hand if wanted.
- It costs one screening credit.
- Proven by reading the code (the lines above), not yet by running it against a real wrong reject.

The test builds the candidate workflow in memory from `live/` + the patch and runs the
guard and the live scorer together. **Never import a pending file.** Applying one to
n8n is a separate, reviewed step; after it goes live, re-export `live/` and delete the
pending files.

## `archive/` — do not import

The stale 2026-08-15 drafts, kept only as history. They carry **different ids and
different webhook paths** from the live workflows, so importing them cannot overwrite
production — it creates new, inactive copies. The danger is not overwriting; it is
mistaking them for the truth, or activating one.

## Webhook-path decoys (both handled 2026-09-10)

n8n registers a webhook only for an ACTIVE workflow, so a duplicate path on an
inactive copy is latent, not live. Two copies held a production path:

| Inactive workflow | held path | belongs to | state now |
|---|---|---|---|
| `stage 1 v.2` (`fk4pPx4MQ1PClqfl`, root, 23 nodes) | `cc4f6e33` | **Stage 1 v.2** — live screening | **path changed + archived** |
| `compare stage 1` (`4cUPnQwiHhkBDCk0`, evaalo, 8 nodes) | `9391209e` | **Campaign Compare — Stage 1** | still holds it, but **was already archived** |

`fk4pPx4MQ1PClqfl` was the real hazard: it sat in the normal workflow list, one
click from activation, under a name differing from the live one only by letter case
and folder (`stage 1 v.2` in root vs `Stage 1 v.2` in `evaalo`). Its path is now a
dead value and it is archived.

`4cUPnQwiHhkBDCk0` still carries `9391209e`, but it was already archived — reaching
it takes un-archiving first, and n8n refuses edits to an archived workflow, which is
why its path could not be changed. Two deliberate steps from danger, not one. **If you
ever un-archive it, change its webhook path before doing anything else.**

Verified after the change: `webhook_entity` still holds exactly 10 rows, one per
active workflow, and no NON-archived workflow holds a live path.

⚠️ Also: the three Compare workflows still carry the description
*"Inactive — do not publish"*. That text is stale — **all three are active and
published.** Do not trust a workflow's description over its `active` flag.

## Archived ≠ gone

n8n hides archived workflows from the default list, which makes the instance look
smaller than it is. As of 2026-09-10 there are **22 workflows: 10 active, 4 inactive
and visible, 8 archived.** An archived workflow still exists in the database and still
holds its webhook path — it simply cannot run or be edited until un-archived. Do not
conclude a workflow is deleted because the list does not show it; check `isArchived`.

The four inactive-but-visible ones are the three `— DRAFT TEST (do not activate)`
redesigns (Stage 1/2/3), which are deliberately kept because open plan items still
reference them, and the retired `stage 1 v.2` above.

## Editing a live workflow

Edit, then publish. **Never unpublish a live workflow hoping to republish it** — the
MCP publish API hits a self-conflict on the workflow's own webhook registration and
cannot re-activate it, which once left an orphaned registration returning 200 while
executing nothing. Recovery required toggling Active in the n8n UI by hand.

**Server-side publish (the big workflows, whose code the MCP mangles):** `n8n export:workflow`
→ patch the export inside the container → `n8n import:workflow` → `n8n publish:workflow`.
`import:workflow` **deactivates** the workflow and the running n8n drops its webhook: it answers
404 until `docker restart n8n-server-n8n-1` (~25 s). Restart only with no execution running and
no live interview, then confirm the path answers 400 to an empty POST and that every other
production path is still registered — probe with GET, which never runs a workflow ("did you
mean to make a POST" = registered).

**Testing a change on the real runtime before it touches production:** import the patched
export as a NEW workflow (new id, a random dead webhook path, no `errorWorkflow`), activate it
with the MCP `publish_workflow` (a first publish registers immediately, no restart), send
synthetic multipart requests with `dry0…` ids and an invalid callback token, then unpublish and
archive it. MCP `execute_workflow` cannot do this for Stage 1: it sends no binary, and Spam
Pre-Check rejects a submission without a CV file (`missing_cv`).

## Refreshing this baseline

There is no automation. Re-export by hand after any material change to a live
workflow, and say in the commit message what changed and why.
