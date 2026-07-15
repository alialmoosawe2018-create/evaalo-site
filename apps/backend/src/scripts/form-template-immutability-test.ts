/**
 * Form binding immutability + schema lock (offline).
 * Run: npm run test:form-template-immutability
 */
import assert from 'node:assert/strict';
import {
    buildFullSnapshot,
    DEFAULT_FORM_TEMPLATE_ID,
} from '../shared/formTemplates/index.js';
import {
    createFormBindingForTemplate,
    hashSnapshot,
} from '../services/formTemplateService.js';
import {
    buildEvaluationRubricFromCampaignBody,
    RubricValidationError,
} from '../services/evaluationRubricService.js';
import { validateRubricDraftList } from '../shared/formTemplates/index.js';
import {
    assertCampaignAcceptsApplications,
    isCampaignSchemaLocked,
    PublicCampaignClosedError,
    resolveCampaignFormBinding,
} from '../services/publicCampaignService.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';

function testStoredBindingUnchangedWhenRegistryWouldChange() {
    const bindingAtCreate = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    const hashAtCreate = bindingAtCreate.schemaHash;
    const fieldCountAtCreate = bindingAtCreate.snapshot.fields.length;

    const freshFromRegistry = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    assert.equal(freshFromRegistry.schemaHash, hashAtCreate);
    assert.equal(freshFromRegistry.snapshot.fields.length, fieldCountAtCreate);

    const mutated = buildFullSnapshot(DEFAULT_FORM_TEMPLATE_ID);
    mutated.fields[0] = {
        ...mutated.fields[0],
        validation: { minLength: 99, maxLength: 120 },
    };
    const newRegistryHash = hashSnapshot(mutated);
    assert.notEqual(newRegistryHash, hashAtCreate);
    assert.equal(bindingAtCreate.schemaHash, hashAtCreate);
}

function testLegacyCampaignResolvesDefaultBinding() {
    const campaign: CampaignFormContext = {
        campaignId: 'legacy_camp',
        criteria: { position: 'Engineer' },
    };
    const binding = resolveCampaignFormBinding(campaign);
    assert.equal(binding.templateId, DEFAULT_FORM_TEMPLATE_ID);
    assert.ok(binding.snapshot.fields.length > 10);
}

function testSchemaLockedAfterFirstCandidate() {
    assert.equal(isCampaignSchemaLocked({ firstCandidateAt: null }), false);
    assert.equal(isCampaignSchemaLocked({ firstCandidateAt: undefined }), false);
    assert.equal(isCampaignSchemaLocked({ firstCandidateAt: new Date() }), true);
}

function testClosedCampaignRejectsApplications() {
    assert.throws(
        () =>
            assertCampaignAcceptsApplications({
                campaignId: 'x',
                status: 'closed',
            }),
        PublicCampaignClosedError
    );
}

function testExpiredCampaignRejectsApplications() {
    assert.throws(
        () =>
            assertCampaignAcceptsApplications({
                campaignId: 'x',
                status: 'active',
                applicationsCloseAt: new Date(Date.now() - 60_000),
            }),
        PublicCampaignClosedError
    );
}

function testActiveCampaignAcceptsApplications() {
    assert.doesNotThrow(() =>
        assertCampaignAcceptsApplications({
            campaignId: 'x',
            status: 'active',
            applicationsCloseAt: new Date(Date.now() + 3600_000),
        })
    );
}

function testRubricContentEquivalentWithUniqueServerIds() {
    const input = {
        position: 'Engineer',
        skills: 'Node',
        customCriteria: [{ label: 'Portfolio', expectation: 'Strong work' }],
    };
    const a = buildEvaluationRubricFromCampaignBody(input);
    const b = buildEvaluationRubricFromCampaignBody(input);
    assert.equal(a.items.length, b.items.length);
    assert.notEqual(a.items[0].id, b.items[0].id, 'server ids differ per build');
    const fingerprint = (items: typeof a.items) =>
        items
            .map((i) => `${i.type}:${i.key}:${i.label}:${i.expectation}`)
            .sort()
            .join('|');
    assert.equal(fingerprint(a.items), fingerprint(b.items));
}

function testCustomCriterionWithoutExpectationRejected() {
    const errors = validateRubricDraftList([
        { type: 'custom', label: 'Portfolio quality', expectation: '' },
    ]);
    assert.ok(errors.some((e) => e.code === 'RUBRIC_EXPECTATION_REQUIRED'));

    assert.throws(
        () => buildEvaluationRubricFromCampaignBody({ customCriteria: [{ label: 'Only custom', expectation: '' }] }),
        (e: unknown) => e instanceof RubricValidationError && (e as RubricValidationError).code === 'RUBRIC_EMPTY'
    );
}

function testDuplicateRubricLabelRejected() {
    assert.throws(
        () =>
            buildEvaluationRubricFromCampaignBody({
                position: 'Engineer',
                customCriteria: [
                    { label: 'Portfolio Quality', expectation: 'A' },
                    { label: 'portfolio-quality', expectation: 'B' },
                ],
            }),
        (e: unknown) =>
            e instanceof RubricValidationError &&
            (e as RubricValidationError).code === 'RUBRIC_VALIDATION_FAILED'
    );
}

function main() {
    testStoredBindingUnchangedWhenRegistryWouldChange();
    console.log('✓ stored binding hash stable; registry mutation does not alter campaign copy');

    testLegacyCampaignResolvesDefaultBinding();
    console.log('✓ legacy campaign without formBinding → default template-remote');

    testSchemaLockedAfterFirstCandidate();
    console.log('✓ firstCandidateAt locks schema');

    testClosedCampaignRejectsApplications();
    testExpiredCampaignRejectsApplications();
    testActiveCampaignAcceptsApplications();
    console.log('✓ campaign active/closed/expired application gates');

    testRubricContentEquivalentWithUniqueServerIds();
    console.log('✓ rubric semantic content stable; server ids unique per build');

    testCustomCriterionWithoutExpectationRejected();
    testDuplicateRubricLabelRejected();
    console.log('✓ rubric validation on campaign create');

    console.log('\nform-template-immutability-test: all passed');
}

main();
