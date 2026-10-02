/**
 * headhunter-serp-health-test
 *
 * The completion of a Head Hunter search carries counts of how the search engine
 * behaved - serpHealth {calls, failed, ignoredFilter} - so the page can tell a recruiter
 * whose search fell short that some search requests got no answer or came back without
 * LinkedIn profiles (owner decisions 2026-10-02: the note shows only on a short result
 * and never suggests searching again). PUBLISHED 2026-10-02 as n8n version 9c18a01c
 * (rollback 72f27440); the PUBLISHED section pins live/ to the tested rebuild.
 *
 * The patch (pending/headhunter-serp-health.*), on 72f27440:
 *   - Merge Serp Results records every SerpAPI call of the search, phase 1 and phase 2
 *     together, keyed by query and page, in its FINAL state (sd.hhSerpHealth);
 *   - Prepare Complete Search turns it into counts, adds them to the completion body
 *     (never the query text) and deletes the record.
 * The backend that stores and returns the counts has its own test:
 * test:headhunter-serp-health-backend.
 *
 * How it is proven, offline and on synthetic data (the repository is public), with the
 * shared n8n v1 engine (lib/headhunterWorkflowEngine.ts):
 *   1. PATCH / GRAPH - only the two nodes change, only by the intended lines.
 *   2. NODE - Merge Serp Results' final-state rules over two runs, Prepare Complete Search's
 *      read-once; the mutations that must fail, do.
 *   3. LIFECYCLE - named search shapes: the counts, and nothing else changes.
 *   4. GENERATED - hundreds of random searches: the counts equal an independent count of
 *      what the search engine answered; sends, paid calls and routing are untouched.
 *
 * Run: npm run test:headhunter-serp-health
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyPatch, bodyOf, canon, clone, COMPLETION_KEYS, eq, runCode, runSearch, url,
    type Ctx, type Item, type Resp, type Run, type Scenario, type Wf,
} from './lib/headhunterWorkflowEngine.js';
import { parseHeadHunterSerpHealth } from '../services/headHunterSerpHealth.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

// The page's helper and its English strings (the frontend owns the wording; this checks the hand-off).
const FRONTEND_UTILS = new URL('../../../frontend/src/', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { headHunterCompletionNotice: notice }: any = await import(`${FRONTEND_UTILS}utils/headHunterCompletionNotice.js`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { translations }: any = await import(`${FRONTEND_UTILS}translations.js`);
const tEn = (key: string) => translations.en[key] ?? key;

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const rec = JSON.parse(read('headhunter-serp-health.patch.json'));

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
Date.now = () => NOW;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const BASE: Wf = JSON.parse(readFileSync(join(WF_DIR, rec.baseFile), 'utf8'));
const NEW: Wf = applyPatch(BASE, rec, PENDING);
const nodeIn = (wf: Wf, name: string) => wf.nodes.find((n) => n.name === name);
const codeOf = (wf: Wf, name: string) => String(nodeIn(wf, name)?.parameters?.jsCode ?? '');
const MERGE = 'Merge Serp Results';
const PREPARE = 'Prepare Complete Search';
const paid = (r: Run) => JSON.stringify([r.serpCalls, r.enriched, r.psCalls]);
const withoutHealth = (c: any) => { const x = clone(c); delete x.serpHealth; return x; };
const sdWithoutHealth = (sd: any) => canon({ ...sd, hhSerpHealth: undefined });

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

/**
 * The counts, computed independently from what the search engine actually answered in the run:
 * each (query, page) once, in its final state - an answer is never undone by a later failure.
 */
function referenceHealth(r: Run): { calls: number; failed: number; ignoredFilter: number } | null {
    const final = new Map<string, string>();
    const google = r.runs['Google SerpAPI Search'] || [];
    const prepared = r.runs['Prepare Serp Pages'] || [];
    google.forEach((out, run) => {
        out[0].forEach((it, i) => {
            const sent = prepared[run]?.[0]?.[i]?.json || {};
            const key = `${sent.q}@${sent.start}`;
            const j = it.json || {};
            const answered = (Boolean(j.search_metadata) || Array.isArray(j.organic_results)) && !it.error;
            const organic = Array.isArray(j.organic_results) ? j.organic_results : [];
            const linkedin = organic.filter((o: any) => /linkedin\.com\/in\//i.test(String(o.link || ''))).length;
            const state = !answered ? 'failed' : organic.length > 0 && linkedin === 0 ? 'ignored' : organic.length > 0 ? 'ok' : 'empty';
            if (state !== 'failed' || !final.has(key) || final.get(key) === 'failed') final.set(key, state);
        });
    });
    if (!final.size) return null;
    const states = [...final.values()];
    return { calls: states.length, failed: states.filter((s) => s === 'failed').length, ignoredFilter: states.filter((s) => s === 'ignored').length };
}

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — search-engine health in the completion (pending, base ${String(rec.baseVersionId).slice(0, 8)})`);
    console.log('='.repeat(96));

    // ================================================================ 1. PATCH / GRAPH
    console.log('\nPATCH');
    check(`base is ${rec.baseFile} (${String(rec.baseVersionId).slice(0, 8)}, ${rec.baseNodeCount} nodes)`, BASE.versionId === rec.baseVersionId && BASE.nodes.length === rec.baseNodeCount, `${BASE.versionId} / ${BASE.nodes.length}`);
    const EXPECT: Record<string, { removed: string[]; code: string[] }> = {
        [MERGE]: {
            removed: [],
            code: [
                '{',
                '  const HEALTH_TTL_MS = 24 * 60 * 60 * 1000;',
                '  const at = Date.now();',
                '  sd.hhSerpHealth = sd.hhSerpHealth || {};',
                '  for (const [id, rec] of Object.entries(sd.hhSerpHealth)) {',
                "    if (!rec || typeof rec.at !== 'number' || at - rec.at > HEALTH_TTL_MS) delete sd.hhSerpHealth[id];",
                '  }',
                '  const health = sd.hhSerpHealth[searchId] || (sd.hhSerpHealth[searchId] = { at, calls: {} });',
                '  health.at = at;',
                '  serpStats.forEach((s, i) => {',
                "    const key = s.q ? s.q + '@' + s.start : 'call' + (isPhase2 ? 2 : 1) + '-' + i;",
                "    const state = !s.answered ? 'failed' : s.organic > 0 && s.linkedin === 0 ? 'ignored' : s.organic > 0 ? 'ok' : 'empty';",
                "    if (state !== 'failed' || !health.calls[key] || health.calls[key] === 'failed') health.calls[key] = state;",
                '  });',
                '}',
                '',
            ],
        },
        [PREPARE]: {
            removed: ['return [{ json: { searchId, searchComplete: true } }];'],
            code: [
                'let serpHealth = null;',
                'if (searchId && sd.hhSerpHealth && sd.hhSerpHealth[searchId]) {',
                '  const states = Object.values(sd.hhSerpHealth[searchId].calls || {});',
                '  delete sd.hhSerpHealth[searchId];',
                '  if (states.length) {',
                '    serpHealth = {',
                '      calls: states.length,',
                "      failed: states.filter((s) => s === 'failed').length,",
                "      ignoredFilter: states.filter((s) => s === 'ignored').length,",
                '    };',
                '  }',
                '}',
                '',
                '  if (serpHealth) body.serpHealth = serpHealth;',
                '  if (serpHealth) body.serpHealth = serpHealth;',
                'return [{ json: serpHealth ? { searchId, searchComplete: true, serpHealth } : { searchId, searchComplete: true } }];',
            ],
        },
    };
    for (const e of rec.parameterEdits) {
        const before = codeOf(BASE, e.node);
        const after = read(e.replaceWholeValueFromFile);
        check(`${e.node}: the base has what this replaces, and only the base`, before.includes(e.expectBeforeContains) && !after.includes(e.expectBeforeContains));
        check(`${e.node}: the replacement carries the change`, after.includes(e.expectAfterContains));
        check(`${e.node}: LF line endings, trailing newline as in the base, ASCII additions`, !after.includes('\r') && after.endsWith('\n') === before.endsWith('\n'));
        const d = lineDiff(before.split('\n'), after.split('\n'));
        const want = EXPECT[e.node];
        check(`${e.node}: removes exactly ${want.removed.length} line(s)`, eq(d.removed, want.removed), JSON.stringify(d.removed));
        const addedCode = d.added.filter((l) => !/^\s*\/\//.test(l));
        check(`${e.node}: adds exactly the intended code; every other added line is a // comment`, eq(addedCode, want.code), JSON.stringify(addedCode));
        check(`${e.node}: every added line is ASCII`, d.added.every((l) => [...l].every((c) => c.charCodeAt(0) < 128)));
    }
    console.log('\nGRAPH');
    const changed = new Set<string>(rec.parameterEdits.map((e: any) => e.node));
    check('same nodes, every other node byte-identical, connections and settings unchanged',
        eq(NEW.nodes.map((n) => n.name), BASE.nodes.map((n) => n.name)) && BASE.nodes.filter((n) => !changed.has(n.name)).every((n) => canon(n) === canon(nodeIn(NEW, n.name)))
        && canon(NEW.connections) === canon(BASE.connections) && canon(NEW.settings) === canon(BASE.settings) && !rec.addNodes && !rec.removeNodes);
    for (const name of changed) {
        check(`${name}: only its jsCode differs`, canon({ ...nodeIn(BASE, name), parameters: {} }) === canon({ ...nodeIn(NEW, name), parameters: {} }) && eq(Object.keys(nodeIn(NEW, name).parameters), ['jsCode']));
    }

    if (rec.publishedVersionId) {
        console.log(`\nPUBLISHED (${String(rec.publishedVersionId).slice(0, 8)}) — live/ must be the tested rebuild, carried through the recorded publishes since`);
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const carried = withRecordedPublishesAfter(WF_DIR, String(rec.publishedVersionId), NEW);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const strip = (n: any) => { const c = clone(n); if (carried.added.has(c.name)) delete c.id; return c; };
        const P = new Map(pub.nodes.map((n) => [n.name, n]));
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (ids included)',
            pub.nodes.length === carried.wf.nodes.length && carried.wf.nodes.every((n) => P.has(n.name) && canon(strip(n)) === canon(strip(P.get(n.name)))));
        check('every connection and the settings of live/ equal the rebuild\'s (executionOrder v1)',
            canon(pub.connections) === canon(carried.wf.connections) && canon(pub.settings) === canon(BASE.settings) && pub.settings?.executionOrder === 'v1');
        const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
        check('each replacement file still hashes to its recorded publishedSha256', rec.parameterEdits.every((e: any) => e.publishedSha256 === sha(read(e.replaceWholeValueFromFile))));
        check('the record\'s graph section still hashes to its recorded publishedStructureSha256',
            Boolean(rec.publishedStructureSha256) && structureSha256(rec) === rec.publishedStructureSha256);
    }

    // ================================================================ 2. NODE
    console.log('\nNODE — final-state rules and read-once');
    const MERGE_NEW = codeOf(NEW, MERGE);
    const PREPARE_NEW = codeOf(NEW, PREPARE);
    const body = bodyOf({ searchId: 'headhunter_test-health' });
    const sid = String(body.searchId);
    const serpOf = (resp: Resp | 'fail', q: string): Item => {
        if (resp === 'fail') return { json: { error: 'Service unavailable' }, error: { message: 'Service unavailable' } };
        if (resp === 'none') return { json: { search_metadata: { id: 'x', status: 'Success' }, search_parameters: { q, start: 0 }, error: "Google hasn't returned any results for this query." } };
        const organic = [...(resp.links || []).map((link, i) => ({ position: i + 1, link })), ...Array.from({ length: resp.web || 0 }, (_, i) => ({ position: 50 + i, link: `https://jobs.example.com/${q.length}-${i}` }))];
        return { json: { search_metadata: { id: 'x', status: 'Success' }, search_parameters: { q, start: 0 }, organic_results: organic } };
    };
    /** One Merge Serp Results run on prepared calls [q, response], in the given phase, against shared static data. */
    const mergeRun = (src: string, sd: any, calls: [string, Resp | 'fail'][], phase2: boolean) => {
        if (phase2) sd.hhPhase2 = { [sid]: { maxEnrich: 20 } }; else if (sd.hhPhase2) delete sd.hhPhase2[sid];
        const prepared = calls.map(([q]) => ({ json: { q, start: 0, __phase2: phase2 } }));
        const ctx: Ctx = { body, sd, liveFallback: false, out: (n) => (n === 'Prepare Serp Pages' ? prepared : undefined) };
        return runCode({ name: MERGE, parameters: {} }, calls.map(([q, r]) => serpOf(r, q)), ctx, src)[0];
    };
    const prepareRun = (src: string, sd: any, input: any) => {
        const ctx: Ctx = { body, sd, liveFallback: false, out: () => undefined };
        return runCode({ name: PREPARE, parameters: {} }, [{ json: input }], ctx, src)[0];
    };
    const health = (sd: any) => {
        const out = prepareRun(PREPARE_NEW, sd, { __completeSearch: true, phase1Count: 1, totalSent: 1, minTarget: 20, targetMet: false, expansionRan: true });
        return out[0]?.json?.serpHealth ?? null;
    };
    const L = (n: number) => Array.from({ length: n }, (_, i) => url(`h-${i}`));
    const scenarios: [string, (src: string) => any, any][] = [
        ['phase 1: one answer with profiles, one with only job boards', (src) => { const sd: any = {}; mergeRun(src, sd, [['qa', { links: L(3) }], ['qb', { web: 5 }]], false); return health(sd); }, { calls: 2, failed: 0, ignoredFilter: 1 }],
        ['a phase-1 503 that phase 2 retried with an answer is NOT failed', (src) => { const sd: any = {}; mergeRun(src, sd, [['qa', { links: L(2) }], ['qb', 'fail']], false); mergeRun(src, sd, [['qb', { links: L(2) }], ['qc', { links: L(1) }]], true); return health(sd); }, { calls: 3, failed: 0, ignoredFilter: 0 }],
        ['an answered query that fails when re-sent in phase 2 stays answered', (src) => { const sd: any = {}; mergeRun(src, sd, [['qa', { web: 4 }]], false); mergeRun(src, sd, [['qa', 'fail'], ['qd', 'fail']], true); return health(sd); }, { calls: 2, failed: 1, ignoredFilter: 1 }],
        ['every phase-1 call failed (the early close) is still counted', (src) => { const sd: any = {}; mergeRun(src, sd, [['qa', 'fail'], ['qb', 'fail']], false); return health(sd); }, { calls: 2, failed: 2, ignoredFilter: 0 }],
        ['"no results" and partial pages are answered, not failed or ignored', (src) => { const sd: any = {}; mergeRun(src, sd, [['qa', 'none'], ['qb', { links: L(1), web: 9 }]], false); return health(sd); }, { calls: 2, failed: 0, ignoredFilter: 0 }],
        ['the same query twice in one run counts once', (src) => { const sd: any = {}; mergeRun(src, sd, [['qa', { links: L(1) }], ['qa', { links: L(1) }]], false); return health(sd); }, { calls: 1, failed: 0, ignoredFilter: 0 }],
    ];
    for (const [label, run, want] of scenarios) {
        const got = run(MERGE_NEW);
        check(label, eq(got, want), JSON.stringify(got));
    }
    {
        const sd: any = { hhSerpHealth: { 'headhunter_old': { at: NOW - 25 * 3600_000, calls: { 'x@0': 'ok' } } } };
        mergeRun(MERGE_NEW, sd, [['qa', { links: L(1) }]], false);
        check('entries older than 24 hours are pruned; this search\'s entry is kept', !sd.hhSerpHealth.headhunter_old && Boolean(sd.hhSerpHealth[sid]));
        const first = prepareRun(PREPARE_NEW, sd, { __completeOnly: true, searchFailed: true, errorMessage: 'synthetic' });
        check('the posting run reads it: serpHealth in the body, the record deleted', eq(first[0]?.json?.serpHealth, { calls: 1, failed: 0, ignoredFilter: 0 }) && !sd.hhSerpHealth[sid]);
        const again = prepareRun(PREPARE_NEW, sd, { __completeOnly: true });
        check('a repeat run posts nothing (the existing hhCompleted guard), so the counts go out once', again.length === 0);
        const sd2: any = {};
        const bare = prepareRun(PREPARE_NEW, sd2, { searchId: sid });
        check('no SerpAPI call made (e.g. the Person Search route): no serpHealth key at all', bare.length === 1 && !('serpHealth' in bare[0].json));
    }
    {
        // Something was sent, so a __completeOnly is a repeat - and one can arrive BEFORE the real
        // __completeSearch. Dropping it must leave the counts for the run that does post.
        const twoStep = (src: string) => {
            const sd: any = {};
            mergeRun(MERGE_NEW, sd, [['qa', { links: L(1) }], ['qb', 'fail']], false);
            sd.hhSendProgress = { [sid]: { expected: 1, sent: 1 } };
            const early = prepareRun(src, sd, { __completeOnly: true });
            const real = prepareRun(src, sd, { __completeSearch: true, phase1Count: 1, totalSent: 1, minTarget: 20, targetMet: false, expansionRan: true });
            return early.length === 0 && real.length === 1 && eq(real[0].json.serpHealth, { calls: 2, failed: 1, ignoredFilter: 0 }) && !sd.hhSerpHealth[sid];
        };
        check('an early repeat __completeOnly is dropped without spending the counts; the real completion after it carries them', twoStep(PREPARE_NEW));
        const from = PREPARE_NEW.indexOf('let serpHealth = null;');
        const to = PREPARE_NEW.indexOf('if (input.__completeOnly) {');
        const block = from > 0 && to > from ? PREPARE_NEW.slice(from, to) : '';
        const dropLine = 'if (input.__completeOnly && anythingSent) return [];';
        const readFirst = block ? PREPARE_NEW.replace(block, '').replace(dropLine, block + dropLine) : PREPARE_NEW;
        check('mutation - reading the counts before the repeat is dropped: caught', readFirst !== PREPARE_NEW && !twoStep(readFirst));
    }
    {
        // Mutations that must be caught by the scenarios above.
        const mutants: [string, string][] = [
            ['an answer turning back into failed', MERGE_NEW.replace("if (state !== 'failed' || !health.calls[key] || health.calls[key] === 'failed') health.calls[key] = state;", 'health.calls[key] = state;')],
            ['partial pages counted as ignored', MERGE_NEW.replace("s.organic > 0 && s.linkedin === 0 ? 'ignored'", "s.organic > 0 && s.linkedin < s.organic ? 'ignored'")],
            ['counting from the phase-2 run only', MERGE_NEW.replace("const health = sd.hhSerpHealth[searchId] || (sd.hhSerpHealth[searchId] = { at, calls: {} });", "const health = (sd.hhSerpHealth[searchId] = { at, calls: {} });")],
            ['a "no results" answer counted as failed', MERGE_NEW.replace("const state = !s.answered ? 'failed'", "const state = !s.answered || !s.organic ? 'failed'")],
        ];
        for (const [label, src] of mutants) {
            const caught = src !== MERGE_NEW && scenarios.some(([, run, want]) => { try { return !eq(run(src), want); } catch { return true; } });
            check(`mutation - ${label}: caught`, caught);
        }
        const noDelete = PREPARE_NEW.replace('  delete sd.hhSerpHealth[searchId];\n', '');
        const sd: any = {};
        mergeRun(MERGE_NEW, sd, [['qa', { links: L(1) }]], false);
        prepareRun(noDelete, sd, { __completeOnly: true });
        check('mutation - Prepare Complete Search not deleting the record: caught (it would linger)', noDelete !== PREPARE_NEW && Boolean(sd.hhSerpHealth[sid]));
    }

    // ================================================================ 3. LIFECYCLE
    console.log('\nLIFECYCLE — whole searches, base vs patched');
    const links = (p: string, n: number) => Array.from({ length: n }, (_, i) => url(`${p}-${i}`));
    const verdictOf = (p: string, s: (number | 'skip')[]) => Object.fromEntries(s.map((v, i) => [`${p}-${i}`, v]));
    const caseOf = (label: string, o: Partial<Scenario> & { p1: Resp[] }): Scenario => ({ label, body: bodyOf(), p2: ['none'], verdict: {}, ...o } as Scenario);
    const cases: [string, Scenario, any][] = [
        ['phase 1 short, phase 2 adds one; Google ignored the filter on one phase-1 call', caseOf('ign', { p1: [{ links: links('a', 4) }, { web: 6 }], p2: [{ links: links('b', 2) }], verdict: { ...verdictOf('a', [80, 80, 'skip', 30]), ...verdictOf('b', [70, 'skip']) } }), null],
        ['every phase-1 SerpAPI call failed (the early "search engine unavailable" close)', caseOf('p1fail', { p1: ['fail', 'fail'] }), { calls: 2, failed: 2, ignoredFilter: 0 }],
        ['phase 1 found job boards only (the early "no LinkedIn profiles" close)', caseOf('p1web', { p1: [{ web: 5 }, { web: 3 }] }), { calls: 2, failed: 0, ignoredFilter: 2 }],
        ['phase 2 failed entirely (the empty-chain close)', caseOf('p2fail', { p1: [{ links: links('a', 3) }, 'none'], p2: ['fail'], verdict: verdictOf('a', [80, 80, 80]) }), null],
    ];
    for (const [label, sc, want] of cases) {
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        const ref = referenceHealth(n);
        const c = n.completions[0] || {};
        console.log(`  --    ${label}: serpHealth ${JSON.stringify(c.serpHealth)}`);
        check(`${sc.label}: one completion; it equals the base's plus serpHealth, which matches an independent count`,
            n.completions.length === 1 && b.completions.length === 1 && eq(withoutHealth(c), b.completions[0]) && eq(c.serpHealth, ref) && (!want || eq(c.serpHealth, want)), JSON.stringify(c));
        check(`${sc.label}: same sends, paid calls and node runs; the record is gone at the end`,
            eq(n.sends, b.sends) && paid(n) === paid(b) && eq(n.trace, b.trace) && sdWithoutHealth(n.sd) === sdWithoutHealth(b.sd) && !n.sd.hhSerpHealth?.[String(sc.body.searchId)]);
    }

    // ================================================================ 4. GENERATED
    console.log('\nGENERATED SEARCHES — random searches through both graphs');
    {
        let seed = 20261004;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const N = 600;
        let same = 0; let counted = 0; let clean = 0; let degraded = 0; let shortDegraded = 0;
        let layersOk = 0; let noted = 0; let layersBad = '';
        let metTarget = 0; let metDegraded = 0;
        let firstBad = '';
        for (let k = 0; k < N; k++) {
            // Every fourth search draws from a strong pool, so some searches meet their target and
            // the "no note when the target is met" side of the cross-layer check is exercised too.
            const strong = k % 4 === 0;
            const people = Array.from({ length: 60 }, (_, i) => `g-${i}`);
            const mk = (): Resp | 'fail' => {
                const r = rnd();
                if (strong) return r < 0.15 ? 'fail' : r < 0.25 ? { web: 1 + Math.floor(rnd() * 9) } : { links: Array.from({ length: 12 + Math.floor(rnd() * 4) }, () => url(pick(people))) };
                if (r < 0.12) return 'fail';
                if (r < 0.2) return 'none';
                if (r < 0.32) return { web: 1 + Math.floor(rnd() * 9) };
                return rnd() < 0.15 ? { links: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => url(pick(people))), web: 7 } : { links: Array.from({ length: Math.floor(rnd() * 16) }, () => url(pick(people), pick(['www', 'www', 'iq', 'ae']))) };
            };
            const verdict: Record<string, number | 'skip'> = {};
            for (const s of people) verdict[s] = strong ? (rnd() < 0.05 ? 'skip' : 60 + Math.floor(rnd() * 41)) : rnd() < 0.3 ? 'skip' : Math.floor(rnd() * 101);
            const sc: Scenario = {
                label: `gen-${k}`, body: bodyOf({ searchId: `headhunter_gen-${k}`, minCandidateCount: strong || rnd() >= 0.3 ? 20 : 40, position: pick(['Sales Manager', 'HR Generalist']) }),
                p1: Array.from({ length: 4 }, mk) as Resp[], p2: Array.from({ length: 3 }, mk) as Resp[], verdict,
            };
            const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
            const c = n.completions[0] || {};
            const ref = referenceHealth(n);
            const keysOk = Object.keys(c).every((key) => COMPLETION_KEYS.has(key) || key === 'serpHealth');
            const numbersOnly = !c.serpHealth || (Object.keys(c.serpHealth).join() === 'calls,failed,ignoredFilter' && Object.values(c.serpHealth).every((v) => Number.isInteger(v) && (v as number) >= 0)
                && c.serpHealth.failed + c.serpHealth.ignoredFilter <= c.serpHealth.calls);
            const noQueryText = !JSON.stringify(c).includes('site:') && !JSON.stringify(c).includes(String(sc.body.position));
            if (n.completions.length === 1 && b.completions.length === 1 && eq(withoutHealth(c), b.completions[0]) && eq(n.sends, b.sends) && paid(n) === paid(b) && eq(n.trace, b.trace)
                && sdWithoutHealth(n.sd) === sdWithoutHealth(b.sd) && !n.sd.hhSerpHealth?.[String(sc.body.searchId)]) same++;
            else firstBad = firstBad || `${sc.label}: differs from the base beyond serpHealth`;
            if (eq(c.serpHealth ?? null, ref) && keysOk && numbersOnly && noQueryText) counted++;
            else firstBad = firstBad || `${sc.label}: serpHealth ${JSON.stringify(c.serpHealth)} vs ${JSON.stringify(ref)}`;
            // The same completion through the other two layers: the backend's parser keeps the counts as
            // they are, and the page's helper notes the search exactly when it fell short (a failed
            // search only when the counts came with it, i.e. the search engine was asked).
            {
                const parsed = parseHeadHunterSerpHealth(c);
                const wanted = Number(sc.body.minCandidateCount);
                const isShort = n.sends.length < wanted;
                const status = c.searchFailed || (n.sends.length === 0 && c.errorMessage) ? 'failed' : 'completed';
                const isDegraded = Boolean(parsed && (parsed.failed || parsed.ignoredFilter));
                const note = notice({ status, candidateCount: n.sends.length, wanted, serpHealth: parsed ?? null, source: 'memory' }, tEn);
                const wantNote = isShort && (status === 'completed' || Boolean(parsed && parsed.calls > 0));
                if (eq(parsed ?? null, c.serpHealth ?? null) && Boolean(note) === wantNote && (!note || !/try again|no further matches/i.test(note.text))) layersOk++;
                else layersBad = layersBad || `${sc.label}: parsed ${JSON.stringify(parsed)}, note ${JSON.stringify(note)}`;
                if (note) noted++;
                if (!isShort) { metTarget++; if (isDegraded) metDegraded++; }
            }
            if (c.serpHealth && (c.serpHealth.failed || c.serpHealth.ignoredFilter)) {
                degraded++;
                if (n.sends.length < Number(sc.body.minCandidateCount)) shortDegraded++;
            } else clean++;
        }
        check(`${N} searches: completion, sends, paid calls, node runs and static data equal the base's (serpHealth aside)`, same === N, firstBad);
        check(`${N} searches: serpHealth equals an independent count, numbers only, no query text, completion keys only`, counted === N, firstBad);
        check(`coverage: ${degraded} degraded searches (${shortDegraded} of them short) and ${clean} clean ones`, degraded > 100 && clean > 50 && shortDegraded > 50, `${degraded}/${clean}/${shortDegraded}`);
        check(`coverage: ${metTarget} searches met their target, ${metDegraded} of them degraded (these must get no note)`, metTarget > 30 && metDegraded > 10, `${metTarget}/${metDegraded}`);
        check(`across the layers: every completion's serpHealth passes the backend parser unchanged, and the page shows a note exactly when the search fell short (${noted} noted, ${metTarget} not)`,
            layersOk === N, layersBad);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
