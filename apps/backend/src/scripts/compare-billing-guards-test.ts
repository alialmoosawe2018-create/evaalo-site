/**
 * Compare-Top billing guards — offline tests (no Mongo, no env).
 * Run: npx tsx src/scripts/compare-billing-guards-test.ts
 *
 * يغطي حراس الفوترة التي أصلحت تسريب الإيرادات والشحنات العالقة:
 *  - فلتر الإكمال يرفض الحالات النهائية (refunded/failed/completed).
 *  - فلتر الفشل لا يرجع طلباً مسترداً إلى failed.
 *  - حساب تكلفة التقرير (1 كردت/مستلم + 2 كردت/مرشح).
 *  - rollback الشحنة اليتيمة يتجاهل المبالغ الصفرية (بلا نداء DB).
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
    buildCampaignCompareCompletionFilter,
    buildCampaignCompareFailureFilter,
    campaignCompareWebhookActionsAfterFinalize,
} from '../services/campaignCompareN8nInbound.js';
import {
    computeCompareTopChargeMicro,
    rollbackCompareTopChargeWithoutRecord,
} from '../services/compareEmailBilling.js';
import { MICRO_PER_CREDIT } from '../types/billing.js';

const LIVE_STATUSES = ['pending', 'dispatched', 'processing'] as const;
const TERMINAL_STATUSES = ['completed', 'failed', 'refunded'] as const;

function testCompletionFilterMatrix(): void {
    const recordId = new mongoose.Types.ObjectId();
    const filter = buildCampaignCompareCompletionFilter(recordId);
    const allowed = filter.status.$in as readonly string[];

    for (const status of LIVE_STATUSES) {
        assert.ok(allowed.includes(status), `completion must allow live status "${status}"`);
    }
    for (const status of TERMINAL_STATUSES) {
        assert.ok(
            !allowed.includes(status),
            `completion must NOT allow terminal status "${status}" (revenue-leak guard)`
        );
    }
}

function testFailureFilterMatrix(): void {
    const filter = buildCampaignCompareFailureFilter('req-1');
    const denied = filter.status.$nin as readonly string[];

    assert.ok(denied.includes('completed'), 'failure must not touch completed');
    assert.ok(denied.includes('refunded'), 'failure must not regress refunded');
    for (const status of LIVE_STATUSES) {
        assert.ok(!denied.includes(status), `failure must be reachable from "${status}"`);
    }
    // failed → failed مسموح (idempotent re-mark) وغير ضار.
    assert.ok(!denied.includes('failed'));
}

function testChargeMath(): void {
    // 1 كردت لكل مستلم إيميل + 2 كردت لكل مرشح في الـ pool.
    const r = computeCompareTopChargeMicro(2, 5);
    assert.equal(r.emailMicro, 2 * MICRO_PER_CREDIT);
    assert.equal(r.candidateMicro, 10 * MICRO_PER_CREDIT);
    assert.equal(r.totalMicro, 12 * MICRO_PER_CREDIT);

    const zero = computeCompareTopChargeMicro(0, 0);
    assert.equal(zero.totalMicro, 0);

    const emailOnly = computeCompareTopChargeMicro(3, 0);
    assert.equal(emailOnly.totalMicro, 3 * MICRO_PER_CREDIT);
}

function testWebhookActionsOnLostRace(): void {
    // callback متأخر/مكرر (finalized=null): يكمل الـ webhook بلا فشل — يوقف retries.
    const actions = campaignCompareWebhookActionsAfterFinalize(null);
    assert.equal(actions.duplicate, true);
    assert.equal(actions.completeWebhook, true);
    assert.equal(actions.failWebhook, false);
}

async function testOrphanRollbackSkipsZeroAmount(): Promise<void> {
    // amountMicro<=0 يعود مبكراً دون أي نداء DB — لذا يصح تشغيله offline.
    await rollbackCompareTopChargeWithoutRecord({
        organizationId: 'org_test',
        requestId: 'req-zero',
        amountMicro: 0,
        reason: 'test',
    });
    await rollbackCompareTopChargeWithoutRecord({
        organizationId: 'org_test',
        requestId: 'req-negative',
        amountMicro: -5,
        reason: 'test',
    });
}

async function main(): Promise<void> {
    testCompletionFilterMatrix();
    testFailureFilterMatrix();
    testChargeMath();
    testWebhookActionsOnLostRace();
    await testOrphanRollbackSkipsZeroAmount();
    console.log('compare-billing-guards-test: all passed');
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(err);
        process.exit(1);
    }
);
