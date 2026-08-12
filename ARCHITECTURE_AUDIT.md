# Evaalo — Architecture & Database Suitability Audit

**Scope:** Due-diligence review of the existing Evaalo codebase (`cursor-react` monorepo) before deciding whether MongoDB Atlas remains the right primary datastore ahead of public launch.
**Method:** Direct inspection of backend models, services, routes, middleware, config, frontend data-access, plus **live introspection of the production `evaalo` cluster** (collection counts, indexes, storage). No code was modified. Every conclusion below cites concrete evidence; where evidence is absent it is called out explicitly.

> **One-line verdict:** MongoDB is currently an **acceptable-to-good** fit and **not yet a limiting factor**. The document model is doing real work for the candidate/interview/AI core. The two places the data model genuinely *strains* against Mongo are (1) the credit/billing ledger (wants ACID + SQL reconciliation) and (2) reporting/analytics (which barely exists yet). Neither justifies a wholesale migration before launch.

---

## 1. Executive Summary

Evaalo is a mature, integration-heavy multi-tenant SaaS. Data authority is **federated across four systems**, and MongoDB is only one of them:

| Concern | System of record | Mongo's role |
|---|---|---|
| Identity, Organizations, Roles, Permissions | **Clerk** | Read-through mirror (`users`, `organizationId` strings) |
| Subscriptions & payments | **Stripe** | Operational mirror (`org_plan_states`) + ledger |
| AI screening / compare / evaluation compute | **n8n + OpenAI** | Stores JSON results only |
| Voice/Video interview media & streaming | **LiveKit / Deepgram / Speechmatics / ElevenLabs / R2** | Session metadata + transcripts |
| Candidates, Applications, Campaigns, Interviews, Credits, Audit | **MongoDB** | Primary operational store |

This matters enormously for the migration question: **most of the "hard" data (auth, money truth, AI) does not live in Mongo at all.** Mongo holds the operational aggregate around them.

The engineering quality is **above average for a startup at this stage**. Strong signals: an append-only credit ledger with idempotency keys and immutable plan snapshots; a transactional-outbox audit pattern; explicit "locked architecture contracts" in the billing layer; webhook idempotency tables. Weak signals: several god-files (`server.ts` ≈ 62 KB; `routes/videoInterview.ts` ≈ 1,765 lines), a `Candidate` "god document", an **in-flight normalization** (dual-write to a new `candidate_applications` join collection) that is only half-complete, schema drift (an orphaned collection from a rename), schemaless `Mixed` fields that erase type-safety, and no caching/pagination layer.

**Live data volumes are pre-launch-trivial** (1,107 documents, ~1 MB) so *all* performance concerns are forward-looking, not observed.

---

## 2. Overall Architecture Quality

**Shape:** npm-workspaces monorepo — `apps/backend` (Express + TypeScript, ~285 TS files), `apps/frontend` (React + Vite, plain `fetch`), plus avatar/reception agent apps and a `shared` package. Backend follows a **fat-service / thin-route** pattern; the `controllers/` directory is **empty** — business logic lives in `services/*` (75+ files) and directly in routes.

**Strengths**
- **Clear service decomposition** by capability (billing, stage1/2/3 evaluation gates, STT router, TTS, voice orchestrator, headhunter, compare). Services are cohesive around a domain.
- **Idempotency discipline everywhere it counts** — `ProcessedWebhook`, unique `(organizationId, idempotencyKey)` on the ledger, idempotency keys threaded through reservations and Stripe handlers.
- **Auditability by design** — `AuditOutbox` (transactional outbox) → `AuditLog`, and every ledger row carries an immutable `planSnapshot`.
- **Explicit invariants written into the code** — `billingRuntimeService.ts` documents "locked architecture contracts" (handlers must not touch Mongo; only `isBillingActive()` may read `subscriptionStatus`). This is unusually disciplined.

**Weaknesses**
- **God-files / low altitude in the HTTP layer:** `server.ts` ~62 KB, `routes/videoInterview.ts` ~1,765 lines, `routes/headHunter.ts` ~1,430, `routes/candidates.ts` ~1,318. Routing, orchestration, and business rules are interleaved. The empty `controllers/` split is aspirational, not realized.
- **In-memory session/realtime state** (`sessionStore.ts`, headhunter results `Map`) — blocks horizontal scaling without sticky sessions or a shared store.
- **Coupling to `Schema.Types.Mixed`** in six+ hot models (`criteria`, `formBinding`, `evaluationRubric`, `blueprintSnapshot`, `jobCriteriaSnapshot`, compare `raw`/`ranking`) — flexible, but the compiler can't help you and Mongoose won't validate it.
- **Schema drift:** live cluster shows an orphaned `campaigncomparerequests` (0 docs) alongside the active `campaign_compare_requests` (15 docs) — residue of a model rename.
- **Migration debt in the open:** `Candidate` still stores legacy embedded evaluations *and* the new `CandidateApplication` collection stores them too (explicit dual-write comment: "source of truth for each submission is CandidateApplication … don't delete until all paths prove out").

**Cohesion:** High within services. **Coupling:** Moderate — routes reach into many services; the billing layer is well-isolated behind contracts, the interview/voice layer less so.

**Architecture score: 7 / 10.**

---

## 3. Database Analysis — Document-oriented or Relational?

**The answer is "both, and the code shows the seam."**

**Genuinely document-oriented (Mongo is an excellent fit):**
- `Candidate` is an *aggregate root*: profile + `writtenInterviewEvaluation` + `voiceInterviewEvaluation` + `videoInterviewEvaluation` + `voiceRecording` + `files[]`, read and written as one unit. This is textbook document modeling.
- `RecruitmentCampaign` embeds versioned, schema-fluid snapshots (`formBinding`, `evaluationRubric`, `criteria` as `Mixed`, three embedded `AiCompareResult` sub-docs). These are shaped by AI output and change often — relational columns would fight this.
- `VideoInterviewSession` embeds `conversationHistory[]` and a fat `blueprintSnapshot` — again an aggregate read as a unit.

**Genuinely relational (Mongo is being worked *around*):**
- **Candidate ↔ Campaign is many-to-many**, and the team **already created a join collection** (`CandidateApplication`) to model it — the single clearest evidence the data is drifting relational. It even carries **both** a string `campaignId` *and* an ObjectId `campaignRef` plus a `candidateId` ObjectId `ref`.
- **The money system** (`OrgPlanState` 1:1 org, `CreditBalance` 1:1 org, `CreditLedger` 1:N append-only) is a classic normalized ledger with foreign keys expressed as `organizationId` strings.

**Conclusion:** The *core product* (candidates, interviews, AI artifacts) is naturally document-oriented. The *transactional and relational periphery* (money, the M2M join, future reporting) is naturally relational and is currently emulated with join collections, idempotency keys, and compensating writes.

---

## 4. MongoDB Suitability — Evidence-based

- **Excellent fit** for: `Candidate` + embedded evaluations, `RecruitmentCampaign` snapshots/criteria, `VideoInterviewSession` transcripts, AI compare results. *Evidence:* every access pattern observed is find-by-key + read-the-whole-aggregate; no cross-document joins needed to render these.
- **Acceptable fit** for: the billing ledger. *Evidence:* it works today via single-document atomic compare-and-swap + idempotency + compensating rollback + reconciliation scripts (`scripts/reconcile-billing-health.ts`). But it is *emulating* transactional semantics rather than getting them for free (see §8).
- **Becoming a limitation** for: **reporting/analytics** and **referential integrity**. *Evidence:* only **3** aggregation call-sites exist in the entire backend (`$group` in `usageReservationService`, two in `videoBillingService`); there are **no `$lookup` joins**, **no `$facet`**, and **no dedicated reporting endpoints** at all. The moment real cross-campaign / cross-tenant reporting is required, Mongo aggregation will be the least ergonomic part of the stack.

**Net:** MongoDB is **not a mistake and not currently a bottleneck.** It is a good fit for ~70% of the domain and an awkward-but-managed fit for the money/reporting ~30%.

**Database-suitability score: 7 / 10.**

---

## 5. Data-Model Inspection (per entity)

| Entity | Where it lives | Cardinality / ownership | Modeling | Natural home |
|---|---|---|---|---|
| **Organization** | **Clerk** (+ `organizationId` string everywhere) | Tenant root | No Mongo model; referenced by string | Clerk — N/A |
| **User** | `users` (mirror of Clerk) | Org N:M via embedded `memberships[]` | Mirror doc, `permissions[]` embedded | Clerk-owned; Mongo mirror fine |
| **Role / Permission** | **Clerk claims** + `config/rbacRoles.ts` | Bundles + overrides | Not a collection; `permissions[]` array on User | Config/Clerk — N/A |
| **Job** | **Not a first-class entity** | Implicit | Encoded in `RecruitmentCampaign.criteria` (Mixed) + `jobPostingId` string | Document (fine) |
| **Campaign** | `recruitmentcampaigns` (62 live) | Org 1:N | Embeds rubric/formBinding/3× compare sub-docs | **Document ✓** |
| **Candidate** | `candidates` (46 live) | Org 1:N; M:N to campaigns | God-document + denormalized counters | **Document ✓** (but bloating) |
| **Application** | `candidate_applications` (38 live) | Candidate N:1, Campaign N:1 (**M2M join**) | New normalized join; dual-write in progress | **Relational-leaning** |
| **Interview (video)** | `video_interview_sessions` (2 live) | Candidate 1:N | Embeds `conversationHistory[]` + snapshot | **Document ✓** |
| **Evaluations** | Embedded in Candidate **and** Application | 1:1 with a stage of an application | Three parallel embedded blobs | Document ✓ (duplication is the risk) |
| **Blueprints / Expertise** | `interview_blueprints`, `job_expertise_profiles` | Campaign/role scoped | AI artifacts | **Document ✓** |
| **Subscription** | `org_plan_states` (mirror of Stripe) | Org 1:1 | Flat doc | Relational-ish, but 1:1 so fine |
| **Credit balance** | `credit_balances` | Org 1:1 | Materialized balance + video counters | Relational-ish; fine as 1:1 |
| **Credit ledger** | `credit_ledger` (307 live) | Org 1:N, append-only | Signed micro-credit deltas + before/after snapshots | **Relational ✓** (wants ACID) |
| **Usage reservation** | `usage_reservations` | Org 1:N, TTL | Headroom holds | Relational-leaning |
| **Audit** | `audit_logs` + `audit_outbox` | Org 1:N | Transactional outbox | Either; well-modeled |
| **Notifications** | **No collection found** | — | Appears to be email (SendGrid) + n8n only | ⚠️ *Evidence missing* |

**Normalization vs denormalization:** The system deliberately **denormalizes for reads** (`Candidate.applicationsCount`, `lastAppliedAt`, `lastCampaignId`; `emailDenorm` on applications; `planSnapshot` on every ledger row; `blueprintSnapshot`/`jobCriteriaSnapshot` on sessions) — sensible in Mongo. It is simultaneously **normalizing the M2M** (Candidate→Application), which is the tension point. References are a **mix of string keys** (`organizationId`, `campaignId` slug, `clerkUserId`) **and ObjectIds** (`candidateId`, `campaignRef`) with **no database-enforced integrity** — correctness depends on application discipline.

---

## 6. Query Analysis

**What the code actually does (evidence):**
- Overwhelmingly **single-collection `find` by indexed key + `.sort({ createdAt: -1 })`**. Example: candidate list = `find({ organizationId, campaignId }).sort({createdAt:-1})`.
- **No pagination** on the primary list endpoints — no `skip`/`limit`/cursor on `candidates`/campaigns (only `videoInterview.ts` uses a `.limit()`). Lists return the full org/campaign set.
- **Aggregation pipelines: 3 total**, all trivial (`$sum`/`$group` for reserved-credit headroom and video seconds). **No `$lookup`, no `$facet`, no multi-stage analytics.**
- **`.populate()` is essentially unused** — cross-collection stitching is done with separate `find`s in application code.
- **No `$text` and no Atlas `$search`** — verified live: `candidates.searchIndexes = []`.

**Is Mongo optimal for these queries?** **Yes, for the current shape.** Key-equality + sort on compound indexes is exactly what Mongo does best, and reading a candidate returns its whole evaluation history in one round-trip (a join in SQL). The queries the code runs today would gain little from Postgres.

**The caveat:** the queries the business *doesn't yet run* — cohort analytics, funnel/conversion reporting, cross-campaign comparisons, time-to-hire — are precisely the ones Mongo handles worst and SQL handles best. Today that's a non-issue because those features don't exist.

---

## 7. Multi-Tenancy

**Design:** Shared collections with an `organizationId` **string discriminator**, injected at query time by `orgScopedQuery(req, baseQuery)` (middleware) and defaulted on insert via `orgScopedDefaults`. RBAC comes from **Clerk session claims** (`requireRole`, `requirePermission`, `requireBillingWrite`).

**Isolation strength:**
- ✅ **Good compound indexing** for tenancy: `{organizationId, createdAt:-1}`, unique `{organizationId, email}` on candidates, `{organizationId, idempotencyKey}` unique on the ledger, 1:1 unique `organizationId` on balance/plan state.
- ✅ Billing mutations are Owner-gated with a dedicated guard.
- ⚠️ **Isolation is application-enforced, not database-enforced.** There is no row-level security; a single handler that forgets `orgScopedQuery` leaks across tenants. This is not hypothetical — project memory records a real cross-tenant attribution bug ("org MUST come from the campaign, never the session"). This risk is **identical under Postgres unless RLS is adopted**, so it is not a Mongo-specific weakness — but it *is* a weakness.
- ⚠️ **Over-indexing observed live:** `candidates` carries **11 indexes** including low-cardinality single-field ones (`entryStage`, `sourceType`, plus a redundant bare `email_1` alongside the unique compound). Across the DB: **148 indexes for 1,107 documents** (index storage 5.3 MB > data 1 MB). This adds write amplification and rarely helps reads.

**Does it scale?** For **per-tenant** volumes (thousands–tens-of-thousands of candidates per org) the shared-collection + compound-index model scales fine on Atlas. The failure modes are the missing pagination and the god-document, not the tenancy model itself.

---

## 8. Billing (the critical subsystem)

This is the **best-engineered** part of the codebase — and also the part with the **strongest relational pull.**

**What's excellent:**
- Append-only `CreditLedger` with **signed micro-credit deltas** (1 credit = 1e6 µ, per-second precision), `balanceBeforeMicro`/`balanceAfterMicro` on every row, and an **immutable `planSnapshot`** so the audit trail survives catalog drift.
- **Idempotency as a first-class gate:** unique `(organizationId, idempotencyKey)` — replayed Stripe webhooks and retried consumes collapse to no-ops.
- **Reservation pattern** (`usage_reservations`) to hold headroom for concurrent metered sessions (voice/video) so a shared pool isn't oversold.
- **Stripe is authoritative**, mirrored into `org_plan_states` through disciplined `apply*` functions; out-of-order `invoice.paid` events are guarded by monotonic period checks.

**Where it strains against Mongo (the core finding):**
- The hot consume path is **not a multi-document transaction.** `consumeCredits` does an **atomic single-document compare-and-decrement** — `findOneAndUpdate({ organizationId, balanceMicro: {$gte: cost} }, {$inc: {-cost}})` — then a **separate** `CreditLedger.create()`, with a **compensating `$inc` rollback** in the `catch`. A process crash *between* the decrement and the ledger insert leaves balance and ledger **drifted** (the compensating write only runs on a caught throw, not on a hard crash). This is mitigated by the before/after snapshots and reconciliation scripts, but it is a genuine correctness surface that ACID would eliminate.
- **TOCTOU in `reserveUsage`:** headroom is computed by aggregating active reservations + reading the balance, *then* creating the reservation — two concurrent reservations can both pass and over-reserve. Partially saved because the *final* consume is an atomic CAS that can't go negative, so reservations can over-*promise* but not over-*spend*.
- Notably, **Mongo transactions ARE used elsewhere** (`contactRevealService` and `videoBillingService` use `startSession()/withTransaction()`), so the team already has the tooling — the core consume path simply predates or opted out of it.

**Is Mongo ideal for billing?** **Acceptable, not ideal.** Money is the textbook case for ACID and for SQL-based reconciliation/reporting. Two viable fixes without leaving Mongo: (a) wrap the consume path in a `withTransaction` on the balance+ledger writes (Atlas supports it — cheapest), or (b) if finance/reporting demands grow, carve the ledger into Postgres as a focused "money service" (polyglot). Neither requires migrating the whole product.

---

## 9. Realtime

**Finding: realtime here is a *streaming/compute* concern, essentially decoupled from the database — so Mongo is neither an advantage nor a limitation.**

- WebSockets are used heavily for **audio/video interview streaming** (`voiceSessionCore.ts`, `videoStreamService.ts`, `deepgramStreamingService.ts`, `avatarAudioService.ts`, reception WS) bridging LiveKit / Deepgram / Speechmatics / ElevenLabs. Frontend uses `new WebSocket` only inside the interview/reception call pages.
- Session state lives in **in-process `Map`s** (`sessionStore.ts`) — not in Mongo, and **not in a shared store**. This is the real realtime scaling constraint: it requires sticky sessions and blocks multi-instance scale-out.
- **No MongoDB change streams** are used; there is **no in-app notification collection** (candidate/interview status changes appear to fan out via n8n/email, not a DB-backed feed — *evidence for a DB notification store is missing*).

**Is the architecture correct?** For streaming, yes (offload to purpose-built media/STT services). The weakness is the **in-memory session store**, not the database. Moving Mongo→Postgres would change nothing here; introducing Redis for shared session/pub-sub would.

---

## 10. Search

**Finding: MongoDB Atlas Search is currently an *unrealized* advantage — it isn't used at all.**
- Candidate/interview/job filtering is **equality on indexed fields** (`campaignId`, `sourceType`, `entryStage`) + `createdAt` sort. No `$text`, no fuzzy, no relevance ranking. Verified live: **zero search indexes** on `candidates`.
- **HeadHunter/"AI search" is external** — it queries LinkedIn via Unipile/n8n and holds results in an **in-memory `Map`**, not Mongo.

**Implication:** If Evaalo wants real recruiter search ("find candidates matching this JD, ranked"), **Atlas Search / Vector Search would become a concrete reason to stay on Mongo** — one datastore for records + lexical + semantic search. That's a latent Mongo advantage the product hasn't cashed in. Under Postgres the equivalent is `tsvector`/`pg_trgm` + `pgvector` (also good). Today: neither is used, so search is a wash.

---

## 11. AI Layer

**Finding: MongoDB provides *no* AI-specific benefit today because no AI data structures live in it.**
- **No embeddings, no `$vectorSearch`** anywhere in the backend (verified). AI **compute is fully offloaded** to OpenAI + n8n; Mongo stores the **JSON results** (`writtenInterviewEvaluation`, `aiCompareTopResult`, `competencyScores`, `blueprintSnapshot`).
- LLM/STT/TTS orchestration is its own service layer (`llmService`, `sttRouterService`, `ttsService`, `voiceOrchestrator`) talking to external providers.

**Where Mongo *could* help:** storing candidate/JD embeddings and running Atlas Vector Search for semantic matching and "similar candidates." That would be a real, DB-native advantage — currently on the table, not taken. Storing LLM outputs as flexible documents *is* a mild Mongo win (schema-fluid), but Postgres JSONB covers that too.

---

## 12. Performance & Scale

**Today (measured):** 1,107 documents, ~1 MB data, ~5.3 MB indexes, 2 video sessions, 307 ledger rows. Performance is a non-issue at this scale; nothing below is observed, all is projected.

**Projected bottlenecks (ordered by when they bite):**
1. **God-document growth / 16 MB cap.** `VideoInterviewSession.conversationHistory[]` is an **unbounded embedded array**; long or abusive interviews grow the doc monotonically. `Candidate` similarly accretes embedded evaluations. This bites *specific hot documents* long before the collection is "big."
2. **No pagination.** Returning an entire org/campaign candidate set to the client fails first at the **network/render** layer (10k–100k rows), not at Mongo. This is the earliest real-world wall.
3. **Write amplification from over-indexing** (148 indexes / 1.1k docs) — grows with ingest volume; cheap to fix by pruning low-cardinality single-field indexes.
4. **Analytical queries at 1M+ candidates / millions of interviews.** Aggregations, funnels, and cross-tenant admin reporting on embedded/`Mixed` fields will be slow and awkward in Mongo. **This is where SQL would decisively win** — but the feature must exist first.
5. **In-memory realtime session state** caps concurrent interviews per instance and blocks horizontal scale independent of the DB.

**Would Mongo remain appropriate at 100k / 1M candidates per large org?** For the **OLTP core (fetch candidate, run interview, meter credits): yes**, with pagination, bounded arrays (move `conversationHistory` to its own collection), and index pruning. For **analytics at that scale: increasingly no** — you'd want a read model / warehouse regardless of primary DB.

**Performance score: 8 / 10 today, ~6 / 10 projected at scale without the fixes above.**

---

## 13. Future Roadmap (Evaalo in ~5 years)

If Evaalo grows into a mainstream ATS, two forces intensify:
- **Reporting/analytics/compliance** becomes a first-class product surface (dashboards, funnels, DEI reporting, data exports, audit queries). This is Mongo's weakest axis and the code has **none of it yet** — greenfield, so it can be built on the *right* substrate (a warehouse or Postgres read model) without touching the transactional core.
- **Financial correctness & finance-team reporting** on the ledger grows in stakes. Either harden with Mongo transactions or split the ledger to Postgres.

The **document core (candidates, interviews, AI artifacts) will still make sense on Mongo in 5 years** — it's aggregate-shaped and schema-fluid by nature. The realistic 5-year end-state is **polyglot**: Mongo for the product core, a relational/warehouse layer for money-truth + analytics, Redis for realtime session/cache, and Atlas (or `pgvector`) for search. A single-store "everything in Postgres" or "everything in Mongo" both look *worse* at that horizon than a deliberate split.

---

## 14. PostgreSQL Comparison (existing vs. hypothetical PG — no recommendation to migrate)

**Becomes easier under Postgres:**
- **Money integrity** — ledger+balance in one ACID transaction, native; the compensating-write/TOCTOU class of bugs disappears.
- **Reporting/analytics** — `JOIN`, `GROUP BY`, window functions, CTEs; the M2M (candidate↔application↔campaign) is a natural join, not a hand-maintained join collection with dual string+ObjectId refs.
- **Referential integrity** — FKs enforce what is today only application-enforced across string keys; orphan/drift bugs (like the dead collection) get harder to create.
- **Tenant isolation** — Row-Level Security can make isolation a *database* guarantee instead of "don't forget `orgScopedQuery`."
- **Unbounded children** — `conversationHistory`, `timeline`, ledger, applications become rows, sidestepping the 16 MB document ceiling.

**Becomes harder under Postgres:**
- The genuinely **schema-fluid `Mixed` fields** (`criteria`, `formBinding`, `evaluationRubric`, `blueprintSnapshot`, `jobCriteriaSnapshot`, compare `raw`) → `JSONB`. Works well, but you trade Mongo's native flexibility for JSONB ergonomics + more migration ceremony as shapes evolve.
- **"Read the whole candidate aggregate in one shot"** becomes a multi-table join or a JSONB blob.
- **Velocity during the current in-flight refactor** — the team is mid dual-write; a schema-rigid store mid-migration is more friction.

**Stays the same:**
- Clerk (auth/orgs/roles), Stripe (payments), n8n/OpenAI (AI), LiveKit/Deepgram/Speechmatics/R2 (media) are unchanged — **the hardest external dependencies are DB-agnostic**. The app is I/O-bound on external AI/media, not on the database engine.

---

## 15. Migration Feasibility

**Classification: MEDIUM–HIGH.**

**Why not "Low":** 23 collections; ORM swap (Mongoose → Prisma/Drizzle) touches nearly every route and service; `Mixed` → `JSONB` mapping; the **dual reference strategy** (string `campaignId` *and* ObjectId `campaignRef`, string `organizationId` vs Clerk ids) must be reconciled; idempotency/ledger semantics and reconciliation must be preserved bit-for-bit; a live, near-zero-downtime cutover with in-flight billing is the genuinely hard part.

**Why not "Very High":** the domain is small (1,107 docs today), the team has **already demonstrated migration capability** (the `candidate_applications` normalization + `scripts/migrateCandidateApplications.ts`, `migrateAddOrgId.ts` are live proof), auth/money-truth/AI already sit outside Mongo, and the schema-fluid parts map cleanly to JSONB.

**Cheapest high-value alternatives to a full migration:**
1. Wrap `consumeCredits` balance+ledger in a Mongo `withTransaction` (closes the correctness gap in days, not months).
2. Add pagination + bound `conversationHistory` (move to its own collection).
3. Prune low-cardinality indexes; delete the orphan `campaigncomparerequests`.
4. Build reporting as a separate read model (Atlas aggregation view or a Postgres/warehouse replica) — **without** moving the primary store.
5. If/when finance requires it, carve *only the ledger* into Postgres (polyglot), leaving the document core in place.

---

## Scorecard

| Dimension | Score | One-line justification |
|---|---:|---|
| **Architecture quality** | **7 / 10** | Strong service boundaries, idempotency/outbox/snapshot discipline; dinged for god-files, empty-controller split, in-memory realtime state, schema drift, half-done dual-write. |
| **Database suitability** | **7 / 10** | Great for the document core; strained on money (no ACID on hot path) and reporting (near-zero aggregation); unrealized search/vector upside. |
| **Scalability** | **6 / 10** | Per-tenant model scales; but no pagination, unbounded arrays, in-memory sessions, no cache, over-indexing bite before Mongo does. |
| **Maintainability** | **6 / 10** | Excellent inline docs + "locked contracts"; hurt by 1,300–1,765-line files, dual-write duplication, `Mixed`-erased types, migration churn. |
| **Performance** | **8 today / 6 projected** | Trivial at current volume; moderate forward risk concentrated in god-documents + analytics, not the engine. |

---

## Risk Assessment

| Risk | Severity | Likelihood | Evidence |
|---|---|---|---|
| Balance/ledger drift on crash between decrement and ledger insert | **High** (money) | Low–Med | `consumeCredits` non-transactional CAS + compensating catch only |
| Reservation TOCTOU over-promising headroom | Medium | Medium | read-then-create in `reserveUsage` |
| Cross-tenant leak via missed `orgScopedQuery` | **High** | Low (but happened once) | app-enforced isolation; prior bug in memory |
| God-document 16 MB blowout (interview transcripts) | Medium | Low–Med | unbounded `conversationHistory[]` |
| Full-collection reads to client (no pagination) | Medium | **High at scale** | list endpoints lack `skip/limit` |
| Reporting cannot be served from current schema | Medium | High (once demanded) | 3 aggregations total, no reporting endpoints |
| Index bloat / write amplification | Low | Medium | 148 indexes / 1.1k docs |
| Schema drift accumulating | Low | Medium | orphan `campaigncomparerequests` |

---

## Long-Term Recommendation

**Do not migrate off MongoDB before launch.** The document model is a *good* fit for the product core, the highest-stakes data (auth, payment truth, AI) already lives outside Mongo, and the two areas that pull relational — money and reporting — are addressable *without* moving the primary store. A wholesale pre-launch migration would consume months of runway to solve problems the product does not yet have.

**Instead, adopt a "harden now, split later" path:**
1. **Now (days–weeks):** wrap the credit consume path in a Mongo transaction; add pagination; bound `conversationHistory`; prune indexes; drop the orphan collection; finish the `candidate_applications` cutover and delete the legacy embedded copies.
2. **Next (as features demand):** build reporting on a dedicated read model/warehouse; add Redis for shared realtime session state + caching; if recruiter search is prioritized, turn on Atlas Search/Vector Search (a Mongo-native win).
3. **Later (only if finance/analytics justify it):** carve the ledger into Postgres as a focused money service — a *targeted* polyglot split, not a big-bang rewrite.

## Migration Recommendation

**Defer.** Re-evaluate a partial (ledger-only) move to Postgres when **either** trigger fires: (a) finance/compliance requires transactional guarantees or rich SQL reporting the team is uncomfortable emulating, **or** (b) analytical reporting becomes a core product surface. Treat it as **event-driven, not calendar-driven**, and keep it **partial** (ledger + reporting), never a full product rewrite.

## Confidence Level

- **High** on all code-grounded findings — models, billing engine, middleware, and *live* index/count introspection were read directly.
- **Medium** on forward-scale projections — inherently speculative; the live dataset is pre-launch-trivial (1,107 docs), so scale behavior is reasoned, not observed.
- **Explicitly low / flagged as missing evidence:** in-app notification storage (no collection found), formal reporting requirements (none exist yet), and real production data volumes (the cluster is effectively empty). These should be confirmed with the team before any migration decision is finalized.

---

*Audit performed by static inspection of the `cursor-react` monorepo plus read-only live introspection of the `evaalo` Atlas database. No files were modified; no schema or data was changed.*
