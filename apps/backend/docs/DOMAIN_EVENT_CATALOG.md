# Evaalo — Domain Event Catalog (v0.1, for review)

**Status:** Contract proposal. No emitters beyond `CandidateStatusChanged` are wired yet.
**Purpose:** Lock the event contracts before wiring the remaining producers. Nothing here is committed or deployed.
**Foundation in code:** `models/DomainEventOutbox.ts`, `models/OrgEventSequence.ts`, `services/domainEventService.ts` (approved).

---

## 1. Cross-cutting contracts (apply to every event)

### 1.1 Envelope
Every published event carries this envelope (see `PublishedDomainEvent` in `domainEventService.ts`); `payload` is event-specific.

| Field | Type | Meaning |
|---|---|---|
| `outboxId` | string | Mongo `_id` of the outbox row — the consumer-side dedupe key. |
| `organizationId` | string | Tenant. Every event is single-tenant. |
| `type` | string | Event name (PascalCase, past tense). |
| `seq` | number | **Per-organization monotonic** sequence — the ordering + replay cursor. |
| `payload` | object | Event-specific body (schemas below). |
| `occurredAt` | Date | When the business fact happened (advisory; `seq` is authoritative for order). |

Stored-only fields on the outbox row: `status` (`pending`/`published`/`failed`), `attempts`, `lastError`, `idempotencyKey`, `createdAt`, `publishedAt`.

**Proposed addition (needs ruling):** add `payload.schemaVersion: number` (default 1) so payloads can evolve without breaking consumers.

### 1.2 Transaction-boundary policy (two modes)
- **Mode A — Transactional outbox (in-session):** `enqueueDomainEvent(input, session)` runs inside the business mutation's Mongo transaction; event and business row commit atomically. **Required for money and anything a consumer must never miss.**
- **Mode B — Best-effort (post-commit):** `emitDomainEventBestEffort(input)` after the write; a crash *before* enqueue loses the event and the client recovers by refetch. **Used for UI-liveness fan-out where a miss is self-healing.**

Rule: **money / must-not-miss → Mode A; live-UI convenience → Mode B.**

### 1.3 Idempotency
- Unique index on **(organizationId, idempotencyKey)**. A duplicate emit is a no-op (returns the existing row, `duplicate: true`).
- **Key discipline (needs ruling):** transactional emits reuse the business idempotency key (true dedupe). Best-effort emits today append `Date.now()` (unique per request — allows legitimate re-transitions but does **not** dedupe replayed upstream callbacks). For events fed by **retryable n8n callbacks** (stage evals, compare) we should use **content-based** keys (see each event) so a replayed callback can't double-emit.

### 1.4 Ordering & delivery
- **Per-organization total order** via `seq`. **No cross-org ordering.**
- `seq` gaps are possible (aborted transactions, idempotent duplicates) and are **benign** — replay uses `seq >` strictly.
- **Delivery is at-least-once.** Consumers **MUST be idempotent**, deduping on `outboxId` (or `(organizationId, seq)`).
- `seq` is assigned at enqueue. For Mode B, enqueue follows the business write, so `seq` order ≈ commit order.

### 1.5 Replay
- Published rows are **retained** (not deleted).
- **Realtime reconnect (Phase 3.4):** client sends `lastAckedSeq`; server replays `{organizationId, seq > lastAckedSeq}` ordered by `seq`, then resumes live pub/sub.
- **Retention (needs ruling):** the collection grows unbounded like the ledger. Proposed: retain **90 days** of published events for replay, then archive/TTL. Open for decision.

### 1.6 Tenant scoping & naming
- Every event is org-scoped; Phase 3 fans out on Redis channel `org:{organizationId}:events`.
- Names are **PascalCase past-tense domain facts**. No coarse `*Updated`.

---

## 2. Event register (summary)

| # | Event | Producer (file · function) | Mode | Idempotency key | Status |
|---|---|---|---|---|---|
| 1 | `CandidateStatusChanged` | `routes/candidates.ts` · PUT `/:id` | B | `candidate-status:{appId\|candId}:{status}:{ts}` | **WIRED** |
| 2 | `ScreeningEvaluationCompleted` | `server.ts` · `dualWriteStageEvaluationUpdate` (mode=stage1) | **A** | `stage-eval:{appId}:screening:{contentHash}` | **WIRED** |
| 3 | `VoiceEvaluationCompleted` | `server.ts` · `dualWriteStageEvaluationUpdate` (mode=stage2) | **A** | `stage-eval:{appId}:voice:{contentHash}` | **WIRED** |
| 4 | `VideoEvaluationCompleted` | `server.ts` · `dualWriteStageEvaluationUpdate` (mode=stage3) | **A** | `stage-eval:{appId}:video:{contentHash}` | **WIRED** |
| 5 | `VideoSessionCompleted` | `routes/videoInterview.ts` · `/end` (after `endSession`) | B † | `video-session:{sessionId}:completed` | **WIRED** |
| 6 | `CompareCompleted` | `campaignCompareN8nInbound.ts` · completion | B | `compare:{requestId}:completed` | **WIRED** |
| 7 | `CompareFailed` | `campaignCompareN8nInbound.ts` · failure catch | B | `compare:{requestId}:failed` | **WIRED** |
| 8 | `CreditsConsumed` | `billingRuntimeService.ts` · `consumeCredits` | **A** | `credits:{consume idempotencyKey}` | **WIRED** |
| 9 | `CreditBalanceRefreshed` | `billingRuntimeService.ts` · `seedBalanceForStripe`/`refreshBalanceFromPlan`/`seedOrgBilling`/`applyVideoPackPurchase` | B | `balance-refresh:{ledger idempotencyKey}` | **WIRED** |
| 10 | `CandidateApplied` | `routes/candidates.ts` · POST `/` (intake) | B | `candidate-applied:{applicationId}` | **WIRED** |

**All producers wired + type-checked (not committed/deployed).** Deviations from the original proposal:
- **† `VideoSessionCompleted` is Mode B (best-effort), not A** — emitting in `/end` after `endSession()` covers voice/screen/video completions, whereas `settle()` only covers video-mode. A missed event is recovered by client refetch.
- **Stage events (2–4) use a generic `contentHash`** (sha1 of the eval `updateData`, 16 hex) — uniform across stages, independent of whether the callback carries a `sessionId`/`rubricSnapshotHash`.
- **`CreditBalanceRefreshed` is Mode B** across all four grant paths (those balance writes aren't transactional yet); a missed grant event is recovered by the 30s billing poll until Phase 3.
- **Consumers:** none registered yet — the Redis realtime relay (the real consumer) is Phase 3, blocked on `REDIS_URL`. Producers write to the outbox; the retry sweep marks rows published.

---

## 3. Per-event contracts

### 1. `CandidateStatusChanged`  — WIRED
- **Producer:** `routes/candidates.ts` PUT `/:id`, after the targeted `CandidateApplication` status write (best-effort).
- **Payload:**
  ```ts
  { candidateId: string; applicationId: string | null; campaignId: string | null;
    status: 'pending' | 'pending_evaluation' | 'accepted' | 'rejected';
    previousStatus?: string;      // PROPOSED — requires reading prior status
    actorClerkUserId?: string; }  // PROPOSED — from auth context
  ```
- **Transaction boundary:** B. The candidate/application status writes are not a single transaction today; event is emitted post-write.
- **Idempotency:** `candidate-status:{applicationId||candidateId}:{status}:{Date.now()}` — unique per request (permits A→B→A re-transitions). *Not* dedupe-on-content by design.
- **Ordering:** per-org `seq`.
- **Consumers:** future → Realtime (candidates board live update), Notifications (candidate/HR), Analytics (funnel/time-in-stage).
- **Replay:** retained; delivered on reconnect by `seq`.

### 2–4. `ScreeningEvaluationCompleted` / `VoiceEvaluationCompleted` / `VideoEvaluationCompleted` — Planned
- **Producer:** the single choke point `server.ts dualWriteStageEvaluationUpdate(candidateId, updateData, {applicationId, campaignId, mode})`, which already writes the evaluation + a timeline event. `mode` ∈ `written|voice|video` selects the event.
- **Payload:**
  ```ts
  { candidateId: string; applicationId: string; campaignId: string | null;
    stage: 'screening' | 'voice' | 'video';
    overallScore?: number;                 // from written/voice/videoInterviewEvaluation.overall_score
    recommendation?: 'Hire' | 'Consider' | 'Reject';
    status?: string; }                     // when the callback also set status (e.g. rejected)
  ```
- **Transaction boundary:** B initially; **upgrade to A** when the dual-write is wrapped in a transaction (recommended — makes eval + event atomic).
- **Idempotency:** **content-based** so replayed n8n callbacks can't double-emit: screening → `stage-eval:{applicationId}:screening:{rubricSnapshotHash}`; voice/video → `stage-eval:{applicationId}:{stage}:{sessionId||contentHash}`.
- **Ordering:** per-org `seq`. Note the three stage events share a producer but are distinct types (deliberate — no coarse `EvaluationUpdated`).
- **Consumers:** future → Realtime (stage board), Notifications ("evaluation ready"), Analytics (scores/pass-rates).
- **Replay:** retained.
- **Open question:** one `StageEvaluationCompleted{stage}` vs three types. Current code + naming convention favor **three types**; confirm.

### 5. `VideoSessionCompleted` — Planned
- **Producer:** `routes/videoInterview.ts` `/end` (`endSession()` → `status='completed'`); settlement in `videoBillingService.settle()` (already `withTransaction`).
- **Payload:**
  ```ts
  { sessionId: string; candidateId: string; applicationId?: string | null; campaignId?: string | null;
    status: 'completed' | 'cancelled';
    billedSeconds?: number; billingStatus?: 'settled' | 'forced_ended'; }
  ```
- **Transaction boundary:** **A** — enqueue inside the existing `settle()` transaction (settlement + event atomic).
- **Idempotency:** `video-session:{sessionId}:completed` (settlement is already idempotent on `vi_end:{sessionId}`).
- **Ordering:** per-org `seq`.
- **Consumers:** future → Realtime (interview list), Analytics (usage/minutes), Billing dashboards.
- **Replay:** retained.

### 6–7. `CompareCompleted` / `CompareFailed` — Planned
- **Producer:** `campaignCompareN8nInbound.ts` where `CampaignCompareRequest.status` becomes `completed` (line ~343) or `failed` (~390, which also refunds credits).
- **Payload:**
  ```ts
  { requestId: string; campaignId: string | null; stage: 'screening' | 'voice' | 'video';
    // completed:
    topCandidateEmails?: string[]; rankedCount?: number;
    // failed:
    error?: string; refunded?: boolean; }
  ```
- **Transaction boundary:** B (post the status `$set`).
- **Idempotency:** `compare:{requestId}:completed` / `compare:{requestId}:failed`.
- **Ordering:** per-org `seq`.
- **Consumers:** future → Realtime (**replaces the 1s poll in `AIHeadHunter.jsx` and the 2.8s poll in `AICvComparison.jsx`**), Analytics. (Result emails are already dispatched separately — event is not the email trigger.)
- **Replay:** retained.

### 8. `CreditsConsumed` — Planned (the transactional one)
- **Producer:** `billingRuntimeService.ts consumeCredits` (now transactional — Phase 0.1).
- **Payload:**
  ```ts
  { usageType: UsageType; amountMicro: number;   // negative (debit)
    balanceAfterMicro: number; units?: number;
    source: LedgerSource; sourceId?: string; ledgerEntryId: string; }
  ```
- **Transaction boundary:** **A (mandatory)** — enqueue inside the consume transaction so the debit, the ledger row, and the event commit together. This is the one event where a miss is unacceptable.
- **Idempotency:** `credits:{consume idempotencyKey}` — reuses the existing per-consume key; the event inherits the consume's exactly-once semantics.
- **Ordering:** per-org `seq` — note: assigning `seq` inside the consume transaction adds a per-org contention point on `OrgEventSequence` (acceptable at current scale; revisit if hot).
- **Consumers:** future → Realtime (**replaces the 30s `/api/billing/status` poll in `BillingContext.jsx`** — live balance), Analytics (usage/cost), Audit.
- **Replay:** retained.

### 9. `CreditBalanceRefreshed` — Future
- **Producer:** `billingRuntimeService.ts` on plan seed / Stripe invoice.paid / video-pack grant.
- **Payload:** `{ balanceAfterMicro: number; monthlyCredits?: number; reason: 'seed'|'invoice_paid'|'plan_change'|'video_pack'|'manual_adjustment'; }`
- **Boundary:** A (alongside the balance write). **Idempotency:** reuse the ledger idempotency key.
- **Consumers:** Realtime (balance), Analytics. **Rationale:** together with `CreditsConsumed`, lets the realtime balance consumer stay correct for both debits and grants.
- **Open question:** single `CreditBalanceChanged` (carrying only `balanceAfterMicro`) for realtime vs the `CreditsConsumed` + `CreditBalanceRefreshed` split (keeps debit detail for analytics/audit). Proposal: **keep the split**; realtime consumer reads `balanceAfterMicro` from either.

### 10. `CandidateApplied` — Future
- **Producer:** `routes/candidates.ts` POST `/` intake (after `upsertCandidateApplication`).
- **Payload:** `{ candidateId: string; applicationId: string; campaignId: string | null; entryStage: 'screening'|'audio'|'video'; sourceType?: string; }`
- **Boundary:** B. **Idempotency:** `candidate-applied:{applicationId}`.
- **Consumers:** Realtime ("new candidate" live), Analytics (intake funnel), Notifications (HR new-applicant).

---

## 4. Decisions requested before wiring resumes

1. **Schema versioning** — add `payload.schemaVersion`? (Recommended: yes.)
2. **Stage events** — three distinct types (2–4) vs one `StageEvaluationCompleted{stage}`? (Recommended: three.)
3. **Idempotency for retryable callbacks** — adopt content-based keys for stage-eval/compare (not `Date.now()`)? (Recommended: yes.)
4. **Transaction upgrade** — wrap `dualWriteStageEvaluationUpdate` in a transaction to move events 2–4 from Mode B to Mode A? (Recommended: yes, as a small follow-up.)
5. **Credit events** — keep `CreditsConsumed` + `CreditBalanceRefreshed` split (vs a single `CreditBalanceChanged`)? (Recommended: split.)
6. **Retention/replay window** — 90 days of published events, then archive/TTL? (Open.)
7. **Wiring order** — proposed: `CompareCompleted/Failed` first (kills two aggressive polls), then `CreditsConsumed` (transactional, kills the 30s poll), then the three stage events, then `VideoSessionCompleted`, then `CandidateApplied`.

---

*Every producer, line reference, and payload field above is taken from the current codebase (exploration + the Phase 2 foundation). Items marked "PROPOSED"/"Future"/"needs ruling" are not yet in code.*
