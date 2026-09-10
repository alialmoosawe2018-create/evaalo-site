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
| `stage1-screening--Stage_1_v2` | Stage 1 v.2 — CV/written screening | `93b459bc…` | 26 | `cc4f6e33` |
| `stage2-voice--stage_2_v2` | stage 2 v.2 — voice interview scoring | `BB87WRQQ…` | 18 | `c7ab59d7` |
| `stage3-video--stage_3_v2` | stage 3 v.2 — video interview scoring | `dWJzDwAd…` | 17 | `2414e184` |
| `compare-stage1--…` | Campaign Compare — Stage 1 (Secure ) | `tk2tAop5…` | 14 | `9391209e` |
| `compare-stage2--…` | Campaign Compare — Stage 2 (Secure) | `3W02FGgY…` | 14 | `cceec6bc` |
| `compare-stage3--…` | Campaign Compare — Stage 3 (Secure ) | `amxEfky3…` | 15 | `b1a5a3ea` |
| `headhunter--AI_Head_hunter` | AI Head hunter | `GlhDGC23…` | 43 | `c92f31a7` |
| `cv-comparison--CV_Comparison` | CV Comparison | `hmPyS1Hy…` | 17 | `5a2e23d9` |
| `log-alerts--Evaalo_Log_Alerts` | Evaalo Log Alerts | `lubD2hXc…` | 2 | `evaalo-log-alerts` |

## `archive/` — do not import

The stale 2026-08-15 drafts, kept only as history. They carry **different ids and
different webhook paths** from the live workflows, so importing them cannot overwrite
production — it creates new, inactive copies. The danger is not overwriting; it is
mistaking them for the truth, or activating one.

## Two traps that live in n8n itself

Both are **latent** — n8n registers a webhook only for an ACTIVE workflow, so nothing
is fighting today. Each fires the moment someone activates the wrong row:

| Inactive workflow | holds path | which belongs to |
|---|---|---|
| `stage 1 v.2` (`fk4pPx4MQ1PClqfl`, root folder, 23 nodes) | `cc4f6e33` | **Stage 1 v.2** — live screening |
| `compare stage 1` (`4cUPnQwiHhkBDCk0`, evaalo folder, 8 nodes) | `9391209e` | **Campaign Compare — Stage 1** |

Note the near-identical names: the live screening workflow is `Stage 1 v.2` in the
`evaalo` folder; the decoy is `stage 1 v.2` in the root. Case and folder are the only
things telling them apart in the UI.

⚠️ Also: the three Compare workflows still carry the description
*"Inactive — do not publish"*. That text is stale — **all three are active and
published.** Do not trust a workflow's description over its `active` flag.

## Editing a live workflow

Edit, then publish. **Never unpublish a live workflow hoping to republish it** — the
MCP publish API hits a self-conflict on the workflow's own webhook registration and
cannot re-activate it, which once left an orphaned registration returning 200 while
executing nothing. Recovery required toggling Active in the n8n UI by hand.

## Refreshing this baseline

There is no automation. Re-export by hand after any material change to a live
workflow, and say in the commit message what changed and why.
