/**
 * Stage 2 gate: an EMPTY Professional Attitude paragraph is accepted only when
 * the same n8n result explicitly marks Professional Attitude "Not Assessed".
 *
 * The regression this pins (2026-09-23): a candidate left a voice interview
 * after four answers. The v2 scorer correctly rated attitude "Not Assessed"
 * (`competencyScores`: assessed:false) and sent the attitude paragraph empty.
 * The gate demanded a paragraph with no abstention, so it refused the WHOLE
 * evaluation — n8n execution 1942 got 400 three times, and HR saw nothing, not
 * even the scorer's note that the candidate left early.
 *
 * The fixture is that execution's callback body, verbatim. It is run through
 * the REAL patch builder — `buildStrictStage2VoicePatch`, lifted as text from
 * server.ts (importing server.ts would start the server) and compiled here —
 * and then through the real gate, exactly as the /webhook/n8n stage2 path does.
 *
 * Run: npx tsx src/scripts/stage2-professional-attitude-abstention-test.ts
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
    getStage2EvaluationGateMode,
    shouldBlockStage2IncompleteEvaluation,
    validateStage2VoiceEvaluationPersistence,
} from '../services/stage2VoiceEvaluationGate.js';
import {
    INVALID_WEBHOOK_ID_TOKENS,
    buildStage2V2Extras,
    normalizeRecommendation,
    pickLooseFromSources,
} from '../services/stageWebhookMerge.js';
import { clampRecommendationToScore } from '../services/recommendationCalibration.js';

let failures = 0;
let passes = 0;
function check(name: string, actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passes += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}: expected ${e}, got ${a}`);
    }
}

/* ── the real builder, lifted from server.ts ─────────────────────────────── */
const serverSrc = readFileSync(new URL('../server.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** A top-level declaration: from its first line to the closing line at column 0. */
function lift(header: string, closer = '}'): string {
    const start = serverSrc.indexOf(`\n${header}`);
    if (start < 0) throw new Error(`server.ts no longer has "${header}" — re-aim this test`);
    const end = serverSrc.indexOf(`\n${closer}\n`, start + 1);
    return serverSrc.slice(start + 1, end + 1 + closer.length);
}
const lifted = [
    lift('function parseWebhookJsonValue'),
    lift('function normalizeStringArrayForWebhook'),
    lift('function normalizePercent0to100'),
    lift('const OVERALL_SCORE_ALIASES', '];'),
    lift('function buildStageEvalSources'),
    lift('function pickOverallScoreFromSources'),
    lift('function buildStrictStage2VoicePatch'),
].join('\n\n');
const js = ts.transpileModule(lifted, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const buildStrictStage2VoicePatch = new Function(
    'INVALID_WEBHOOK_ID_TOKENS',
    'buildStage2V2Extras',
    'normalizeRecommendation',
    'pickLooseFromSources',
    'clampRecommendationToScore',
    `${js}\nreturn buildStrictStage2VoicePatch;`
)(
    INVALID_WEBHOOK_ID_TOKENS,
    buildStage2V2Extras,
    normalizeRecommendation,
    pickLooseFromSources,
    clampRecommendationToScore
) as (data: Record<string, unknown>) => Record<string, unknown>;

/* ── the /webhook/n8n stage2 path, minus the database ───────────────────────── */
function stage2Ingress(body: Record<string, unknown>) {
    const patch = buildStrictStage2VoicePatch(body);
    const check = validateStage2VoiceEvaluationPersistence(body, patch);
    const blocked = shouldBlockStage2IncompleteEvaluation(getStage2EvaluationGateMode(), check);
    return { patch, accepted: !blocked, issues: check.ok ? [] : check.issues };
}

const FIXTURE = JSON.parse(
    readFileSync(new URL('./fixtures/stage2-exec-1942-callback.json', import.meta.url), 'utf8')
).body as Record<string, string>;
const scoresOf = (body: Record<string, string>) => JSON.parse(body.competencyScores) as Array<Record<string, unknown>>;
/** The fixture with its professional_attitude competency entry replaced. */
function withAttitudeEntry(entry: Record<string, unknown> | null, extra: Record<string, string> = {}) {
    const scores = scoresOf(FIXTURE).filter((e) => e.competencyKey !== 'professional_attitude');
    if (entry) scores.push({ competencyKey: 'professional_attitude', evidence: [], selfReported: false, ...entry });
    return { ...FIXTURE, competencyScores: JSON.stringify(scores), ...extra };
}

check('the gate runs in enforce mode (as in production)', getStage2EvaluationGateMode(), 'enforce');

/* ── 1. the regression: execution 1942, verbatim ───────────────────────────── */
console.log('\n▶ execution 1942 — the candidate left early, attitude "Not Assessed"');
{
    const r = stage2Ingress(FIXTURE);
    check('the builder sends no attitude paragraph (it arrived empty)', r.patch.professional_attitude, undefined);
    check('…and carries the explicit marker from the same result',
        (r.patch.competencyScores as Array<Record<string, unknown>>).filter((e) => e.competencyKey === 'professional_attitude')
            .map((e) => [e.rating, e.assessed]),
        [['Not Assessed', false]]);
    check('ACCEPTED — no issues', r.issues, []);
    check('accepted, so the evaluation is stored', r.accepted, true);
    check('HR now sees the scorer\'s note that the candidate left early',
        String(r.patch.summary).startsWith('ملاحظة: غادر المرشح المقابلة قبل أن تنتهي'), true);
    check('…with its recommendation and status', [r.patch.recommendation, r.patch.status], ['Consider', 'insufficient_data']);
}

/* ── 2. still rejected: assessed, but the paragraph is empty ────────────────── */
console.log('\n▶ Professional Attitude ASSESSED but its paragraph empty');
check('assessed:true + a real rating + empty paragraph ⇒ rejected',
    stage2Ingress(withAttitudeEntry({ rating: 'Good', assessed: true })).issues, ['professional_attitude']);
check('the paragraph missing entirely (field absent) ⇒ rejected',
    (() => { const b: Record<string, string> = { ...withAttitudeEntry({ rating: 'Good', assessed: true }) }; delete b['Professional Attitude']; return stage2Ingress(b).issues; })(),
    ['professional_attitude']);

/* ── 3. still rejected: the marker is not explicit ─────────────────────────── */
console.log('\n▶ the "not assessed" marker must be explicit and consistent');
check('rating "Not Assessed" but assessed:true (contradiction) ⇒ rejected',
    stage2Ingress(withAttitudeEntry({ rating: 'Not Assessed', assessed: true })).issues, ['professional_attitude']);
check('assessed:false but a real rating (contradiction) ⇒ rejected',
    stage2Ingress(withAttitudeEntry({ rating: 'Good', assessed: false })).issues, ['professional_attitude']);
check('rating "Not Assessed" but `assessed` missing ⇒ rejected',
    stage2Ingress(withAttitudeEntry({ rating: 'Not Assessed' })).issues, ['professional_attitude']);
check('`assessed` as the string "false" (not the boolean) ⇒ rejected',
    stage2Ingress(withAttitudeEntry({ rating: 'Not Assessed', assessed: 'false' })).issues, ['professional_attitude']);
check('no professional_attitude entry at all ⇒ rejected',
    stage2Ingress(withAttitudeEntry(null)).issues, ['professional_attitude']);
check('no competencyScores at all ⇒ rejected',
    (() => { const b: Record<string, string> = { ...FIXTURE }; delete b.competencyScores; return stage2Ingress(b).issues; })(),
    ['professional_attitude']);
check('two professional_attitude entries (ambiguous) ⇒ rejected',
    (() => {
        const scores = scoresOf(FIXTURE);
        scores.push({ competencyKey: 'professional_attitude', rating: 'Good', assessed: true, evidence: [] });
        return stage2Ingress({ ...FIXTURE, competencyScores: JSON.stringify(scores) }).issues;
    })(),
    ['professional_attitude']);

/* ── 4. still rejected: a malformed paragraph, even when not assessed ──────── */
console.log('\n▶ malformed attitude values');
check('a bare rating word as the paragraph ("Good") ⇒ rejected, marker or not',
    stage2Ingress({ ...FIXTURE, 'Professional Attitude': 'Good' }).issues, ['professional_attitude']);
check('a one-word fragment ⇒ rejected, marker or not',
    stage2Ingress({ ...FIXTURE, 'Professional Attitude': 'ok' }).issues, ['professional_attitude']);

/* ── 5. still rejected: unrelated incomplete fields ──────────────────────── */
console.log('\n▶ unrelated incomplete fields are not excused');
check('summary missing ⇒ rejected on summary (attitude not blamed)',
    stage2Ingress({ ...FIXTURE, Summary: '' }).issues, ['summary']);
check('recommendation missing ⇒ rejected on recommendation',
    stage2Ingress({ ...FIXTURE, Recommendation: '' }).issues, ['recommendation']);
check('final HR evaluation missing ⇒ rejected',
    stage2Ingress({ ...FIXTURE, 'Final HR Evaluation': '' }).issues, ['final_hr_evaluation']);
check('a numeric competency rating ⇒ rejected',
    stage2Ingress({ ...FIXTURE, 'Communication Skills': '7' }).issues, ['communication']);
check('a missing competency rating ⇒ rejected',
    stage2Ingress({ ...FIXTURE, 'Problem Solving': '' }).issues, ['problem_solving']);

/* ── 6. unchanged: a normal, complete evaluation ─────────────────────────── */
console.log('\n▶ a complete evaluation is unaffected');
check('assessed attitude with a real paragraph ⇒ accepted',
    stage2Ingress(withAttitudeEntry({ rating: 'Good', assessed: true },
        { 'Professional Attitude': 'Polite and composed throughout; answered every question directly.' })).issues, []);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
