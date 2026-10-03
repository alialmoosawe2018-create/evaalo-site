/**
 * What the job form sends for part one of the video interview.
 *
 * The promise to the recruiter: the three questions you saw — edited or not — are
 * the ones the job is created with. A set made from an older description or
 * interview language must never be sent, a job never goes out with fewer than
 * three, and voice jobs (option 3) or a backend with the feature off send nothing.
 *
 * Run: node src/utils/jdInterviewQuestions.test.mjs   (from apps/frontend)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    JD_QUESTIONS_CONFIG_OFF,
    applyJdQuestionEdit,
    buildJdQuestionsPreviewBody,
    emptyJdQuestionsDraft,
    isJdDraftEdited,
    jdDraftFailed,
    jdDraftFromPreview,
    jdDraftView,
    jdFailureMessageKey,
    jdPreviewErrorCode,
    jdProblemMessageKeys,
    jdQuestionsApplicability,
    jdQuestionsCreateDecision,
    jdQuestionsFlowSupported,
    jdQuestionsSourceKey,
    jdSetProblemMessageKeys,
    jdWaitMessageKey,
    loadingJdQuestionsDraft,
    normalizeJdQuestionsConfig,
    readJdQuestionsRejection,
    skippedJdQuestionsDraft,
} from './jdInterviewQuestions.js';
import { translations } from '../translations.js';

let failed = 0;
let passed = 0;

function check(name, fn) {
    try {
        fn();
        console.log('  ✓', name);
        passed += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', err.message);
        failed += 1;
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function eq(a, b, msg) {
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja !== jb) throw new Error(`${msg}\n        got:      ${ja}\n        expected: ${jb}`);
}

// Synthetic — no real job, company or person.
const JD = 'Duties: keep the stock records of a warehouse. Requirements: two years in a store.';
const ON = { enabled: true, languages: ['ar'] };
const PREVIEW = {
    success: true,
    language: 'ar',
    questions: [
        { id: 'q1', question: 'سؤال أول عن الجرد، شلون راح ترتبه؟', clarifyHint: 'يعني الخطوات.', duty: 'الجرد' },
        { id: 'q2', question: 'سؤال ثاني عن التسليم، شنو راح تسوي؟', clarifyHint: 'يعني أول خطوة.', duty: 'التسليم' },
        { id: 'q3', question: 'سؤال ثالث عن النقص، شلون راح تتصرف؟', clarifyHint: 'يعني منو تبلغ.', duty: 'النقص' },
    ],
};
const KEY = jdQuestionsSourceKey(JD, 'ar');
const on = { applicability: 'on', currentKey: KEY };

console.log('applicability — when the preview exists at all');

check('backend flag off → nothing, for every flow', () => {
    for (const interviewType of ['process', 'form', 'video', 'audio']) {
        const a = jdQuestionsApplicability({ config: JD_QUESTIONS_CONFIG_OFF, interviewType, jobDescription: JD, interviewLanguage: 'ar' });
        assert(a === 'off', `${interviewType}: the section must not exist while the backend is off (got ${a})`);
    }
});

check('voice (option 3) never carries part one', () => {
    assert(jdQuestionsFlowSupported('audio') === false, 'audio must be unsupported');
    const a = jdQuestionsApplicability({ config: ON, interviewType: 'audio', jobDescription: JD, interviewLanguage: 'ar' });
    assert(a === 'off', `got ${a}`);
});

check('options 1, 2 and 4 are supported', () => {
    for (const t of ['process', 'form', 'video']) assert(jdQuestionsFlowSupported(t), `${t} must be supported`);
    assert(!jdQuestionsFlowSupported(null), 'no flow chosen yet');
});

check('no description / no language / language not enabled are told apart', () => {
    const base = { config: ON, interviewType: 'video' };
    eq(jdQuestionsApplicability({ ...base, jobDescription: '   ', interviewLanguage: 'ar' }), 'no_description', 'blank description');
    eq(jdQuestionsApplicability({ ...base, jobDescription: JD, interviewLanguage: '' }), 'no_language', 'no language');
    eq(jdQuestionsApplicability({ ...base, jobDescription: JD, interviewLanguage: 'en' }), 'language_not_enabled', 'English is off until measured');
    eq(jdQuestionsApplicability({ ...base, jobDescription: JD, interviewLanguage: 'ar' }), 'on', 'ready to preview');
});

check('config: anything but an explicit enabled:true reads as off', () => {
    for (const bad of [null, undefined, {}, { success: true }, { success: true, enabled: 'true' }, { success: false, enabled: true }]) {
        assert(normalizeJdQuestionsConfig(bad).enabled === false, `${JSON.stringify(bad)} must be off`);
    }
    eq(normalizeJdQuestionsConfig({ success: true, enabled: true, languages: ['ar', 'ku', 'en', 7] }), { enabled: true, languages: ['ar', 'en'] }, 'only interview languages survive');
});

console.log('create — what goes out with the job');

check('nothing is sent when the preview does not apply', () => {
    for (const applicability of ['off', 'no_description', 'no_language', 'language_not_enabled']) {
        const d = jdQuestionsCreateDecision(jdDraftFromPreview(PREVIEW, KEY), { applicability, currentKey: KEY });
        assert(d.allowed === true, `${applicability} must not block the job`);
        eq(d.fields, {}, `${applicability} must send no question fields`);
    }
});

check('the set shown unchanged goes out exactly, as «preview»', () => {
    const d = jdQuestionsCreateDecision(jdDraftFromPreview(PREVIEW, KEY), on);
    assert(d.allowed, 'a ready set must allow the job');
    eq(d.fields.jdInterviewQuestions.map((q) => q.question), PREVIEW.questions.map((q) => q.question), 'questions');
    eq(d.fields.jdInterviewQuestions.map((q) => q.clarifyHint), PREVIEW.questions.map((q) => q.clarifyHint), 'hints');
    eq(d.fields.jdInterviewQuestions.map((q) => q.duty), PREVIEW.questions.map((q) => q.duty), 'duties');
    eq(d.fields.jdInterviewQuestionsSource, 'preview', 'source');
    assert(!('jdInterviewQuestionsSkip' in d.fields), 'a ready set is not a skip');
});

check('an edited question goes out as typed (trimmed), as «edited»', () => {
    let draft = jdDraftFromPreview(PREVIEW, KEY);
    draft = applyJdQuestionEdit(draft, 1, 'question', '  سؤال معدّل عن التسليم، شلون راح تنظمه؟  ');
    draft = applyJdQuestionEdit(draft, 2, 'clarifyHint', 'توضيح جديد.');
    const d = jdQuestionsCreateDecision(draft, on);
    assert(d.allowed, 'an edited complete set must allow the job');
    eq(d.fields.jdInterviewQuestions[1].question, 'سؤال معدّل عن التسليم، شلون راح تنظمه؟', 'the edit itself');
    eq(d.fields.jdInterviewQuestions[2].clarifyHint, 'توضيح جديد.', 'the edited hint');
    eq(d.fields.jdInterviewQuestions[0].question, PREVIEW.questions[0].question, 'untouched question');
    eq(d.fields.jdInterviewQuestionsSource, 'edited', 'source');
});

check('editing back to the original wording is «preview» again', () => {
    let draft = jdDraftFromPreview(PREVIEW, KEY);
    draft = applyJdQuestionEdit(draft, 0, 'question', 'x');
    assert(isJdDraftEdited(draft), 'changed');
    draft = applyJdQuestionEdit(draft, 0, 'question', `${PREVIEW.questions[0].question} `);
    assert(!isJdDraftEdited(draft), 'whitespace alone is not an edit');
});

check('ids are always q1..q3 in display order', () => {
    const d = jdQuestionsCreateDecision(jdDraftFromPreview(PREVIEW, KEY), on);
    eq(d.fields.jdInterviewQuestions.map((q) => q.id), ['q1', 'q2', 'q3'], 'ids');
});

check('🔴 a set made from an OLDER description is never sent', () => {
    const draft = jdDraftFromPreview(PREVIEW, KEY);
    const changed = jdQuestionsSourceKey(`${JD} Also drives the forklift.`, 'ar');
    eq(jdDraftView(draft, changed), 'stale', 'view');
    const d = jdQuestionsCreateDecision(draft, { applicability: 'on', currentKey: changed });
    assert(d.allowed === false && d.reason === 'needs_generate', `must wait for a new set (got ${JSON.stringify(d)})`);
});

check('🔴 a set made for another interview language is never sent', () => {
    const draft = jdDraftFromPreview(PREVIEW, KEY);
    const d = jdQuestionsCreateDecision(draft, { applicability: 'on', currentKey: jdQuestionsSourceKey(JD, 'en') });
    assert(d.allowed === false, 'must wait');
});

check('a set still being written for the OLD text is stale at once (no spinner for a useless answer)', () => {
    const draft = loadingJdQuestionsDraft(KEY);
    const changed = jdQuestionsSourceKey(`${JD} Also drives the forklift.`, 'ar');
    eq(jdDraftView(draft, KEY), 'loading', 'same text: still loading');
    eq(jdDraftView(draft, changed), 'stale', 'changed text');
    eq(jdQuestionsCreateDecision(draft, { applicability: 'on', currentKey: changed }), { allowed: false, reason: 'needs_generate' }, 'decision');
});

check('only trailing spaces in the description do not make the set stale', () => {
    const draft = jdDraftFromPreview(PREVIEW, KEY);
    eq(jdDraftView(draft, jdQuestionsSourceKey(`${JD}  \n`, 'ar')), 'ready', 'view');
});

check('a blank question or clarification blocks the job — never fewer than three', () => {
    for (const field of ['question', 'clarifyHint']) {
        const draft = applyJdQuestionEdit(jdDraftFromPreview(PREVIEW, KEY), 2, field, '   ');
        const d = jdQuestionsCreateDecision(draft, on);
        assert(d.allowed === false && d.reason === 'incomplete', `${field} blank must block (got ${JSON.stringify(d)})`);
    }
});

check('waiting states block with their own reason', () => {
    eq(jdQuestionsCreateDecision(emptyJdQuestionsDraft(), on), { allowed: false, reason: 'needs_generate' }, 'idle');
    eq(jdQuestionsCreateDecision(loadingJdQuestionsDraft(KEY), on), { allowed: false, reason: 'loading' }, 'loading');
    eq(jdQuestionsCreateDecision(jdDraftFailed(KEY, 'GENERATION_FAILED'), on), { allowed: false, reason: 'failed' }, 'failed needs a decision');
    // A failure for an older description: just try the new one.
    eq(
        jdQuestionsCreateDecision(jdDraftFailed('old', 'GENERATION_FAILED'), on),
        { allowed: false, reason: 'needs_generate' },
        'stale failure'
    );
});

check('«continue without» sends the skip, and survives a later edit of the description', () => {
    const draft = skippedJdQuestionsDraft();
    eq(jdQuestionsCreateDecision(draft, on), { allowed: true, fields: { jdInterviewQuestionsSkip: true } }, 'skip');
    eq(
        jdQuestionsCreateDecision(draft, { applicability: 'on', currentKey: jdQuestionsSourceKey('other text', 'ar') }),
        { allowed: true, fields: { jdInterviewQuestionsSkip: true } },
        'skip is the recruiter’s choice, not tied to the text'
    );
});

console.log('preview answer');

check('anything but three questions is a failure, not a short set', () => {
    for (const n of [0, 1, 2, 4]) {
        const r = { success: true, questions: PREVIEW.questions.concat(PREVIEW.questions).slice(0, n) };
        eq(jdDraftFromPreview(r, KEY).status, 'failed', `${n} questions`);
    }
    eq(jdDraftFromPreview({ success: false }, KEY).status, 'failed', 'success:false');
    eq(jdDraftFromPreview(null, KEY).status, 'failed', 'no body');
});

check('a ready draft keeps an untouched copy, so edits never change «original»', () => {
    const draft = applyJdQuestionEdit(jdDraftFromPreview(PREVIEW, KEY), 0, 'question', 'changed');
    eq(draft.original[0].question, PREVIEW.questions[0].question, 'original');
});

check('edits are capped like the server', () => {
    const draft = applyJdQuestionEdit(jdDraftFromPreview(PREVIEW, KEY), 0, 'question', 'x'.repeat(900));
    eq(draft.questions[0].question.length, 600, 'cap');
});

check('only question and clarifyHint can be edited', () => {
    const draft = jdDraftFromPreview(PREVIEW, KEY);
    assert(applyJdQuestionEdit(draft, 0, 'duty', 'x') === draft, 'duty is not editable');
    assert(applyJdQuestionEdit(draft, 7, 'question', 'x') === draft, 'no such question');
});

check('preview errors map to what the section can say', () => {
    eq(jdPreviewErrorCode({ status: 429, data: {} }), 'RATE_LIMITED', '429');
    eq(jdPreviewErrorCode({ status: 422, data: { error: 'GENERATION_FAILED' } }), 'GENERATION_FAILED', '422');
    eq(jdPreviewErrorCode({ status: 400, data: { error: 'JOB_DESCRIPTION_TOO_LONG' } }), 'JOB_DESCRIPTION_TOO_LONG', 'too long');
    eq(jdPreviewErrorCode({ status: 0 }), 'FAILED', 'network');
    for (const code of ['RATE_LIMITED', 'GENERATION_FAILED', 'JOB_DESCRIPTION_TOO_LONG', 'FAILED']) {
        assert(jdFailureMessageKey(code), `${code} needs a message`);
    }
});

check('preview body carries the names the create route checks', () => {
    eq(
        buildJdQuestionsPreviewBody({ jobDescription: ` ${JD} `, interviewLanguage: 'ar', position: ' Storekeeper ', company: '' }),
        { text: JD, interviewLanguage: 'ar', position: 'Storekeeper' },
        'body'
    );
});

console.log('create refused — notes under the right question');

check('JD_QUESTIONS_INVALID → notes by index and for the set', () => {
    const r = readJdQuestionsRejection({
        error: 'JD_QUESTIONS_INVALID',
        problems: [{ index: 1, codes: ['yes_no', 'too_long'] }, { index: 9, codes: ['x'] }],
        setProblems: ['same_opener'],
    });
    eq(r, { problems: { 1: ['yes_no', 'too_long'] }, setProblems: ['same_opener'] }, 'parsed');
    assert(readJdQuestionsRejection({ error: 'OTHER' }) === null, 'other errors are not ours');
});

check('editing a refused question clears its notes and the set notes, not the others', () => {
    let draft = jdDraftFromPreview(PREVIEW, KEY);
    draft = { ...draft, problems: { 0: ['yes_no'], 2: ['too_long'] }, setProblems: ['duplicate'] };
    draft = applyJdQuestionEdit(draft, 0, 'question', 'new');
    eq(draft.problems, { 2: ['too_long'] }, 'problems');
    eq(draft.setProblems, [], 'set problems');
});

// The server's codes, read from its source so a new check cannot ship without wording here.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.resolve(here, '../../../backend/src/services/jdInterviewQuestions.ts'), 'utf8');
const questionCodes = [
    ...new Set([...serverSrc.matchAll(/out\.push\('([a-z_]+)'\)/g)].map((m) => m[1]).concat(
        [...serverSrc.matchAll(/return \['([a-z_]+)'\]/g)].map((m) => m[1])
    )),
];
const setCodes = [...new Set([...serverSrc.matchAll(/setProblems\.push\('([a-z_]+)'\)/g)].map((m) => m[1]))];

check('every server problem code has its own wording (no generic fallback)', () => {
    assert(questionCodes.length >= 20, `expected the server's ~20 codes, read ${questionCodes.length} — has the source moved?`);
    assert(setCodes.length === 4, `expected 4 set codes, read ${setCodes.length}`);
    for (const code of questionCodes) {
        for (const lang of ['ar', 'en']) {
            const keys = jdProblemMessageKeys([code], lang);
            assert(!keys.includes('newCampaign_jdq_p_generic'), `${code} falls back to the generic note`);
        }
    }
    for (const code of setCodes) {
        assert(!jdSetProblemMessageKeys([code]).includes('newCampaign_jdq_p_generic'), `set code ${code} falls back`);
    }
});

check('one note per distinct message (three dialect codes read as one line)', () => {
    eq(jdProblemMessageKeys(['not_iraqi_msa', 'lamma', 'not_iraqi_levantine'], 'ar'), ['newCampaign_jdq_p_dialect'], 'dialect');
    eq(jdProblemMessageKeys(['not_situational'], 'en'), ['newCampaign_jdq_p_notSituationalEn'], 'en wording');
    eq(jdProblemMessageKeys(['not_situational'], 'ar'), ['newCampaign_jdq_p_notSituationalAr'], 'ar wording');
    eq(jdProblemMessageKeys(['brand_new_code'], 'ar'), ['newCampaign_jdq_p_generic'], 'unknown → generic');
});

check('every key this feature shows exists in English and Arabic', () => {
    const keys = new Set([
        ...questionCodes.flatMap((c) => jdProblemMessageKeys([c], 'ar').concat(jdProblemMessageKeys([c], 'en'))),
        ...jdSetProblemMessageKeys(setCodes),
        'newCampaign_jdq_p_generic',
        ...['loading', 'needs_generate', 'failed', 'incomplete'].map(jdWaitMessageKey),
        ...['RATE_LIMITED', 'GENERATION_FAILED', 'JOB_DESCRIPTION_TOO_LONG', 'FAILED'].map(jdFailureMessageKey),
    ]);
    // Read from the component, so a key used there but never written fails here.
    const component = readFileSync(path.resolve(here, '../components/JdInterviewQuestionsPreview.jsx'), 'utf8');
    for (const m of component.matchAll(/t\('((?:newCampaign_jdq?_)[A-Za-z_]+)'\)/g)) keys.add(m[1]);
    const sidebar = readFileSync(path.resolve(here, '../components/NewInterviewSidebar.jsx'), 'utf8');
    for (const m of sidebar.matchAll(/t\('(newCampaign_jdq_[A-Za-z_]+|newCampaign_jd_hint[A-Za-z]*)'\)/g)) keys.add(m[1]);
    assert(keys.size > 30, `expected the feature's keys, found ${keys.size}`);
    for (const key of keys) {
        for (const lang of ['en', 'ar']) {
            assert(typeof translations[lang][key] === 'string' && translations[lang][key].trim(), `${lang}.${key} is missing`);
        }
    }
});

check('the Kurdish box hint mentions the interview when the feature is on', () => {
    // Kurdish falls back to English key by key; the hint itself is written.
    for (const key of ['newCampaign_jd_hintVideo', 'newCampaign_jd_hintInterview', 'newCampaign_jdq_title']) {
        assert(typeof translations.ku[key] === 'string' && translations.ku[key].trim(), `ku.${key} is missing`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
