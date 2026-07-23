# Campaign Compare v2 — Secure n8n Workflows (Stages 1–3)

Backend-owned candidate pools, signed callbacks with **`candidateSnapshotHash`**, **no MongoDB** in any workflow.

All drafts are **`active: false`** until local E2E passes.

## Banned workflows (do not activate)

| Workflow | ID | Reason |
|----------|-----|--------|
| Stage 3 Compare NoOp | `z5gBWWSO0B0pKIzj` | No ranking, no callback |
| Legacy AI Compare Video (ranking) | `N8N_VIDEO_AI_COMPARE_WEBHOOK_URL` (`c0de9126-…`) | Mongo + open webhook |
| Legacy Stage 1/2 Mongo compare | `4cUPnQwiHhkBDCk0`, `maDzOQsRJnzeLZtH` | Direct Mongo reads |

## Draft exports

Import each file into n8n as **inactive**:

| Stage | JSON | Env var (set after import only) |
|-------|------|----------------------------------|
| 1 | `docs/n8n-workflows/campaign-compare-stage1-secure-draft.json` | `N8N_CAMPAIGN_COMPARE_STAGE1_WEBHOOK_URL` |
| 2 | `docs/n8n-workflows/campaign-compare-stage2-secure-draft.json` | `N8N_CAMPAIGN_COMPARE_STAGE2_WEBHOOK_URL` |
| 3 | `docs/n8n-workflows/campaign-compare-stage3-secure-draft.json` | `N8N_CAMPAIGN_COMPARE_STAGE3_WEBHOOK_URL` |

Regenerate (new webhook UUID each run — **do not** pin paths in `.env` until import):

```bash
npm run build:campaign-compare-drafts
# or per stage:
npm run build:campaign-compare-stage1-draft
npm run build:campaign-compare-stage2-draft
npm run build:campaign-compare-stage3-draft
```

## Environment

| Variable | Where |
|----------|--------|
| `N8N_CAMPAIGN_COMPARE_INBOUND_SECRET` | Backend `.env` **and** n8n `$env` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | n8n Docker: set `false` so Code nodes and callback headers can read `$env` |
| `N8N_EXPRESSIONS_ALLOWED_ENV_VARS` | n8n Docker: `N8N_CAMPAIGN_COMPARE_INBOUND_SECRET` (optional allowlist) |
| `N8N_CAMPAIGN_COMPARE_STAGE1\|2\|3_WEBHOOK_URL` | Backend `.env` — full URL **after** n8n import |
| `CAMPAIGN_COMPARE_CALLBACK_SIGNING_SECRET` | Backend (HMAC on `callbackUrl`) |
| `CAMPAIGN_COMPARE_CALLBACK_ALLOWLIST` | Backend (`PUBLIC_API_URL` origin) |
| `CAMPAIGN_COMPARE_V2_ENABLED` | Backend (`true` for local E2E) |

Local n8n off-machine: `npm run webhook:tunnel` + tunnel as `PUBLIC_API_URL`.

## Outbound (Backend → n8n) — all stages

Source: `src/services/campaignCompareN8nOutbound.ts`

```json
{
  "requestId": "uuid",
  "campaignId": "…",
  "organizationId": "…",
  "compareStage": "stage1 | stage2 | stage3",
  "topN": 5,
  "criteria": { "position": "…" },
  "candidatePool": [ "…" ],
  "candidateSnapshotHash": "sha256-hex",
  "callbackUrl": "https://api…/webhook/n8n/campaign-compare/stageN?…",
  "inboundSecret": "shared-secret"
}
```

## Inbound callback (n8n → Backend) — all stages

URLs:

- `POST /webhook/n8n/campaign-compare/stage1`
- `POST /webhook/n8n/campaign-compare/stage2`
- `POST /webhook/n8n/campaign-compare/stage3`

Headers:

- `X-Campaign-Compare-Secret`: `$env.N8N_CAMPAIGN_COMPARE_INBOUND_SECRET`
- `X-Idempotency-Key`: n8n `$execution.id`

Body (**`candidateSnapshotHash` required on all stages**):

Stage 1 production uses **Phase 1.5** (decision-support report aligned with `ScreeningAiComparePanel.jsx`). Regenerate/patch:

```bash
npm run build:campaign-compare-stage1-draft
# live n8n SQLite (VPS):
node scripts/patch-n8n-stage1-phase15.mjs /root/n8n-data-old/database.sqlite
```

```json
{
  "requestId": "…",
  "compareStage": "stage1 | stage2 | stage3",
  "candidateSnapshotHash": "sha256-hex",
  "contextualIntroduction": "…",
  "decisionSummary": "…",
  "comparativeSummary": "…",
  "comparativeInsights": { "dimension label": "who wins and why" },
  "whyTopCandidateWins": "…",
  "finalRecommendation": "…",
  "candidateRanking": [
    {
      "rank": 1,
      "candidateId": "…",
      "candidateName": "…",
      "stageScore": 88,
      "competitiveAdvantage": "…",
      "recommendation": "Hire",
      "overallRecommendation": "Strong Consider",
      "executiveComment": "…",
      "confidence": 82,
      "confidence_rationale": "…",
      "reasons": ["…"],
      "strengths": ["…"],
      "risks": ["…"],
      "watchOut": "…",
      "differenceFromNext": "…"
    }
  ],
  "topRecommendation": "…",
  "interviewFocus": "…",
  "wildcard": null
}
```

Stages 2–3 use the same Phase 1.5 schema and `Build Callback Body` parser as Stage 1 (`extractLlmText` handles chainLlm `response`, `candidatePool` allow-list). Patch scripts: `patch-n8n-stage2-stage3-phase15.py` (requires `patch-payload-stage23.json` from local `node` export).

Backend (`campaignCompareN8nInbound.ts`) rejects:

- missing hash → `400 snapshot_hash_required`
- mismatch vs `CampaignCompareRequest.candidateSnapshotHash` → `400 snapshot_hash_mismatch`

Build Callback Body must set `candidateSnapshotHash` from Validate node context (`ctx.candidateSnapshotHash` for S1/S2, `cb.candidateSnapshotHash` for S3).

## Per-stage notes

### Stage 1

- Pool: written interview evaluations (`Stage1PoolItem`)
- UI trigger: `ai-compare-top?stage=written`
- Flow: Webhook → Validate → LLM → Build Callback → HTTP

### Stage 2

- Pool: voice interview evaluations (`Stage2PoolItem`)
- UI trigger: `ai-compare-top?stage=voice`
- `rankingLimit = min(topN, pool.length, 10)`

### Stage 3

- Pool: video interview evaluations (`Stage3PoolItem` — 10 competencies + optional `competencyScores`)
- UI trigger: `ai-compare-top?stage=video`
- Extra node: **Prepare LLM Context** — dual `llm` / `callback` split (secrets not passed to LLM)
- Do **not** use NoOp `z5gBWWSO0B0pKIzj`

## Local E2E checklist

1. Import all three drafts (inactive); set n8n `$env` secret
2. Set webhook URLs in `.env` from import (not from generator log until imported)
3. `CAMPAIGN_COMPARE_V2_ENABLED=true`
4. Test each stage from UI + verify `CampaignCompareRequest.status === completed`
5. `npm run test:campaign-compare-security`

Negative test: callback without hash or wrong hash → request stays non-completed.

## Publish (after E2E only)

1. Activate drafts; update prod/staging webhook URLs
2. Do **not** enable NoOp or legacy Mongo ranking workflows
3. Rollback: unpublish drafts (502 on dispatch) — do not revert to legacy paths

## Production n8n requirements

Code nodes in secure drafts must **not** use `require('crypto')` (n8n task runner blocks it). Use plain `received !== expected` for inbound secret checks.

Docker must expose the compare secret to nodes:

```yaml
environment:
  - N8N_CAMPAIGN_COMPARE_INBOUND_SECRET=…
  - N8N_BLOCK_ENV_ACCESS_IN_NODE=false
  - N8N_EXPRESSIONS_ALLOWED_ENV_VARS=N8N_CAMPAIGN_COMPARE_INBOUND_SECRET
```

After editing workflows in the DB, restart n8n — runtime uses `workflow_history` (`activeVersionId`), not only `workflow_entity.nodes`.
