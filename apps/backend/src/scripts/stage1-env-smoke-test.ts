/**
 * Smoke test: .env stage security config loads and mint works (no network/n8n/MongoDB).
 * Run: npx tsx src/scripts/stage1-env-smoke-test.ts
 */
import '../loadEnv.js';
import assert from 'node:assert/strict';
import {
    areStageSecretsConfigured,
    assertStageSecureMintConfiguration,
    getStageCallbackSecurityMode,
    getPublicApiBase,
    mintStageCallbackUrl,
} from '../services/stageCallbackAuth.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';

function main(): void {
    assert.equal(getStageCallbackSecurityMode(), 'required');
    assert.equal(areStageSecretsConfigured(), true);
    assert.doesNotThrow(() => assertStageSecureMintConfiguration());

    const base = getPublicApiBase();
    assert.ok(base.length > 0, 'PUBLIC_API_URL must be set');

    const minted = mintStageCallbackUrl({
        mode: 'stage1',
        candidateId: CANDIDATE_ID,
    });
    assert.ok(minted.callbackUrl.includes('/webhook/n8n/stage1?'));
    assert.ok(minted.callbackUrl.startsWith(base));
    assert.ok(minted.inboundSecret.length > 0);

    console.log('stage1-env-smoke-test: .env stage security OK');
    console.log(`  securityMode=required publicApiBase=${base}`);
    console.log(`  mintPath=/webhook/n8n/stage1 (token present)`);
}

main();
