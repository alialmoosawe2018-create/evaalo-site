/**
 * Reset a stuck ai-compare-top request: refund credit + clear campaign field.
 * Usage: node scripts/reset-stuck-compare.mjs [campaignId] [requestId]
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const campaignId = process.argv[2] || '6606bf9964a7b3d06430a4ba4ea75e1f';
const requestId = process.argv[3] || '7dc8a5202ca39217e9b0df6f062d496c';

const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI);

const { refundCompareEmail } = await import('../src/services/compareEmailBilling.ts');

const camp = await mongoose.connection.collection('recruitmentcampaigns').findOne({ campaignId });
if (!camp) {
    console.error('Campaign not found:', campaignId);
    process.exit(1);
}

const orgId = camp.organizationId || 'org_default';
const current = camp.aiCompareTopResult;
console.log('Before:', JSON.stringify(current, null, 2));

if (current?.requestId === requestId && current?.status === 'processing') {
    const { refunded } = await refundCompareEmail({
        campaignId,
        organizationId: orgId,
        field: 'aiCompareTopResult',
        requestId,
        reason: 'failed',
    });
    console.log('Refund result:', refunded);
} else if (current?.status === 'refunded') {
    console.log('Already refunded, skipping refund');
} else {
    console.warn('Unexpected state — proceeding with unset only');
}

await mongoose.connection.collection('recruitmentcampaigns').updateOne(
    { campaignId },
    { $unset: { aiCompareTopResult: '' } },
);

const after = await mongoose.connection.collection('recruitmentcampaigns').findOne(
    { campaignId },
    { projection: { aiCompareTopResult: 1 } },
);
console.log('After:', after?.aiCompareTopResult ?? null);

const bal = await mongoose.connection.collection('creditbalances').findOne({ organizationId: orgId });
console.log('Balance micro:', bal?.balanceMicro ?? bal?.balances);

await mongoose.disconnect();
console.log('Done — refresh the page and click Compare Top Candidates again.');
