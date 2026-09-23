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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

/* ── 6. the frontend: every creator sends it, every creator refuses without it ──
   Found by SCANNING, not listed: earlier today a hand-written list of link
   builders missed two of four. Every `apiClient.post('/api/recruitment-campaigns'`
   in the frontend is found here, and the function that contains it must both send
   interviewLanguage and refuse to post without one. A new creator added later is
   caught without anyone remembering it. */
const FRONT = join(HERE, '..', '..', '..', 'frontend', 'src');
function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
    }
    return out;
}
/** The body of the `const X = async (…) => {` that encloses `at`. */
function enclosingHandler(text: string, at: number): { name: string; body: string } {
    const re = /const (\w+) = async \([^)]*\) => \{/g;
    let best: { name: string; start: number } | null = null;
    for (const m of text.matchAll(re)) {
        if ((m.index ?? 0) < at) best = { name: m[1], start: m.index ?? 0 };
    }
    return best ? { name: best.name, body: text.slice(best.start, at) } : { name: '(none)', body: '' };
}
const creators: { file: string; name: string; body: string }[] = [];
for (const file of walk(FRONT)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/apiClient\.post\(\s*'\/api\/recruitment-campaigns'/g)) {
        const h = enclosingHandler(text, m.index ?? 0);
        creators.push({ file: file.slice(FRONT.length + 1).replace(/\\/g, '/'), name: h.name, body: code(h.body) });
    }
}
console.log(`   campaign creators found by scan: ${creators.length} — ${creators.map((c) => `${c.file}#${c.name}`).join(', ')}`);
check('the scan finds all four creation call sites', creators.length >= 4, true);
const sidebarText = code(readFileSync(join(FRONT, 'components', 'NewInterviewSidebar.jsx'), 'utf8'));
const validateBody = sidebarText.slice(
    sidebarText.indexOf('const validateForm = () => {'),
    sidebarText.indexOf('setErrors(newErrors);', sidebarText.indexOf('const validateForm = () => {')),
);
for (const c of creators) {
    const label = `${c.file}#${c.name}`;
    /* The screening body is built by a helper — the call must hand it the value,
       and the helper must put it in the payload. */
    const sends = /\binterviewLanguage\b/.test(c.body);
    check(`${label}: sends the interview language`, sends, true);
    const refuses =
        /requireInterviewLanguage\(\)/.test(c.body) ||
        /if \(interviewLanguage !== 'ar' && interviewLanguage !== 'en'\)/.test(c.body) ||
        (/validateForm\(\)/.test(c.body) && /newErrors\.interviewLanguage/.test(validateBody));
    check(`${label}: refuses to create without one`, refuses, true);
}
const helper = code(readFileSync(join(FRONT, 'utils', 'screeningCampaignPayload.js'), 'utf8'));
check('the screening payload helper puts it in the body', /payload\.interviewLanguage = interviewLanguage;/.test(helper), true);

/* "No default" also means no CARRY-OVER: opening the form for a new job must not
   silently inherit the previous job's choice. Every reset of the job form resets it. */
const resets = (sidebarText.match(/setJobDetails\(\{\}\);/g) || []).length;
const langResets = (sidebarText.match(/setJobDetails\(\{\}\);\s*setInterviewLanguage\(''\);/g) || []).length;
check(`every job-form reset (${resets}) also clears the interview language`, langResets === resets && resets > 0, true);
check('the choice starts empty — no default',
    /const \[interviewLanguage, setInterviewLanguage\] = useState\(''\);/.test(sidebarText), true);

/* The candidate pages show the CAMPAIGN's language and never read `?language=`. */
for (const page of ['Interview.jsx', 'PublicScreeningCall.jsx']) {
    const text = code(readFileSync(join(FRONT, 'pages', page), 'utf8'));
    check(`${page}: does not read ?language= at all`, /searchParams\.get\('language'\)/.test(text), false);
    check(`${page}: does not pass a language to the voice socket`,
        /useVoiceInterview\(\{[^}]*\blanguage\b/.test(text), false);
    check(`${page}: switches the page to the campaign's language`, /changeLanguage\(campaignLang\)/.test(text), true);
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nall checks passed');
