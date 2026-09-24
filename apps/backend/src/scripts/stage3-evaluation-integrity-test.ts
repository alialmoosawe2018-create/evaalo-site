/**
 * Stage 3 evaluation integrity: an evaluator, parser or technical failure must
 * produce NO hiring judgment and NO callback — never insufficient_data, never a
 * score of 0, never Reject.
 *
 * The regression this pins (2026-09-23, n8n execution 1945): the assessment LLM
 * returned a full assessment — 7 of 10 competencies scored, two critical
 * concerns — but wrote four quotes as `"quote": \"…\"`. JSON.parse threw,
 * `getAssessment` swallowed the error and returned {}, and the scorer read
 * "nothing parsed" as "nothing assessed": insufficient_data, 0, Reject, with a
 * note telling HR the interview could not be assessed. The candidate was
 * rejected by a syntax error.
 *
 * Since workflow version 93a52261 the node THROWS instead. A Code node that
 * throws stops the run before the callback, so Evaalo records no evaluation and
 * the stalled-evaluation monitor (videoEvaluationHealthService) alerts the owner.
 *
 * The fixture is SYNTHETIC — no candidate data — and reproduces only the exact
 * malformed structure of 1945: a `\"`-escaped quote value standing outside a
 * string, which V8 rejects with "Unexpected token '\'".
 *
 * The node code under test is read from the repo baseline of the LIVE workflow
 * (docs/n8n-workflows/live/stage3-video--stage_3_v2.json) and run the way n8n
 * runs a Code node: `$input` and `$('Node')` are supplied.
 *
 * Run: npx tsx src/scripts/stage3-evaluation-integrity-test.ts
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, '../../docs/n8n-workflows/live/stage3-video--stage_3_v2.json');
const FIXTURE = join(HERE, 'fixtures/stage3-malformed-evaluator-output.synthetic.txt');

type Json = Record<string, any>;
const workflow = JSON.parse(readFileSync(BASELINE, 'utf8')) as Json;
const nodeByName = (name: string): Json => {
    const node = (workflow.nodes as Json[]).find((n) => n.name === name);
    if (!node) throw new Error(`baseline has no node "${name}"`);
    return node;
};
const SCORING = nodeByName('Stage 3 Scoring').parameters.jsCode as string;
const PRECHECK = nodeByName('Video Transcript Pre-Check').parameters.jsCode as string;
const MALFORMED = readFileSync(FIXTURE, 'utf8');

/** The getAssessment that shipped before 93a52261 — kept only to prove the test catches its return. */
const PRE_FIX_GET_ASSESSMENT =
    "function getAssessment(item) { const j = item.json || {}; if (j.output && typeof j.output === 'object') return j.output; if (j.blueprint || j.generic) return j; const raw = j.text || j.response || j.data || ''; const m = String(raw).match(/\\{[\\s\\S]*\\}/); if (m) { try { return JSON.parse(m[0]); } catch (e) {} } return {}; }";

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

// ---- n8n Code-node emulation -----------------------------------------------
function runNode(code: string, input: Json, nodes: Record<string, Json>): { out?: Json; error?: string } {
    const $input = { all: () => [{ json: input }], first: () => ({ json: input }), item: { json: input } };
    const $ = (name: string) => {
        if (!(name in nodes)) throw new Error(`no node data: ${name}`);
        return { first: () => ({ json: nodes[name] }), item: { json: nodes[name] } };
    };
    try {
        const result = new Function('$input', '$', code)($input, $) as Array<{ json: Json }>;
        return { out: JSON.parse(JSON.stringify(result[0].json)) };
    } catch (err) {
        return { error: String((err as Error).message) };
    }
}

const BLUEPRINT = {
    competencies: [
        { competencyKey: 'synthetic_competency_a', title: 'A', priority: 'critical', redFlags: [] },
        { competencyKey: 'synthetic_competency_b', title: 'B', priority: 'high', redFlags: [] },
    ],
};
const webhook = (body: Json = {}): Json => ({
    body: {
        candidateId: 'synthetic-candidate',
        fullTranscript: 'ai agent: synthetic question one?\n\nuser: a synthetic answer that is long enough.',
        messageCount: 4,
        blueprintSnapshot: BLUEPRINT,
        ...body,
    },
});
const score = (code: string, text: Json) => runNode(code, text, { Webhook: webhook() });
const assessment = (scores: [number, number], rating: string) =>
    JSON.stringify({
        blueprint: BLUEPRINT.competencies.map((c, i) => ({
            competencyKey: c.competencyKey,
            assessed: true,
            score: scores[i],
            evidence: { claim: 'c', situation: 's', action: 'a', result: 'r', quote: 'synthetic quote' },
            redFlagsDetected: [],
        })),
        generic: Object.fromEntries(
            ['role_judgment_problem_solving', 'ownership_accountability', 'learning_adaptability', 'overall_role_fit'].map(
                (k) => [k, { rating, assessed: true, evidence: 'e' }]
            )
        ),
        critical_concerns: [],
        summary: 'Synthetic.',
        strengths: [],
        weaknesses: [],
        overall_role_fit_narrative: 'n',
    });
const verdict = (r: { out?: Json }) =>
    r.out ? [r.out.status, r.out.overall_score, r.out.recommendation] : null;
/** n8n splits a thrown message on ": " and shows only the tail — the reason must survive whole. */
const shownWhole = (msg = '') => !msg.includes(': ');

const preFixScoring = SCORING.replace(/\/\/ An evaluator\/parser failure[\s\S]*?\n\}\n(?=function getBlueprintDef)/, () => PRE_FIX_GET_ASSESSMENT + '\n');

console.log('\nThe fixture reproduces the 1945 failure');
let parseError = '';
try {
    JSON.parse(MALFORMED.match(/\{[\s\S]*\}/)![0]);
} catch (err) {
    parseError = String((err as Error).message);
}
check("fixture is rejected by JSON.parse with the 1945 error (Unexpected token '\\')", parseError.startsWith("Unexpected token '\\'"), true);
check('pre-fix code turns it into insufficient_data / 0 / Reject (the bug)', verdict(score(preFixScoring, { text: MALFORMED })), ['insufficient_data', 0, 'Reject']);
check('pre-fix code was really swapped in for that check', preFixScoring !== SCORING && preFixScoring.includes('catch (e) {} } return {}; }'), true);

console.log('\nEvaluator failures stop the workflow — no judgment, no callback');
const r45 = score(SCORING, { text: MALFORMED });
check('malformed evaluator JSON throws, returns nothing', [!!r45.error, r45.out ?? null], [true, null]);
check('…with the parse reason, shown whole by n8n', /^STAGE3_EVALUATOR_OUTPUT_INVALID - assessment JSON does not parse/.test(r45.error ?? '') && shownWhole(r45.error), true);
const failing: Record<string, [Json, RegExp]> = {
    'no JSON object at all': [{ text: 'I am unable to evaluate this interview.' }, /no JSON object/],
    'empty output': [{ text: '' }, /no JSON object/],
    'truncated JSON': [{ text: assessment([2, 3], 'Good').slice(0, 300) }, /does not parse/],
    'valid JSON without a blueprint array': [{ text: '{"summary":"x","generic":{}}' }, /no blueprint array/],
    'parsed output object without a blueprint array': [{ output: { summary: 'x' } }, /no blueprint array/],
};
for (const [name, [input, reason]] of Object.entries(failing)) {
    const r = score(SCORING, input);
    check(`${name} -> throws (${reason.source})`, !!r.error && !r.out && /STAGE3_EVALUATOR_OUTPUT_INVALID/.test(r.error) && reason.test(r.error) && shownWhole(r.error), true);
}

console.log('\nReal assessments are untouched');
const genuineZero = score(SCORING, { text: assessment([1, 1], 'Bad') });
check('a GENUINE zero is still a judgment: scored / 0 / Reject', verdict(genuineZero), ['scored', 0, 'Reject']);
check('…identical to the pre-fix output', genuineZero.out, score(preFixScoring, { text: assessment([1, 1], 'Bad') }).out);
const ordinary = score(SCORING, { text: assessment([4, 3], 'Good') });
check('an ordinary assessment scores exactly as before the fix', ordinary.out, score(preFixScoring, { text: assessment([4, 3], 'Good') }).out);
check('…and is a real verdict', !!ordinary.out && ordinary.out.status === 'scored' && ordinary.out.overall_score > 0, true);
// Absolute pins: the pre-fix comparison above drifts WITH the file, so it cannot
// see a changed weight or threshold. These can (blueprint 65 + generic 35).
check('pinned arithmetic: all 4s + Good -> 75 / Hire', verdict(score(SCORING, { text: assessment([4, 4], 'Good') })), ['scored', 75, 'Hire']);
check('pinned arithmetic: all 3s + Intermediate -> 50 / Consider', verdict(score(SCORING, { text: assessment([3, 3], 'Intermediate') })), ['scored', 50, 'Consider']);
// Uniform scores hide the cluster weights; a critical 5 beside a high 1 does not (65.25 -> 65).
check('pinned arithmetic: critical 5 + high 1 + Good -> 65 / Consider', verdict(score(SCORING, { text: assessment([5, 1], 'Good') })), ['scored', 65, 'Consider']);

console.log('\nPre-Check: technical input failures stop; product rules unchanged');
const pre = (body: Json) => runNode(PRECHECK, webhook(body), {});
const missing = pre({ candidateId: '' });
check('missing candidateId -> throws, no Reject', !!missing.error && /^STAGE3_INPUT_INVALID - missing candidate ID/.test(missing.error) && shownWhole(missing.error), true);
for (const [name, criteria] of [['criteria not JSON', 'not json'], ['criteria empty array', []]] as const) {
    const r = pre({ criteria });
    check(`${name} -> throws, no Reject`, !!r.error && /^STAGE3_INPUT_INVALID - criteria/.test(r.error) && shownWhole(r.error), true);
}
check('valid criteria -> passes', pre({ criteria: ['x'] }).out?.passed, true);
check('transcript under 50 chars -> the existing Reject path, unchanged', pre({ fullTranscript: 'short' }).out?.rejectCode, 'invalid_transcript');
check('fewer than 2 messages -> the existing Reject path, unchanged', pre({ messageCount: 1 }).out?.rejectCode, 'insufficient_messages');
check('check order kept: short transcript wins over bad criteria', pre({ fullTranscript: 'short', criteria: 'x' }).out?.rejectCode, 'invalid_transcript');

console.log('\nThe throw can only stop the run if the graph lets it');
for (const name of ['Stage 3 Scoring', 'Video Transcript Pre-Check']) {
    const onError = nodeByName(name).onError;
    check(`"${name}" stops the workflow on error (no continue-on-fail)`, onError === undefined || onError === 'stopWorkflow', true);
}
const next = (from: string) => ((workflow.connections[from]?.main ?? []) as Json[][]).flat().map((c) => c.node);
check('Scoring feeds only the translation step', next('Stage 3 Scoring'), ['Stage 3 Translate LLM']);
check('the callback is reached only through Localization', next('Apply Stage 3 Localization').includes('HTTP Request'), true);
check('no other node feeds the callback', Object.keys(workflow.connections).filter((n) => next(n).includes('HTTP Request')), ['Apply Stage 3 Localization']);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
