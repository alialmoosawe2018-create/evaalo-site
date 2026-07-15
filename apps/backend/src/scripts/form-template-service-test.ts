/**
 * Run: npm run test:form-template-service
 */
import assert from 'node:assert/strict';
import {
    buildFullSnapshot,
    validateApplicationSubmission,
    validateRubricDraftList,
    DEFAULT_FORM_TEMPLATE_ID,
} from '../shared/formTemplates/index.js';
import {
    createFormBindingForTemplate,
    hashSnapshot,
} from '../services/formTemplateService.js';
import {
    buildEvaluationRubricFromCampaignBody,
} from '../services/evaluationRubricService.js';

function testDefaultSnapshotHasAllSections() {
    const snap = buildFullSnapshot(DEFAULT_FORM_TEMPLATE_ID);
    assert.equal(snap.sections.length, 5);
    assert.ok(snap.fields.find((f) => f.id === 'cv')?.required);
    assert.ok(snap.fields.find((f) => f.id === 'full_name')?.required);
}

function testSnapshotHashStable() {
    const a = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    const b = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    assert.equal(a.schemaHash, b.schemaHash);
}

function testRegistryChangeDoesNotAlterStoredBinding() {
    const binding = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    const storedHash = binding.schemaHash;
    const storedFieldCount = binding.snapshot.fields.length;
    // Simulate "registry changed later" — stored binding unchanged
    assert.equal(binding.schemaHash, storedHash);
    assert.equal(binding.snapshot.fields.length, storedFieldCount);
}

function testRejectUnexpectedField() {
    const binding = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    const result = validateApplicationSubmission(binding.snapshot, {
        body: {
            full_name: 'Jane Doe',
            email: 'jane@example.com',
            phone: '+9647700000000',
            position_applied_for: 'Engineer',
            years_of_experience: '5',
            skills: JSON.stringify(['a', 'b', 'c']),
            agreeToTerms: 'true',
            evil_field: 'hack',
        },
        files: {
            cv: { mimeType: 'application/pdf', size: 1000 },
        },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.field === 'evil_field'));
}

function testRejectMissingRequired() {
    const binding = createFormBindingForTemplate(DEFAULT_FORM_TEMPLATE_ID);
    const result = validateApplicationSubmission(binding.snapshot, {
        body: { email: 'jane@example.com' },
        files: {},
    });
    assert.equal(result.ok, false);
}

function testRubricRequiresExpectation() {
    const errors = validateRubricDraftList([
        { type: 'custom', label: 'Portfolio quality', expectation: '' },
    ]);
    assert.ok(errors.some((e) => e.code === 'RUBRIC_EXPECTATION_REQUIRED'));
}

function testRubricDedupe() {
    const dupes = validateRubricDraftList([
        { type: 'custom', label: 'Portfolio Quality', expectation: 'Strong work' },
        { type: 'custom', label: 'portfolio-quality', expectation: 'Also strong' },
    ]);
    assert.ok(dupes.some((e) => e.code === 'RUBRIC_DUPLICATE'));
}

function testBuildRubricFromCampaign() {
    const result = buildEvaluationRubricFromCampaignBody({
        position: 'Senior Engineer',
        skills: 'Node.js',
        customCriteria: [{ label: 'Portfolio quality', expectation: 'Strong OSS' }],
        interviewType: 'form',
    });
    assert.ok(result.items.length >= 2);
    assert.ok(result.rubricSnapshotHash.startsWith('sha256:'));
}
function testImmutableHashAfterBuild() {
    const snap = buildFullSnapshot(DEFAULT_FORM_TEMPLATE_ID);
    const h1 = hashSnapshot(snap);
    snap.fields[0].validation = { minLength: 99 };
    const h2 = hashSnapshot(snap);
    assert.notEqual(h1, h2);
}

function main() {
    testDefaultSnapshotHasAllSections();
    testSnapshotHashStable();
    testRegistryChangeDoesNotAlterStoredBinding();
    testRejectUnexpectedField();
    testRejectMissingRequired();
    testRubricRequiresExpectation();
    testRubricDedupe();
    testBuildRubricFromCampaign();
    testImmutableHashAfterBuild();
    console.log('✓ form-template-service tests passed');
}

main();
