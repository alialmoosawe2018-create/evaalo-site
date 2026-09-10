/**
 * Stage 1 parity checks (offline, fictional data only).
 * Run: npm run test:stage1-parity
 */
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { orgScopedQuery } from '../middleware/orgScope.js';
import {
    isCompleteStage1WrittenPatch,
    validateStage1WrittenEvaluationPersistence,
    STAGE1_INCOMPLETE_EVALUATION_ERROR,
} from '../services/stage1WrittenEvaluationGate.js';
import { buildN8nStageIdempotencyKey } from '../services/webhookIdempotency.js';
import { mergeEval, applyN8nRejectHandling } from '../services/stageWebhookMerge.js';
import { shouldSendStage1ToN8n } from '../services/stage1N8nPayloadBuilder.js';

/**
 * The frontend utilities this file checks parity against, loaded from the REAL
 * frontend source.
 *
 * The specifier is built at runtime on purpose. The backend tsconfig sets
 * `rootDir: ./src` with `allowJs` off, so a static import of a sibling
 * workspace's .js would fail the type-check. A computed specifier is not
 * resolved by TypeScript, while Node/tsx resolves it normally — which is what
 * makes this a parity test instead of a copy of one.
 */
const FRONTEND_UTILS = new URL('../../../frontend/src/utils/', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stageRecommendation: any = await import(`${FRONTEND_UTILS}stageRecommendation.js`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const screeningCampaigns: any = await import(`${FRONTEND_UTILS}screeningCampaigns.js`);

const CANDIDATE_ID = '507f1f77bcf86cd799439011';

function mockReq(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
    return { body, headers } as unknown as Request;
}

/**
 * ⚠️ `auth` MUST be a FUNCTION, and what it returns MUST carry
 * `tokenType: 'session_token'`. Two separate Clerk gates enforce this:
 *
 *   1. `getAuth` CALLS the property — `const authObject = req.auth(options)`
 *      (@clerk/express/dist/index.js). An object here throws
 *      "req.auth is not a function", and getAuthContext swallows that in its
 *      try/catch (middleware/auth.ts), so no org resolves at all.
 *   2. The returned object is passed through `getAuthObjectForAcceptedToken`,
 *      whose `acceptsToken` defaults to TokenType.SessionToken. Without
 *      `tokenType` it is REPLACED by signedOutAuthObject (orgId: null).
 *
 * Either mistake silently degrades every request to DEFAULT_ORG_ID, which is
 * exactly how this test read `org_default` for BOTH orgs while it sat
 * unregistered and never ran. Nothing here needs Clerk keys, clerkMiddleware
 * or the network.
 */
function mockOrgReq(orgId: string): Request {
    return {
        auth: () => ({
            tokenType: 'session_token',
            userId: `user_${orgId}`,
            orgId,
            sessionClaims: { orgId },
        }),
    } as unknown as Request;
}

function testStage1IdempotencyIncludesSessionId(): void {
    const body = { evaluationSource: 'written', overall_score: 70 };
    const reqA = mockReq(body);
    const reqB = mockReq(body);
    const keyEmpty = buildN8nStageIdempotencyKey(reqA, 'stage1', CANDIDATE_ID, '');
    const keySess = buildN8nStageIdempotencyKey(reqB, 'stage1', CANDIDATE_ID, 'sess-abc');
    assert.notEqual(keyEmpty, keySess);
    assert.match(keyEmpty, /^n8n:stage1:hash:/);
}

function testStage2IdempotencyIncludesSessionId(): void {
    const body = { evaluationSource: 'voice' };
    const req = mockReq(body);
    const keyEmpty = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, '');
    const keyWithSession = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, 'voice-sess-abc');
    assert.notEqual(keyEmpty, keyWithSession, 'stage2 must include sessionId in hash fallback');
    const keySameSession = buildN8nStageIdempotencyKey(req, 'stage2', CANDIDATE_ID, 'voice-sess-abc');
    assert.equal(keyWithSession, keySameSession);
}

function testExecutionIdPriority(): void {
    const req = mockReq({ executionId: 'exec-123', overall_score: 1 });
    const key = buildN8nStageIdempotencyKey(req, 'stage1', CANDIDATE_ID, 'sess-x');
    assert.equal(key, 'n8n:stage1:exec:exec-123');
}

function testHeaderIdempotencyKeyPriority(): void {
    const body = { evaluationSource: 'written' };
    const req = mockReq(body, { 'x-idempotency-key': 'exec-from-header' });
    const key = buildN8nStageIdempotencyKey(req, 'stage1', CANDIDATE_ID, '');
    assert.equal(key, 'n8n:stage1:exec-from-header');
}

function testSamePayloadSameIdempotencyKey(): void {
    const body = { evaluationSource: 'written', overall_score: 55, recommendation: 'Consider' };
    const reqA = mockReq(body);
    const reqB = mockReq(body);
    const keyA = buildN8nStageIdempotencyKey(reqA, 'stage1', CANDIDATE_ID, '');
    const keyB = buildN8nStageIdempotencyKey(reqB, 'stage1', CANDIDATE_ID, '');
    assert.equal(keyA, keyB, 'identical Stage 1 callbacks must share idempotency key');
}

function testPublicScreeningSkipsWrittenStage1Send(): void {
    // ⚠️ لا تُعِد كتابة الشرط هنا. كان سطراً مضمَّناً داخل الاختبار فينجح مهما
    // تغيّرت البوّابة الحقيقية؛ استُخرج إلى services/stage1N8nPayloadBuilder.ts.
    assert.equal(shouldSendStage1ToN8n('public_screening', true), false);
    assert.equal(shouldSendStage1ToN8n('manual', true), true);
    assert.equal(shouldSendStage1ToN8n(undefined, true), true);
    // البوّابة الثانية: بلا webhook مضبوط لا يُرسَل شيء مهما كان المصدر.
    assert.equal(shouldSendStage1ToN8n('manual', false), false);
    assert.equal(shouldSendStage1ToN8n('public_screening', false), false);
}

function testOrgScopedQueryIsolation(): void {
    const orgA = orgScopedQuery(mockOrgReq('org_a'), { campaignId: { $in: ['c1'] } });
    const orgB = orgScopedQuery(mockOrgReq('org_b'), { campaignId: { $in: ['c1'] } });
    // Named guard first: if a future @clerk/backend bump changes the
    // acceptsToken default or adds a required field, the mock degrades to
    // signedOutAuthObject and EVERY org collapses to the shared default. The
    // assertions below would still fail, but this one says why.
    assert.notEqual(
        orgA.organizationId,
        'org_default',
        'mock req no longer reaches getAuth — see mockOrgReq: auth must be a function returning tokenType session_token'
    );
    assert.equal(orgA.organizationId, 'org_a');
    assert.equal(orgB.organizationId, 'org_b');
    assert.notEqual(orgA.organizationId, orgB.organizationId);
}

/** مرشّح واحد يكفي لبناء مجموعة — الحقول الأخرى لا تؤثّر في العنوان أو الحذف. */
const CANDIDATE_IN_CAMP_1 = { _id: 'cand-1', campaignId: 'camp-1' };

function testCampaignBatchTitleNotDeletedWhenMetaExists(): void {
    const meta = {
        campaignId: 'camp-1',
        criteria: { position: 'HR Business Partner' },
        templateName: 'HR BP Template',
    };
    const groups = screeningCampaigns.buildScreeningCampaignGroups(
        [CANDIDATE_IN_CAMP_1],
        [],
        { 'camp-1': meta },
        {}
    );
    const row = groups.active.find((g: { selectionKey: string }) => g.selectionKey === 'camp-1');
    assert.ok(row, 'camp-1 group must exist');
    assert.equal(row.isDeleted, false);
    assert.equal(row.title, 'HR Business Partner');
}

function testCampaignDeletedOnlyWithoutMeta(): void {
    // بلا بيانات وصفية وبمرشّحين موجودين ⇒ محذوفة، والعنوان من الإنتاج نفسه.
    const deleted = screeningCampaigns.buildScreeningCampaignGroups(
        [CANDIDATE_IN_CAMP_1],
        [],
        {},
        {}
    );
    const gone = deleted.active.find((g: { selectionKey: string }) => g.selectionKey === 'camp-1');
    assert.ok(gone, 'camp-1 group must exist');
    assert.equal(gone.isDeleted, true);
    assert.equal(gone.title, 'Deleted Campaign');

    /**
     * ⚠️ الحارس الذي أسقطته النسخة المرآتية تماماً: خريطة فارغة **لم تُجب بعد**
     * لا تقول شيئاً عن وجود الحملة. اعتبارُها حذفاً هو ما كان يُومض «حملة
     * محذوفة» على اللوحة قبل وصول الدفعة. النسخة القديمة كانت تحسبها
     * `isDeleted = meta == null` فتُغفل هذا الشرط كلّه.
     */
    const stillLoading = screeningCampaigns.buildScreeningCampaignGroups(
        [CANDIDATE_IN_CAMP_1],
        [],
        {},
        {},
        { metaPending: true }
    );
    const pendingRow = stillLoading.active.find(
        (g: { selectionKey: string }) => g.selectionKey === 'camp-1'
    );
    assert.ok(pendingRow, 'camp-1 group must exist');
    assert.equal(pendingRow.isDeleted, false, 'a snapshot that has not answered must never assert deletion');
    assert.notEqual(pendingRow.title, 'Deleted Campaign');
}

function testPlaceholderFinalHrRejected(): void {
    const data = { evaluationSource: 'written', ingress: 'stage1' };
    const patch = {
        overall_score: 70,
        recommendation: 'Consider' as const,
        final_hr_evaluation: 'undefined',
    };
    assert.equal(isCompleteStage1WrittenPatch(patch), false);
    const result = validateStage1WrittenEvaluationPersistence(data, patch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, STAGE1_INCOMPLETE_EVALUATION_ERROR);
}

function testFrontendNormalization(): void {
    // ⚠️ هذه هي دوالّ الواجهة الحقيقية، لا نسخة عنها — وإلّا فالاسم «parity» كذب.
    const { normalizeStageEvalText, normalizeStageEvalStringList } = stageRecommendation;
    assert.equal(typeof normalizeStageEvalText, 'function', 'frontend util failed to load');
    assert.equal(normalizeStageEvalText('undefined'), null);
    assert.equal(normalizeStageEvalText('null'), null);
    assert.equal(normalizeStageEvalText('Valid HR report.'), 'Valid HR report.');
    const parsed = normalizeStageEvalStringList('["Strength one", "Strength two"]');
    assert.deepEqual(parsed, ['Strength one', 'Strength two']);
}

/**
 * ⚠️ لا تُعِد كتابة `mergeEval` هنا. كان هذا الاختبار ينسخها داخله فينجح مهما
 * انكسر الإنتاج؛ استُخرجت الآن إلى services/stageWebhookMerge.ts وتُستورد.
 */
function testMergeEvalStripsPlaceholderText(): void {
    const merged = mergeEval(
        { fit_for_role: 'Good fit', summary: 'Prior summary' },
        { fit_for_role: 'undefined', final_hr_evaluation: 'Valid HR narrative.' }
    );
    assert.equal(merged.fit_for_role, 'Good fit');
    assert.equal(merged.final_hr_evaluation, 'Valid HR narrative.');
    assert.equal(merged.summary, 'Prior summary');

    // القيمة النائبة المخزَّنة سلفاً تُحذف حتى لو لم يمسّها الـ patch — هذا
    // الشرط الثاني في mergeEval ولم تكن النسخة المرآتية تختبره أصلاً.
    const cleaned = mergeEval({ stale: 'NaN', keep: 'real' }, {});
    assert.equal('stale' in cleaned, false);
    assert.equal(cleaned.keep, 'real');
}

function testRejectSpamSetsRejectedAndNotes(): void {
    const updateData: Record<string, unknown> = {};
    applyN8nRejectHandling(
        {
            ingress: 'stage1-reject',
            rejectCode: 'honeypot',
            summary: 'Spam detected',
        },
        updateData,
        {},
        'Existing note'
    );
    assert.equal(updateData.status, 'rejected');
    assert.match(String(updateData.notes), /\[n8n:honeypot\]/);
    assert.match(String(updateData.notes), /Spam detected/);
    assert.match(String(updateData.notes), /^Existing note\n/);

    // فرعٌ لم تكن النسخة المرآتية تملكه أصلاً: التوصية وحدها تكفي للرفض حتى بلا
    // rejectCode ولا ingress. النسخة القديمة كانت بثلاثة معاملات فقط، فلم تكن
    // ترى الـ patch إطلاقاً — أي أنّ هذا المسار لم يُختبر ولا مرّة.
    const byRecommendation: Record<string, unknown> = {};
    applyN8nRejectHandling({}, byRecommendation, { recommendation: 'no hire' });
    assert.equal(byRecommendation.status, 'rejected');

    // ولا يُرفَض من لم يُرفَض.
    const notRejected: Record<string, unknown> = {};
    applyN8nRejectHandling({}, notRejected, { recommendation: 'Consider' });
    assert.equal(notRejected.status, undefined);
}

function main(): void {
    testStage1IdempotencyIncludesSessionId();
    testStage2IdempotencyIncludesSessionId();
    testExecutionIdPriority();
    testHeaderIdempotencyKeyPriority();
    testSamePayloadSameIdempotencyKey();
    testPublicScreeningSkipsWrittenStage1Send();
    testOrgScopedQueryIsolation();
    testCampaignBatchTitleNotDeletedWhenMetaExists();
    testCampaignDeletedOnlyWithoutMeta();
    testPlaceholderFinalHrRejected();
    testFrontendNormalization();
    testMergeEvalStripsPlaceholderText();
    testRejectSpamSetsRejectedAndNotes();
    console.log('stage1-parity-test: all passed');
}

main();
