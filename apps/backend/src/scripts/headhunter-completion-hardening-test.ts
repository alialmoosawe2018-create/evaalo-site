/**
 * headhunter-completion-hardening-test
 *
 * A Head Hunter search must end with the RIGHT completion however late the held-back
 * runs arrive, and every answer of the model must land on the candidate it was about
 * (published 2026-10-02 as n8n version 72f27440; rollback 3164bf87).
 *
 * The patch (pending/headhunter-completion-hardening.*), on top of the
 * empty-chain close:
 *   - Finalize Top N Send / Finalize Phase 2 Send run once per phase per search. Split
 *     In Batches fires its done branch again for every Stream Batch Done run n8n holds
 *     back, and each repeat reran the finalize node on a pool already handed on: it
 *     overwrote hhSendProgress (blinding the guard in Prepare Complete Search) and
 *     produced a false completion that lost only because n8n v1's canvas order put
 *     the real one first.
 *   - Finalize Top N Send: an empty pool says "No candidates found: ..." instead of the
 *     "(25)" threshold text.
 *   - Apply AI Analysis pairs answers with Has Match?'s output instead of Map Candidate
 *     Fields' last N rows (a row with a title and no name shifted every answer before it).
 *   - Is Phase 2? drops a clause that could never evaluate ($getWorkflowStaticData does
 *     not exist in expressions).
 *
 * How it is proven, offline and on synthetic data (the repository is public), with the
 * shared n8n v1 engine (lib/headhunterWorkflowEngine.ts; test:headhunter-empty-chain-close
 * makes it replay executions 2048 and 2057 run for run):
 *   1. PATCH / GRAPH - only the four nodes change, and only by the intended lines.
 *   2. ORDER TRIPWIRES - the canvas and settings the once-per-phase rule rests on.
 *   3. EXEC 2048 - the base graph regenerates the false completions where n8n did; the
 *      patched graph posts the same single completion with every repeat silent.
 *   4. FORCED ORDER - an extra held-back run in front of a finalize node's send: the
 *      base posts the false completion, the patched graph the right one; each marker,
 *      taken out, makes this fail. Also the documented limit: a held-back run BEFORE a
 *      phase's last batch (n8n v1 never does this).
 *   5. LIFECYCLE - named search shapes, base vs patched, natural and forced order.
 *   6. PAIRING - the real Map / Has Match? / Apply AI chain with a nameless row at every
 *      position; the wrong pairings that must fail, do.
 *   7. GENERATED - hundreds of random searches, natural and forced order.
 *
 * Run: npm run test:headhunter-completion-hardening
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyPatch, bodyOf, canon, clone, completionOnly, eq, profileOf, REC_2048, renumber, runCode, runIf, runSearch, scenario2048,
    sendKey, slugOf, url, without,
    type Ctx, type Item, type Resp, type Run, type RunOpts, type Scenario, type Wf,
} from './lib/headhunterWorkflowEngine.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const load = (f: string): Wf => JSON.parse(readFileSync(join(WF_DIR, f), 'utf8'));
const rec = JSON.parse(read('headhunter-completion-hardening.patch.json'));
const ec = JSON.parse(read(rec.basePatch));

// One frozen clock: Merge Serp Results, Filter New URLs and Person Search stamp static data with it.
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
Date.now = () => NOW;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

// The base is the empty-chain close applied to its own base, until this record names a published base.
const BASE: Wf = rec.baseFile ? load(rec.baseFile) : applyPatch(load(ec.baseFile), ec, PENDING);
const NEW: Wf = applyPatch(BASE, rec, PENDING);
const nodeIn = (wf: Wf, name: string) => wf.nodes.find((n) => n.name === name);
const outs = (wf: Wf, name: string, o = 0) => ((wf.connections[name]?.main?.[o]) || []).map((c: any) => `${c.node}[${c.index}]`).sort();
const ins = (wf: Wf, name: string) => Object.entries(wf.connections).flatMap(([f, c]: [string, any]) =>
    (c.main || []).flatMap((arr: any[], o: number) => (arr || []).filter((x) => x.node === name).map(() => `${f}[${o}]`))).sort();
const codeOf = (wf: Wf, name: string) => String(nodeIn(wf, name)?.parameters?.jsCode ?? '');

const FTN = 'Finalize Top N Send';
const FP2 = 'Finalize Phase 2 Send';
const APPLY = 'Apply AI Analysis';
const OLD_EMPTY = 'No candidates passed the preliminary AI score threshold (25).';
const NEW_EMPTY = 'No candidates found: none of the profiles reviewed qualified for this search.';
const reword = (c: any) => (c && c.errorMessage === OLD_EMPTY ? { ...c, errorMessage: NEW_EMPTY } : c);
const paid = (r: Run) => JSON.stringify([r.serpCalls, r.enriched, r.psCalls]);
const finalizeOutputs = (r: Run, name: string) => (r.runs[name] || []).map((o) => o[0].length);
const repeatsSilent = (r: Run) => [FTN, FP2].every((name) => finalizeOutputs(r, name).slice(1).every((len) => len === 0));
const falseEmpties = (r: Run) => (r.runs[FTN] || []).filter((o) => o[0].some((i) => i.json.errorMessage === OLD_EMPTY)).length;

/** The held-back run n8n defers: phase 1's rejected rows into Stream Batch Done (one skip row if there were none). */
const heldBack = (r: Run): Item[] => {
    const rows = r.runs['Has Match?']?.[0]?.[1] ?? [];
    return rows.length ? rows : [{ json: { __skip: true, name: '' } }];
};
const forced = (after: string): RunOpts => ({ inject: { after, run: 0, node: 'Stream Batch Done', items: heldBack } });

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

const MARK = (p: string) => [
    'sd.hhFinalized = sd.hhFinalized || {};',
    'const hhFin = sd.hhFinalized[searchId] || (sd.hhFinalized[searchId] = {});',
    `if (hhFin.${p}) return [];`,
    `hhFin.${p} = true;`,
];
const EXPECT: Record<string, { removed: string[]; code: string[] }> = {
    [FTN]: { removed: [`    errorMessage = '${OLD_EMPTY}';`], code: [...MARK('p1'), `    errorMessage = '${NEW_EMPTY}';`] },
    [FP2]: { removed: [], code: MARK('p2') },
    [APPLY]: {
        removed: ["const mapValid = $('Map Candidate Fields').all().filter((item) => !item.json.__skip);", 'const candidates = mapValid.slice(-inputs.length);'],
        code: ["const candidates = $('Has Match?').all(0);"],
    },
};

/** A copy of the patched graph with one node's code changed: the mutations that must be caught. */
function variant(name: string, f: (src: string) => string): Wf {
    const wf = clone(NEW);
    const n = nodeIn(wf, name);
    const before = String(n.parameters.jsCode);
    n.parameters.jsCode = f(before);
    if (n.parameters.jsCode === before) throw new Error(`variant: ${name} unchanged`);
    return wf;
}
const dropMarker = (p: string) => (src: string) => src.replace(MARK(p).join('\n') + '\n', '');

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — completion hardening (${rec.publishedVersionId ? 'published ' + String(rec.publishedVersionId).slice(0, 8) : 'pending'}, on top of ${rec.basePatch})`);
    console.log('='.repeat(96));

    // ================================================================ 1. PATCH / GRAPH
    console.log('\nPATCH');
    check(`base: ${rec.baseFile ? rec.baseFile : 'the empty-chain close applied to ' + ec.baseFile} (${rec.baseNodeCount} nodes)`,
        BASE.nodes.length === rec.baseNodeCount && (!rec.baseVersionId || BASE.versionId === rec.baseVersionId), `${BASE.versionId} / ${BASE.nodes.length}`);
    check('the base already carries the empty-chain close (Nothing To Enrich?, no Limit Candidates)', Boolean(nodeIn(BASE, 'Nothing To Enrich?')) && !nodeIn(BASE, 'Limit Candidates'));
    for (const e of rec.parameterEdits) {
        const before = codeOf(BASE, e.node);
        const after = read(e.replaceWholeValueFromFile);
        const lfBefore = before.replace(/\r\n/g, '\n');
        check(`${e.node}: the base has what this replaces`, lfBefore.includes(e.expectBeforeContains));
        check(`${e.node}: the replacement carries the change`, after.includes(e.expectAfterContains));
        check(`${e.node}: LF line endings, trailing newline as in the base`, !after.includes('\r') && after.endsWith('\n') === before.endsWith('\n'));
        const d = lineDiff(lfBefore.split('\n'), after.split('\n'));
        const want = EXPECT[e.node];
        check(`${e.node}: removes exactly ${want.removed.length} line(s)`, eq(d.removed, want.removed), JSON.stringify(d.removed));
        const addedCode = d.added.filter((l) => !/^\s*\/\//.test(l));
        check(`${e.node}: adds exactly the intended code (${want.code.length} line(s)); every other added line is a // comment`, eq(addedCode, want.code), JSON.stringify(addedCode));
        check(`${e.node}: every added line is ASCII`, d.added.every((l) => [...l].every((c) => c.charCodeAt(0) < 128)));
        if (e.node === FTN || e.node === FP2) {
            const L = after.split('\n');
            const sdAt = L.indexOf("const sd = $getWorkflowStaticData('global');");
            const firstCode = L.findIndex((l, i) => i > sdAt && !/^\s*\/\//.test(l));
            const p = e.node === FTN ? 'p1' : 'p2';
            check(`${e.node}: the marker comes right after \`const sd\` (comments aside), before anything reads or writes the search's state`,
                sdAt > 0 && L.indexOf("const searchId = String(wh.searchId || '');") < sdAt && eq(L.slice(firstCode, firstCode + 4), MARK(p)));
        }
    }
    {
        const set = rec.parameterSets[0];
        const b = nodeIn(BASE, 'Is Phase 2?'); const n = nodeIn(NEW, 'Is Phase 2?');
        const strip = (x: any) => { const c = clone(x); c.parameters.conditions.conditions[0].leftValue = ''; return c; };
        check('Is Phase 2?: only the one condition\'s leftValue changes', rec.parameterSets.length === 1 && set.path === 'conditions.conditions' && canon(strip(b)) === canon(strip(n)));
        check('Is Phase 2?: the new condition is `$json.__phase2 === true`, reading no static data', n.parameters.conditions.conditions[0].leftValue === '={{ $json.__phase2 === true }}');
        const ctx: Ctx = { body: bodyOf(), sd: { hhExpansionActive: { 'headhunter_test-0001': true } }, out: () => undefined, liveFallback: false };
        const items: Item[] = [true, false, undefined, 'true', 1, null].map((v) => ({ json: v === undefined ? {} : { __phase2: v } }));
        const routeB = runIf(b, items, ctx).map((o) => o.length); const routeN = runIf(n, items, ctx).map((o) => o.length);
        // In the model the dead clause renders undefined by construction; production agrees: the same routing on 54 recorded runs (1043 items).
        check('Is Phase 2?: routes every value of __phase2 as the base does in the model (the dead clause renders undefined)', eq(routeB, routeN) && eq(routeN, [1, 5]), `${routeB} / ${routeN}`);
    }

    console.log('\nGRAPH');
    const changed = new Set<string>([...rec.parameterEdits.map((e: any) => e.node), 'Is Phase 2?']);
    check('same nodes as the base: none added, none removed', eq(NEW.nodes.map((n) => n.name).sort(), BASE.nodes.map((n) => n.name).sort()) && !rec.addNodes && !rec.removeNodes);
    const untouched = BASE.nodes.filter((n) => !changed.has(n.name));
    check(`the ${untouched.length} other nodes are byte-identical (positions included)`, untouched.length === BASE.nodes.length - 4 && untouched.every((n) => canon(n) === canon(nodeIn(NEW, n.name))));
    for (const name of changed) {
        const strip = (x: any) => ({ ...x, parameters: {} });
        check(`${name}: nothing but its parameters differs (same id, type, version, position, settings)`, canon(strip(nodeIn(BASE, name))) === canon(strip(nodeIn(NEW, name))));
    }
    check('every connection and the workflow settings are unchanged', canon(NEW.connections) === canon(BASE.connections) && canon(NEW.settings) === canon(BASE.settings));

    if (rec.publishedVersionId) {
        console.log(`\nPUBLISHED (${String(rec.publishedVersionId).slice(0, 8)}) — live/ must be the tested rebuild, carried through the recorded publishes since`);
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const carried = withRecordedPublishesAfter(WF_DIR, String(rec.publishedVersionId), NEW);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const strip = (n: any) => { const c = clone(n); if (carried.added.has(c.name)) delete c.id; return c; };
        const P = new Map(pub.nodes.map((n) => [n.name, n]));
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (ids included)',
            pub.nodes.length === carried.wf.nodes.length && carried.wf.nodes.every((n) => P.has(n.name) && canon(strip(n)) === canon(strip(P.get(n.name)))));
        const cs = (w: Wf) => Object.entries(w.connections).flatMap(([f, v]: [string, any]) => (v.main || []).flatMap((arr: any[], o: number) => (arr || []).map((x) => `${f}[${o}]->${x.node}[${x.index}]`))).sort();
        // Every connection type (ai_languageModel too, not only main), each output's targets as a set; trailing empty outputs ignored.
        const allConns = (w: Wf) => canon(Object.fromEntries(Object.entries(w.connections).map(([f, v]: [string, any]) => [f, Object.fromEntries(Object.entries(v || {}).map(([t, o]: [string, any]) => {
            const outs = (o || []).map((arr: any[]) => (arr || []).map((x: unknown) => canon(x)).sort());
            while (outs.length && !outs[outs.length - 1].length) outs.pop();
            return [t, outs];
        }).filter(([, outs]) => (outs as unknown[]).length))]).filter(([, v]) => Object.keys(v as object).length)));
        check('every connection of live/ (every type) equals the tested rebuild carried through the recorded publishes', eq(cs(pub), cs(carried.wf)) && allConns(pub) === allConns(carried.wf));
        const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
        check('each replacement file still hashes to its recorded publishedSha256', rec.parameterEdits.every((e: any) => e.publishedSha256 === sha(read(e.replaceWholeValueFromFile))));
        check('the parameter set (Is Phase 2?) still hashes to its recorded publishedStructureSha256',
            Boolean(rec.publishedStructureSha256) && structureSha256(rec) === rec.publishedStructureSha256);
        check('the workflow settings are the archived base\'s, unchanged (executionOrder v1)', canon(pub.settings) === canon(BASE.settings) && pub.settings?.executionOrder === 'v1');
    }

    // ================================================================ 2. ORDER TRIPWIRES
    console.log('\nORDER TRIPWIRES — what "the first done of a phase is the real one" rests on');
    const pos = (n: string) => nodeIn(NEW, n).position as number[];
    check('executionOrder is v1 (children by canvas position, depth first)', NEW.settings?.executionOrder === 'v1');
    check('Has Match? [0] -> AI Analyze Candidate only; [1] -> Stream Batch Done only', eq(outs(NEW, 'Has Match?', 0), ['AI Analyze Candidate[0]']) && eq(outs(NEW, 'Has Match?', 1), ['Stream Batch Done[0]']));
    check('AI Analyze Candidate sits ABOVE Stream Batch Done: the accepted branch runs to the end first and the rejected rows are held back',
        pos('AI Analyze Candidate')[1] < pos('Stream Batch Done')[1], `${pos('AI Analyze Candidate')} / ${pos('Stream Batch Done')}`);
    check('candidates enter the pool only on the accepted branch: Has Match?[0] -> AI Analyze -> Apply AI -> Accumulate',
        eq(ins(NEW, 'AI Analyze Candidate'), ['Has Match?[0]']) && eq(ins(NEW, APPLY), ['AI Analyze Candidate[0]']) && eq(ins(NEW, 'Accumulate Candidate'), ['Apply AI Analysis[0]']));
    check('Split In Batches done -> Is Phase 2? only; Is Phase 2? [0] -> Finalize Phase 2 Send, [1] -> Finalize Top N Send',
        eq(outs(NEW, 'Split In Batches', 0), ['Is Phase 2?[0]']) && eq(outs(NEW, 'Is Phase 2?', 0), [`${FP2}[0]`]) && eq(outs(NEW, 'Is Phase 2?', 1), [`${FTN}[0]`]));
    check('Finalize Top N Send is reached only from Is Phase 2?[1]; Finalize Phase 2 Send from Is Phase 2?[0] and Phase 2 Found Nothing?[0]',
        eq(ins(NEW, FTN), ['Is Phase 2?[1]']) && eq(ins(NEW, FP2), ['Is Phase 2?[0]', 'Phase 2 Found Nothing?[0]']));
    {
        // Load-bearing: with the two swapped, the first done of phase 1 fires before any candidate is accumulated.
        const swapped = clone(NEW);
        const a = nodeIn(swapped, 'AI Analyze Candidate'); const s = nodeIn(swapped, 'Stream Batch Done');
        [a.position, s.position] = [s.position, a.position];
        const r = runSearch(swapped, scenario2048());
        check(`…and it is load-bearing: swap the two and the patched graph delivers ${r.sends.length} of the 14 in exec 2048 (the tripwire above guards it)`, r.sends.length < 14, String(r.sends.length));
    }

    // ================================================================ 3. EXEC 2048
    console.log('\nEXEC 2048 — the recorded shape: repeats after the real completion');
    const sc48 = scenario2048();
    const b48 = runSearch(BASE, sc48);
    const n48 = runSearch(NEW, sc48);
    {
        const r1Nodes = new Set<string>([...ec.addNodes.map((a: any) => a.name), 'Person Search Plan', 'Try Person Search?', 'Add Person Search Links']);
        check('base graph: replays the recorded 2048 runs (the empty-chain IF nodes and dark Person Search nodes aside, Limit Candidates removed)',
            eq(renumber(without(b48.trace, r1Nodes)), renumber(without(REC_2048, new Set(ec.removeNodes)))));
        check('base graph: the false "(25)" text is generated twice (Finalize Top N Send runs 1 and 2) and posted 0 times', falseEmpties(b48) === 2 && b48.completions.every((c) => c.errorMessage !== OLD_EMPTY));
        check('base graph: Finalize Phase 2 Send repeats twice with totalSent 12 (the real total is 14)',
            eq((b48.runs[FP2] || []).slice(1).map((o) => o[0][0]?.json?.totalSent), [12, 12]));
        check('base graph: one completion, 14 of 20 - the real one wins only by arriving first', b48.completions.length === 1 && b48.completions[0].totalSent === 14);
        check('patched graph: the same single completion, the same sends, the same paid calls', eq(n48.completions, b48.completions) && eq(n48.sends, b48.sends) && paid(n48) === paid(b48));
        check('patched graph: every repeat finalize run outputs nothing (Top N [12, 0, 0], Phase 2 [2, 0, 0])', eq(finalizeOutputs(n48, FTN), [12, 0, 0]) && eq(finalizeOutputs(n48, FP2), [2, 0, 0]), `${finalizeOutputs(n48, FTN)} / ${finalizeOutputs(n48, FP2)}`);
        const sid = String(sc48.body.searchId);
        check('patched graph: the send progress the guard reads is the real one at the end (2 of 2, phase 2, total 14); the base\'s was overwritten to 0 of 0',
            eq(n48.sd.hhSendProgress[sid], { expected: 2, sent: 2, phase: 2, phase1Count: 12, minTarget: 20, totalAfter: 14 })
            && b48.sd.hhSendProgress[sid].expected === 0 && b48.sd.hhSendProgress[sid].totalAfter === 12, JSON.stringify(n48.sd.hhSendProgress[sid]));
        const rest = (sd: any) => canon({ ...sd, hhFinalized: undefined, hhSendProgress: undefined });
        check('patched graph: all other static data byte-identical to the base', rest(n48.sd) === rest(b48.sd));
    }

    // ================================================================ 4. FORCED ORDER
    console.log('\nFORCED ORDER — an extra held-back run in front of the send (n8n v1 does not do this today)');
    {
        const bf = runSearch(BASE, sc48, forced(FP2));
        const nf = runSearch(NEW, sc48, forced(FP2));
        check('after Finalize Phase 2 Send: the base POSTS the false "(25)" completion and drops the real one', bf.completions.length === 1 && bf.completions[0].errorMessage === OLD_EMPTY, JSON.stringify(bf.completions));
        check('after Finalize Phase 2 Send: the patched graph posts the real completion (14 of 20) and sends the same 14', eq(nf.completions, n48.completions) && eq(nf.sends, n48.sends) && paid(nf) === paid(n48));
        const bt = runSearch(BASE, sc48, forced(FTN));
        const nt = runSearch(NEW, sc48, forced(FTN));
        const dupes = (r: Run) => r.sends.length - new Set(r.sends.map(sendKey)).size;
        console.log(`  --    after Finalize Top N Send, base: ${bt.sends.length} sends (${dupes(bt)} repeated), completion ${JSON.stringify(bt.completions.map((c) => c.totalSent ?? c.errorMessage))}`);
        check('after Finalize Top N Send: the patched graph is unmoved - same completion, same 14 sends, each once', eq(nt.completions, n48.completions) && eq(nt.sends, n48.sends) && dupes(nt) === 0);
        // Each piece, taken out, is caught by the forced order above.
        const noP1 = variant(FTN, dropMarker('p1'));
        const noP2 = variant(FP2, dropMarker('p2'));
        const m1 = runSearch(noP1, sc48, forced(FP2));
        const m2 = runSearch(noP2, sc48, forced(FP2));
        check('mutation - Finalize Top N Send without its marker: the false empty-pool completion is posted again (in its new wording)', m1.completions.length === 1 && m1.completions[0].errorMessage === NEW_EMPTY, JSON.stringify(m1.completions));
        check('mutation - Finalize Phase 2 Send without its marker: totalSent 12 is posted instead of 14', m2.completions.length === 1 && m2.completions[0].totalSent === 12, JSON.stringify(m2.completions));
        const ident = runSearch(variant(FP2, (s) => s + '\n'), sc48, forced(FP2));
        check('…while an identity change (one extra newline) still posts 14 (the harness is not simply failing)', eq(ident.completions, n48.completions));

        // THE LIMIT (in _knownLimits): an extra held-back run BEFORE a phase's last batch is processed makes the
        // first done of that phase fire on a partial pool. n8n v1 never does this (the held-back branch runs last).
        // The base then re-sends and posts a total that disagrees with what it sent; the patched graph finalizes
        // the partial pool once and reports exactly what it sent - consistent, but it can deliver fewer.
        const distinct = (r: Run) => new Set(r.sends.map(sendKey)).size;
        const consistent = (r: Run) => r.completions.length === 1 && r.completions[0].totalSent === distinct(r) && distinct(r) === r.sends.length;
        const p30: Scenario = {
            label: 'p30', body: bodyOf(), p2: ['none'],
            p1: [{ links: Array.from({ length: 15 }, (_, i) => url(`e-${i}`)) }, { links: Array.from({ length: 15 }, (_, i) => url(`e-${15 + i}`)) }],
            verdict: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`e-${i}`, i % 5 === 0 ? 'skip' : 80])),
        };
        const early: [string, Scenario, RunOpts][] = [
            ['exec 2048, held-back phase-1 rows right after phase 2\'s batch is handed out', sc48, { inject: { after: 'Split In Batches', run: 2, node: 'Stream Batch Done', items: heldBack } }],
            ['30 profiles in phase 1, batch 1\'s rejected rows right after the last batch is handed out', p30, { inject: { after: 'Split In Batches', run: 1, node: 'Stream Batch Done', items: heldBack } }],
        ];
        for (const [label, sc, opts] of early) {
            const nat = runSearch(NEW, sc);
            const be = runSearch(BASE, sc, opts); const ne = runSearch(NEW, sc, opts);
            console.log(`  --    limit, ${label}:\n          natural order ${nat.sends.length} sent; base ${be.sends.length} sends (${distinct(be)} people), posts ${JSON.stringify(be.completions.map((c) => c.totalSent))}; patched ${ne.sends.length} sends, posts ${JSON.stringify(ne.completions.map((c) => c.totalSent))}`);
            check(`limit, ${label}: the patched graph still posts exactly what it sent, nobody twice`, consistent(ne) && consistent(nat), JSON.stringify(ne.completions));
        }
    }

    // ================================================================ 5. LIFECYCLE
    console.log('\nLIFECYCLE — whole searches, base vs patched, natural and forced order');
    const links = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => url(`${prefix}-${from + i}`));
    const verdictOf = (prefix: string, scores: (number | 'skip')[]) => Object.fromEntries(scores.map((s, i) => [`${prefix}-${i}`, s]));
    const caseOf = (label: string, o: Partial<Scenario> & { p1: Resp[] }): Scenario => ({ label, body: bodyOf(), p2: ['none'], verdict: {}, ...o } as Scenario);
    const cases: { sc: Scenario; note: string; expect?: (b: Run, n: Run) => boolean }[] = [
        { note: 'phase 1 alone meets the target, over two batches (25 qualified, 5 rejected)',
            sc: caseOf('p1-only', { p1: [{ links: links('a', 15) }, { links: links('a', 15, 15) }], verdict: verdictOf('a', [...Array(25).fill(80), ...Array(5).fill('skip')]) }),
            expect: (b, n) => n.completions[0].totalSent === 25 && n.completions[0].expansionRan === false && falseEmpties(b) >= 1 },
        { note: 'exec 2036 shape: phase 1 sends 2, phase 2 finds nobody new who qualifies (a genuine __completeOnly after sends)',
            sc: caseOf('2036', { p1: [{ links: links('a', 5) }, 'none'], p2: [{ links: links('b', 4) }], verdict: { ...verdictOf('a', [90, 90, 'skip', 'skip', 'skip']), ...verdictOf('b', ['skip', 'skip', 'skip', 'skip']) } }),
            expect: (_b, n) => eq(n.completions[0], { searchId: 'headhunter_test-0001', searchComplete: true, phase1Count: 2, totalSent: 2, minTarget: 20, targetMet: false, expansionRan: true, errorMessage: 'Expanded search completed: sent 2 qualified candidate(s); target was 20.' }) },
        { note: 'empty pool: every accepted profile scores under 25, rejected rows held back, two batches (done fires repeatedly)',
            sc: caseOf('p1-empty', { p1: [{ links: links('a', 15) }, { links: links('a', 15, 15) }], verdict: verdictOf('a', Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 'skip' : 10))) }),
            expect: (b, n) => b.completions[0]?.errorMessage === OLD_EMPTY && eq(n.completions[0], { searchId: 'headhunter_test-0001', searchComplete: true, errorMessage: NEW_EMPTY }) && finalizeOutputs(b, FTN).length > 1 },
        { note: 'every phase-1 SerpAPI call failed', sc: caseOf('p1-fail', { p1: ['fail', 'fail'] }) },
        { note: 'phase 2 returns only profiles phase 1 fetched (the empty-chain close)',
            sc: caseOf('p2-fetched', { p1: [{ links: links('a', 6) }, 'none'], p2: [{ links: links('a', 6) }], verdict: verdictOf('a', [80, 80, 80, 30, 'skip', 10]) }) },
        { note: 'Tier 40: three phase-1 batches and two phase-2 batches',
            sc: caseOf('t40', { body: bodyOf({ minCandidateCount: 40 }), p1: [{ links: links('a', 15) }, { links: links('a', 15, 15) }, { links: links('a', 15, 30) }, { links: links('a', 15, 45) }],
                p2: [{ links: links('b', 20) }, { links: links('b', 20, 20) }],
                verdict: { ...verdictOf('a', Array.from({ length: 60 }, (_, i) => (i % 4 === 0 ? 'skip' : i % 5 === 0 ? 30 : 70))), ...verdictOf('b', Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 'skip' : 60))) } }),
            expect: (_b, n) => finalizeOutputs(n, FP2).length >= 1 && (n.runs['Split In Batches'] || []).length > 6 },
    ];
    for (const c of cases) {
        const b = runSearch(BASE, c.sc); const n = runSearch(NEW, c.sc);
        console.log(`  --    ${c.note}\n          base: ${b.completions.length} completion(s) ${JSON.stringify(b.completions.map((x) => x.totalSent ?? x.errorMessage))}, ${falseEmpties(b)} false "(25)" generated`);
        check(`${c.sc.label}: patched -> ONE completion, the base's (empty-pool wording aside), completion fields only`, n.completions.length === 1 && b.completions.length === 1 && eq(n.completions, b.completions.map(reword)) && completionOnly(n), JSON.stringify(n.completions));
        check(`${c.sc.label}: same sends, same paid calls, every repeat finalize run silent`, eq(n.sends, b.sends) && paid(n) === paid(b) && repeatsSilent(n));
        if (c.expect) check(`${c.sc.label}: the shape is what it claims (counts / message)`, c.expect(b, n));
        for (const after of [FTN, FP2]) {
            if (!n.runs[after]) continue;
            const nf = runSearch(NEW, c.sc, forced(after));
            check(`${c.sc.label}: a held-back run forced in after ${after} changes nothing`, eq(nf.completions, n.completions) && eq(nf.sends, n.sends) && paid(nf) === paid(n));
        }
    }

    // ================================================================ 6. PAIRING
    console.log('\nPAIRING — every answer lands on the candidate it was about');
    {
        const MAP = codeOf(NEW, 'Map Candidate Fields');
        const HAS = nodeIn(NEW, 'Has Match?');
        const APPLY_OLD = codeOf(BASE, APPLY);
        const APPLY_NEW = codeOf(NEW, APPLY);
        /** Real Map -> real Has Match? -> a model that answers about the item it got -> Apply AI (given code). */
        const pairing = (applySrc: string, slugs: string[], sc: Scenario) => {
            const body = sc.body;
            const ctx0: Ctx = { body, sd: {}, out: () => undefined, liveFallback: false };
            const mapOut = runCode({ name: 'Map Candidate Fields', parameters: {} }, slugs.map((s) => ({ json: profileOf(s, sc) })), ctx0, MAP)[0];
            const hm = runIf(HAS, mapOut, ctx0);
            const ai = hm[0].map((it) => ({ json: { text: JSON.stringify({ match_score: sc.verdict[slugOf(it.json.linkedin_url)], match_insights: [] }) } }));
            const ctx: Ctx = { body, sd: {}, liveFallback: false, out: (name, branch = 0) => (name === 'Map Candidate Fields' ? mapOut : name === 'Has Match?' ? hm[branch] : undefined) };
            const out = runCode({ name: APPLY, parameters: {} }, ai, ctx, applySrc)[0];
            const wrong = out.filter((o) => o.json.match_score !== sc.verdict[slugOf(o.json.linkedin_url)] || !o.json.name).length;
            return { wrong, total: out.length, accepted: hm[0].length, mapped: mapOut.length };
        };
        const slugs = Array.from({ length: 8 }, (_, i) => `q-${i}`);
        const base: Scenario = { label: 'pairing', body: bodyOf(), p1: [], p2: [], verdict: Object.fromEntries(slugs.map((s, i) => [s, 31 + i * 9])) };
        let newOk = 0; let oldWrongFromK1 = 0; let oldRightAtK0 = false; const rows: string[] = [];
        for (let k = 0; k < slugs.length; k++) {
            // The nameless row at position k; rows 2 and 6 are abroad (Map skips them), unless one of them is the nameless row.
            const sc: Scenario = { ...base, nameless: [slugs[k]], verdict: { ...base.verdict, ...(k !== 2 ? { 'q-2': 'skip' } : {}), ...(k !== 6 ? { 'q-6': 'skip' } : {}) } };
            const n = pairing(APPLY_NEW, slugs, sc); const o = pairing(APPLY_OLD, slugs, sc);
            if (n.wrong === 0 && n.total === n.accepted && n.accepted === slugs.length - 1 - (k !== 2 ? 1 : 0) - (k !== 6 ? 1 : 0)) newOk++;
            if (k === 0) oldRightAtK0 = o.wrong === 0;
            else if (o.wrong > 0) oldWrongFromK1++;
            rows.push(`k=${k}: base ${o.wrong}/${o.total} wrong, patched ${n.wrong}/${n.total}`);
        }
        console.log(`  --    ${rows.join('; ')}`);
        check('patched: with a nameless row at every position 0..7 (and two skipped rows), every answer lands on its own candidate', newOk === slugs.length);
        check('base: the same rows at positions 1..7 put answers on the wrong candidates (position 0 is right only by luck)', oldWrongFromK1 === slugs.length - 1 && oldRightAtK0);
        const noNameless = pairing(APPLY_OLD, slugs, { ...base, verdict: { ...base.verdict, 'q-2': 'skip' } });
        check('base and patched agree whenever no nameless row occurs (every recorded evaluation: 0 of 260 had one)', noNameless.wrong === 0 && pairing(APPLY_NEW, slugs, { ...base, verdict: { ...base.verdict, 'q-2': 'skip' } }).wrong === 0);
        const mutants: [string, string][] = [
            ['the rejected branch, .all(1)', APPLY_NEW.replace("$('Has Match?').all(0)", "$('Has Match?').all(1)")],
            ["Map Candidate Fields' whole list", APPLY_NEW.replace("$('Has Match?').all(0)", "$('Map Candidate Fields').all()")],
            ['the old last-N slice', APPLY_NEW.replace("const candidates = $('Has Match?').all(0);", "const candidates = $('Map Candidate Fields').all().filter((item) => !item.json.__skip).slice(-inputs.length);")],
        ];
        for (const [label, src] of mutants) {
            let caught = false;
            for (let k = 0; k < slugs.length && !caught; k++) {
                const sc: Scenario = { ...base, nameless: [slugs[k]], verdict: { ...base.verdict, 'q-6': 'skip' } };
                if (pairing(src, slugs, sc).wrong > 0) caught = true;
            }
            check(`mutation - pairing with ${label}: caught`, src !== APPLY_NEW && caught);
        }
        // The same through whole searches: a nameless profile third in the first batch.
        const sc: Scenario = caseOf('nameless', { p1: [{ links: links('a', 8) }, 'none'], nameless: ['a-2'], verdict: verdictOf('a', [90, 20, 70, 85, 30, 95, 'skip', 60]) });
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        const mismatched = (r: Run) => r.sends.filter((s) => s.match_score !== sc.verdict[slugOf(s.linkedin_url)]).length;
        console.log(`  --    whole search: base sends ${b.sends.length}, ${mismatched(b)} with another candidate's score; patched sends ${n.sends.length}, ${mismatched(n)}`);
        check('whole search: the patched graph sends every candidate with its own score; the base does not', mismatched(n) === 0 && n.sends.length > 0 && mismatched(b) > 0);
        // Through the engine's own $('X').all(branch): pairing with the rejected branch must change what is sent.
        const m = runSearch(variant(APPLY, (src) => src.replace("$('Has Match?').all(0)", "$('Has Match?').all(1)")), sc);
        check('whole search, mutation - pairing with .all(1): caught (the engine honours the branch index)', !eq(m.sends, n.sends), `${m.sends.length} vs ${n.sends.length}`);
    }

    // ================================================================ 7. GENERATED
    console.log('\nGENERATED SEARCHES — random searches, natural and forced order');
    {
        let seed = 20261003;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const N = 600;
        let ok1 = 0; let okSame = 0; let okSilent = 0; let forcedRuns = 0; let forcedOk = 0; let multiBatch = 0; let emptyGen = 0; let emptyPostedGenuine = 0; let emptyPostedFalse = 0;
        const baseForced: Record<string, number> = {};
        let firstBad = '';
        for (let k = 0; k < N; k++) {
            const tierN = rnd() < 0.3 ? 40 : 20;
            const people = Array.from({ length: 90 }, (_, i) => `g-${i}`);
            const mk = (): Resp => {
                const r = rnd();
                if (r < 0.08) return 'fail';
                if (r < 0.15) return 'none';
                if (r < 0.2) return { web: 1 + Math.floor(rnd() * 9) };
                return { links: Array.from({ length: Math.floor(rnd() * 22) }, () => url(pick(people), pick(['www', 'www', 'www', 'iq', 'ae']))) };
            };
            const verdict: Record<string, number | 'skip'> = {};
            for (const s of people) verdict[s] = rnd() < 0.3 ? 'skip' : Math.floor(rnd() * 101);
            const sc: Scenario = {
                label: `gen-${k}`, body: bodyOf({ searchId: `headhunter_gen-${k}`, minCandidateCount: tierN, location: rnd() < 0.85 ? 'Baghdad, Iraq' : 'Dubai, UAE' }),
                p1: Array.from({ length: 4 }, mk), p2: Array.from({ length: 3 }, mk), verdict,
            };
            const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
            // More profiles than one stream batch (20): the loop runs more than once in that phase.
            if ((n.runs['Filter New URLs'] || []).some((o) => o[0].length > 20)) multiBatch++;
            emptyGen += falseEmpties(b);
            // Posted "(25)": genuine when nobody was sent (the pool really was empty), false otherwise.
            for (const c of b.completions.filter((x) => x.errorMessage === OLD_EMPTY)) { if (b.sends.length) emptyPostedFalse++; else emptyPostedGenuine++; }
            if (n.completions.length === 1 && completionOnly(n)) ok1++; else firstBad = firstBad || `${sc.label}: ${n.completions.length} completions`;
            if (b.completions.length === 1 && eq(n.completions, b.completions.map(reword)) && eq(n.sends, b.sends) && paid(n) === paid(b)) okSame++;
            else firstBad = firstBad || `${sc.label}: differs from the base`;
            if (repeatsSilent(n)) okSilent++; else firstBad = firstBad || `${sc.label}: a repeat finalize run produced output`;
            for (const after of [FTN, FP2]) {
                if (!n.runs[after]) continue;
                forcedRuns++;
                const nf = runSearch(NEW, sc, forced(after));
                if (eq(nf.completions, n.completions) && eq(nf.sends, n.sends) && paid(nf) === paid(n)) forcedOk++;
                else firstBad = firstBad || `${sc.label}: forced after ${after} changed the outcome`;
                const bf = runSearch(BASE, sc, forced(after));
                const key = eq(bf.completions, b.completions) && eq(bf.sends, b.sends) ? 'unchanged'
                    : bf.completions.some((c) => c.errorMessage === OLD_EMPTY) && !b.completions.some((c) => c.errorMessage === OLD_EMPTY) ? 'posts the false "(25)" completion'
                        : !eq(bf.sends, b.sends) ? 'sends differ (re-sent or lost candidates)' : 'a different completion';
                baseForced[`after ${after}: ${key}`] = (baseForced[`after ${after}: ${key}`] || 0) + 1;
            }
        }
        check(`${N} searches: the patched graph posts exactly ONE completion every time, completion fields only`, ok1 === N, firstBad);
        check(`${N} searches: completion, sends and paid calls identical to the base (empty-pool wording aside)`, okSame === N, firstBad);
        check(`${N} searches: every repeat finalize run outputs nothing`, okSilent === N, firstBad);
        check(`${forcedRuns} forced orders (a held-back run after each finalize node's first run): the patched outcome never moves`, forcedOk === forcedRuns && forcedRuns > N, firstBad);
        check(`coverage: ${multiBatch} searches ran more than one batch through the loop`, multiBatch > 100, String(multiBatch));
        check(`base graph, natural order: the "(25)" text was generated ${emptyGen} times, posted ${emptyPostedGenuine} times as the genuine empty-pool completion and never after a send`, emptyPostedFalse === 0 && emptyGen > emptyPostedGenuine, String(emptyPostedFalse));
        console.log('        base graph, the same forced orders:');
        for (const [key, v] of Object.entries(baseForced).sort((x, y) => y[1] - x[1])) console.log(`          ${String(v).padStart(4)}  ${key}`);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
