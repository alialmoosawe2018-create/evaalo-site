/**
 * headhunter-empty-chain-close-test
 *
 * An empty candidate chain must still close the search: exactly one completion, the
 * correct one, and nothing more paid for (published 2026-10-02 as n8n version 3164bf87;
 * rollback b0a763c1).
 *
 * The defect (n8n 2.25.6, workflow-execute.js: a child is scheduled only when its
 * parent's output is non-empty). Between Merge Serp Results and Split In Batches any
 * step can hand on an empty list - Split Out on no organic results, Filter LinkedIn
 * URLs with no /in/ link, Filter New URLs dropping every profile (already fetched, or
 * on a foreign LinkedIn subdomain) - and then nothing downstream runs. Exec 2057 shows
 * it on the live engine: phase 2's Filter New URLs output 0 items, the execution ended
 * "success", and Complete Search never ran.
 *
 * The patch (pending/headhunter-empty-chain-close.*):
 *   - Merge Serp Results closes a PHASE-2 run with no LinkedIn profile at all;
 *   - Filter New URLs hands on one control item instead of an empty list;
 *   - Nothing To Enrich? routes that item around the paid enrichment loop, and
 *     Phase 2 Found Nothing? sends phase-2 closes to Finalize Phase 2 Send (which
 *     reports the phase-1 totals) and phase-1 closes to Prepare Complete Search;
 *   - Limit Candidates, which never capped anything (its maxItems expression is
 *     undefined), is removed: Nothing To Enrich?[1] feeds Split In Batches directly.
 *
 * How it is proven, all offline and on synthetic data (the repository is public):
 *   1. PATCH / GRAPH - the patch applies to live/ and touches nothing else.
 *   2. ENGINE FIDELITY - a small n8n v1 engine, modelled from the server's n8n source
 *      (scheduling order, Split In Batches v3, IF filters, Split Out, Limit, expression
 *      errors), runs the REAL code of every Code node. Before it is trusted it must
 *      reproduce, run for run, the recorded traces of executions 2048 (a full phase 2
 *      with its stray done firings) and 2057 (the stall).
 *   3. NODES - the two edited nodes against the live code over generated inputs: the
 *      non-empty output and static data byte-identical, the empty case one control item.
 *   4. LIFECYCLE - whole searches through both graphs: every empty-chain shape closes
 *      exactly once with the right body; nothing extra is paid for.
 *   5. GENERATED SEARCHES - hundreds of random searches through both graphs.
 *
 * Run: npm run test:headhunter-empty-chain-close
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyPatch, bodyOf, canon, REC_2048, scenario2048, clone, closeFired, completionOnly, eq, multisetSubset, renumber, runCode, runSearch,
    runSplitOut, sendKey, serpItem, slugOf, url, without,
    type Ctx, type Item, type Resp, type Scenario, type Wf,
} from './lib/headhunterWorkflowEngine.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const patch = JSON.parse(readFileSync(join(PENDING, 'headhunter-empty-chain-close.patch.json'), 'utf8'));

// One frozen clock: Merge Serp Results, Filter New URLs and Person Search stamp static data with it.
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
Date.now = () => NOW;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const live: Wf = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const liveCode = (name: string) => String(live.nodes.find((n) => n.name === name)?.parameters?.jsCode ?? '');

const OLD = live;
const NEW = applyPatch(live, patch, PENDING);
// The engine-fidelity replays run on the version that produced each recorded trace, so they
// stay valid whatever is published later. 2048 ran df1b0a66 (the page2-off-tier40 record: Tier
// 20 proven live in 2048, then ae589a3d published); 2057 was the smoke test on the Person
// Search draft, byte-matched to a2b5cbec before it was published (the person-search record).
const archived = (v: string, what: string): Wf => JSON.parse(readFileSync(join(WF_DIR, 'archive', `headhunter--AI_Head_hunter--${v}-before-${what}.json`), 'utf8'));
const RAN_2048 = archived('df1b0a66', 'page2-off-tier40');
const RAN_2057 = archived('a2b5cbec', 'position-titles');
const nodeIn = (wf: Wf, name: string) => wf.nodes.find((n) => n.name === name);
const outs = (wf: Wf, name: string, o = 0) => ((wf.connections[name]?.main?.[o]) || []).map((c: any) => `${c.node}[${c.index}]`).sort();
const ins = (wf: Wf, name: string) => Object.entries(wf.connections).flatMap(([f, c]: [string, any]) =>
    (c.main || []).flatMap((arr: any[], o: number) => (arr || []).filter((x) => x.node === name).map(() => `${f}[${o}]`))).sort();
const NEW_NODES = new Set<string>(patch.addNodes.map((a: any) => a.name));
const DROPPED = new Set<string>(patch.removeNodes || []);
// The same node runs, once the new IF nodes and the removed pass-through Limit Candidates are left out.
const sameRuns = (n: { trace: string[] }, o: { trace: string[] }) => eq(renumber(without(n.trace, NEW_NODES)), renumber(without(o.trace, DROPPED)));

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — an empty candidate chain closes the search (pending, base ${String(patch.baseVersionId).slice(0, 8)})`);
    console.log('='.repeat(96));

    // ================================================================ 1. PATCH / GRAPH
    console.log('\nPATCH');
    check(`patch base is the version in ${String(patch.baseFile).startsWith('archive/') ? 'its archive (published since)' : 'live/'} (${String(patch.baseVersionId).slice(0, 8)}, ${patch.baseNodeCount} nodes)`, live.versionId === patch.baseVersionId && live.nodes.length === patch.baseNodeCount, `${live.versionId} / ${live.nodes.length}`);
    for (const e of patch.parameterEdits) {
        const before = liveCode(e.node);
        const after = read(e.replaceWholeValueFromFile);
        check(`${e.node}: live has what this replaces`, before.includes(e.expectBeforeContains));
        check(`${e.node}: the replacement carries the change`, after.includes(e.expectAfterContains));
        check(`${e.node}: each removed line exists in live and is gone from the replacement`, e.removedLines.every((l: string) => before.split('\n').includes(l) && !after.split('\n').includes(l)));
        const a = after.split('\n');
        let j = 0; const lost: string[] = [];
        for (const line of before.split('\n')) {
            if (e.removedLines.includes(line)) continue;
            while (j < a.length && a[j] !== line) j++;
            if (j >= a.length) { lost.push(line); j = 0; continue; }
            j++;
        }
        check(`${e.node}: every other line is kept, in order`, lost.length === 0, lost.slice(0, 2).join(' | '));
        const nonAscii = (s: string) => [...new Set([...s].filter((c) => c.charCodeAt(0) > 127))].sort().join('');
        check(`${e.node}: no new non-ASCII character (the additions are ASCII)`, nonAscii(after) === nonAscii(before), nonAscii(after));
        check(`${e.node}: LF line endings, trailing newline as in live`, !after.includes('\r') && after.endsWith('\n') === before.endsWith('\n'));
    }

    console.log('\nGRAPH');
    check('51 nodes after the patch (two added, Limit Candidates removed)', NEW.nodes.length === 51, String(NEW.nodes.length));
    const edited = new Set(patch.parameterEdits.map((e: any) => e.node));
    const untouched = live.nodes.filter((n) => !edited.has(n.name) && !DROPPED.has(n.name));
    check('the 47 untouched nodes are byte-identical (positions included)', untouched.length === 47 && untouched.every((n) => canon(n) === canon(nodeIn(NEW, n.name))));
    check('removed: exactly Limit Candidates, as recorded, and gone from the graph', eq([...DROPPED], ['Limit Candidates']) && canon(patch.removeNodesExpect) === canon([nodeIn(live, 'Limit Candidates')]) && !nodeIn(NEW, 'Limit Candidates')
        && !JSON.stringify(NEW.connections).includes('Limit Candidates'));
    const limitExpr = String(nodeIn(live, 'Limit Candidates').parameters.maxItems);
    check('…a node whose only parameter is a maxItems expression that calls $getWorkflowStaticData (undefined in expressions: it capped nothing)',
        eq(Object.keys(nodeIn(live, 'Limit Candidates').parameters), ['maxItems']) && limitExpr.startsWith('={{ ($getWorkflowStaticData(') && nodeIn(live, 'Limit Candidates').type === 'n8n-nodes-base.limit');
    check('…and no node reads it by name (only comments mention it)', live.nodes.every((n) => !/\$\(\s*\?['"]Limit Candidates/.test(JSON.stringify(n.parameters))));
    for (const name of edited) {
        const l = nodeIn(live, name as string); const n = nodeIn(NEW, name as string);
        check(`${name}: only its jsCode differs`, canon({ ...l, parameters: {} }) === canon({ ...n, parameters: {} }) && Object.keys(l.parameters).join() === 'jsCode');
    }
    for (const a of patch.addNodes) {
        const n = nodeIn(NEW, a.name);
        const conds = n.parameters.conditions;
        check(`${a.name}: IF 2.2, strict, one boolean condition on $json only`, n.type === 'n8n-nodes-base.if' && n.typeVersion === 2.2 && conds.options.typeValidation === 'strict'
            && conds.conditions.length === 1 && conds.conditions[0].operator.type === 'boolean' && conds.conditions[0].operator.operation === 'true'
            && !JSON.stringify(n.parameters).includes('$getWorkflowStaticData') && !JSON.stringify(n.parameters).includes('$(') && !n.disabled && !n.alwaysOutputData);
        check(`${a.name}: name was free in live/`, !nodeIn(live, a.name));
    }
    check('Nothing To Enrich? tests exactly `$json.__nothingToEnrich === true`', nodeIn(NEW, 'Nothing To Enrich?').parameters.conditions.conditions[0].leftValue === '={{ $json.__nothingToEnrich === true }}');
    check('Phase 2 Found Nothing? tests exactly both markers', nodeIn(NEW, 'Phase 2 Found Nothing?').parameters.conditions.conditions[0].leftValue === '={{ $json.__nothingToEnrich === true && $json.__phase2 === true }}');
    const expectOut: [string, number, string[]][] = [
        ['Filter New URLs', 0, ['Nothing To Enrich?[0]']],
        ['Nothing To Enrich?', 0, ['Phase 2 Found Nothing?[0]']],
        ['Nothing To Enrich?', 1, ['Split In Batches[0]']],
        ['All Serp Pages Failed?', 0, ['Phase 2 Found Nothing?[0]']],
        ['All Serp Pages Failed?', 1, ['Split Out[0]']],
        ['Phase 2 Found Nothing?', 0, ['Finalize Phase 2 Send[0]']],
        ['Phase 2 Found Nothing?', 1, ['Prepare Complete Search[0]']],
    ];
    for (const [n, o, want] of expectOut) check(`${n}[${o}] -> ${want.join(', ')}`, eq(outs(NEW, n, o), want), outs(NEW, n, o).join(', '));
    check('Split In Batches is fed by Nothing To Enrich?[1] (where Limit Candidates was) and Stream Batch Done: the paid loop sees no control item',
        eq(ins(NEW, 'Split In Batches'), ['Nothing To Enrich?[1]', 'Stream Batch Done[0]']) && eq(ins(OLD, 'Split In Batches'), ['Limit Candidates[0]', 'Stream Batch Done[0]']), ins(NEW, 'Split In Batches').join(', '));
    check('Finalize Phase 2 Send: fed by Is Phase 2?[0] and Phase 2 Found Nothing?[0]', eq(ins(NEW, 'Finalize Phase 2 Send'), ['Is Phase 2?[0]', 'Phase 2 Found Nothing?[0]']), ins(NEW, 'Finalize Phase 2 Send').join(', '));
    check('Prepare Complete Search: fed by its two old sources plus Phase 2 Found Nothing?[1] (instead of All Serp Pages Failed?[0])',
        eq(ins(NEW, 'Prepare Complete Search'), ['Complete Search Now?[0]', 'Has Final Candidates?[1]', 'Phase 2 Found Nothing?[1]']), ins(NEW, 'Prepare Complete Search').join(', '));
    const others = (w: Wf) => canon(Object.fromEntries(Object.entries(w.connections).filter(([k]) => !['Filter New URLs', 'All Serp Pages Failed?'].includes(k) && !NEW_NODES.has(k) && !DROPPED.has(k))));
    check('every other connection is unchanged', others(OLD) === others(NEW));
    check('every main connection targets input 0: no node waits for a second input, each emission runs its target once', (Object.values(NEW.connections) as any[]).every((c) => (c.main || []).every((arr: any[]) => (arr || []).every((x) => x.index === 0))));
    const seen = new Set<string>(['Webhook']); const queue = ['Webhook'];
    while (queue.length) { const x = queue.shift() as string; for (const arr of (NEW.connections[x]?.main || [])) for (const c of (arr || [])) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); } }
    check('both new nodes are reachable from the Webhook', [...NEW_NODES].every((n) => seen.has(n)));

    if (patch.publishedVersionId) {
        console.log(`\nPUBLISHED (${String(patch.publishedVersionId).slice(0, 8)}) — live/ must be the tested rebuild, carried through the recorded publishes since`);
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const carried = withRecordedPublishesAfter(WF_DIR, String(patch.publishedVersionId), NEW);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const strip = (n: any) => { const c = clone(n); if (NEW_NODES.has(c.name) || carried.added.has(c.name)) delete c.id; return c; };
        const P = new Map(pub.nodes.map((n) => [n.name, n]));
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (new-node ids aside)',
            pub.nodes.length === carried.wf.nodes.length && carried.wf.nodes.every((n) => P.has(n.name) && canon(strip(n)) === canon(strip(P.get(n.name)))));
        const ids = patch.publishedNodeIds || {};
        check('the two new nodes carry the ids n8n gave them at publish (recorded in publishedNodeIds)', [...NEW_NODES].every((n) => Boolean(ids[n]) && P.get(n)?.id === ids[n]));
        const cs = (w: Wf) => Object.entries(w.connections).flatMap(([f, v]: [string, any]) => (v.main || []).flatMap((arr: any[], o: number) => (arr || []).map((x) => `${f}[${o}]->${x.node}[${x.index}]`))).sort();
        // Every connection type (ai_languageModel too, not only main), each output's targets as a set; trailing empty outputs ignored.
        const allConns = (w: Wf) => canon(Object.fromEntries(Object.entries(w.connections).map(([f, v]: [string, any]) => [f, Object.fromEntries(Object.entries(v || {}).map(([t, o]: [string, any]) => {
            const outs = (o || []).map((arr: any[]) => (arr || []).map((x: unknown) => canon(x)).sort());
            while (outs.length && !outs[outs.length - 1].length) outs.pop();
            return [t, outs];
        }).filter(([, outs]) => (outs as unknown[]).length))]).filter(([, v]) => Object.keys(v as object).length)));
        check('every connection of live/ (every type) equals the tested rebuild carried through the recorded publishes', eq(cs(pub), cs(carried.wf)) && allConns(pub) === allConns(carried.wf));
        const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
        check('each replacement file still hashes to its recorded publishedSha256', patch.parameterEdits.every((e: any) => e.publishedSha256 === sha(read(e.replaceWholeValueFromFile))));
        check('the graph section (nodes added/removed, connections) still hashes to its recorded publishedStructureSha256',
            Boolean(patch.publishedStructureSha256) && structureSha256(patch) === patch.publishedStructureSha256);
        check('the workflow settings (executionOrder v1 ...) are the archived base\'s, unchanged', canon(pub.settings) === canon(live.settings) && pub.settings?.executionOrder === 'v1');
    }

    // ================================================================ 2. ENGINE FIDELITY
    console.log('\nENGINE FIDELITY — the model must replay real executions run for run');
    {
        const sc = scenario2048();
        const ran = runSearch(RAN_2048, sc);
        const got = ran.trace;
        const firstDiff = got.findIndex((t, i) => t !== REC_2048[i]);
        check(`exec 2048 on df1b0a66: the engine reproduces all ${REC_2048.length} recorded node runs, in order, with their output counts`, eq(got, REC_2048), firstDiff >= 0 ? `#${firstDiff}: ${got[firstDiff]} vs ${REC_2048[firstDiff]}` : `${got.length} vs ${REC_2048.length}`);
        const scores = (ran.runs['Accumulate Candidate'] || []).map((o) => o[0].map((i) => i.json.score));
        check('…harness self-check: Apply AI Analysis (real code) passed the scenario\'s scores to Accumulate', eq(scores, [[100, 100, 100, 100, 100, 100, 100, 68, 54, 100, 100, 100], [46, 100, 68]]), JSON.stringify(scores));
        check('…and one completion: 12 + 2 sent, target 20', ran.completions.length === 1 && ran.completions[0].totalSent === 14 && ran.completions[0].phase1Count === 12, JSON.stringify(ran.completions));
        // The base (live) graph runs the same search the same way, its dark Person Search nodes passing through.
        const r = runSearch(OLD, sc);
        check('the base graph runs the same search the same way (its dark Person Search nodes left out)',
            eq(renumber(without(r.trace, new Set(['Person Search Plan', 'Try Person Search?', 'Add Person Search Links']))), REC_2048) && eq(r.completions, ran.completions) && eq(r.sends, ran.sends));
        const n = runSearch(NEW, sc);
        check('patched graph, same search: the same runs once the two new IF nodes and the removed Limit Candidates are left out', sameRuns(n, r));
        check('…same completion, sends, SerpAPI calls, EnrichLayer calls and static data, byte for byte',
            eq(n.completions, r.completions) && eq(n.sends, r.sends) && eq(n.serpCalls, r.serpCalls) && eq(n.enriched, r.enriched) && canon(n.sd) === canon(r.sd));
    }
    let rec2057: Scenario;
    {
        // Exec 2057 (2026-10-01, a2b5cbec, pinned smoke test): Google, EnrichLayer, the model and the
        // send were pinned, so phase 2 got back the profiles phase 1 had already fetched (plus one
        // on a foreign subdomain).
        const PIN = [url('s-0'), url('s-1'), url('s-2'), url('s-3'), url('s-4', 'ae')];
        rec2057 = { label: '2057', body: bodyOf({ searchId: 'headhunter_test-2057' }), p1: [], p2: [], verdict: { 's-0': 77, 's-1': 77, 's-2': 77 }, pinned: { google: [{ links: PIN }, 'none'], enrich: ['s-0', 's-1', 's-2'], ai: [77, 77, 77] } };
        const REC_2057 = [
            'Validate Search Input#0 [1]', 'Validate Callback URL#0 [1]', 'Input Valid#0 [1/0]', 'Resolve Search Tier#0 [1]', 'Needs Translation?#0 [0/1]', 'Apply Translation#0 [1]',
            'Person Search Plan#0 [1]', 'Try Person Search?#0 [0/1]', 'Build Search Query#0 [1]', 'Expand Search Queries#0 [2]', 'Prepare Serp Pages#0 [2]', 'Google SerpAPI Search#0 [2]',
            'Merge Serp Results#0 [1]', 'All Serp Pages Failed?#0 [0/1]', 'Split Out#0 [5]', 'Filter LinkedIn URLs#0 [5]', 'Add Person Search Links#0 [5]', 'Filter New URLs#0 [4]',
            'Limit Candidates#0 [4]', 'Split In Batches#0 [0/4]', 'Enrichlayer Profile Fetch#0 [3]', 'Count Enrich Batch#0 [3]', 'Map Candidate Fields#0 [3]', 'Has Match?#0 [3/0]',
            'AI Analyze Candidate#0 [3]', 'Apply AI Analysis#0 [3]', 'Accumulate Candidate#0 [3]', 'Stream Batch Done#0 [3]', 'Split In Batches#1 [3/0]', 'Is Phase 2?#0 [0/3]',
            'Finalize Top N Send#0 [3]', 'Has Final Candidates?#0 [3/0]', 'Send Candidate to Evaalo#0 [3]', 'Track Send Progress#0 [1]', 'Start Phase 2?#0 [1/0]', 'Expand Phase 2 Queries#0 [2]',
            'Prepare Serp Pages#1 [2]', 'Google SerpAPI Search#1 [2]', 'Merge Serp Results#1 [1]', 'All Serp Pages Failed?#1 [0/1]', 'Split Out#1 [5]', 'Filter LinkedIn URLs#1 [5]',
            'Add Person Search Links#1 [5]', 'Filter New URLs#1 [0]',
        ];
        const ran = runSearch(RAN_2057, rec2057);
        const firstDiff = ran.trace.findIndex((t, i) => t !== REC_2057[i]);
        check(`exec 2057 on a2b5cbec: the engine reproduces the real stall, all ${REC_2057.length} node runs, ending at Filter New URLs [0]`, eq(ran.trace, REC_2057), firstDiff >= 0 ? `#${firstDiff}: ${ran.trace[firstDiff]} vs ${REC_2057[firstDiff]}` : `${ran.trace.length} vs ${REC_2057.length}`);
        check('…and, as in production, no completion at all', ran.completions.length === 0);
        const r = runSearch(OLD, rec2057);
        check('the base graph stalls the same way: same runs, no completion', eq(r.trace, REC_2057) && r.completions.length === 0);
        const n = runSearch(NEW, rec2057);
        check('patched graph, same pinned search: exactly ONE completion', n.completions.length === 1, String(n.completions.length));
        check('…carrying the phase-1 totals the way Finalize Phase 2 Send reports them',
            eq(n.completions[0], { searchId: 'headhunter_test-2057', searchComplete: true, phase1Count: 3, totalSent: 3, minTarget: 20, targetMet: false, expansionRan: true, errorMessage: 'Expanded search completed: sent 3 qualified candidate(s); target was 20.' }), JSON.stringify(n.completions[0]));
        check('…by the route Filter New URLs -> Nothing To Enrich? -> Phase 2 Found Nothing? -> Finalize Phase 2 Send -> Has Final Candidates? -> Prepare Complete Search -> Complete Search',
            eq(n.trace.slice(-7), ['Filter New URLs#1 [1]', 'Nothing To Enrich?#1 [1/0]', 'Phase 2 Found Nothing?#0 [1/0]', 'Finalize Phase 2 Send#0 [1]', 'Has Final Candidates?#1 [0/1]', 'Prepare Complete Search#0 [1]', 'Complete Search#0 [1]']), n.trace.slice(-7).join(' > '));
        check('…paying for nothing more: same SerpAPI calls, same EnrichLayer calls, same 3 sends', eq(n.serpCalls, r.serpCalls) && eq(n.enriched, r.enriched) && eq(n.sends, r.sends));
    }

    // ================================================================ 3. NODES
    console.log('\nNODES — the two edited nodes against the live code');
    const MERGE_OLD = liveCode('Merge Serp Results');
    const MERGE_NEW = read('headhunter-empty-chain-close.merge-serp.node.js');
    const FNU_OLD = liveCode('Filter New URLs');
    const FNU_NEW = read('headhunter-empty-chain-close.filter-new-urls.node.js');
    const FLI = liveCode('Filter LinkedIn URLs');
    let seed = 20261002;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const nodeCtx = (sd: any, body: any, extra: Record<string, Item[]> = {}): Ctx => ({ body, sd, out: (n) => extra[n], liveFallback: false });
    const runNode = (src: string, items: Item[], sd: any, body: any, extra: Record<string, Item[]> = {}) => runCode({ name: 'node', parameters: {} }, items, nodeCtx(sd, body, extra), src)[0];
    {
        // Merge Serp Results over generated SerpAPI batches, both phases.
        let same = 0; let cases = 0; let closes = 0; let agree = 0; let mismatch = ''; let closeBad = '';
        for (let k = 0; k < 3000; k++) {
            const phase2 = k % 2 === 1;
            const calls = 1 + Math.floor(rnd() * 3);
            const prepared: Item[] = []; const serp: Item[] = [];
            for (let c = 0; c < calls; c++) {
                const q = `q${c}`;
                prepared.push({ json: { q, start: 0, __phase2: phase2 } });
                const kind = pick(['links', 'links', 'web', 'mixed', 'none', 'fail', 'empty']);
                const links = Array.from({ length: Math.floor(rnd() * 6) }, () => url(`m-${Math.floor(rnd() * 12)}`, pick(['www', 'www', 'iq', 'ae'])));
                if (kind === 'none') serp.push(serpItem('none', q, 0));
                else if (kind === 'fail') serp.push(serpItem('fail', q, 0));
                else if (kind === 'empty') serp.push(serpItem({ links: [] }, q, 0));
                else if (kind === 'web') serp.push(serpItem({ web: 1 + Math.floor(rnd() * 5) }, q, 0));
                else if (kind === 'mixed') serp.push(serpItem({ links, web: 2 }, q, 0));
                else serp.push(serpItem({ links }, q, 0));
            }
            const body = bodyOf();
            const sdBase = phase2 ? { hhPhase2: { [body.searchId]: { maxEnrich: 20 } } } : {};
            const sdO: any = clone(sdBase); const sdN: any = clone(sdBase);
            const o = runNode(MERGE_OLD, serp, sdO, body, { 'Prepare Serp Pages': prepared });
            const n = runNode(MERGE_NEW, serp, sdN, body, { 'Prepare Serp Pages': prepared });
            // What Filter LinkedIn URLs (live code) would pass on after Split Out, on the live Merge output.
            const flOut = o[0].json.__completeOnly ? null : runNode(FLI, runSplitOut({ parameters: { fieldToSplitOut: 'organic_results' } }, o)[0], {}, body);
            const isClose = n.length === 1 && n[0].json.__nothingToEnrich === true;
            if (isClose) closes++;
            if (!isClose) { cases++; if (eq(o, n) && canon(sdO) === canon(sdN)) same++; else if (!mismatch) mismatch = `case ${k}`; }
            // The close fires exactly when phase 2 would otherwise hand Split Out / Filter LinkedIn URLs nothing.
            const wouldStall = phase2 && flOut !== null && flOut.length === 0;
            if (isClose === wouldStall) agree++;
            if (isClose && !(phase2 && eq(n[0].json, { __completeOnly: true, __nothingToEnrich: true, __phase2: true, serpStats: o[0].json.serpStats }) && canon(sdO) === canon(sdN))) closeBad = closeBad || `close ${k}: ${JSON.stringify(n[0].json).slice(0, 160)}`;
        }
        check(`Merge: in ${cases} generated batches that do not close, output and static data are byte-identical to live`, same === cases, mismatch);
        check(`Merge: it closes (${closes} batches) exactly when live phase 2 would hand Filter LinkedIn URLs (real code) an empty list — 3000/3000 agree`, agree === 3000, String(agree));
        check('Merge: the close is phase 2 only, carries the live serpStats, and leaves static data as live does', !closeBad && closes > 100, closeBad || String(closes));
    }
    {
        // Filter New URLs over generated profile lists.
        let same = 0; let cases = 0; let closes = 0; let bad = '';
        for (let k = 0; k < 4000; k++) {
            const phase2 = rnd() < 0.5;
            const iraq = rnd() < 0.8;
            const body = bodyOf({ location: iraq ? pick(['Baghdad, Iraq', 'Erbil, Iraq', 'بغداد']) : 'Dubai, UAE', minCandidateCount: pick([20, 40]) });
            const tier = body.minCandidateCount === 40 ? { minCount: 40, maxEnrich: 55 } : { minCount: 20, maxEnrich: 35 };
            const fetched = Array.from({ length: Math.floor(rnd() * 8) }, () => `f-${Math.floor(rnd() * 10)}`);
            const sdBase: any = { hhFetched: { [body.searchId]: { at: NOW - 1000, slugs: fetched } } };
            if (phase2) sdBase.hhPhase2 = { [body.searchId]: { maxEnrich: tier.minCount } };
            if (rnd() < 0.3) sdBase.hhSpend = { [body.searchId]: { ceiling: 120, spent: Math.floor(rnd() * 130), at: NOW } };
            if (rnd() < 0.2) sdBase.hhSeenUrls = { [body.searchId]: [url('f-1').toLowerCase()] };
            const n = Math.floor(rnd() * 10) + 1;
            const input: Item[] = Array.from({ length: n }, () => {
                const r = rnd();
                const link = r < 0.4 ? url(`f-${Math.floor(rnd() * 10)}`, pick(['www', 'iq'])) : r < 0.6 ? url(`x-${Math.floor(rnd() * 30)}`, pick(['ae', 'eg', 'qa', 'sy', 'in'])) : r < 0.65 ? 'https://www.linkedin.com/in/?trk=x' : url(`n-${Math.floor(rnd() * 30)}`, pick(['www', 'iq']));
                return { json: rnd() < 0.2 ? { link, __ps: true } : { link, title: 'x' } };
            });
            const sdO = clone(sdBase); const sdN = clone(sdBase);
            const extra = { 'Resolve Search Tier': [{ json: tier }] };
            const o = runNode(FNU_OLD, input, sdO, body, extra);
            const nw = runNode(FNU_NEW, input, sdN, body, extra);
            if (o.length) { cases++; if (eq(o, nw) && canon(sdO) === canon(sdN)) same++; else bad = bad || `case ${k}`; continue; }
            closes++;
            const c = nw.length === 1 ? nw[0].json : {};
            const okShape = nw.length === 1 && c.__completeOnly === true && c.__nothingToEnrich === true && c.__phase2 === phase2 && c.received === n && canon(sdO) === canon(sdN);
            const allForeign = input.every((i) => /^https:\/\/(ae|eg|qa|in)\./.test(i.json.link));
            const okMsg = phase2
                ? (c.errorMessage === undefined && c.searchFailed === undefined)
                : c.searchFailed === false && c.errorMessage === (iraq && allForeign
                    ? `No candidates found in Iraq: all ${n} LinkedIn profile(s) the search returned are on LinkedIn sites of other countries.`
                    : `No candidates found: none of the ${n} LinkedIn profile(s) the search returned could be evaluated.`);
            if (!okShape || !okMsg) bad = bad || `close ${k}: ${JSON.stringify(c)}`;
        }
        check(`Filter New URLs: in ${cases} generated lists with something to enrich, output and static data are byte-identical to live`, same === cases && !bad, bad);
        check(`Filter New URLs: in ${closes} generated empty results, ONE control item with the right phase, count and message, static data as live`, closes > 200 && !bad, bad);
    }

    {
        // Billing rests on this: Finalize Phase 2 Send reached with NO new candidate sends nobody.
        // Phase 1's Finalize Top N Send (expansion branch) leaves the pool and records what it sent;
        // the same ranking over the same pool picks the same people, all already sent.
        const FTN = liveCode('Finalize Top N Send'); const FP2 = liveCode('Finalize Phase 2 Send');
        let ok = 0; let tried = 0; let bad = '';
        for (let k = 0; k < 3000; k++) {
            const body = bodyOf({ location: pick(['Baghdad, Iraq', 'Erbil, Iraq', 'Dubai, UAE']), minCandidateCount: pick([20, 40]) });
            const tier = body.minCandidateCount === 40 ? { minCount: 40 } : { minCount: 20 };
            const n = Math.floor(rnd() * 30);
            const pool = Array.from({ length: n }, () => {
                const id = Math.floor(rnd() * 40);
                return { name: `Synthetic ${id}`, match_score: 25 + Math.floor(rnd() * 76), location: pick(['Baghdad, Iraq', 'Basra, Iraq', 'Dubai, United Arab Emirates', 'Texas, United States', '']), location_priority: pick([0, 1]), ...(rnd() < 0.9 ? { linkedin_url: url(`f-${id}`, pick(['www', 'iq'])) + pick(['', '?trk=x']) } : {}) };
            });
            const sd: any = { hhStats: { [body.searchId]: { enrichOk: n, enrichErr: 0 } }, hhCandidates: { [body.searchId]: pool } };
            const extra = { 'Resolve Search Tier': [{ json: tier }] };
            const first = runNode(FTN, [{ json: { batchDone: true } }], sd, body, extra);
            if (!sd.hhExpansionPending?.[body.searchId] || first[0]?.json?.__completeOnly) continue; // phase 2 starts only after a send
            tried++;
            sd.hhPhase2 = { [body.searchId]: { maxEnrich: tier.minCount } };
            const second = runNode(FP2, [{ json: { __nothingToEnrich: true, __phase2: true } }], sd, body, extra);
            if (second.length === 1 && second[0].json.__completeOnly === true && second[0].json.totalSent === first.length && sd.hhSendProgress[body.searchId].expected === 0) ok++;
            else bad = bad || `case ${k}: ${JSON.stringify(second.map((i) => i.json.name || i.json.totalSent))}`;
        }
        check(`Finalize Phase 2 Send with no new candidate: sends nobody and reports the phase-1 count (${tried} generated phase-1 pools)`, ok === tried && tried > 1000, bad);
    }

    // ================================================================ 4. LIFECYCLE
    console.log('\nLIFECYCLE — whole searches, live graph vs patched graph');
    const phase1 = (n: number, from = 0, sub = 'www') => Array.from({ length: n }, (_, i) => url(`a-${from + i}`, sub));
    const scores = (o: Record<string, number | 'skip'>) => o;
    function caseOf(label: string, o: Partial<Scenario> & { p1: Resp[]; p2?: Resp[] }): Scenario {
        return { label, body: bodyOf(), p2: ['none'], verdict: {}, ...o } as Scenario;
    }
    // Phase 1: 6 profiles, 3 qualified (80), one weak (30), one abroad (skip), one rejected (10) -> 3 sent of 20.
    const V1 = scores({ 'a-0': 80, 'a-1': 80, 'a-2': 80, 'a-3': 30, 'a-4': 'skip', 'a-5': 10 });
    const P1OK: Resp[] = [{ links: phase1(6) }, 'none'];
    const expectP2 = (sent: number, target = 20, id = 'headhunter_test-0001') => ({ searchId: id, searchComplete: true, phase1Count: sent, totalSent: sent, minTarget: target, targetMet: sent >= target, expansionRan: true, errorMessage: `Expanded search completed: sent ${sent} qualified candidate(s); target was ${target}.` });
    // The reference: what Finalize Phase 2 Send reports TODAY when phase 2 enriches new people who all fail.
    const ref = runSearch(OLD, caseOf('reference', { p1: P1OK, p2: [{ links: [url('b-0'), url('b-1')] }], verdict: { ...V1, 'b-0': 10, 'b-1': 'skip' } }));
    check('reference (live graph): phase 2 finds 2 new people, neither qualifies -> one completion with the phase-1 totals', ref.completions.length === 1 && eq(ref.completions[0], expectP2(3)), JSON.stringify(ref.completions));
    type L = { label: string; sc: Scenario; want: any; oldLast?: string };
    const lifecycle: L[] = [
        { label: 'phase 2 returns only profiles phase 1 already fetched', sc: caseOf('p2-fetched', { p1: P1OK, p2: [{ links: phase1(6) }, { links: phase1(3) }], verdict: V1 }), want: expectP2(3), oldLast: 'Filter New URLs' },
        { label: 'every phase-2 SerpAPI call failed (503)', sc: caseOf('p2-fail', { p1: P1OK, p2: ['fail', 'fail'], verdict: V1 }), want: expectP2(3), oldLast: 'Split Out' },
        { label: 'Google answered "no results" to every phase-2 query', sc: caseOf('p2-none', { p1: P1OK, p2: ['none', 'none'], verdict: V1 }), want: expectP2(3), oldLast: 'Split Out' },
        { label: 'phase 2: Google ignored site: (job boards only, no /in/ link)', sc: caseOf('p2-web', { p1: P1OK, p2: [{ web: 10 }, { web: 4 }], verdict: V1 }), want: expectP2(3), oldLast: 'Filter LinkedIn URLs' },
        { label: 'phase 2: only foreign LinkedIn subdomains on an Iraq search', sc: caseOf('p2-foreign', { p1: P1OK, p2: [{ links: [url('c-0', 'ae'), url('c-1', 'eg')] }, { links: [url('c-2', 'qa')] }], verdict: V1 }), want: expectP2(3), oldLast: 'Filter New URLs' },
        { label: 'phase 2: a mix of fetched, foreign and slug-less links', sc: caseOf('p2-mix', { p1: P1OK, p2: [{ links: [url('a-1', 'iq'), url('c-0', 'ae'), 'https://www.linkedin.com/in/?trk=x'] }, 'fail'], verdict: V1 }), want: expectP2(3), oldLast: 'Filter New URLs' },
        { label: 'Tier 40: phase 2 returns only fetched profiles', sc: caseOf('t40-fetched', { body: bodyOf({ minCandidateCount: 40 }), p1: [{ links: phase1(6) }, 'none', 'none', 'none'], p2: [{ links: phase1(6) }], verdict: V1 }), want: expectP2(3, 40), oldLast: 'Filter New URLs' },
        { label: 'Tier 40: every phase-2 call failed', sc: caseOf('t40-fail', { body: bodyOf({ minCandidateCount: 40 }), p1: [{ links: phase1(6) }, 'none', 'none', 'none'], p2: ['fail'], verdict: V1 }), want: expectP2(3, 40), oldLast: 'Split Out' },
        { label: 'phase 1: every profile is on a foreign subdomain (Iraq search)', sc: caseOf('p1-foreign', { p1: [{ links: phase1(5, 0, 'ae') }, { links: phase1(3, 5, 'eg') }], verdict: V1 }),
            want: { searchId: 'headhunter_test-0001', searchComplete: true, errorMessage: 'No candidates found in Iraq: all 8 LinkedIn profile(s) the search returned are on LinkedIn sites of other countries.' }, oldLast: 'Filter New URLs' },
        { label: 'phase 1: foreign subdomains and slug-less links (Iraq search)', sc: caseOf('p1-mixed', { p1: [{ links: [url('z', 'ae'), 'https://www.linkedin.com/in/?trk=x'] }, 'none'], verdict: V1 }),
            want: { searchId: 'headhunter_test-0001', searchComplete: true, errorMessage: 'No candidates found: none of the 2 LinkedIn profile(s) the search returned could be evaluated.' }, oldLast: 'Filter New URLs' },
        { label: 'phase 1: a non-Iraq search with only slug-less links', sc: caseOf('p1-dubai', { body: bodyOf({ location: 'Dubai, UAE' }), p1: [{ links: ['https://www.linkedin.com/in/?trk=a', 'https://www.linkedin.com/in/#b'] }], verdict: V1 }),
            want: { searchId: 'headhunter_test-0001', searchComplete: true, errorMessage: 'No candidates found: none of the 2 LinkedIn profile(s) the search returned could be evaluated.' }, oldLast: 'Filter New URLs' },
    ];
    // Person Search switched on (it ships dark): the ps route and its budget edge.
    const PLAN_ON = String(nodeIn(live, 'Person Search Plan').parameters.jsCode).replace('enabled: false,', 'enabled: true,');
    const psLinks = Array.from({ length: 20 }, (_, i) => url(`ps-${i}`));
    const psVerdict: Record<string, number | 'skip'> = Object.fromEntries(psLinks.map((l, i) => [slugOf(l), i < 4 ? 90 : 'skip']));
    lifecycle.push({ label: 'Person Search on (ps route): phase 2 Google returns only the Person Search people', sc: caseOf('ps-p2', { plan: PLAN_ON, ps: psLinks, p1: [], p2: [{ links: psLinks.slice(0, 8).map((l) => l.replace('www.', 'iq.')) }], verdict: psVerdict }), want: expectP2(4), oldLast: 'Filter New URLs' });
    lifecycle.push({ label: 'Person Search on: more results than asked for exhaust the budget before phase 1 enriches anyone', sc: caseOf('ps-budget', { plan: PLAN_ON, ps: Array.from({ length: 50 }, (_, i) => url(`ps-${i}`)), p1: [], verdict: psVerdict }),
        want: { searchId: 'headhunter_test-0001', searchComplete: true, errorMessage: 'No candidates found: none of the 50 LinkedIn profile(s) the search returned could be evaluated.' }, oldLast: 'Filter New URLs' });

    for (const [label, sc, msg] of [
        ['every phase-1 SerpAPI call failed', caseOf('p1-allfail', { p1: ['fail', 'fail'] }), 'Search engine unavailable: all 2 page request(s) to SerpAPI failed.'],
        ['phase 1 found no LinkedIn profile at all', caseOf('p1-zero', { p1: ['none', { web: 6 }] }), 'No LinkedIn profiles found for this search.'],
    ] as [string, Scenario, string][]) {
        const o = runSearch(OLD, sc); const n = runSearch(NEW, sc);
        check(`existing Merge close, ${label}: the same single completion as live, now via Phase 2 Found Nothing?[1]`,
            o.completions.length === 1 && eq(n.completions, o.completions) && n.completions[0].errorMessage === msg && n.trace.includes('Phase 2 Found Nothing?#0 [0/1]') && eq(n.serpCalls, o.serpCalls) && canon(n.sd) === canon(o.sd), JSON.stringify(n.completions));
    }
    for (const l of lifecycle) {
        const o = runSearch(OLD, l.sc);
        const n = runSearch(NEW, l.sc);
        const oldStall = o.completions.length === 0;
        const oldDesc = oldStall ? `stalls after ${o.trace[o.trace.length - 1]}` : `${o.completions.length} completion(s)${o.sends.length > n.sends.length ? `, ${o.sends.length - n.sends.length} duplicate send(s)` : ''}`;
        console.log(`  --    ${l.label}\n          live: ${oldDesc}`);
        check(`${l.label}: patched -> exactly ONE completion, the correct one`, n.completions.length === 1 && eq(n.completions[0], l.want) && completionOnly(n), JSON.stringify(n.completions));
        check(`${l.label}: same SerpAPI, EnrichLayer and Person Search calls as live (nothing more paid for)`, eq(n.serpCalls, o.serpCalls) && eq(n.enriched, o.enriched) && n.psCalls === o.psCalls);
        check(`${l.label}: every candidate sent once, and only ones live also sent`, new Set(n.sends.map(sendKey)).size === n.sends.length && multisetSubset(n.sends.map(sendKey), o.sends.map(sendKey)) && eq([...new Set(o.sends.map(sendKey))].sort(), [...new Set(n.sends.map(sendKey))].sort()));
        if (l.oldLast) {
            const lastChainRun = o.trace.filter((t) => /^(Split Out|Filter LinkedIn URLs|Add Person Search Links|Filter New URLs)#/.test(t)).pop() || '';
            check(`${l.label}: live hands on an empty list at ${l.oldLast}`, lastChainRun.startsWith(l.oldLast + '#') && lastChainRun.endsWith('[0]'), lastChainRun);
        }
        const nf = runSearch(NEW, l.sc, { liveFallback: true });
        check(`${l.label}: unchanged if Is Phase 2?'s static-data fallback were live`, nf.completions.length === 1 && eq(nf.completions[0], l.want));
    }

    // ================================================================ 5. GENERATED SEARCHES
    console.log('\nGENERATED SEARCHES — random searches through both graphs');
    {
        const N = 600;
        let unchanged = 0; let unchangedOk = 0; let fired = 0; let firedOk = 0; let oneEach = 0; let paidSame = 0; let sendsOk = 0;
        let limitRuns = 0; let limitCut = 0;
        const liveOutcome: Record<string, number> = {};
        let firstBad = '';
        for (let k = 0; k < N; k++) {
            const tierN = rnd() < 0.25 ? 40 : 20;
            const iraq = rnd() < 0.85;
            const pool = Array.from({ length: 30 }, (_, i) => `g-${i}`);
            const mk = (): Resp => {
                const r = rnd();
                if (r < 0.1) return 'fail';
                if (r < 0.2) return 'none';
                if (r < 0.27) return { web: 1 + Math.floor(rnd() * 9) };
                const links = Array.from({ length: Math.floor(rnd() * 10) }, () => url(pick(pool), pick(['www', 'www', 'www', 'iq', 'ae', 'sy', 'eg'])));
                return rnd() < 0.15 ? { links, web: 2 } : { links };
            };
            const verdict: Record<string, number | 'skip'> = {};
            for (const s of pool) verdict[s] = rnd() < 0.25 ? 'skip' : Math.floor(rnd() * 101);
            const usePs = rnd() < 0.2;
            const sc: Scenario = {
                label: `gen-${k}`,
                body: bodyOf({ searchId: `headhunter_gen-${k}`, minCandidateCount: tierN, location: iraq ? 'Baghdad, Iraq' : 'Dubai, UAE', position: pick(['Sales Manager', 'HR Generalist', 'Procurement Officer']) }),
                p1: Array.from({ length: 4 }, mk), p2: Array.from({ length: 3 }, mk), verdict,
                ...(usePs ? { plan: PLAN_ON, ps: Array.from({ length: Math.floor(rnd() * 45) }, (_, i) => url(`ps-${k}-${i}`)) } : {}),
            };
            if (usePs) for (const l of sc.ps || []) verdict[slugOf(l)] = rnd() < 0.3 ? 'skip' : Math.floor(rnd() * 101);
            // Profiles score off their slug; keep the position words in the occupation so Map Candidate Fields matches.
            const o = runSearch(OLD, sc);
            const n = runSearch(NEW, sc);
            // On the live graph, Limit Candidates passes on exactly what Filter New URLs handed it.
            const fnuOut = (o.runs['Filter New URLs'] || []).map((x) => x[0].length).filter((len) => len > 0);
            const limOut = (o.runs['Limit Candidates'] || []).map((x) => x[0].length);
            limitRuns += limOut.length;
            if (!eq(fnuOut, limOut)) limitCut++;
            if (n.completions.length === 1 && completionOnly(n)) oneEach++; else firstBad = firstBad || `${sc.label}: ${n.completions.length} completions`;
            if (eq(n.serpCalls, o.serpCalls) && eq(n.enriched, o.enriched) && n.psCalls === o.psCalls) paidSame++; else firstBad = firstBad || `${sc.label}: paid calls differ`;
            if (new Set(n.sends.map(sendKey)).size === n.sends.length && multisetSubset(n.sends.map(sendKey), o.sends.map(sendKey))) sendsOk++; else firstBad = firstBad || `${sc.label}: sends`;
            if (!closeFired(n)) {
                unchanged++;
                if (sameRuns(n, o) && eq(n.completions, o.completions) && eq(n.sends, o.sends) && canon(n.sd) === canon(o.sd)) unchangedOk++;
                else firstBad = firstBad || `${sc.label}: non-empty path changed`;
                continue;
            }
            fired++;
            const c = n.completions[0] || {};
            const distinctSent = new Set(n.sends.map(sendKey)).size;
            const closeItems = Object.values(n.runs).flatMap((rs) => rs.flatMap((outA) => outA.flatMap((b) => b.filter((i) => i.json && i.json.__nothingToEnrich === true))));
            const inPhase2 = closeItems.some((i) => i.json.__phase2 === true);
            const want = inPhase2 ? expectP2(distinctSent, tierN, sc.body.searchId as string) : null;
            const ok = inPhase2 ? eq(c, want) : (distinctSent === 0 && Object.keys(c).sort().join() === 'errorMessage,searchComplete,searchId' && /^No candidates found/.test(c.errorMessage));
            if (ok && n.completions.length === 1) firedOk++; else firstBad = firstBad || `${sc.label}: ${JSON.stringify(c)} want ${JSON.stringify(want)}`;
            const key = o.completions.length === 0 ? 'no completion (record stays submitted)' : eq(o.completions[0], c) ? (o.sends.length > n.sends.length ? 'the same completion, after re-sending the shortlist' : 'the same completion') : 'a DIFFERENT completion';
            liveOutcome[key] = (liveOutcome[key] || 0) + 1;
        }
        check(`${N} searches: the patched graph posts exactly ONE completion every time, carrying completion fields only`, oneEach === N, firstBad);
        check(`${N} searches: the same SerpAPI, EnrichLayer and Person Search calls as live, every time`, paidSame === N, firstBad);
        check(`${N} searches: every candidate sent once, and only ones live also sent`, sendsOk === N, firstBad);
        // In the model this holds by construction (its maxItems expression renders undefined, as $getWorkflowStaticData
        // does not exist in expressions); the production evidence is 27 of 27 saved Limit runs (1913-2048) plus exec 2057.
        check(`model, live graph: Limit Candidates passed every item on (${limitRuns} runs over ${N} searches), as in production`, limitCut === 0 && limitRuns > 500, `${limitCut} search(es) cut`);
        check(`${unchanged} searches whose chain never went empty: trace, completion, sends and static data byte-identical to live`, unchangedOk === unchanged && unchanged > 100, firstBad);
        check(`${fired} searches whose chain went empty: the right completion (phase-1 totals / "no candidates")`, firedOk === fired && fired > 50, firstBad);
        console.log('        live graph on those same empty-chain searches:');
        for (const [k, v] of Object.entries(liveOutcome).sort((a, b) => b[1] - a[1])) console.log(`          ${String(v).padStart(4)}  ${k}`);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
