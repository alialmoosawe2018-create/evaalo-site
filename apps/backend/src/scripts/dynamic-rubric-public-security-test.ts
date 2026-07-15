/**
 * Public form-config security: no rubric/criteria leak (offline).
 * Run: npm run test:dynamic-rubric-public-security
 */
import assert from 'node:assert/strict';
import {
    createFormBindingForTemplate,
    mintPublicApplicationToken,
    toPublicFormConfig,
} from '../services/formTemplateService.js';
import { buildEvaluationRubricFromCampaignBody } from '../services/evaluationRubricService.js';
import { resolveCampaignFormBinding } from '../services/publicCampaignService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

function simulatePublicFormConfigResponse(campaign: CampaignFormContext) {
    const binding = resolveCampaignFormBinding(campaign);
    const criteria = (campaign.criteria || {}) as Record<string, unknown>;
    const positionTitle =
        (typeof criteria.position === 'string' && criteria.position.trim()) ||
        (typeof criteria.job === 'string' && criteria.job.trim()) ||
        'Open Position';
    return {
        publicCampaignId: campaign.publicApplicationToken!,
        positionTitle,
        status: campaign.status === 'closed' ? ('closed' as const) : ('active' as const),
        form: toPublicFormConfig(binding),
    };
}

function testPubTokenFormat() {
    const token = mintPublicApplicationToken();
    assert.ok(token.startsWith('pub_'));
    assert.ok(token.length > 20);
    assert.ok(!token.includes('campaignId'));
}

function testPublicFormConfigExcludesInternalFields() {
    const binding = createFormBindingForTemplate();
    const rubric = buildEvaluationRubricFromCampaignBody({
        position: 'Secret Role',
        skills: 'React',
        customCriteria: [{ label: 'Portfolio', expectation: 'Strong OSS' }],
    });
    const campaign: CampaignFormContext = {
        campaignId: '6606bf9964a7b3d06430a4ba4ea75e1f',
        organizationId: 'org_secret_123',
        createdByClerkUserId: 'user_clerk_abc',
        publicApplicationToken: mintPublicApplicationToken(),
        criteria: { position: 'Secret Role', skills: 'React', salaryMin: '5000' },
        formBinding: binding,
        evaluationRubric: rubric.items,
        rubricSnapshotHash: rubric.rubricSnapshotHash,
        rubricVersion: 1,
    };

    const response = simulatePublicFormConfigResponse(campaign);
    const json = JSON.stringify(response);

    assert.ok(response.publicCampaignId.startsWith('pub_'));
    assert.equal(response.positionTitle, 'Secret Role');
    assert.ok(response.form.fields.length > 0);
    assert.ok(!('evaluationRubric' in response));
    assert.ok(!('criteria' in response));
    assert.ok(!('organizationId' in response));
    assert.ok(!('campaignId' in response));
    assert.ok(!json.includes('org_secret_123'));
    assert.ok(!json.includes('6606bf9964a7b3d06430a4ba4ea75e1f'));
    assert.ok(!json.includes('Strong OSS'));
    assert.ok(!json.includes('salaryMin'));
}

function testRandomPubTokenDoesNotEmbedInternalIds() {
    for (let i = 0; i < 5; i++) {
        const token = mintPublicApplicationToken();
        assert.ok(!/^[a-f0-9]{32}$/.test(token));
        assert.ok(!token.includes('org_'));
    }
}

function testFormConfigFieldsHaveNoRubricMetadata() {
    const binding = createFormBindingForTemplate();
    const form = toPublicFormConfig(binding);
    for (const field of form.fields) {
        assert.ok('id' in field);
        assert.ok('type' in field);
        assert.ok(!('expectation' in field));
    }
}

function main() {
    testPubTokenFormat();
    console.log('✓ pub_ token format');

    testPublicFormConfigExcludesInternalFields();
    console.log('✓ public form-config excludes rubric, criteria, org, campaignId');

    testRandomPubTokenDoesNotEmbedInternalIds();
    console.log('✓ pub tokens are opaque (not internal hex ids)');

    testFormConfigFieldsHaveNoRubricMetadata();
    console.log('✓ form field defs contain no rubric metadata');

    console.log('\ndynamic-rubric-public-security-test: all passed');
}

main();
