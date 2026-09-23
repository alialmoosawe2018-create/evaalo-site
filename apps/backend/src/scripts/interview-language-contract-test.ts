/**
 * The shared contract behind "the interview language is set when the job is
 * created" (owner, 2026-09-23) — the part both the voice (Stage 2) and the video
 * (Stage 3) paths stand on.
 *
 * The one thing this file exists to prevent: the field leaking into `criteria`.
 * The creation route does `criteria = stripRubricAndTemplateKeysFromCriteria({ ...body })`
 * — the WHOLE body becomes criteria — and `deriveLegacyRubricFromCriteria` turns
 * every key that is neither a preset nor a known meta key into a SCORED custom
 * rubric item. Left in, `interviewLanguage: 'ar'` would have become a Stage 1
 * criterion every applicant is measured against, changed the rubric snapshot hash,
 * and ridden into the criteria list sent to n8n. So it is a top-level campaign
 * field, stripped like `interviewType` — and section 2 below first PROVES the trap
 * is real before proving the strip avoids it, so this is not a test of nothing.
 *
 * Run: npx tsx src/scripts/interview-language-contract-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    normalizeInterviewLanguage,
    resolveCampaignInterviewLanguage,
} from '../services/interviewLanguage.js';
import {
    stripRubricAndTemplateKeysFromCriteria,
    deriveLegacyRubricFromCriteria,
} from '../services/evaluationRubricService.js';
import { hashRubricContent } from '../services/formTemplateService.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (...p: string[]) => readFileSync(join(HERE, '..', ...p), 'utf8');
const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

/* ── 1. normalisation — one normalizer for the whole system ─────────────────── */
check('ar', normalizeInterviewLanguage('ar'), 'ar');
check('en', normalizeInterviewLanguage('en'), 'en');
check('english', normalizeInterviewLanguage('English'), 'en');
check('a regional tag', normalizeInterviewLanguage('en-US'), 'en');
check('Kurdish is served in Arabic', normalizeInterviewLanguage('ku'), 'ar');
check('junk is "not said", not Arabic', normalizeInterviewLanguage('klingon'), null);
check('empty is "not said"', normalizeInterviewLanguage(''), null);

/* ── 2. the field must never become a scored criterion ───────────────────── */
const BODY = {
    position: 'HSE Engineer',
    location: 'Babil',
    experienceYears: '4-5',
    evaluationLanguage: 'ar',
    interviewType: 'form',
};
/* The negative control — the trap, demonstrated. Without the strip, the key is
   derived into a custom rubric item. If this ever stops being true the strip is
   no longer load-bearing and section 2 should be re-read, not deleted. */
const unstripped = deriveLegacyRubricFromCriteria({ ...BODY, interviewLanguage: 'ar' } as Record<string, unknown>);
check(
    'CONTROL: a raw interviewLanguage key IS turned into a scored rubric item',
    JSON.stringify(unstripped).includes('interviewLanguage'),
    true,
);
const withField = stripRubricAndTemplateKeysFromCriteria({ ...BODY, interviewLanguage: 'en' });
const without = stripRubricAndTemplateKeysFromCriteria({ ...BODY });
check('the strip removes interviewLanguage from criteria', 'interviewLanguage' in withField, false);
check('…exactly as it removes interviewType', 'interviewType' in withField, false);
/* Item ids carry a random suffix by design ("content, not identity" — the service
   says so), so the comparison is on content. The hash below is content-based too. */
const content = (items: Array<Record<string, unknown>>) =>
    JSON.stringify(items.map(({ id: _id, ...rest }) => rest));
check(
    'the derived rubric has identical content with and without the field',
    content(deriveLegacyRubricFromCriteria(withField) as unknown as Array<Record<string, unknown>>),
    content(deriveLegacyRubricFromCriteria(without) as unknown as Array<Record<string, unknown>>),
);
check(
    'and so is the rubric snapshot hash',
    hashRubricContent(deriveLegacyRubricFromCriteria(withField)),
    hashRubricContent(deriveLegacyRubricFromCriteria(without)),
);

/* ── 3. resolution: the campaign's field, else its report language, else Arabic ─ */
check('own field', resolveCampaignInterviewLanguage({ interviewLanguage: 'en' }).source, 'campaign');
check('legacy campaign',
    resolveCampaignInterviewLanguage({ criteria: { evaluationLanguage: 'en' } }).source, 'legacy_evaluation_language');
/* The legacy read must be the SAME read the report uses (campaignCriteriaLanguage),
   which also honours the older `criteria.language` key. */
check('legacy campaign on the older criteria.language key',
    resolveCampaignInterviewLanguage({ criteria: { language: 'en' } }).language, 'en');
check('nothing ⇒ Arabic', resolveCampaignInterviewLanguage({}).language, 'ar');

/* ── 4. the persistence and the public read, as wired ──────────────────────── */
const model = code(src('models', 'RecruitmentCampaign.ts'));
check('the model declares the field', /interviewLanguage\?: 'ar' \| 'en';/.test(model), true);
check('…with an enum in the schema', /interviewLanguage: \{\s*type: String,\s*enum: \['ar', 'en'\]/.test(model), true);

const route = code(src('routes', 'recruitmentCampaigns.ts'));
check('creation normalises the body value', /normalizeInterviewLanguage\(rawInterviewLanguage\)/.test(route), true);
check('an unreadable value is refused, not guessed', /'invalid_interview_language'/.test(route), true);
check('the value is stored top-level on the campaign',
    /interviewLanguage: interviewLanguage \?\? undefined,/.test(route), true);
/* Validation must run BEFORE the campaign is built — a refusal after `new
   RecruitmentCampaign(...)` would still be correct, but after `save()` it would not. */
check('the refusal happens before the campaign is constructed',
    route.indexOf("'invalid_interview_language'") < route.indexOf('new RecruitmentCampaign('), true);

const pub = code(src('routes', 'publicCampaign.ts'));
check('the candidate lookup returns the campaign language',
    /interviewLanguage: campaignInterviewLanguage,/.test(pub), true);
check('the public-link pages have their own read',
    /router\.get\('\/campaign-interview-language'/.test(pub), true);
check('both reads use the same shared loader', (pub.match(/loadCampaignInterviewLanguage\(/g) || []).length, 2);

/* ── 5. the report language is untouched ──────────────────────────────────── */
/* evaluationLanguage is still derived from body.language exactly as before. */
check('the report language derivation is unchanged',
    /criteria\.evaluationLanguage = evaluationLanguage;/.test(route) &&
        /const shareLangRaw = String\(body\.language \|\| ''\)\.toLowerCase\(\);/.test(route), true);

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nall checks passed');
