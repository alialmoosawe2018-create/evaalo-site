/**
 * headhunter-page2-off-tier40-test
 *
 * Stage 1 (page 1 only, no phase-2 repeat of an answered query, one retry of a
 * query that never answered, an explicit close when phase 1 finds no profile)
 * went live for Tier 20 as df1b0a66 and was proven in exec 2048. This extends it
 * to Tier 40.
 *
 * WHY: the two retained Tier-40 runs (execs 2040 and 2044) spent 44 calls on
 * pages 2-5 and delivered no candidate from them; 7 and 9 of their 20
 * simultaneous phase-1 calls came back as SerpAPI 503s (it gives up after ~90 s);
 * in 2040 two of those page-1 queries were never sent again.
 *
 * This runs the REAL live code (df1b0a66) and the REAL new code side by side:
 * Tier 20 must behave exactly as it does today, case by case, and Tier 40 is
 * replayed on the exact query strings of execs 2040 and 2044 (search titles and
 * city only, no people).
 *
 * Run: npm run test:headhunter-page2-off-tier40
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PATCH_FILE = join(WF_DIR, 'pending', 'headhunter-page2-off-tier40.patch.json');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Item = { json: Record<string, unknown>; error?: { message: string } };
type Ctx = {
    body: Record<string, unknown>;
    sd: Record<string, any>;
    tier?: Record<string, unknown>;
    translation?: Record<string, unknown>;
    prepared?: Item[];
    input?: Item[];
};

function run(code: string, ctx: Ctx): Item[] {
    const $ = (name: string) => {
        if (name === 'Webhook') return { first: () => ({ json: { body: ctx.body } }) };
        if (name === 'Resolve Search Tier') return { first: () => ({ json: ctx.tier || {} }) };
        if (name === 'Apply Translation') return { first: () => ({ json: ctx.translation || {} }) };
        if (name === 'Prepare Serp Pages') return { all: () => ctx.prepared || [] };
        throw new Error(`the node read an unexpected node: ${name}`);
    };
    // eslint-disable-next-line no-new-func
    return new Function('$', '$input', '$getWorkflowStaticData', code)($, { all: () => ctx.input || [] }, () => ctx.sd) as Item[];
}

function onlyTheseLinesRemoved(before: string, after: string, removed: string[]): string[] {
    const a = after.split('\n');
    let j = 0;
    const missing: string[] = [];
    for (const line of before.split('\n')) {
        if (removed.includes(line)) continue;
        while (j < a.length && a[j] !== line) j++;
        if (j >= a.length) { missing.push(line); j = 0; continue; }
        j++;
    }
    return missing;
}

const LOCATION = 'Baghdad, Iraq';
// The two retained Tier-40 runs: phase-1 queries, phase-2 queries as recorded, and
// the page-1 queries SerpAPI gave up on (HTTP 503 "Service unavailable" after ~90 s).
const REAL: Record<string, { position: string; phase1: string[]; phase2: string[]; gaveUp503: string[] }> = {
    '2040': {
        position: 'HR Business Partner',
        phase1: [
            'site:linkedin.com/in/ ("HR Business Partner" OR "شريك أعمال الموارد البشرية") AND "Baghdad" AND "Iraq" AND "5 years" AND "10 years"',
            'site:linkedin.com/in/ "HR Business Partner" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "Partner" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "Human Resources" AND ("Baghdad" OR "Iraq")',
        ],
        phase2: [
            'site:linkedin.com/in/ "HR Business Partner" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Business" OR "Partner") AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "HR Business Partner" ("Baghdad" OR "Iraq")',
        ],
        gaveUp503: [
            'site:linkedin.com/in/ "Partner" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "Human Resources" AND ("Baghdad" OR "Iraq")',
        ],
    },
    '2044': {
        position: 'Sales Manager',
        phase1: [
            'site:linkedin.com/in/ ("Sales Manager" OR "مدير مبيعات") AND ("Baghdad" AND "Iraq") AND ("5 years" OR "6 years" OR "7 years" OR "8 years" OR "9 years" OR "10 years")',
            'site:linkedin.com/in/ "Sales Manager" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "Manager" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Sales" OR "Manager") AND ("Baghdad" OR "Iraq")',
        ],
        phase2: [
            'site:linkedin.com/in/ "Sales Manager" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Sales" OR "Manager") AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "Sales Manager" ("Baghdad" OR "Iraq")',
        ],
        gaveUp503: ['site:linkedin.com/in/ ("Sales" OR "Manager") AND ("Baghdad" OR "Iraq")'],
    },
};

const answer = (q: string, start = 0, profiles = 1): Item => ({
    json: {
        search_metadata: { id: `id-${q.length}-${start}`, status: 'Success' },
        search_parameters: { q, start },
        search_information: { total_results: 3860 },
        organic_results: [
            ...Array.from({ length: profiles }, (_, i) => ({ link: `https://www.linkedin.com/in/person-${q.length}-${start}-${i}` })),
            { link: 'https://www.linkedin.com/pulse/an-article-not-a-profile' },
        ],
    },
});
const noResults = (q: string, start = 0): Item => ({
    json: { search_metadata: { id: `nr-${q.length}-${start}` }, search_parameters: { q, start }, search_information: { total_results: 2 }, error: "Google hasn't returned any results for this query." },
});
const siteDropped = (q: string, start = 0): Item => ({
    json: { search_metadata: { id: `sd-${q.length}-${start}` }, search_parameters: { q, start }, search_information: { total_results: 10300000 }, organic_results: [{ link: 'https://www.reddit.com/r/sales' }] },
});
// SerpAPI's HTTP 503 as n8n hands it to Merge: {json: {error}, error} (SerpAPI gave up after ~90 s).
const serpapi503 = (): Item => ({ json: { error: 'Service unavailable - try again later' }, error: { message: 'Service unavailable - try again later' } });

function main(): void {
    console.log('='.repeat(96));
    console.log('Head Hunter — Stage 1 extended to Tier 40 (Tier 20 must not change at all)');
    console.log('='.repeat(96));

    const patch = JSON.parse(readFileSync(PATCH_FILE, 'utf8'));
    const live = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    const liveNode = (name: string) => String(live.nodes.find((n: { name: string }) => n.name === name)?.parameters?.jsCode ?? '');
    const oldCode: Record<string, string> = {};
    const newCode: Record<string, string> = {};

    console.log('\nPATCH');
    // Published: the pre-change code lives in the archived base; live/ must carry the new code.
    const archived = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    const baseNode = (name: string) => String(archived.nodes.find((n: { name: string }) => n.name === name)?.parameters?.jsCode ?? '');
    check('patch base is the archived pre-change version', archived.versionId === patch.baseVersionId, `${archived.versionId} vs ${patch.baseVersionId}`);
    check('that base has the node count the patch expects', archived.nodes.length === patch.baseNodeCount);
    check('exactly three nodes are touched', patch.parameterEdits.length === 3);
    for (const edit of patch.parameterEdits) {
        const before = baseNode(edit.node);
        const after = readFileSync(join(WF_DIR, 'pending', edit.replaceWholeValueFromFile), 'utf8');
        // CONTENT, not a version id - a version-id check breaks on every later, unrelated publish.
        // Expand Phase 2 Queries was superseded 2026-10-01 by enrich-cap-phase2 (comment only): live/ must
        // carry this code or a RECORDED successor (a published patch whose archived base held exactly this code).
        const carried = liveCarriesOrRecordedSuccessor(WF_DIR, edit.node, after, liveNode(edit.node));
        check(`${edit.node}: the published code or a recorded successor is STILL live, byte for byte (${carried.via})`, carried.ok);
        oldCode[edit.node] = before;
        newCode[edit.node] = after;
        check(`${edit.node}: the archived base had what this replaces`, before.includes(edit.expectBeforeContains));
        check(`${edit.node}: the replacement carries the change`, after.includes(edit.expectAfterContains));
        const lost = onlyTheseLinesRemoved(before, after, edit.removedLines);
        check(`${edit.node}: every other line of the base code is kept, in order`, lost.length === 0, lost.slice(0, 3).join(' | '));
    }
    check('no Tier-20-only gate is left', !/isTier20|tierMin < 40/.test(Object.values(newCode).join('\n')));
    check('Resolve Search Tier keeps the literal \\x00-\\x7f regex bytes of the live node',
        newCode['Resolve Search Tier'].includes('/[^\u0000-\u007f]/'));
    const prepare = liveNode('Prepare Serp Pages');

    // ---- Tier 20: identical to today ----------------------------------------
    console.log('\nTIER 20 — behaves exactly as df1b0a66');
    const tier20 = { minCount: 20 };
    for (const min of [20, 15]) {
        const body = { searchId: 's', position: 'HR Assistant', location: LOCATION, minCandidateCount: min };
        check(`Resolve Search Tier, minCandidateCount ${min}: identical to live`,
            eq(run(oldCode['Resolve Search Tier'], { body, sd: {} }), run(newCode['Resolve Search Tier'], { body, sd: {} })));
    }
    const q1 = REAL['2044'].phase1[0];
    const q2 = REAL['2044'].phase1[1];
    const prepared2: Item[] = [{ json: { q: q1, start: 0 } }, { json: { q: q2, start: 0 } }];
    const mergeCases: [string, Item[]][] = [
        ['two answers', [answer(q1, 0, 3), answer(q2, 0, 2)]],
        ['answer + SerpAPI 503', [answer(q1), serpapi503()]],
        ['"no results" + SerpAPI 503 (no profile)', [noResults(q1), serpapi503()]],
        ['site dropped on both', [siteDropped(q1), siteDropped(q2)]],
        ['all failed', [serpapi503(), serpapi503()]],
    ];
    for (const [label, input] of mergeCases) {
        for (const phase2 of [false, true]) {
            const body = { searchId: 's1', position: 'Sales Manager', location: LOCATION, minCandidateCount: 20 };
            const mk = () => (phase2 ? { hhPhase2: { s1: { pagesPerQuery: 1 } } } : {}) as Record<string, any>;
            const sdOld = mk();
            const sdNew = mk();
            const o = run(oldCode['Merge Serp Results'], { body, sd: sdOld, tier: tier20, prepared: prepared2, input });
            const n = run(newCode['Merge Serp Results'], { body, sd: sdNew, tier: tier20, prepared: prepared2, input });
            const strip = (s: Record<string, any>) => { const c = JSON.parse(JSON.stringify(s)); if (c.hhPhase1Serp) for (const k of Object.keys(c.hhPhase1Serp)) delete c.hhPhase1Serp[k].at; return c; };
            check(`Merge, Tier 20, ${label}, phase ${phase2 ? 2 : 1}: same output and static data as live`, eq(o, n) && eq(strip(sdOld), strip(sdNew)), JSON.stringify(n).slice(0, 140));
        }
    }
    const expand = (code: string, position: string, min: number, sd: Record<string, any>) => run(code, {
        body: { searchId: 'x', position, location: LOCATION, minCandidateCount: min },
        sd,
        tier: { minCount: min >= 40 ? 40 : 20 },
        translation: { position, location: LOCATION },
    }).map((i) => String(i.json.q));
    for (const pos of ['HR Assistant', 'Sales Manager', 'Audit Manager', 'Site Engineer']) {
        const planned = expand(oldCode['Expand Phase 2 Queries'], pos, 20, {});
        for (const [label, rec] of [
            ['no phase-1 record', null],
            ['phase 1 answered query 2', { answered: [planned[0]], failed: [] }],
            ['SerpAPI gave up (503) on a phase-1 query', { answered: [], failed: ['site:linkedin.com/in/ "X" AND ("Baghdad" OR "Iraq")'] }],
            ['everything answered', { answered: planned, failed: [] }],
        ] as [string, Record<string, unknown> | null][]) {
            const mk = () => (rec ? { hhPhase1Serp: { x: { at: 1, ...rec } } } : {}) as Record<string, any>;
            const sdOld = mk();
            const sdNew = mk();
            check(`Expand, Tier 20, ${pos}, ${label}: identical to live`,
                eq(expand(oldCode['Expand Phase 2 Queries'], pos, 20, sdOld), expand(newCode['Expand Phase 2 Queries'], pos, 20, sdNew)) && eq(sdOld, sdNew));
        }
    }

    // ---- Tier 40: the new behaviour ------------------------------------------
    console.log('\nTIER 40 — page 1 only, no answered repeats, retries of unanswered queries');
    for (const min of [40, 30]) {
        const body = { searchId: 's', position: 'Sales Manager', location: LOCATION, minCandidateCount: min };
        const o = run(oldCode['Resolve Search Tier'], { body, sd: {} })[0].json;
        const n = run(newCode['Resolve Search Tier'], { body, sd: {} })[0].json;
        check(`minCandidateCount ${min}: page 1 only (live: ${o.pagesPerQuery})`, n.pagesPerQuery === 1 && o.pagesPerQuery === 5);
        check(`minCandidateCount ${min}: still 4 query variants, maxEnrich 55, everything else as live`,
            n.queryVariants === 4 && n.maxEnrich === 55 && eq({ ...o, pagesPerQuery: 0 }, { ...n, pagesPerQuery: 0 }));
    }
    for (const [id, r] of Object.entries(REAL)) {
        const liveOut = expand(oldCode['Expand Phase 2 Queries'], r.position, 40, {});
        check(`exec ${id}: the LIVE node reproduces the recorded phase-2 queries exactly (shim fidelity)`, eq(liveOut, r.phase2), liveOut.join(' || '));
        const answered = r.phase1.filter((q) => !r.gaveUp503.includes(q));
        const sd: Record<string, any> = { hhPhase1Serp: { x: { at: Date.now(), answered, failed: r.gaveUp503 } } };
        const newOut = expand(newCode['Expand Phase 2 Queries'], r.position, 40, sd);
        const expected: string[] = [];
        for (const q of [...r.gaveUp503, ...r.phase2]) if (!answered.includes(q) && !expected.includes(q)) expected.push(q);
        check(`exec ${id}: phase 2 = the failed page-1 queries once + the planned ones phase 1 did not answer (${expected.length})`,
            eq(newOut, expected), newOut.join(' || '));
        check(`exec ${id}: Tier-40 phase 2 asks for page 1 only (maxEnrich still 40)`, sd.hhPhase2.x.pagesPerQuery === 1 && sd.hhPhase2.x.maxEnrich === 40);
        check(`exec ${id}: the phase-1 record is cleared`, !sd.hhPhase1Serp.x);
    }
    {
        const body = { searchId: 's4', position: 'Sales Manager', location: LOCATION, minCandidateCount: 40 };
        const prepared4 = REAL['2044'].phase1.map((q) => ({ json: { q, start: 0 } }));
        const sd: Record<string, any> = {};
        const out = run(newCode['Merge Serp Results'], { body, sd, tier: { minCount: 40 }, prepared: prepared4, input: [answer(prepared4[0].json.q as string), answer(prepared4[1].json.q as string), answer(prepared4[2].json.q as string), serpapi503()] })[0].json;
        check('Tier 40 phase 1: answered and failed queries are recorded for phase 2',
            out.__completeOnly === false && eq(sd.hhPhase1Serp.s4.failed, [REAL['2044'].phase1[3]]) && sd.hhPhase1Serp.s4.answered.length === 3);
        const sd2: Record<string, any> = {};
        const closed = run(newCode['Merge Serp Results'], { body, sd: sd2, tier: { minCount: 40 }, prepared: prepared4, input: [noResults(REAL['2044'].phase1[0]), siteDropped(REAL['2044'].phase1[1]), serpapi503(), serpapi503()] })[0].json;
        check('Tier 40 phase 1 with no profile at all closes the search explicitly (2 of 4 failed)',
            closed.__completeOnly === true && closed.searchFailed === true && /2 of 4/.test(String(closed.errorMessage)), JSON.stringify(closed).slice(0, 160));
    }

    // ---- budget, exec 2044 ---------------------------------------------------
    console.log('\nBUDGET — exec 2044 (Tier 40, Sales Manager), SerpAPI calls');
    const r = REAL['2044'];
    const count = (tierCode: string, expandCode: string, mergeCode: string) => {
        const sd: Record<string, any> = {};
        const b = { searchId: 'b', position: r.position, location: LOCATION, minCandidateCount: 40 };
        const tier = run(tierCode, { body: b, sd })[0].json;
        const p1 = run(prepare, { body: b, sd, tier, input: r.phase1.map((q) => ({ json: { q } })) });
        // phase 1 answers as production saw them on page 1: SerpAPI gave up (503) on the bag-of-words call
        const answers = p1.map((i) => (r.gaveUp503.includes(String(i.json.q)) && Number(i.json.start) === 0 ? serpapi503() : answer(String(i.json.q), Number(i.json.start))));
        run(mergeCode, { body: b, sd, tier, prepared: p1, input: answers });
        const q2 = run(expandCode, { body: b, sd, tier, translation: { position: r.position, location: LOCATION } });
        const p2 = run(prepare, { body: b, sd, tier, input: q2 });
        return { p1: p1.length, p2: p2.length, deep: [...p1, ...p2].filter((i) => Number(i.json.start) >= 10).length };
    };
    const before = count(oldCode['Resolve Search Tier'], oldCode['Expand Phase 2 Queries'], oldCode['Merge Serp Results']);
    const after = count(newCode['Resolve Search Tier'], newCode['Expand Phase 2 Queries'], newCode['Merge Serp Results']);
    console.log(`    live: phase 1 ${before.p1} + phase 2 ${before.p2} = ${before.p1 + before.p2} calls (pages 2+: ${before.deep})`);
    console.log(`    new : phase 1 ${after.p1} + phase 2 ${after.p2} = ${after.p1 + after.p2} calls (pages 2+: ${after.deep})`);
    check('live today: 29 calls, 22 of them pages 2-5 (as measured in production)', before.p1 === 20 && before.p2 === 9 && before.deep === 22);
    check('new: 6 calls, no page 2+ (4 page-1 + the 503d bag-of-words re-sent + the no-AND title query)', after.p1 === 4 && after.p2 === 2 && after.deep === 0);

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
