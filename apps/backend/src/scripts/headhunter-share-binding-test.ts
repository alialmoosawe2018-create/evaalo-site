/**
 * A sourcing context may only be spent against the campaign — and the
 * organization — it was minted for.
 *
 * This is the rule `/sourcing-context` and `/api/candidates` share. It exists as
 * its own module for the reason `pinnedBlueprintForScoring` had to: the first
 * test of that rule reimplemented it locally, and every mutation of the route
 * stayed green because nothing in the test touched the code that runs.
 *
 * ⚠️ The case that matters most is the least obvious one: a context with NO
 * organization must be REFUSED. An absent org is not "nothing to check" — it is
 * a context we cannot prove belongs to this tenant, which is the single property
 * this function exists to establish.
 *
 * Run: npm run test:headhunter-share-binding
 */
import assert from 'node:assert/strict';
import { assertSourcingContextMatchesCampaign } from '../services/headHunterShareBinding.js';

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

const ORG_A = 'org_3IsSoVuqhLik0yCzkhedGHq24ak';
const ORG_B = 'org_3GmTSWnWuk2G02PcWG3fs4IVb5j';
const CAMPAIGN_A = 'b1e2d3c4a5f60718293a4b5c6d7e8f90';
const CAMPAIGN_B = '350b2b126342a274af0526a3e409271c';

check('a context minted for this campaign, in this org, is accepted', () => {
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_A,
        contextCampaignId: CAMPAIGN_A,
        campaignOrgId: ORG_A,
        campaignId: CAMPAIGN_A,
    });
    assert.equal(v.ok, true);
    assert.equal(v.code, undefined);
});

check('🔴 a context from ANOTHER organization is refused', () => {
    // The multi-tenant invariant. A link minted in org B must never be spendable
    // against org A's campaign, whatever the anonymous submitter's browser says.
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_B,
        contextCampaignId: CAMPAIGN_A,
        campaignOrgId: ORG_A,
        campaignId: CAMPAIGN_A,
    });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'HEADHUNTER_CONTEXT_ORG_MISMATCH');
});

check('🔴 a context minted for another campaign is refused', () => {
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_A,
        contextCampaignId: CAMPAIGN_B,
        campaignOrgId: ORG_A,
        campaignId: CAMPAIGN_A,
    });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'HEADHUNTER_CONTEXT_CAMPAIGN_MISMATCH');
});

check('🔴 a context with NO organization FAILS CLOSED', () => {
    // Not "nothing to compare" — unprovable, which is the same thing as wrong
    // for a check whose only job is to prove tenancy.
    for (const missing of ['', '   ', null, undefined]) {
        const v = assertSourcingContextMatchesCampaign({
            contextOrgId: missing as any,
            contextCampaignId: CAMPAIGN_A,
            campaignOrgId: ORG_A,
            campaignId: CAMPAIGN_A,
        });
        assert.equal(v.ok, false, `contextOrgId=${JSON.stringify(missing)} was let through`);
        assert.equal(v.code, 'HEADHUNTER_CONTEXT_ORG_MISMATCH');
    }
});

check('a campaign with no organization also fails closed', () => {
    // Symmetric: the campaign side is just as unprovable.
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_A,
        contextCampaignId: CAMPAIGN_A,
        campaignOrgId: '',
        campaignId: CAMPAIGN_A,
    });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'HEADHUNTER_CONTEXT_ORG_MISMATCH');
});

check('a LEGACY context with no campaign is allowed once its org matches', () => {
    // The three contexts that existed before share links carried a campaign have
    // none. They are still org-proven, so a link a recruiter already sent is not
    // stranded. Every context minted since carries one.
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_A,
        contextCampaignId: undefined,
        campaignOrgId: ORG_A,
        campaignId: CAMPAIGN_A,
    });
    assert.equal(v.ok, true);
});

check('…but a legacy context still cannot cross organizations', () => {
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_B,
        contextCampaignId: undefined,
        campaignOrgId: ORG_A,
        campaignId: CAMPAIGN_A,
    });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'HEADHUNTER_CONTEXT_ORG_MISMATCH');
});

check('every refusal carries a message a candidate can read', () => {
    const v = assertSourcingContextMatchesCampaign({
        contextOrgId: ORG_B,
        contextCampaignId: CAMPAIGN_A,
        campaignOrgId: ORG_A,
        campaignId: CAMPAIGN_A,
    });
    assert.ok(v.message && v.message.length > 20, 'a bare code is not an explanation');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
