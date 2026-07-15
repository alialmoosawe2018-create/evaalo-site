# AI CV Comparison — n8n Workflow

Compare uploaded PDF résumés against job criteria. **Non-CV files are filtered out** before AI ranking and do not appear in results.

## Workflow export

Regenerate after editing `scripts/build-cv-comparison-workflow.mjs`:

```bash
npm run build:cv-comparison-workflow
```

Import **`docs/n8n-workflows/cv-comparison.workflow.json`** into n8n (replace the existing **CV Comparison** workflow or import as new version).

| Env (backend `.env`) | Purpose |
|----------------------|---------|
| `N8N_CV_COMPARISON_WEBHOOK_URL` | Full webhook URL **after** import |
| `N8N_CV_COMPARISON_INBOUND_SECRET` | Same value in n8n + backend |
| `CV_COMPARISON_CALLBACK_ALLOWLIST` | Must include `PUBLIC_API_URL` origin |
| `PUBLIC_API_URL` | Used to mint signed callback URL |

## Flow (with non-CV filter)

```text
Webhook → Validate Input → Validate Callback URL → Input Valid
  → Prepare CV Binaries → Extract from File
  → Filter CV Documents        ← drops non-CV / empty PDFs
  → Has Valid CVs?
       yes → Aggregate CVs → Compare CVs Agent → Format Results → Send Results
       no  → Send Results (empty comparisons + skippedFiles)
```

### Filter CV Documents (heuristics)

A file is **kept** only if extracted text looks like a CV:

- At least ~80 characters of text
- Multiple CV signals (experience, education, skills, خبرة, تعليم, …), **or**
- Email + phone / role keywords, **or**
- Long text with CV filename hint (`cv`, `resume`, `سيرة`)

Skipped files are listed in `skippedFiles` on the callback payload:

```json
{
  "skippedFiles": [
    { "fileName": "invoice.pdf", "reason": "not_cv_like" },
    { "fileName": "scan-empty.pdf", "reason": "insufficient_text" }
  ]
}
```

They are **not** included in `comparisons` / `candidates`.

## Outbound (Backend → n8n)

`POST` multipart to `N8N_CV_COMPARISON_WEBHOOK_URL`:

- `comparisonId`, `callbackUrl`, `criteria`, `inboundSecret`
- `cvs[]` — one PDF per part (minimum **2** files from UI; only valid CVs are ranked)

## Inbound callback (n8n → Backend)

`POST /webhook/n8n/cv-comparison?comparisonId=…&token=…`

Headers:

- `X-Cv-Comparison-Secret`: inbound secret
- `X-Idempotency-Key`: execution id

Body includes `comparisons`, `candidates`, `skippedFiles` (optional).

Each comparison row may include:

| Field | Purpose |
|-------|---------|
| `summary` | Short text for the results table |
| `finalHrReport` | Full **Final HR Report** (name, experience, education, hire assessment) |
| `strengths` / `weaknesses` / `skills` | Expanded panel sections |

Frontend polls: `GET /api/cv-comparison/last-result?comparisonId=…`
