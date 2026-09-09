/**
 * Catalog plumbing must not become Stage 1 criteria (no DB).
 * Usage: npx tsx src/scripts/stage1-rubric-meta-keys-test.ts
 *
 * `deriveLegacyRubricFromCriteria` used to walk every key in `criteria`, so the
 * scorer was handed `roleKey`, `labelKey`, `roleMatchSource` and
 * `evaluationLanguage` as criteria to judge a candidate against — asking, in
 * effect, "does this candidate meet `ar`?".
 *
 * The values still matter; they are simply read from where they belong. This
 * pins BOTH halves: the keys leave the rubric, and the report language still
 * resolves from `criteria`.
 */
import assert from 'node:assert';
import { deriveLegacyRubricFromCriteria } from '../services/evaluationRubricService.js';
import { resolveCampaignEvaluationRubric } from '../services/stage1N8nPayloadBuilder.js';
import { resolveEvaluationLanguage } from '../services/evaluationLanguage.js';

/** Shaped after a real production campaign (1ae52ee1). */
const CRITERIA: Record<string, unknown> = {
    position: 'Senior HR Specialist',
    location: 'Baghdad',
    industryType: 'Oil & Gas',
    educationLevel: 'bachelor',
    experienceYears: '2-3',
    languages: 'English; Arabic',
    skills: 'Communication; Active Listening',
    certifications: 'HR professional certification',
    careerLevel: 'senior',
    managementTrack: 'ic',
    // plumbing — real jobs, but not criteria
    roleKey: 'hr_specialist',
    labelKey: 'hr_specialist.senior',
    roleMatchSource: 'exact_catalog',
    evaluationLanguage: 'ar',
};

let failures = 0;
const check = (name: string, fn: () => void) => {
    try {
        fn();
        console.log('  ✔ ' + name);
    } catch (err) {
        failures += 1;
        console.log('  ✘ ' + name + ' — ' + (err as Error).message);
    }
};

const labels = (criteria: Record<string, unknown>) =>
    deriveLegacyRubricFromCriteria(criteria).map((r) => r.label);

console.log('Stage 1 rubric derivation');

check('the four plumbing keys are not criteria', () => {
    const out = labels(CRITERIA);
    for (const k of ['roleKey', 'labelKey', 'roleMatchSource', 'evaluationLanguage']) {
        assert.ok(!out.includes(k), k + ' is still being scored as a criterion');
    }
});

check('every real criterion survives', () => {
    const out = labels(CRITERIA);
    for (const k of [
        'position',
        'location',
        'industryType',
        'educationLevel',
        'experienceYears',
        'languages',
        'skills',
        'certifications',
        'careerLevel',
        'managementTrack',
    ]) {
        assert.ok(out.includes(k), 'lost a real criterion: ' + k);
    }
    assert.equal(out.length, 10);
});

check('the report language still resolves — the values were not deleted', () => {
    // The whole point: removing them from the RUBRIC must not remove them from
    // `criteria`, which is where resolveEvaluationLanguage actually reads.
    assert.equal(resolveEvaluationLanguage({ campaignCriteria: CRITERIA }), 'ar');
    assert.equal(CRITERIA.roleKey, 'hr_specialist');
});

check('an English campaign still resolves English', () => {
    assert.equal(
        resolveEvaluationLanguage({ campaignCriteria: { ...CRITERIA, evaluationLanguage: 'en' } }),
        'en'
    );
});

check('resolveCampaignEvaluationRubric agrees — this is what Stage 1 calls', () => {
    const out = resolveCampaignEvaluationRubric({
        campaignId: 'c1',
        criteria: CRITERIA,
    } as never).map((r) => r.label);
    assert.equal(out.length, 10);
    assert.ok(!out.includes('evaluationLanguage'));
});

check('a stored rubric is still returned untouched', () => {
    const stored = [
        { id: 'custom__x__1', type: 'custom', key: 'x', label: 'Hand-written', expectation: 'y' },
    ];
    const out = resolveCampaignEvaluationRubric({
        campaignId: 'c1',
        criteria: CRITERIA,
        evaluationRubric: stored,
    } as never);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, 'Hand-written');
});

check('a criterion merely NAMED like plumbing is not dropped', () => {
    const out = labels({ position: 'Dev', myRoleKeyPreference: 'strong' });
    assert.ok(out.includes('myRoleKeyPreference'));
});

console.log(failures === 0 ? '\n✅ stage1-rubric-meta-keys: all passed' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
