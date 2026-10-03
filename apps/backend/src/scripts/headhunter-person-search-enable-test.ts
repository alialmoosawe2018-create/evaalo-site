/**
 * headhunter-person-search-enable-test
 *
 * Person Search switched on for every organisation (owner decision 2026-10-03: few
 * subscribers yet, so no allowlist). PUBLISHED 2026-10-03 as n8n version 899466d2
 * (rollback 1f83d9b2); the PUBLISHED section pins live/ to the tested rebuild. The record pending/headhunter-person-search-enable.*
 * changes ONE thing on 1f83d9b2: Person Search Plan's CONFIG.enabled false -> true, plus
 * its comments. The design, its measurement and the dark publish are in
 * headhunter-person-search.*; the credential publish in headhunter-person-search-credential.
 *
 * Dark since 2026-10-01, the Person Search path never ran on the graph it now joins: the
 * job-title gate, the empty-chain close, the completion hardening and the search-engine
 * counts were all published after it. So this test runs it on THAT graph, with the shared
 * n8n v1 engine (lib/headhunterWorkflowEngine.ts), on synthetic data (the repo is public):
 *   1. PATCH / GRAPH - only Person Search Plan changes, only by the enabled line and comments.
 *   2. PLAN - who gets Person Search: an Iraq search with a plain-English title, any organisation.
 *   3. LIFECYCLE - named searches, Person Search on, and in the order n8n may also run them.
 *   4. GENERATED - hundreds of random searches with Person Search on: exactly one
 *      completion, nobody sent twice, the EnrichLayer ceiling (120 / 240 credits) held,
 *      the search-engine counts honest; a search Person Search does not apply to runs
 *      exactly as before.
 *
 * Run: npm run test:headhunter-person-search-enable
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyPatch, bodyOf, canon, COMPLETION_KEYS, eq, runCode, runSearch, slugOf, url,
    type Ctx, type Item, type Resp, type Run, type RunOpts, type Scenario, type Wf,
} from './lib/headhunterWorkflowEngine.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const rec = JSON.parse(read('headhunter-person-search-enable.patch.json'));

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
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
const PLAN = 'Person Search Plan';
const CEILING: Record<number, number> = { 20: 120, 40: 240 };

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

/** Search-engine counts computed independently from the SerpAPI calls the run made (same rule as test:headhunter-serp-health). */
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

/**
 * EnrichLayer credits the search spent, computed independently: 3 per Person Search result
 * returned, 1 per Person Search profile fetched (use_cache=if-present), 2 per other fetch.
 */
function credits(r: Run, sc: Scenario): number {
    const ps = new Set((sc.ps || []).map(slugOf));
    return 3 * (r.psCalls ? (sc.ps || []).length : 0) + r.enriched.reduce((sum, link) => sum + (ps.has(slugOf(link)) ? 1 : 2), 0);
}

/** The held-back run n8n defers: phase 1's rejected rows into Stream Batch Done (one skip row if there were none). */
const heldBack = (r: Run): Item[] => {
    const rows = r.runs['Has Match?']?.[0]?.[1] ?? [];
    return rows.length ? rows : [{ json: { __skip: true, name: '' } }];
};
const forced = (after: string): RunOpts => ({ inject: { after, run: 0, node: 'Stream Batch Done', items: heldBack } });
const ORDERS: [string, RunOpts][] = [['natural', {}], ['held-back run after Finalize Top N Send', forced('Finalize Top N Send')], ['held-back run after Finalize Phase 2 Send', forced('Finalize Phase 2 Send')]];

/** What every search must satisfy with Person Search on. Returns '' or the first broken rule. */
function broken(r: Run, sc: Scenario): string {
    if (r.completions.length !== 1) return `${r.completions.length} completions`;
    const c = r.completions[0] || {};
    const slugs = r.sends.map((s) => slugOf(String(s.linkedin_url)));
    if (new Set(slugs).size !== slugs.length) return 'a candidate was sent twice';
    if (r.sends.length && c.totalSent !== r.sends.length) return `totalSent ${c.totalSent} but ${r.sends.length} sent`;
    if (new Set(r.enriched.map(slugOf)).size !== r.enriched.length) return 'a profile was fetched twice';
    const target = Number(sc.body.minCandidateCount) >= 40 ? 40 : 20;
    if (credits(r, sc) > CEILING[target]) return `${credits(r, sc)} EnrichLayer credits > ceiling ${CEILING[target]}`;
    if (!Object.keys(c).every((k) => COMPLETION_KEYS.has(k) || k === 'serpHealth')) return `unexpected completion keys ${Object.keys(c)}`;
    if (!eq(c.serpHealth ?? null, referenceHealth(r))) return `serpHealth ${JSON.stringify(c.serpHealth)} vs ${JSON.stringify(referenceHealth(r))}`;
    return '';
}
const sameRun = (a: Run, b: Run) => eq(a.completions, b.completions) && eq(a.sends, b.sends) && eq(a.serpCalls, b.serpCalls) && eq(a.enriched, b.enriched) && a.psCalls === b.psCalls && eq(a.trace, b.trace);

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — Person Search switched on for every organisation (${rec.publishedVersionId ? 'published ' + String(rec.publishedVersionId).slice(0, 8) : 'pending'}, base ${String(rec.baseVersionId).slice(0, 8)})`);
    console.log('='.repeat(96));

    // ================================================================ 1. PATCH / GRAPH
    console.log('\nPATCH');
    check(`base is ${rec.baseFile} (${String(rec.baseVersionId).slice(0, 8)}, ${rec.baseNodeCount} nodes)`, BASE.versionId === rec.baseVersionId && BASE.nodes.length === rec.baseNodeCount);
    check('one edit, on Person Search Plan, nothing else in the record', rec.parameterEdits.length === 1 && rec.parameterEdits[0].node === PLAN && !rec.addNodes && !rec.removeNodes && !rec.connections && !rec.parameterSets);
    const before = codeOf(BASE, PLAN);
    const after = read(rec.parameterEdits[0].replaceWholeValueFromFile);
    const d = lineDiff(before.split('\n'), after.split('\n'));
    const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
    check('the base ships it dark', before.includes('  enabled: false, // dark launch'));
    check('code: exactly one line removed and one added - enabled false -> true',
        eq(d.removed.filter((l) => !isComment(l)), ['  enabled: false, // dark launch: switched on only by a separate, owner-approved publish'])
        && eq(d.added.filter((l) => !isComment(l)), ['  enabled: true, // on for every organisation since 2026-10-03 (owner decision: few subscribers yet)']),
        JSON.stringify(d));
    check('the allowlist stays empty (every organisation) and the ceiling stays 120 / 240', after.includes("  orgAllowlist: [], //") && after.includes('ceiling: { 20: 120, 40: 240 }'));
    check('added lines are ASCII; LF; trailing newline as in the base', d.added.every((l) => [...l].every((ch) => ch.charCodeAt(0) < 128)) && !after.includes('\r') && after.endsWith('\n') === before.endsWith('\n'));
    console.log('\nGRAPH');
    check('every other node byte-identical; connections and settings unchanged',
        BASE.nodes.filter((n) => n.name !== PLAN).every((n) => canon(n) === canon(nodeIn(NEW, n.name))) && NEW.nodes.length === BASE.nodes.length
        && canon(NEW.connections) === canon(BASE.connections) && canon(NEW.settings) === canon(BASE.settings));
    check('Person Search Plan: only its jsCode differs', canon({ ...nodeIn(BASE, PLAN), parameters: {} }) === canon({ ...nodeIn(NEW, PLAN), parameters: {} }) && eq(Object.keys(nodeIn(NEW, PLAN).parameters), ['jsCode']));
    check('the Person Search HTTP node: GET search/person with the query the Plan builds, header auth, never throws, no retry (each call is billed)',
        (() => {
            const n = nodeIn(NEW, 'Person Search');
            const p = n.parameters;
            return p.authentication === 'genericCredentialType' && p.genericAuthType === 'httpHeaderAuth' && p.method === 'GET' && p.url === 'https://enrichlayer.com/api/v2/search/person'
                && p.jsonQuery === '={{ JSON.stringify($json.query) }}' && p.options?.response?.response?.neverError === true && p.options?.timeout === 60000 && !n.retryOnFail;
        })());

    if (rec.publishedVersionId) {
        console.log(`\nPUBLISHED (${String(rec.publishedVersionId).slice(0, 8)}) — live/ must be the tested rebuild, carried through the recorded publishes since`);
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const carried = withRecordedPublishesAfter(WF_DIR, String(rec.publishedVersionId), NEW);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const P = new Map(pub.nodes.map((n) => [n.name, n]));
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (ids included)',
            pub.nodes.length === carried.wf.nodes.length && carried.wf.nodes.every((n) => P.has(n.name) && canon(n) === canon(P.get(n.name))));
        check("every connection and the settings of live/ equal the rebuild's", canon(pub.connections) === canon(carried.wf.connections) && canon(pub.settings) === canon(BASE.settings));
        check('the replacement file still hashes to its recorded publishedSha256', rec.parameterEdits.every((e: any) => e.publishedSha256 === createHash('sha256').update(read(e.replaceWholeValueFromFile), 'utf8').digest('hex')));
        check("the record's graph section still hashes to its recorded publishedStructureSha256", Boolean(rec.publishedStructureSha256) && structureSha256(rec) === rec.publishedStructureSha256);
    }

    // ================================================================ 2. PLAN
    console.log('\nPLAN — who gets Person Search');
    const planOf = (o: Record<string, unknown>, minCount = 20) => {
        const sd: any = {};
        const ctx: Ctx = { body: bodyOf({ searchId: 'headhunter_plan', ...o }), sd, liveFallback: false, out: (n) => (n === 'Resolve Search Tier' ? [{ json: { minCount } }] : undefined) };
        return { decision: runCode(nodeIn(NEW, PLAN), [{ json: {} }], ctx)[0][0].json, sd };
    };
    const iraq = planOf({});
    check('an Iraq search with an English title: Person Search, links only, as many as the target, the spend ceiling opened',
        iraq.decision.usePs === true && iraq.decision.query?.country === 'IQ' && iraq.decision.query?.enrich_profiles === 'skip' && iraq.decision.query?.page_size === '20'
        && iraq.decision.query?.current_role_title === '"sales manager"' && iraq.sd.hhSpend?.headhunter_plan?.ceiling === 120, JSON.stringify(iraq.decision));
    check('Tier 40: 40 links, ceiling 240', planOf({}, 40).decision.query?.page_size === '40' && planOf({}, 40).sd.hhSpend?.headhunter_plan?.ceiling === 240);
    check('any organisation (no allowlist)', planOf({ organizationId: 'org_someone_else' }).decision.usePs === true);
    check('Arabic location words count as Iraq', planOf({ location: 'بغداد' }).decision.usePs === true);
    check('not an Iraq search: no Person Search', planOf({ location: 'Dubai, UAE' }).decision.reason === 'not an Iraq search');
    check('an Arabic title: no Person Search (Arabic titles are a later change)', planOf({ position: 'مدير مبيعات' }).decision.reason === 'title is not plain English');
    check('the base still says disabled', (() => {
        const ctx: Ctx = { body: bodyOf({ searchId: 'headhunter_plan' }), sd: {}, liveFallback: false, out: (n) => (n === 'Resolve Search Tier' ? [{ json: { minCount: 20 } }] : undefined) };
        return runCode(nodeIn(BASE, PLAN), [{ json: {} }], ctx)[0][0].json.reason === 'disabled';
    })());

    // ================================================================ 3. LIFECYCLE
    console.log('\nLIFECYCLE — whole searches with Person Search on, in every order');
    const people = (p: string, n: number, sub = 'www') => Array.from({ length: n }, (_, i) => url(`${p}-${i}`, sub));
    const scores = (links: string[], f: (i: number) => number | 'skip') => Object.fromEntries(links.map((l, i) => [slugOf(l), f(i)]));
    const caseOf = (label: string, o: Partial<Scenario>): Scenario => ({ label, body: bodyOf(), p1: ['none'], p2: ['none'], verdict: {}, ...o } as Scenario);
    const ps20 = people('ps', 20);
    const ps40 = people('ps', 40);
    const g10 = people('g', 10);
    const p2links = people('p2', 8);
    type Case = { sc: Scenario; want: (r: Run) => string };
    const cases: Case[] = [
        {
            sc: caseOf('ps fills Tier 20 and everyone qualifies', { ps: ps20, verdict: scores(ps20, () => 90) }),
            want: (r) => (r.psCalls === 1 && !r.serpCalls.length && r.sends.length === 20 && r.completions[0]?.targetMet === true && !r.completions[0]?.serpHealth && credits(r, cases[0].sc) === 3 * 20 + 20 ? '' : `ps ${r.psCalls}, serp ${r.serpCalls.length}, sent ${r.sends.length}`),
        },
        {
            sc: caseOf('ps fills Tier 20 but only 6 qualify: phase 2 asks Google', { ps: ps20, p2: [{ links: p2links }, { links: [...ps20.slice(0, 3), ...p2links.slice(0, 2)] }], verdict: { ...scores(ps20, (i) => (i < 6 ? 85 : 20)), ...scores(p2links, () => 75) } }),
            want: (r) => (r.serpCalls.length > 0 && r.serpCalls.every((s) => s.startsWith('p2')) && r.sends.length > 6 && Boolean(r.completions[0]?.serpHealth) ? '' : `serp ${r.serpCalls.join('|')}, sent ${r.sends.length}`),
        },
        {
            sc: caseOf('ps short (7 links): Google phase 1 runs too, Person Search people fetched first', { ps: ps20.slice(0, 7), p1: [{ links: g10 }, { web: 5 }], verdict: { ...scores(ps20, () => 80), ...scores(g10, (i) => (i % 2 ? 70 : 'skip')) } }),
            want: (r) => (r.serpCalls.some((s) => s.startsWith('p1')) && eq(r.enriched.slice(0, 7).map(slugOf), ps20.slice(0, 7).map(slugOf)) ? '' : `serp ${r.serpCalls.length}, first fetched ${r.enriched.slice(0, 7).map(slugOf)}`),
        },
        {
            sc: caseOf('ps answers with nobody: Google exactly as before', { ps: [], p1: [{ links: g10 }, 'none'], verdict: scores(g10, (i) => (i < 4 ? 80 : 30)) }),
            want: () => '',
        },
        {
            sc: caseOf('ps fills Tier 40', { body: bodyOf({ minCandidateCount: 40 }), ps: ps40, verdict: scores(ps40, () => 88) }),
            want: (r) => (r.sends.length === 40 && credits(r, cases[4].sc) === 3 * 40 + 40 ? '' : `sent ${r.sends.length}`),
        },
        {
            sc: caseOf('ps links on country subdomains are kept (rewritten to www)', { ps: [...people('psiq', 10, 'iq'), ...people('psae', 10, 'ae')], verdict: { ...scores(people('psiq', 10), () => 80), ...scores(people('psae', 10), () => 80) } }),
            want: (r) => (r.enriched.length === 20 && r.enriched.every((l) => l.includes('://www.linkedin.com/')) ? '' : `fetched ${r.enriched.length}`),
        },
        {
            // Without the shared ceiling: 19 x 3 (Person Search) + 19 x 1 + 16 x 2 (phase 1, capped at 35)
            // + 20 x 2 (phase 2) = 148 credits. With it, phase 2 gets only what is left of 120.
            sc: caseOf('ps short by one (19) and Google rich: the shared ceiling cuts phase 2', {
                ps: ps20.slice(0, 19), p1: [{ links: people('rg1', 10) }, { links: people('rg2', 10) }, { links: people('rg3', 10) }, { links: people('rg4', 10) }],
                p2: [{ links: people('rp1', 10) }, { links: people('rp2', 10) }, { links: people('rp3', 10) }],
                verdict: { ...scores(ps20, (i) => (i < 3 ? 80 : 20)), ...Object.fromEntries(['rg1', 'rg2', 'rg3', 'rg4', 'rp1', 'rp2', 'rp3'].flatMap((g) => people(g, 10).map((l, i) => [slugOf(l), i === 0 ? 80 : 20]))) },
            }),
            want: (r) => {
                const p2 = r.enriched.filter((l) => /rp\d-/.test(l)).length;
                return credits(r, cases.find((c) => c.sc.label.startsWith('ps short by one'))!.sc) >= 110 && p2 > 0 && p2 < 20 ? '' : `phase-2 fetches ${p2}, credits ${credits(r, cases.find((c) => c.sc.label.startsWith('ps short by one'))!.sc)}`;
            },
        },
        {
            sc: caseOf('every phase-2 SerpAPI call fails after a short ps phase', { ps: ps20, p2: ['fail', 'fail', 'fail'], verdict: scores(ps20, (i) => (i < 5 ? 90 : 10)) }),
            want: (r) => (r.sends.length === 5 && r.completions[0]?.serpHealth?.failed === r.completions[0]?.serpHealth?.calls ? '' : `sent ${r.sends.length}, health ${JSON.stringify(r.completions[0]?.serpHealth)}`),
        },
        {
            sc: caseOf('ps fills but nobody qualifies and Google finds nobody new', { ps: ps20, p2: [{ links: ps20.slice(0, 5) }], verdict: scores(ps20, () => 10) }),
            want: (r) => (r.sends.length === 0 ? '' : `sent ${r.sends.length}`),
        },
    ];
    for (const { sc, want } of cases) {
        for (const [order, opts] of ORDERS) {
            const r = runSearch(NEW, sc, opts);
            const why = broken(r, sc) || (order === 'natural' ? want(r) : '');
            check(`${sc.label} [${order}]: one completion, nobody twice, ceiling held${order === 'natural' ? ', and the case itself' : ''}`, !why,
                `${why} (credits ${credits(r, sc)})`);
        }
    }
    {
        const base = runSearch(BASE, cases[3].sc); const on = runSearch(NEW, cases[3].sc);
        check('ps answers with nobody: the same sends and completion as with Person Search off (one extra Person Search call)',
            eq(on.sends, base.sends) && eq(on.completions, base.completions) && on.psCalls === 1 && base.psCalls === 0);
    }
    for (const [label, body] of [['not an Iraq search', bodyOf({ location: 'Dubai, United Arab Emirates' })], ['an organisation that never had it before', bodyOf({ organizationId: 'org_other' })]] as const) {
        const sc = caseOf(label, { body, ps: ps20, p1: [{ links: g10 }, { web: 3 }], p2: [{ links: p2links }], verdict: { ...scores(g10, () => 70), ...scores(p2links, () => 60) } });
        const on = runSearch(NEW, sc); const off = runSearch(BASE, sc);
        if (label === 'not an Iraq search') check(`${label}: runs exactly as before (no Person Search call)`, sameRun(on, off) && on.psCalls === 0);
        else check(`${label}: gets Person Search too (no allowlist)`, on.psCalls === 1 && !broken(on, sc));
    }

    // ================================================================ 4. GENERATED
    console.log('\nGENERATED SEARCHES — Person Search on, random answers');
    {
        let seed = 20261003;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const N = 400;
        let ok = 0; let firstBad = '';
        const routes = { ps: 0, google: 0 }; let phase2 = 0; let met = 0; let short = 0; let maxShare = 0; let atCeiling = 0;
        for (let k = 0; k < N; k++) {
            const target = rnd() < 0.3 ? 40 : 20;
            const pool = Array.from({ length: 90 }, (_, i) => `gp-${i}`);
            // Every third search is "rich": Person Search just short of the target and Google answering
            // with many new people, the shape in which the shared ceiling has to cut phase 2.
            const rich = k % 3 === 1;
            const shape = rnd();
            const psCount = rich ? target - 1 - Math.floor(rnd() * 3) : shape < 0.45 ? target : shape < 0.8 ? Math.floor(rnd() * target) : 0;
            const psSlugs = [...new Set(Array.from({ length: psCount * 2 }, () => pick(pool)))].slice(0, psCount);
            let fresh = 0;
            const mk = (): Resp | 'fail' => {
                const r = rnd();
                if (rich) return r < 0.1 ? 'fail' : { links: Array.from({ length: 10 + Math.floor(rnd() * 5) }, () => url(`rich-${k}-${fresh++}`)) };
                if (r < 0.12) return 'fail';
                if (r < 0.2) return 'none';
                if (r < 0.3) return { web: 1 + Math.floor(rnd() * 9) };
                return { links: Array.from({ length: Math.floor(rnd() * 14) }, () => url(pick(pool), pick(['www', 'www', 'iq', 'ae']))) };
            };
            const verdict: Record<string, number | 'skip'> = {};
            const strong = rnd() < 0.4;
            for (const s of pool) verdict[s] = strong ? (rnd() < 0.05 ? 'skip' : 55 + Math.floor(rnd() * 46)) : rnd() < 0.25 ? 'skip' : Math.floor(rnd() * 101);
            // Rich searches' Google people mostly fail, so the search stays short and phase 2 runs.
            const richVerdict = () => (rnd() < 0.15 ? 75 : 15);
            const sc: Scenario = {
                label: `gen-${k}`, body: bodyOf({ searchId: `headhunter_gen-${k}`, minCandidateCount: target, position: pick(['Sales Manager', 'HR Generalist', 'Accountant']) }),
                ps: psSlugs.map((s) => url(s, pick(['www', 'www', 'iq']))), p1: Array.from({ length: 4 }, mk) as Resp[], p2: Array.from({ length: 3 }, mk) as Resp[], verdict,
            };
            if (rich) for (let i = 0; i < fresh; i++) verdict[`rich-${k}-${i}`] = richVerdict();
            const [, opts] = ORDERS[k % ORDERS.length];
            const r = runSearch(NEW, sc, opts);
            const why = broken(r, sc);
            if (!why) ok++; else firstBad = firstBad || `${sc.label} (${ORDERS[k % ORDERS.length][0]}): ${why}`;
            if (r.serpCalls.some((s) => s.startsWith('p1'))) routes.google++; else routes.ps++;
            if (r.serpCalls.some((s) => s.startsWith('p2'))) phase2++;
            if (r.sends.length >= target) met++; else short++;
            maxShare = Math.max(maxShare, credits(r, sc) / CEILING[target]);
            if (credits(r, sc) >= CEILING[target] - 2) atCeiling++;
        }
        check(`${N} searches (every order n8n may take): one completion, nobody sent or fetched twice, ceiling held, honest counts`, ok === N, firstBad);
        check(`coverage: ${routes.ps} skipped Google phase 1, ${routes.google} ran it; ${phase2} reached phase 2; ${met} met the target, ${short} fell short; ${atCeiling} ran up to their ceiling`,
            routes.ps > 80 && routes.google > 80 && phase2 > 80 && met > 40 && short > 40 && atCeiling > 40, JSON.stringify({ routes, phase2, met, short, maxShare, atCeiling }));
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
