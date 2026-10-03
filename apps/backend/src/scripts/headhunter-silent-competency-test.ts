/**
 * headhunter-silent-competency-test
 *
 * Apply AI Analysis computes the Head Hunter match score from the model's
 * per-criterion judgements. A competency of the role model the profile is silent on
 * (kind "neutral") used to be DROPPED, so with only title and location set a profile
 * judged positive on both scored 100 whatever its evidence. It now counts HALF - the
 * rule a silent set criterion already follows (owner decision 2026-10-03, option A).
 * PUBLISHED 2026-10-03 as n8n version 4496e0fe (rollback 899466d2); the PUBLISHED
 * section pins live/ to the tested rebuild.
 *
 * Measured before building it (local replay of the live scoring code on the 78
 * computed evaluations of execs 2040-2069; replay == recorded 78/78 - real profiles,
 * so the replay stays out of this public repo): 100s 34 -> 6, title and location
 * alone -> 85, evidence 88-98, 0 of 78 cross the 50 delivery bar.
 *
 * This test, on synthetic judgements only:
 *   1. PATCH / GRAPH - only Apply AI Analysis changes, only the competency arithmetic.
 *   2. CASES - the node itself, old vs new, on named judgement sets.
 *   3. GENERATED - thousands of random judgement sets: nothing changes unless a
 *      competency is silent; a silent competency always moves the score toward the
 *      half-credit point; the fallback and the parse are untouched.
 *
 * Run: npm run test:headhunter-silent-competency
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch, canon, eq, runCode, type Ctx, type Item, type Wf } from './lib/headhunterWorkflowEngine.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const rec = JSON.parse(read('headhunter-silent-competency.patch.json'));

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const BASE: Wf = JSON.parse(readFileSync(join(WF_DIR, rec.baseFile), 'utf8'));
const NEW: Wf = applyPatch(BASE, rec, PENDING);
const NODE = 'Apply AI Analysis';
const nodeIn = (wf: Wf, name: string) => wf.nodes.find((n) => n.name === name);
const codeOf = (wf: Wf) => String(nodeIn(wf, NODE)?.parameters?.jsCode ?? '');

/** Line diff (longest common subsequence). */
function lineDiff(a: string[], b: string[]): { removed: string[]; added: string[] } {
    const n = a.length; const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const removed: string[] = []; const added: string[] = [];
    let i = 0; let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) removed.push(a[i++]); else added.push(b[j++]);
    }
    while (i < n) removed.push(a[i++]);
    while (j < m) added.push(b[j++]);
    return { removed, added };
}

type Kind = 'positive' | 'warning' | 'neutral';
type Insight = { kind: Kind; text: string };
const COMPETENCIES = ['Stakeholder management', 'Employee relations', 'Recruitment coordination', 'Performance management', 'HR metrics', 'Labor law compliance', 'Process improvement', 'Compensation advice', 'Onboarding', 'Conflict resolution', 'Policy application'];

/** Score one judgement set with the node's own code (old or new), the way production runs it. */
function score(wf: Wf, insights: Insight[], wh: Record<string, unknown> = {}, llm: number | null = 60): { match_score: number; score_source: string; llm_match_score: number | null } {
    const body = { searchId: 'headhunter_unit', position: 'HR Business Partner', location: 'Baghdad, Iraq', ...wh };
    const candidate: Item = { json: { name: 'Synthetic Person', linkedin_url: 'https://www.linkedin.com/in/synthetic-person' } };
    const text = JSON.stringify({ ...(llm == null ? {} : { match_score: llm }), match_insights: insights });
    const ctx: Ctx = { body, sd: {}, liveFallback: false, out: (n, branch) => (n === 'Has Match?' && (branch ?? 0) === 0 ? [candidate] : undefined) };
    const out = runCode(nodeIn(wf, NODE), [{ json: { text } }], ctx)[0][0].json;
    return { match_score: out.match_score, score_source: out.score_source, llm_match_score: out.llm_match_score };
}
const ins = (label: string, kind: Kind): Insight => ({ kind, text: `${label}: synthetic judgement` });
const comps = (kinds: Kind[]): Insight[] => kinds.map((k, i) => ins(COMPETENCIES[i % COMPETENCIES.length] + (i >= COMPETENCIES.length ? ` ${i}` : ''), k));
const n = (count: number, kind: Kind): Kind[] => Array.from({ length: count }, () => kind);
const TITLE_LOC: Insight[] = [ins('position', 'positive'), ins('location', 'positive')];

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — a silent competency counts half (${rec.publishedVersionId ? 'published ' + String(rec.publishedVersionId).slice(0, 8) : 'pending'}, base ${String(rec.baseVersionId).slice(0, 8)})`);
    console.log('='.repeat(96));

    // ================================================================ 1. PATCH / GRAPH
    console.log('\nPATCH');
    check(`base is ${rec.baseFile} (${String(rec.baseVersionId).slice(0, 8)}, ${rec.baseNodeCount} nodes)`, BASE.versionId === rec.baseVersionId && BASE.nodes.length === rec.baseNodeCount);
    check('one edit, on Apply AI Analysis, nothing else in the record', rec.parameterEdits.length === 1 && rec.parameterEdits[0].node === NODE && !rec.addNodes && !rec.removeNodes && !rec.connections && !rec.parameterSets);
    const before = codeOf(BASE); const after = codeOf(NEW);
    const d = lineDiff(before.split('\n'), after.split('\n'));
    const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
    check('code: exactly the competency arithmetic changes (3 lines out, 3 in)',
        eq(d.removed.filter((l) => !isComment(l)), [
            "  const judgedComp = competencies.filter((k) => k === 'positive' || k === 'warning');",
            '  if (!judgedComp.length) {',
            "  const competencyPct = (judgedComp.filter((k) => k === 'positive').length / judgedComp.length) * 100;",
        ]) && eq(d.added.filter((l) => !isComment(l)), [
            '  if (!competencies.length) {',
            "  const competencyCredit = competencies.map((k) => (k === 'positive' ? 1 : k === 'warning' ? 0 : SILENT_CREDIT));",
            '  const competencyPct = mean(competencyCredit) * 100;',
        ]), JSON.stringify({ removed: d.removed.filter((l) => !isComment(l)), added: d.added.filter((l) => !isComment(l)) }));
    check('the half is the existing SILENT_CREDIT (0.5), not a new constant', before.includes('const SILENT_CREDIT = 0.5;') && after.includes('const SILENT_CREDIT = 0.5;') && !/=\s*0\.5\b/.test(d.added.join('\n')));
    check('added lines are ASCII; LF; the weights (70 / 30, 35/30/15/20) unchanged',
        d.added.every((l) => [...l].every((ch) => ch.charCodeAt(0) < 128)) && !after.includes('\r')
        && after.includes('const CRITERION_WEIGHTS = { position: 35, location: 30, years: 15, other: 20 };') && after.includes('roundScore(0.7 * criteriaPct + 0.3 * competencyPct)'));
    console.log('\nGRAPH');
    check('every other node byte-identical; connections and settings unchanged',
        BASE.nodes.filter((x) => x.name !== NODE).every((x) => canon(x) === canon(nodeIn(NEW, x.name))) && NEW.nodes.length === BASE.nodes.length
        && canon(NEW.connections) === canon(BASE.connections) && canon(NEW.settings) === canon(BASE.settings));
    check('Apply AI Analysis: only its jsCode differs', canon({ ...nodeIn(BASE, NODE), parameters: {} }) === canon({ ...nodeIn(NEW, NODE), parameters: {} }) && eq(Object.keys(nodeIn(NEW, NODE).parameters), ['jsCode']));

    if (rec.publishedVersionId) {
        console.log(`\nPUBLISHED (${String(rec.publishedVersionId).slice(0, 8)}) — live/ must be the tested rebuild, carried through the recorded publishes since`);
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const carried = withRecordedPublishesAfter(WF_DIR, String(rec.publishedVersionId), NEW);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const P = new Map(pub.nodes.map((x) => [x.name, x]));
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (ids included)',
            pub.nodes.length === carried.wf.nodes.length && carried.wf.nodes.every((x) => P.has(x.name) && canon(x) === canon(P.get(x.name))));
        check("every connection and the settings of live/ equal the rebuild's", canon(pub.connections) === canon(carried.wf.connections) && canon(pub.settings) === canon(BASE.settings));
        check('the replacement file still hashes to its recorded publishedSha256', rec.parameterEdits.every((e: any) => e.publishedSha256 === createHash('sha256').update(read(e.replaceWholeValueFromFile), 'utf8').digest('hex')));
        check("the record's graph section still hashes to its recorded publishedStructureSha256", Boolean(rec.publishedStructureSha256) && structureSha256(rec) === rec.publishedStructureSha256);
    }

    // ================================================================ 2. CASES
    console.log('\nCASES — the node itself, before -> after');
    const cases: [string, Insight[], Record<string, unknown>, number, number][] = [
        ['title + location positive, 11 competencies silent (the exec-2069 shape)', [...TITLE_LOC, ...comps(n(11, 'neutral'))], {}, 100, 85],
        ['title + location positive, 5 competencies positive and 6 silent', [...TITLE_LOC, ...comps([...n(5, 'positive'), ...n(6, 'neutral')])], {}, 100, 92],
        ['title + location positive, 1 positive and 10 silent', [...TITLE_LOC, ...comps([...n(1, 'positive'), ...n(10, 'neutral')])], {}, 100, 86],
        ['title + location positive, every competency positive: still 100', [...TITLE_LOC, ...comps(n(8, 'positive'))], {}, 100, 100],
        ['title + location positive, no role model at all: still 100', [...TITLE_LOC], {}, 100, 100],
        ['title + location positive, 1 warning and 10 silent: silence now half, not dropped', [...TITLE_LOC, ...comps([...n(1, 'warning'), ...n(10, 'neutral')])], {}, 70, 84],
        ['title + location positive, judged competencies only (no silence): unchanged', [...TITLE_LOC, ...comps([...n(3, 'positive'), ...n(1, 'warning')])], {}, 93, 93],
        ['location judged warning, competencies silent', [ins('position', 'positive'), ins('location', 'warning'), ...comps(n(11, 'neutral'))], {}, 54, 53],
        ['years set and silent, no role model: the criteria rule as before', [...TITLE_LOC, ins('years of experience', 'neutral')], { yearsOfExperience: '5-10' }, 91, 91],
        ['years and age set, both silent, competencies silent', [...TITLE_LOC, ins('years of experience', 'neutral'), ins('ageRange', 'neutral'), ...comps(n(11, 'neutral'))], { yearsOfExperience: '5-10', ageRange: '35-44' }, 83, 73],
    ];
    for (const [label, insights, wh, wantOld, wantNew] of cases) {
        const o = score(BASE, insights, wh); const x = score(NEW, insights, wh);
        check(`${label}: ${wantOld} -> ${wantNew}`, o.match_score === wantOld && x.match_score === wantNew && o.score_source === 'computed' && x.score_source === 'computed', `got ${o.match_score} -> ${x.match_score}`);
    }
    {
        const silentOnly = [ins('position', 'neutral'), ins('location', 'neutral'), ...comps(n(11, 'neutral'))];
        const o = score(BASE, silentOnly, {}, 42); const x = score(NEW, silentOnly, {}, 42);
        check('nothing judged at all: still the model\'s own number (llm-fallback), as before', eq(o, x) && x.score_source === 'llm-fallback' && x.match_score === 42, JSON.stringify(x));
        const broken = score(NEW, [], {}, null);
        check('an unparseable answer: still 0 / none, as before', broken.match_score === 0 && broken.score_source === 'none');
        const notSet = [...TITLE_LOC, ins('languages', 'neutral'), ins('skills', 'neutral')];
        check('a criterion the recruiter did not set is not turned into a silent competency', score(NEW, notSet).match_score === 100 && score(BASE, notSet).match_score === 100);
    }

    // ================================================================ 3. GENERATED
    console.log('\nGENERATED — random judgement sets, old vs new');
    {
        let seed = 20261004;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const kindOf = (pPos: number, pWarn: number): Kind => { const r = rnd(); return r < pPos ? 'positive' : r < pPos + pWarn ? 'warning' : 'neutral'; };
        const N = 3000;
        let same = 0; let sameWhenNoSilence = 0; let noSilence = 0; let towardHalf = 0; let silent = 0; let sourceSame = 0;
        let was100 = 0; let left100 = 0; const cross = { down: 0, up: 0 };
        let firstBad = '';
        for (let k = 0; k < N; k++) {
            const wh: Record<string, unknown> = {};
            if (rnd() < 0.3) wh.yearsOfExperience = '3-5';
            if (rnd() < 0.2) wh.ageRange = '25-34';
            const insights: Insight[] = [ins('position', kindOf(0.8, 0.1)), ins('location', kindOf(0.7, 0.2))];
            if (wh.yearsOfExperience) insights.push(ins('years of experience', kindOf(0.3, 0.2)));
            if (wh.ageRange) insights.push(ins('ageRange', kindOf(0.2, 0.1)));
            const cn = rnd() < 0.15 ? 0 : 1 + Math.floor(rnd() * 12);
            const shape = rnd();
            const ck = Array.from({ length: cn }, () => (shape < 0.25 ? kindOf(0.6, 0.3) : kindOf(0.15, 0.05)));
            insights.push(...comps(ck));
            const llm = Math.floor(rnd() * 101);
            const o = score(BASE, insights, wh, llm); const x = score(NEW, insights, wh, llm);
            if (o.score_source === x.score_source) sourceSame++;
            else firstBad = firstBad || `#${k}: source ${o.score_source} -> ${x.score_source}`;
            if (o.match_score === x.match_score) same++;
            const silentComps = ck.filter((c) => c === 'neutral').length;
            if (!silentComps) {
                noSilence++;
                if (o.match_score === x.match_score) sameWhenNoSilence++;
                else firstBad = firstBad || `#${k}: no silent competency, yet ${o.match_score} -> ${x.match_score}`;
            } else if (o.score_source === 'computed') {
                silent++;
                // Old: silence dropped -> competency% = positive / judged (or criteria only). New: silence pulls it toward 50%.
                const judged = ck.filter((c) => c !== 'neutral');
                const oldPct = judged.length ? (judged.filter((c) => c === 'positive').length / judged.length) * 100 : null;
                const newPct = ((ck.filter((c) => c === 'positive').length + 0.5 * silentComps) / ck.length) * 100;
                const ok = oldPct == null ? true : (oldPct >= 50 ? newPct <= oldPct + 1e-9 && newPct >= 50 - 1e-9 : newPct >= oldPct - 1e-9 && newPct <= 50 + 1e-9);
                if (ok) towardHalf++;
                else firstBad = firstBad || `#${k}: competency ${oldPct} -> ${newPct} is not toward 50`;
                if (o.match_score === 100) { was100++; if (x.match_score < 100) left100++; }
                if (o.match_score >= 50 && x.match_score < 50) cross.down++;
                if (o.match_score < 50 && x.match_score >= 50) cross.up++;
            }
        }
        check(`${N} sets: the source (computed / llm-fallback / none) never changes`, sourceSame === N, firstBad);
        check(`${noSilence} sets with no silent competency: the score is exactly the old one`, sameWhenNoSilence === noSilence && noSilence > 300, firstBad);
        check(`${silent} sets with a silent competency: the competency share only moves toward the half point`, towardHalf === silent && silent > 1500, firstBad);
        check(`a 100 that rested on silence never stays 100 (${left100} of ${was100})`, was100 > 100 && left100 === was100);
        console.log(`  --    synthetic sets crossing the 50 bar: down ${cross.down}, up ${cross.up} of ${silent} (real data: 0 of 78; synthetic shapes are harsher on purpose); unchanged overall ${same}/${N}`);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
