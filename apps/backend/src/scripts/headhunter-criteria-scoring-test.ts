/**
 * headhunter-criteria-scoring-test
 *
 * THE DEFECT: "I ask for 20 candidates and get 2."
 *
 * Measured on exec 2036 (HR Assistant, Baghdad, 2026-09-29): 27 candidates were
 * scored, 14 were actually in Iraq, and 10 of those 14 scored EXACTLY 35 — five
 * of them physically in Baghdad. Four had `position: positive` AND
 * `location: positive` in their own insights, which under the prompt's own
 * rubric (Position 35% + Location 30% + Years 15% + other 20%) is at least 65.
 * A score of 35 is arithmetically impossible under that rubric. 35 is the only
 * number in the prompt — the location cap — and the model anchored on it.
 *
 * The fix moves the arithmetic out of the model, exactly as the Stage 1 screener
 * was fixed. The model keeps judging; this node adds up the weights.
 *
 * This runs the REAL replacement node against the REAL per-criterion judgements
 * of all 46 candidates from execs 2035 and 2036, so the before/after delivery
 * count is measured rather than predicted.
 *
 * The fixture is anonymised on purpose: this repository is public, so it carries
 * only criterion labels, `kind` values and the model's own score — no names, no
 * LinkedIn URLs, no job titles.
 *
 * Run: npm run test:headhunter-criteria-scoring
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const NODE_FILE = join(WF_DIR, 'pending', 'headhunter-criteria-scoring.node.js');
const FIXTURE = join(HERE, 'fixtures', 'headhunter-real-evaluator-output.json');

const THRESHOLD = 50; // `Finalize Top N Send` shortlists at >= 50

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

type Insight = { label: string; kind: string };
type FixtureCandidate = { id: string; inIraq: boolean; inBaghdad: boolean; llmScore: number; insights: Insight[] };
type Fixture = Record<string, { meta: Record<string, unknown>; candidates: FixtureCandidate[] }>;

/** Rebuild the LLM's raw answer from the recorded judgements. */
function llmAnswer(c: FixtureCandidate): string {
    return JSON.stringify({
        match_score: c.llmScore,
        match_insights: c.insights.map((i) => ({ kind: i.kind, text: `${i.label}: recorded judgement` })),
    });
}

/** Run the REAL node with the two shims it uses. */
function runNode(code: string, answers: string[]): Record<string, unknown>[] {
    const mapped = answers.map((_, i) => ({ json: { name: `c${i}`, __skip: false } }));
    const $ = () => ({ all: () => mapped });
    const $input = { all: () => answers.map((text) => ({ json: { text } })) };
    // eslint-disable-next-line no-new-func
    const fn = new Function('$', '$input', code);
    return (fn($, $input) as { json: Record<string, unknown> }[]).map((o) => o.json);
}

function main(): void {
    console.log('='.repeat(96));
    console.log('Head Hunter — compute the match score from the rubric instead of trusting the model');
    console.log('='.repeat(96));

    const code = readFileSync(NODE_FILE, 'utf8');
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    const patch = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-criteria-scoring.patch.json'), 'utf8'));
    // Published: the base is the archived pre-fix version; live/ carries the result.
    const base = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    const live = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    const edit = patch.parameterEdits[0];
    const baseNode = base.nodes.find((n: { name: string }) => n.name === edit.node);
    const liveNode = live.nodes.find((n: { name: string }) => n.name === edit.node);

    console.log('\nPATCH');
    check('patch base is the archived pre-fix version', base.versionId === patch.baseVersionId, `${base.versionId} vs ${patch.baseVersionId}`);
    check('the node it replaces exists in that base', Boolean(baseNode));
    check('the base node had the defect this replaces', String(baseNode.parameters.jsCode).includes(edit.expectBeforeContains));
    // CONTENT, not a version id - a version-id check breaks on every later, unrelated publish.
    // Superseded 2026-09-30 by headhunter-neutral-half-credit (silent = half, not full), which
    // replaced this exact node: live/ must carry EITHER this code or that recorded successor.
    const successor = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-neutral-half-credit.patch.json'), 'utf8'));
    const liveCode = String(liveNode?.parameters.jsCode);
    const successorBase = JSON.parse(readFileSync(join(WF_DIR, successor.baseFile), 'utf8'));
    check('the successor replaced exactly this node, from exactly this code',
        successor.parameterEdits[0].node === edit.node
        && String(successorBase.nodes.find((n: { name: string }) => n.name === edit.node)?.parameters.jsCode) === code);
    // Followed through every RECORDED successor since (neutral-half-credit, then completion-hardening's
    // pairing fix on 2026-10-02), not only the first one.
    const carried = liveCarriesOrRecordedSuccessor(WF_DIR, edit.node, code, liveCode);
    // (Each hop's archived base must hold the previous hop's code, so reaching completion-hardening means
    // passing through the successor checked above.)
    check(`live carries this node or a recorded successor, byte for byte (${carried.via})`, carried.ok);
    check('and the bare-50 default is gone from live', !liveCode.includes(edit.expectBeforeContains));
    check('the replacement carries the rubric', code.includes(edit.expectAfterContains));
    // Strip comments first: the file's own header QUOTES the prompt's cap rule,
    // which made this check fail on its own documentation.
    const codeOnly = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const capLines = codeOnly
        .split('\n')
        .filter((l) => /\b35\b/.test(l) && !l.includes('position: 35'));
    check('the replacement does NOT reintroduce a location cap', capLines.length === 0, capLines.join(' | '));
    check('the model’s own number is kept for comparison', code.includes('llm_match_score'));
    check('only one node is touched', patch.parameterEdits.length === 1);

    // ---- replay every real candidate ---------------------------------------
    console.log('\nREPLAY — all 46 real candidates, real per-criterion judgements');
    let totalBefore = 0;
    let totalAfter = 0;
    for (const [execId, ex] of Object.entries(fixture)) {
        const out = runNode(code, ex.candidates.map(llmAnswer));
        check(`exec ${execId}: every candidate produced a score`, out.length === ex.candidates.length);

        const rows = ex.candidates.map((c, i) => ({
            c,
            now: Number(out[i].match_score),
            src: String(out[i].score_source),
        }));
        const iraqi = rows.filter((r) => r.c.inIraq);
        const beforeDeliv = iraqi.filter((r) => r.c.llmScore >= THRESHOLD).length;
        const afterDeliv = iraqi.filter((r) => r.now >= THRESHOLD).length;
        totalBefore += beforeDeliv;
        totalAfter += afterDeliv;

        console.log(`\n  exec ${execId}  (${ex.meta.position} · ${ex.meta.location} · years ${ex.meta.years})`);
        console.log(`    scored ${rows.length} · in Iraq ${iraqi.length}`);
        console.log(`    deliverable (Iraqi & >= ${THRESHOLD}):  model ${beforeDeliv}  ->  computed ${afterDeliv}`);
        console.log(`    actually delivered that day: ${ex.meta.delivered}`);
        const band = (lo: number, hi: number, f: (r: typeof rows[number]) => number) => iraqi.filter((r) => f(r) >= lo && f(r) < hi).length;
        console.log(`    Iraqi score spread  model   : >=70:${iraqi.filter((r) => r.c.llmScore >= 70).length}  50-69:${band(50, 70, (r) => r.c.llmScore)}  40-49:${band(40, 50, (r) => r.c.llmScore)}  25-39:${band(25, 40, (r) => r.c.llmScore)}`);
        console.log(`    Iraqi score spread  computed: >=70:${iraqi.filter((r) => r.now >= 70).length}  50-69:${band(50, 70, (r) => r.now)}  40-49:${band(40, 50, (r) => r.now)}  25-39:${band(25, 40, (r) => r.now)}`);

        // the candidates the model contradicted itself on
        const contradicted = rows.filter((r) => {
            const pos = r.c.insights.find((i) => /^position/i.test(i.label));
            const loc = r.c.insights.find((i) => /^location/i.test(i.label));
            return pos?.kind === 'positive' && loc?.kind === 'positive' && r.c.llmScore < THRESHOLD;
        });
        if (contradicted.length) {
            console.log(`    🔴 model scored these UNDER ${THRESHOLD} despite position+ AND location+ :`);
            for (const r of contradicted) console.log(`         ${r.c.id}  model=${r.c.llmScore}  computed=${r.now}`);
            check(`exec ${execId}: every self-contradicted candidate now clears ${THRESHOLD}`,
                contradicted.every((r) => r.now >= THRESHOLD),
                contradicted.map((r) => `${r.c.id}=${r.now}`).join(' '));
        }
        check(`exec ${execId}: every score came from the rubric, not a fallback`,
            rows.every((r) => r.src === 'computed'), rows.filter((r) => r.src !== 'computed').map((r) => r.src).join(','));
        check(`exec ${execId}: no score is the anchored 35 any more`,
            !rows.some((r) => r.now === 35 && r.c.llmScore === 35 && r.c.insights.some((i) => i.kind === 'positive')));
    }

    console.log(`\n  TOTAL deliverable across both searches:  model ${totalBefore}  ->  computed ${totalAfter}`);
    check('the fix increases delivery on real data', totalAfter > totalBefore, `${totalBefore} -> ${totalAfter}`);

    // ---- the promises the prompt makes -------------------------------------
    console.log('\nRUBRIC PROMISES');
    const mk = (ins: [string, string][]) => JSON.stringify({
        match_score: 1,
        match_insights: ins.map(([label, kind]) => ({ kind, text: `${label}: x` })),
    });
    const score = (ins: [string, string][]) => Number(runNode(code, [mk(ins)])[0].match_score);

    check('position+ and location+ alone scores >= 65 (35+30 of the weight)',
        score([['position', 'positive'], ['location', 'positive']]) === 100, String(score([['position', 'positive'], ['location', 'positive']])));
    check('a years warning costs only its 15% share',
        score([['position', 'positive'], ['location', 'positive'], ['years of experience', 'warning']]) === 81,
        String(score([['position', 'positive'], ['location', 'positive'], ['years of experience', 'warning']])));
    check('an unspecified criterion is NOT a penalty',
        score([['position', 'positive'], ['location', 'positive'], ['certifications', 'neutral']]) === 100);
    // position warning => 0 of 35, location + years earn 45, active weight 80 => 56.
    check('a position warning costs its full 35% share (45/80 = 56)',
        score([['position', 'warning'], ['location', 'positive'], ['years of experience', 'positive']]) === 56,
        String(score([['position', 'warning'], ['location', 'positive'], ['years of experience', 'positive']])));
    check('all-warning scores 0, not 35',
        score([['position', 'warning'], ['location', 'warning']]) === 0);
    check('label spelling variants map to the same criterion',
        score([['yearsOfExperience', 'warning'], ['position', 'positive'], ['location', 'positive']])
        === score([['years of experience', 'warning'], ['position', 'positive'], ['location', 'positive']]));
    check('"location (final cap)" is still the location criterion',
        score([['location (final cap)', 'warning'], ['position', 'positive']]) === 54,
        String(score([['location (final cap)', 'warning'], ['position', 'positive']])));

    console.log('\nCOMPETENCY HALF');
    const withComp = score([['position', 'positive'], ['location', 'positive'], ['Stakeholder Management', 'positive']]);
    check('a positive competency keeps a perfect profile at 100', withComp === 100, String(withComp));
    const halfComp = score([['position', 'positive'], ['location', 'positive'], ['Stakeholder Management', 'warning']]);
    check('a failed competency costs 30% of the total', halfComp === 70, String(halfComp));
    check('competencies that say nothing are skipped, not scored as zero',
        score([['position', 'positive'], ['location', 'positive'], ['Stakeholder Management', 'neutral']]) === 100);

    console.log('\nFALLBACK — the old bare 50 default is gone');
    const noJson = runNode(code, ['not json at all'])[0];
    check('an unparseable answer does not become 50', noJson.match_score !== 50, String(noJson.match_score));
    check('and it is labelled', noJson.score_source === 'none', String(noJson.score_source));
    const noCriteria = runNode(code, [JSON.stringify({ match_score: 88, match_insights: [{ kind: 'neutral', text: 'company: x' }] })])[0];
    check('an answer with nothing judged falls back to the model and says so',
        noCriteria.match_score === 88 && noCriteria.score_source === 'llm-fallback',
        `${noCriteria.match_score}/${noCriteria.score_source}`);

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
    console.log('\nMUTATIONS that must turn this red:');
    console.log('  M1  count neutral criteria in the denominator      -> "an unspecified criterion is NOT a penalty"');
    console.log('  M2  score all-neutral competencies as 0            -> "competencies that say nothing are skipped"');
    console.log('  M3  restore `let match_score = 50` as the fallback -> "an unparseable answer does not become 50"');
    console.log('  M4  reintroduce a 35 cap                           -> the replay + "does NOT reintroduce a location cap"');
    console.log('  M5  swap the position and years weights            -> the two weight-share checks');
}

main();
