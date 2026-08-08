# Evaalo — Architecture Improvement Program: Final Summary

**Status:** ✅ Foundation complete & frozen (Phases 0–2 + 100% Billing Repository).
**Branch:** `arch/phase0-critical-correctness` — **nothing committed, nothing deployed.**
**Companion docs:** [`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md) (the why), [`apps/backend/docs/DOMAIN_EVENT_CATALOG.md`](./apps/backend/docs/DOMAIN_EVENT_CATALOG.md) (event contracts), `.claude/plans/architecture-design-v1-2-validated-swing.md` (the plan + living status).
**Guiding principle (locked):** *Harden now, separate later* — fix correctness on MongoDB; add structural seams that make a future partial split (e.g. ledger → Postgres) cheap; **do not** migrate databases.

---

## 1. What the program achieved

| # | Outcome | Before | After |
|---|---|---|---|
| 1 | Credit spend can't corrupt money | balance & ledger written in 2 non-transactional steps (drift on crash) | single `withTransaction`; balance + ledger + event commit atomically |
| 2 | Tenant isolation is enforceable | every query had to remember `orgScopedQuery` (leaked once) | Mongoose guard plugin flags/【strict】-throws unscoped queries |
| 3 | Person status is consistent | `PUT /candidates/:id` wrote only `Candidate`, left the application stale | targets the exact `CandidateApplication`; ambiguous → 400 |
| 4 | Data access is swappable | fat services issued Mongo IO inline | repository layer for candidates + **100% of billing IO** |
| 5 | Lists can scale | unpaginated full-collection reads | opt-in cursor pagination (backward compatible) |
| 6 | Business events exist | no way to react to state changes | durable transactional outbox, 10 producers wired |

---

## 2. Completed changes (by phase)

### Phase 0 — Critical correctness
- **0.1 Transactional money** — `services/billingRuntimeService.ts`: `consumeCredits` & `adjustCredits` now do the balance CAS + ledger insert inside one `session.withTransaction(...)`, with a standalone-Mongo fallback (mirrors `videoBillingService.settle`). Ledger `balanceBefore` is derived from the post-decrement value, so `before + amount === after` holds under concurrency.
- **0.2 Tenant-isolation guard** — new `models/plugins/tenantGuard.ts`; applied to `Candidate`, `CandidateApplication`, `RecruitmentCampaign`, `VideoInterviewSession`. Modes via env `TENANT_GUARD`: **warn** (default, logs once), **strict** (throws — for CI), **off**. Safe keys (`_id`, `organizationId`, per-model unique alternates) + `skipTenantGuard` bypass mean only genuine unscoped scans trip it.
- **0.3a Per-application status** — `routes/candidates.ts` `PUT /:id` resolves the exact target application (single-app resolves automatically → existing calls unaffected); ambiguous multi-application → `400 campaign_context_required`; legacy no-application candidates fall back to person-level; writes a `status_changed` timeline event.

### Phase 1 — Repository layer
- **Candidate-application repository + cursor pagination** — `repositories/candidateApplicationRepository.ts` + `repositories/pagination.ts` (org-scoped lean rows, `limit+1`/`hasMore`, `$and`-safe cursor). Service delegates; `GET /api/candidates` uses opt-in paging (full-list behavior preserved when no `limit`/`cursor`). *(Pre-existing parallel work — verified + tested, not rewritten.)*
- **Billing repositories (100%)** — `repositories/creditBalanceRepository.ts` + `creditLedgerRepository.ts` own **all** `credit_balances` / `credit_ledger` IO (session-aware `$gte`-guarded CAS, `upsertPeriod`/`setFields`, idempotency lookup, activity `list`, raw projection). `billingRuntimeService` **no longer imports the models for IO** — consume / adjust / video-pack / seed / refresh / reconcile / activity all delegate; the service keeps only transaction orchestration + domain events.
- **Index pruning** — `Candidate` schema no longer declares `entryStage_1` / `sourceType_1`; `scripts/prune-candidate-indexes.ts` drops those + the redundant `email_1` (ops step, `DRY_RUN` supported, protected indexes guarded).

### Phase 2 — Domain events + outbox
- **Envelope** — `models/DomainEventOutbox.ts` gained `schemaVersion` (first-class, default 1); `services/domainEventService.ts` threads it through enqueue + the published envelope.
- **10 producers wired** at the choke points (see catalog for full contracts):
  - Transactional (Mode A): `CreditsConsumed`, `ScreeningEvaluationCompleted` / `VoiceEvaluationCompleted` / `VideoEvaluationCompleted` (the last three via a **transaction upgrade** to `server.ts dualWriteStageEvaluationUpdate`).
  - Best-effort (Mode B): `CompareCompleted` / `CompareFailed`, `CreditBalanceRefreshed` (4 grant paths), `VideoSessionCompleted`, `CandidateApplied`, `CandidateStatusChanged`.
- **Idempotency** — content-based keys for callback-fed events (n8n can redeliver); per-consume key reused for money events.

---

## 3. Locked architecture contracts

- **Money is synchronous + transactional** — credit checks/debits never depend on eventual-consistency events. Events are for side-effects (realtime, notifications, analytics, audit).
- **Tenancy has three layers** — repository boundary (org injected), the guard plugin, and (Phase 3) the per-org Redis channel.
- **Event names** are specific past-tense facts (`ScreeningEvaluationCompleted`), never coarse `*Updated`.
- **Two realtime planes stay separate** — the audio/video media sockets are untouched; the future `/ws/events` + Redis carry business events only.

---

## 4. Deferred items (intentional, non-urgent)

| Item | Why deferred | What it needs |
|---|---|---|
| **0.3b Reservation TOCTOU** | money-loss already closed by 0.1 (final spend can't overdraw); the correct fix is invasive | add a `reservedMicro` counter on `CreditBalance` with an `$expr`-guarded atomic reserve, decremented on finalize/release/expire |
| **Candidate-repo "100%"** | billing was the priority; the legacy `Candidate.find` fallback in the list route still calls the model directly | route the legacy fallback + person lookups through a `CandidateRepository` (parallel-work territory — coordinate) |
| **`CreditBalanceRefreshed` → Mode A** | the grant/seed balance writes aren't wrapped in transactions | wrap those balance writes so grant events are transactional (currently best-effort; missed events self-heal via the 30s poll) |
| **Integration test harness** | its own dedicated phase, per decision | `mongodb-memory-server` (replica-set mode) + the real Phase 0 verifications (see §6) |

---

## 5. Migration / ops notes (actions required at deploy time — NOT done here)

1. **Provision managed Redis** and set `REDIS_URL` — hard prerequisite for Phase 3.
2. **Run the index prune** once, post-deploy: `DRY_RUN=true npx tsx src/scripts/prune-candidate-indexes.ts` then without `DRY_RUN`. It drops `entryStage_1`, `sourceType_1`, `email_1` (guards protected indexes; skips absent ones). The live indexes still exist until this runs.
3. **Decide the tenant-guard mode per environment** — leave `TENANT_GUARD` unset (warn) in prod initially; run CI/tests with `TENANT_GUARD=strict`. Flip prod to strict only after the warn logs are clean.
4. **Transactions require a replica set** — prod (Atlas) is fine; local standalone Mongo uses the built-in non-transactional fallback automatically.
5. **Schema drift** — the orphan `campaigncomparerequests` collection (0 docs) can be dropped (separate from the index script).
6. **Commit discipline** — all work sits uncommitted on `arch/phase0-critical-correctness`; the working tree also contains unrelated pre-existing changes from parallel development — stage selectively when committing.

---

## 6. Verification status (read this honestly)

- **Type safety:** `tsc --noEmit` green after every step.
- **Unit gates (standalone `tsx`, mocked models — the repo has no test framework):**
  - Candidate-repo pagination — 4 checks (cursor round-trip, `clampLimit`, `limit+1`/`hasMore`/org-scope, `$and` cursor predicate).
  - Billing repositories — 8 checks (guarded CAS returns balance/null, session forwarding, deduction-guarded vs grant-unguarded, array-form ledger create, `upsertPeriod` flags + `$unset`, `setFields`, `list` sort/limit, `findOneLean`).
  - Domain-event pipeline — 2 checks (`schemaVersion` default/override, published envelope + new types).
- **NOT yet verified (the honest gap → the deferred integration phase):**
  - `withTransaction` behavior against a real Atlas replica set.
  - No **balance↔ledger drift** under real concurrent `consumeCredits`.
  - **Kill-mid-transaction** consistency.
  - **Two-org isolation** end-to-end + the guard throwing in `strict`.
  - Outbox: exactly one row per fact, rolled back with the mutation on failure.
- **Bottom line:** the foundation is type-correct and unit-verified with mocks, but **has not run against a real database and is uncommitted.** Treat "done" as "ready for integration verification," not "battle-tested."

---

## 7. Phase 3 readiness

Everything upstream of realtime is in place: the domain-event outbox is **producing** and waiting for a consumer. Phase 3 (`/ws/events` + Redis relay + client `EventsSocket`) needs exactly one input from you — **`REDIS_URL`** from your chosen managed provider — then it slots onto this foundation without touching the producers. The immediate wins it unlocks: replacing the 30s `BillingContext` poll, the 1s `AIHeadHunter` poll, and the 2.8s `AICvComparison` poll with live pushes.

---

*Foundation frozen at this point. Phase 3 begins after Redis is provisioned; the integration-test harness follows as a dedicated phase.*
