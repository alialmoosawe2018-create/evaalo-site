# N8N — "AI Compare Top Candidates" (Stages 1, 2 & 3)

A standalone comparison flow, independent of the interview webhooks
(`/webhook/n8n/stage1|2|3`) and Head Hunter (`/webhook/n8n/head-hunter`).

The backend triggers an n8n workflow with a campaign's id + recipient emails,
n8n runs the comparison, and posts the ranking back to a dedicated inbound
webhook. Results are persisted on the campaign and polled by the stage page.

The same feature is available on **Stage 1 (screening)**, **Stage 2 (voice)**
and **Stage 3 (video)**. Each stage uses its own n8n webhook URL, its own inbound
callback URL, and stores its result in a **separate field** on the campaign so
one stage's comparison never overwrites another's. The stage is selected with the
`?stage=screening|voice|video` query param on the trigger/poll endpoints
(default `screening`), and is encoded in the inbound callback path. See
[§6 Per-stage matrix](#6-per-stage-matrix) for the full mapping.

---

## 1. Outbound — backend → n8n

The backend POSTs to the per-stage n8n webhook (see [§6](#6-per-stage-matrix)).
For Stage 1: `N8N_SCREENING_AI_COMPARE_WEBHOOK_URL` (default
`https://n8n.evaalo.com/webhook/9391209e-26c0-48f9-858e-8136e62ab787`).

Triggered from:
`POST /api/recruitment-campaigns/:campaignId/ai-compare-top?stage=screening|voice|video`
(body `{ "emails": ["hr@example.com", ...] }`, RBAC `campaign.write`,
default `stage=screening`).

### Outbound payload (JSON)

```json
{
  "source": "screening-ai-compare-top",
  "stage": "screening",
  "campaignId": "a1b2c3...",
  "organizationId": "org_123",
  "requestId": "f9e8d7...",
  "emails": ["hr@example.com", "lead@example.com"],
  "criteria": { "position": "...", "location": "...", "...": "..." },
  "submittedAt": "2026-06-09T15:00:00.000Z"
}
```

`source` / `stage` reflect the stage (`screening` / `voice` / `video`). n8n does
not need to echo `stage` back — the inbound callback path already encodes it.

`requestId` is generated per trigger and stored on the campaign. **n8n must echo
it back unchanged** in the inbound call — it is the key used to ignore stale
responses (e.g. results from an older, superseded request).

---

## 2. Inbound — n8n → backend

n8n posts the final comparison to the per-stage callback path:

```
POST /webhook/n8n/screening-ai-compare   # Stage 1
POST /webhook/n8n/voice-ai-compare       # Stage 2
POST /webhook/n8n/video-ai-compare       # Stage 3
```

Optional shared secret: set `N8N_SCREENING_AI_COMPARE_INBOUND_SECRET` and send
header `X-AI-Compare-Secret: <same value>`. The **same** secret is reused for all
three stages.

### Inbound payload (JSON)

Required identity fields (must match the outbound trigger):

```json
{
  "campaignId": "a1b2c3...",
  "organizationId": "org_123",
  "requestId": "f9e8d7...",

  "summary": "Candidate A is the strongest overall ...",
  "ranking": [
    {
      "rank": 1,
      "candidateName": "Ali Mahmood",
      "candidateEmail": "ali@example.com",
      "score": 92,
      "strengths": "Strong SQL, leadership",
      "weaknesses": "Limited cloud experience",
      "reason": "Best match for the role requirements"
    }
  ]
}
```

To report a failure instead, send `{ campaignId, organizationId, requestId, error: "..." }`.

### Field flexibility

The backend normalizes common aliases, so n8n output does not have to match
exactly:

- ranking array key: `ranking` | `ranked` | `candidates` | `results` | `items` | `comparison` | `data`, or a bare top-level array.
- per-row: `rank`/`position`/`order`, `candidateName`/`name`/`full_name`,
  `candidateEmail`/`email`, `score`/`rating`/`points`/`total`,
  `strengths`/`pros`, `weaknesses`/`cons`, `reason`/`rationale`/`summary`/`notes`.
- top-level summary: `summary` | `overview` | `conclusion` | `recommendation`.

The full raw body is stored under `<field>.raw` for debugging (the field depends
on the stage — see [§6](#6-per-stage-matrix)).

---

## 3. Idempotency & stale-response guard

- Inbound dedupe key: `ai-compare:<stage>:<campaignId>:<requestId>` (source
  `n8n-{screening|voice|video}-ai-compare` in the `ProcessedWebhook` ledger).
  Duplicate deliveries return `200 { ok: true, duplicate: true }`.
- Stale guard: if the campaign's current per-stage `requestId` does not
  match the inbound `requestId`, the response is ignored
  (`200 { ok: true, stale: true }`). Only the latest request can write results.
- Multi-tenancy: the campaign is looked up by `{ campaignId, organizationId }`;
  a mismatch returns `404`.

---

## 4. Frontend polling

After triggering, the stage page polls:

```
GET /api/recruitment-campaigns/:campaignId/ai-compare-top?stage=screening|voice|video
```

- interval: 3s, max 40 attempts (~120s) → then a "taking longer than expected"
  message (Refresh re-checks).
- the poller ignores any result whose `requestId` differs from the active one.
- statuses: `pending` → `completed` | `failed`.

---

## 5. Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `N8N_SCREENING_AI_COMPARE_WEBHOOK_URL` | Stage 1 outbound n8n webhook | `https://n8n.evaalo.com/webhook/9391209e-26c0-48f9-858e-8136e62ab787` |
| `N8N_VOICE_AI_COMPARE_WEBHOOK_URL` | Stage 2 outbound n8n webhook | `https://n8n.evaalo.com/webhook/a7b9b932-43e6-4666-b107-9bc664542392` |
| `N8N_VIDEO_AI_COMPARE_WEBHOOK_URL` | Stage 3 outbound n8n webhook | `https://n8n.evaalo.com/webhook/c0de9126-4c40-484f-afa3-ba8708b67965` |
| `N8N_SCREENING_AI_COMPARE_INBOUND_SECRET` | optional inbound auth (`X-AI-Compare-Secret`), shared by all 3 stages | _(unset = no check)_ |

---

## 6. Per-stage matrix

| Stage | `?stage=` | Outbound env (default URL) | Inbound callback | Campaign field | `ProcessedWebhook` source |
| --- | --- | --- | --- | --- | --- |
| 1 — Screening | `screening` | `N8N_SCREENING_AI_COMPARE_WEBHOOK_URL` (`…9391209e…`) | `/webhook/n8n/screening-ai-compare` | `aiCompareTopResult` | `n8n-screening-ai-compare` |
| 2 — Voice | `voice` | `N8N_VOICE_AI_COMPARE_WEBHOOK_URL` (`…a7b9b932…`) | `/webhook/n8n/voice-ai-compare` | `voiceAiCompareTopResult` | `n8n-voice-ai-compare` |
| 3 — Video | `video` | `N8N_VIDEO_AI_COMPARE_WEBHOOK_URL` (`…c0de9126…`) | `/webhook/n8n/video-ai-compare` | `videoAiCompareTopResult` | `n8n-video-ai-compare` |

The inbound payload contract, field-flexibility, idempotency and polling
behaviour are identical across stages — only the URLs, campaign field and
dedupe source differ.
