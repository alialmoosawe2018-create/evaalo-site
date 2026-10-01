/**
 * headhunter-page2-off-test
 *
 * Stage 1 of the Page-2 decision, Tier 20 only.
 *
 * THE WASTE: Tier-20 page 2 (start=10) returned a LinkedIn profile in 0 of 16
 * distinct responses in execs 2033-2039 and 1 of 4 in exec 2041 (8 profiles, none
 * delivered: 6 on foreign subdomains, 2 enriched and then dropped) — Google
 * answers "no results" or ignores site:linkedin.com/in/ — while SerpAPI bills an
 * empty answer as a search: in execs 2033-2039, 16 of 32 billed calls bought
 * nothing. Phase 2 also re-sent phase-1 query 2 verbatim: a cache hit in 19 of 20
 * repeats; the 20th (exec 2024) re-answered a call that had failed to connect.
 *
 * Without page 2 a phase 1 can end with no LinkedIn profile at all (1 of 21
 * retained runs, exec 2024, where page 2 had been the backup). Nothing
 * downstream runs on an empty list, so Merge Serp Results now closes such a
 * search explicitly instead of leaving the recruiter on a spinner.
 *
 * THE CHANGE (three nodes): Tier 20 asks for page 1 only, in both phases; phase 2
 * does not re-send a query phase 1 got an answer for, and re-sends once a query
 * that got no answer (a connection error). Tier 40 is untouched.
 *
 * This runs the REAL live node code and the REAL new node code side by side on
 * the same inputs, including the exact query strings of five real Tier-20
 * searches (execs 2033, 2035, 2036, 2039, 2041 — titles and city only, no people).
 *
 * Run: npm run test:headhunter-page2-off
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor } from './headhunter-recorded-successors';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PATCH_FILE = join(WF_DIR, 'pending', 'headhunter-page2-off.patch.json');

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

/** Run node code with the n8n globals it reads; fail on any node it should not read. */
function run(code: string, ctx: Ctx): Item[] {
    const $ = (name: string) => {
        if (name === 'Webhook') return { first: () => ({ json: { body: ctx.body } }) };
        if (name === 'Resolve Search Tier') return { first: () => ({ json: ctx.tier || {} }) };
        if (name === 'Apply Translation') return { first: () => ({ json: ctx.translation || {} }) };
        if (name === 'Prepare Serp Pages') return { all: () => ctx.prepared || [] };
        throw new Error(`the node read an unexpected node: ${name}`);
    };
    const $input = { all: () => ctx.input || [] };
    const $getWorkflowStaticData = () => ctx.sd;
    // eslint-disable-next-line no-new-func
    return new Function('$', '$input', '$getWorkflowStaticData', code)($, $input, $getWorkflowStaticData) as Item[];
}

/** Every line of the live code survives in the new code, in order, except the listed ones. */
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

// The four most recent searches: phase-1 queries and phase-2 queries as recorded.
const REAL: Record<string, { position: string; phase1: string[]; phase2: string[] }> = {
    '2033': {
        position: 'HR Assistant',
        phase1: [
            'site:linkedin.com/in/ ("HR Assistant" OR "مساعد موارد بشرية") AND ("Baghdad" AND "Iraq") AND ("3 years" OR "4 years" OR "5 years")',
            'site:linkedin.com/in/ "HR Assistant" AND ("Baghdad" OR "Iraq")',
        ],
        phase2: [
            'site:linkedin.com/in/ "HR Assistant" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Assistant") AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "HR Assistant" ("Baghdad" OR "Iraq")',
        ],
    },
    '2035': {
        position: 'HR Business Partner',
        phase1: [
            'site:linkedin.com/in/ ("HR Business Partner" OR "شريك أعمال الموارد البشرية") AND ("Baghdad" AND "Iraq") AND ("3 years" OR "4 years" OR "5 years")',
            'site:linkedin.com/in/ "HR Business Partner" AND ("Baghdad" OR "Iraq")',
        ],
        phase2: [
            'site:linkedin.com/in/ "HR Business Partner" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Business" OR "Partner") AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "HR Business Partner" ("Baghdad" OR "Iraq")',
        ],
    },
    '2036': {
        position: 'HR Assistant',
        phase1: [
            'site:linkedin.com/in/ ("HR Assistant" OR "مساعد موارد بشرية") AND "Baghdad" AND "Iraq" AND ("1 year" OR "0 years" OR "0-1 years")',
            'site:linkedin.com/in/ "HR Assistant" AND ("Baghdad" OR "Iraq")',
        ],
        phase2: [
            'site:linkedin.com/in/ "HR Assistant" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Assistant") AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "HR Assistant" ("Baghdad" OR "Iraq")',
        ],
    },
    '2039': {
        position: 'HR Business Partner',
        phase1: [
            'site:linkedin.com/in/ ("HR Business Partner" OR "شريك أعمال الموارد البشرية") AND "Baghdad" AND "Iraq" AND "5 years" AND "10 years"',
            'site:linkedin.com/in/ "HR Business Partner" AND ("Baghdad" OR "Iraq")',
        ],
        phase2: [
            'site:linkedin.com/in/ "HR Business Partner" AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ ("Business" OR "Partner") AND ("Baghdad" OR "Iraq")',
            'site:linkedin.com/in/ "HR Business Partner" ("Baghdad" OR "Iraq")',
        ],
    },
};
REAL['2041'] = {
    position: 'Procurement Officer',
    phase1: [
        'site:linkedin.com/in/ ("Procurement Officer" OR "Officer Procurement" OR "مسؤول مشتريات" OR "موظف مشتريات") AND ("Baghdad" AND "Iraq")',
        'site:linkedin.com/in/ "Procurement Officer" AND ("Baghdad" OR "Iraq")',
    ],
    phase2: [
        'site:linkedin.com/in/ "Procurement Officer" AND ("Baghdad" OR "Iraq")',
        'site:linkedin.com/in/ ("Procurement" OR "Officer") AND ("Baghdad" OR "Iraq")',
        'site:linkedin.com/in/ "Procurement Officer" ("Baghdad" OR "Iraq")',
    ],
};
const LOCATION = 'Baghdad, Iraq';

/** A SerpAPI answer carrying one LinkedIn profile, as the node receives it. */
const answer = (q: string, start = 0, extra: Record<string, unknown> = {}): Item => ({
    json: {
        search_metadata: { id: `id-${q.length}-${start}`, status: 'Success' },
        search_parameters: { q, start },
        search_information: { total_results: 3860 },
        organic_results: [
            { link: `https://www.linkedin.com/in/person-${q.length}-${start}` },
            { link: 'https://www.linkedin.com/pulse/an-article-not-a-profile' },
            { link: 'https://example.com/not-a-profile' },
        ],
        ...extra,
    },
});
const noResults = (q: string, start = 10): Item => ({
    json: {
        search_metadata: { id: `nr-${q.length}-${start}`, status: 'Success' },
        search_parameters: { q, start },
        search_information: { total_results: 2 },
        error: "Google hasn't returned any results for this query.",
    },
});
// The shape Merge really receives: n8n rewrites the routing node's {json: {}, error}
// into {json: {error: message}, error} before any child runs (execs 1860-2040).
const connectionError = (): Item => ({ json: { error: 'Service unavailable - try again later' }, error: { message: 'Service unavailable - try again later' } });
// Same, once an in-between node (the pending serp classifier) has dropped item.error.
const connectionErrorNoItemError = (): Item => ({ json: { error: 'Service unavailable - try again later' } });
/** An answer where Google dropped site: - results, none of them a profile. */
const siteDropped = (q: string, start = 0): Item => ({ json: { search_metadata: { id: `sd-${q.length}-${start}` }, search_parameters: { q, start }, search_information: { total_results: 10300000 }, organic_results: [{ link: 'https://www.reddit.com/r/humanresources' }, { link: 'https://www.linkedin.com/pulse/an-article' }] } });

function main(): void {
    console.log('='.repeat(96));
    console.log('Head Hunter — Tier 20 stops paying for page 2 and for phase-2 repeats of answered queries');
    console.log('='.repeat(96));

    const patch = JSON.parse(readFileSync(PATCH_FILE, 'utf8'));
    const live = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    const liveNode = (name: string) => String(live.nodes.find((n: { name: string }) => n.name === name)?.parameters?.jsCode ?? '');
    const newCode: Record<string, string> = {};
    const oldCode: Record<string, string> = {};

    // ---- the patch is what it says it is -----------------------------------
    console.log('\nPATCH');
    // Published: the pre-fix code lives in the archived base; live/ must carry the new code.
    const archived = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    const baseNode = (name: string) => String(archived.nodes.find((n: { name: string }) => n.name === name)?.parameters?.jsCode ?? '');
    check('patch base is the archived pre-fix version', archived.versionId === patch.baseVersionId, `${archived.versionId} vs ${patch.baseVersionId}`);
    check('that base has the node count the patch expects', archived.nodes.length === patch.baseNodeCount);
    check('exactly three nodes are touched', patch.parameterEdits.length === 3);
    for (const edit of patch.parameterEdits) {
        const before = baseNode(edit.node);
        const after = readFileSync(join(WF_DIR, 'pending', edit.replaceWholeValueFromFile), 'utf8');
        // CONTENT, not a version id - a version-id check breaks on every later, unrelated publish.
        // Superseded 2026-10-01 by headhunter-page2-off-tier40 (all three nodes), then enrich-cap-phase2
        // (Expand Phase 2 Queries, comment only): live/ must carry this code or a RECORDED successor - a
        // published patch whose archived base held exactly the code it replaced.
        const carried = liveCarriesOrRecordedSuccessor(WF_DIR, edit.node, after, liveNode(edit.node));
        check(`${edit.node}: live carries this code or a recorded successor, byte for byte (${carried.via})`, carried.ok);
        oldCode[edit.node] = before;
        newCode[edit.node] = after;
        check(`${edit.node}: the archived base had what this replaces`, before.includes(edit.expectBeforeContains));
        check(`${edit.node}: the replacement carries the change`, after.includes(edit.expectAfterContains));
        const lost = onlyTheseLinesRemoved(before, after, edit.removedLines);
        check(`${edit.node}: every other line of the base code is kept, in order`, lost.length === 0, lost.slice(0, 3).join(' | '));
        check(`${edit.node}: the removed lines really were in the base code`, edit.removedLines.every((l: string) => before.split('\n').includes(l)));
    }
    const prepare = liveNode('Prepare Serp Pages');
    check('Prepare Serp Pages (untouched) still takes phase-1 pages from the tier', prepare.includes('Number(tier.pagesPerQuery) || 2'));
    check('Prepare Serp Pages (untouched) still takes phase-2 pages from hhPhase2', prepare.includes('Number(phase2.pagesPerQuery) || 3'));
    const serpNode = live.nodes.find((n: { name: string }) => n.name === 'Google SerpAPI Search');
    check('the SerpAPI node is untouched and has no retryOnFail (it cannot see per-call errors)', !serpNode.retryOnFail && serpNode.onError === 'continueRegularOutput');

    // ---- Resolve Search Tier ------------------------------------------------
    console.log('\nRESOLVE SEARCH TIER');
    for (const min of [20, 15, 40, 30]) {
        const body = { searchId: 's', position: 'HR Assistant', location: LOCATION, minCandidateCount: min };
        const o = run(oldCode['Resolve Search Tier'], { body, sd: {} })[0].json;
        const n = run(newCode['Resolve Search Tier'], { body, sd: {} })[0].json;
        const tier40 = min >= 40 || min === 30;
        if (tier40) {
            check(`minCandidateCount ${min} (Tier 40): output identical to live`, eq(o, n), JSON.stringify(n));
        } else {
            check(`minCandidateCount ${min} (Tier 20): page 1 only`, n.pagesPerQuery === 1 && o.pagesPerQuery === 2, `${o.pagesPerQuery} -> ${n.pagesPerQuery}`);
            check(`minCandidateCount ${min} (Tier 20): everything else identical to live`, eq({ ...o, pagesPerQuery: 0 }, { ...n, pagesPerQuery: 0 }));
        }
    }

    // ---- Merge Serp Results -------------------------------------------------
    console.log('\nMERGE SERP RESULTS — records what phase 1 got an answer for');
    const [q1, q2] = REAL['2039'].phase1;
    const prepared: Item[] = [{ json: { q: q1, start: 0, __phase2: false } }, { json: { q: q2, start: 0, __phase2: false } }];
    const body = { searchId: 's1', position: 'HR Business Partner', location: LOCATION, minCandidateCount: 20 };
    const tier = { minCount: 20 };
    const tier40 = { minCount: 40 };
    {
        const sdOld: Record<string, any> = {};
        const sdNew: Record<string, any> = {};
        const input = [answer(q1), connectionError()];
        const o = run(oldCode['Merge Serp Results'], { body, sd: sdOld, tier, prepared, input })[0].json;
        const n = run(newCode['Merge Serp Results'], { body, sd: sdNew, tier, prepared, input })[0].json;
        check('the merged results are identical to live', eq(o.organic_results, n.organic_results) && o.__completeOnly === n.__completeOnly);
        check('phase 1: the answered query is recorded as answered', eq(sdNew.hhPhase1Serp?.s1?.answered, [q1]), JSON.stringify(sdNew.hhPhase1Serp?.s1));
        check('phase 1: the query whose call failed to connect is recorded as failed (q taken from the page it was sent for)',
            eq(sdNew.hhPhase1Serp?.s1?.failed, [q2]));
        const stats = n.serpStats as Record<string, unknown>[];
        check('one serpStats line per call', Array.isArray(stats) && stats.length === 2);
        check('serpStats counts LinkedIn PROFILES only (/in/, not /pulse/) among the results', stats[0].organic === 3 && stats[0].linkedin === 1 && stats[0].answered === true,
            JSON.stringify(stats[0]));
        check('serpStats keeps the connection error', stats[1].answered === false && String(stats[1].error).includes('Service unavailable'));
    }
    {
        const sd: Record<string, any> = {};
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [answer(q1), connectionErrorNoItemError()] });
        check('a connection error is still recognised when an in-between node dropped item.error', eq(sd.hhPhase1Serp.s1.failed, [q2]));
    }
    {
        const sd: Record<string, any> = {};
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared: [...prepared, { json: { q: q2, start: 10 } }], input: [answer(q1), answer(q2), noResults(q2)] });
        check('a Google "no results" is an ANSWER, not a failure (never retried)', eq(sd.hhPhase1Serp.s1.answered, [q1, q2]) && eq(sd.hhPhase1Serp.s1.failed, []));
    }
    {
        const sd: Record<string, any> = {};
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [answer(q1), noResults(q2, 0)] });
        check('… also when "no results" was the ONLY call for that query (Tier 20 has one page per query now)',
            eq(sd.hhPhase1Serp.s1.answered, [q1, q2]) && eq(sd.hhPhase1Serp.s1.failed, []), JSON.stringify(sd.hhPhase1Serp.s1));
    }
    {
        const sd: Record<string, any> = {};
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared: [{ json: { q: q1, start: 0 } }, { json: { q: q1, start: 10 } }], input: [answer(q1), connectionError()] });
        check('a query answered on one page and failed on another is ANSWERED, not in the failed list',
            eq(sd.hhPhase1Serp.s1.answered, [q1]) && eq(sd.hhPhase1Serp.s1.failed, []), JSON.stringify(sd.hhPhase1Serp.s1));
    }
    {
        const sd: Record<string, any> = {};
        // continueRegularOutput on a whole-node failure re-emits the node's input items
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [answer(q1), { json: { q: q2, start: 0, __phase2: false } }] });
        check('a whole-node failure (input item re-emitted) is recorded as failed', eq(sd.hhPhase1Serp.s1.failed, [q2]));
    }
    {
        const sd: Record<string, any> = { hhPhase2: { s1: { pagesPerQuery: 1 } } };
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [answer(q1), connectionError()] });
        check('phase 2 records nothing', !sd.hhPhase1Serp);
    }
    {
        const sdOld: Record<string, any> = {};
        const sdNew: Record<string, any> = {};
        const input = [connectionError(), connectionError()];
        const o = run(oldCode['Merge Serp Results'], { body, sd: sdOld, tier, prepared, input });
        const n = run(newCode['Merge Serp Results'], { body, sd: sdNew, tier, prepared, input });
        check('every phase-1 call failed: the same failed-search answer as live', eq(o, n), JSON.stringify(n));
        check('… and nothing is recorded for a search that is over', !sdNew.hhPhase1Serp);
    }
    console.log('\nMERGE SERP RESULTS — a phase 1 with no LinkedIn profile at all closes the search');
    {
        const sd: Record<string, any> = {};
        const out = run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [noResults(q1, 0), connectionError()] })[0].json;
        check('exec 2024\'s shape ("no results" + a connection error, no page 2 to fall back on): an explicit failed completion, not silence',
            out.__completeOnly === true && out.searchFailed === true && /1 of 2/.test(String(out.errorMessage)), JSON.stringify(out));
        check('… and nothing is recorded for phase 2', !sd.hhPhase1Serp);
    }
    {
        const out = run(newCode['Merge Serp Results'], { body, sd: {}, tier, prepared, input: [siteDropped(q1), siteDropped(q2)] })[0].json;
        check('Google dropped site: on both calls: a completion saying no profiles were found (not a failure)',
            out.__completeOnly === true && out.searchFailed === false && /No LinkedIn profiles found/.test(String(out.errorMessage)), JSON.stringify(out));
    }
    {
        const sd: Record<string, any> = { hhPhase2: { s1: { pagesPerQuery: 1 } } };
        const o = run(oldCode['Merge Serp Results'], { body, sd: { hhPhase2: { s1: {} } }, tier, prepared, input: [siteDropped(q1)] })[0].json;
        const n = run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [siteDropped(q1)] })[0].json;
        check('phase 2 with no profile keeps today\'s behaviour (not closed here)', n.__completeOnly === false && eq(o.organic_results, n.organic_results));
    }
    {
        const sdOld: Record<string, any> = {};
        const sdNew: Record<string, any> = {};
        const o = run(oldCode['Merge Serp Results'], { body, sd: sdOld, tier: {}, prepared, input: [siteDropped(q1), siteDropped(q2)] })[0].json;
        const n = run(newCode['Merge Serp Results'], { body, sd: sdNew, tier: {}, prepared, input: [siteDropped(q1), siteDropped(q2)] })[0].json;
        check('an unknown tier falls back to today\'s behaviour (no close, no record), never to Tier 20',
            n.__completeOnly === false && eq(o.organic_results, n.organic_results) && !sdNew.hhPhase1Serp, JSON.stringify(n).slice(0, 120));
    }
    console.log('\nMERGE SERP RESULTS — Tier 40 behaves exactly as live');
    for (const input of [[answer(q1), connectionError()], [siteDropped(q1), siteDropped(q2)], [noResults(q1, 0), connectionError()], [connectionError(), connectionError()]]) {
        const sdOld: Record<string, any> = {};
        const sdNew: Record<string, any> = {};
        const o = run(oldCode['Merge Serp Results'], { body, sd: sdOld, tier: tier40, prepared, input });
        const n = run(newCode['Merge Serp Results'], { body, sd: sdNew, tier: tier40, prepared, input });
        const strip = (x: Item[]) => x.map((i) => { const { serpStats, ...rest } = i.json; return rest; });
        check(`Tier 40, ${input.length} calls: same output as live (serpStats aside) and no phase-1 record`,
            eq(strip(o), strip(n)) && !sdNew.hhPhase1Serp && eq(sdOld, sdNew), JSON.stringify(strip(n)).slice(0, 160));
    }
    {
        const sd: Record<string, any> = { hhPhase1Serp: { old: { at: Date.now() - 25 * 3600 * 1000, answered: [], failed: [] }, fresh: { at: Date.now(), answered: [], failed: [] } } };
        run(newCode['Merge Serp Results'], { body, sd, tier, prepared, input: [answer(q1), answer(q2)] });
        check('records older than 24 h are pruned, fresh ones kept', !sd.hhPhase1Serp.old && Boolean(sd.hhPhase1Serp.fresh) && Boolean(sd.hhPhase1Serp.s1));
    }

    // ---- Expand Phase 2 Queries: real searches ------------------------------
    console.log('\nEXPAND PHASE 2 QUERIES — five real Tier-20 searches');
    const expand = (code: string, position: string, min: number, sd: Record<string, any>, searchId = 'x') => run(code, {
        body: { searchId, position, location: LOCATION, minCandidateCount: min },
        sd,
        tier: { minCount: min >= 40 ? 40 : 20 },
        translation: { position, location: LOCATION },
    }).map((i) => String(i.json.q));
    for (const [id, r] of Object.entries(REAL)) {
        const liveOut = expand(oldCode['Expand Phase 2 Queries'], r.position, 20, {});
        check(`exec ${id}: the LIVE node reproduces the recorded phase-2 queries exactly (shim fidelity)`, eq(liveOut, r.phase2), liveOut.join(' || '));
        const sd: Record<string, any> = { hhPhase1Serp: { x: { at: Date.now(), answered: r.phase1, failed: [] } } };
        const newOut = expand(newCode['Expand Phase 2 Queries'], r.position, 20, sd);
        const expected = r.phase2.filter((q) => !r.phase1.includes(q));
        check(`exec ${id}: the new node drops only the query phase 1 already answered (${r.phase2.length} -> ${newOut.length})`, eq(newOut, expected), newOut.join(' || '));
        check(`exec ${id}: page 1 only in phase 2`, sd.hhPhase2?.x?.pagesPerQuery === 1 && sd.hhPhase2?.x?.maxEnrich === 20);
        check(`exec ${id}: the phase-1 record is cleared`, !sd.hhPhase1Serp.x);
    }

    console.log('\nEXPAND PHASE 2 QUERIES — the retry rule');
    const r = REAL['2039'];
    const [s2, bag, s4] = r.phase2;
    const exp = (answered: string[], failed: string[]) =>
        expand(newCode['Expand Phase 2 Queries'], r.position, 20, { hhPhase1Serp: { x: { at: Date.now(), answered, failed } } });
    check('phase-1 query 2 failed to connect: it is sent once more, first',
        eq(exp([r.phase1[0]], [s2]), [s2, bag, s4]), exp([r.phase1[0]], [s2]).join(' || '));
    check('the AI-built query failed to connect: it is retried as well',
        eq(exp([s2], [r.phase1[0]]), [r.phase1[0], bag, s4]));
    check('every planned query was already answered: phase 2 still gets one query (never an empty list)',
        eq(exp([s2, bag, s4], []), [s2]));
    check('no phase-1 record at all: exactly today\'s three queries',
        eq(expand(newCode['Expand Phase 2 Queries'], r.position, 20, {}), r.phase2));

    console.log('\nTIER 40 — untouched');
    for (const pos of ['HR Business Partner', 'Sales Manager', 'IT Support Engineer']) {
        const sdOld: Record<string, any> = {};
        const sdNew: Record<string, any> = { hhPhase1Serp: { x: { at: Date.now(), answered: [`site:linkedin.com/in/ "${pos}" AND ("Baghdad" OR "Iraq")`], failed: [] } } };
        const o = expand(oldCode['Expand Phase 2 Queries'], pos, 40, sdOld);
        const n = expand(newCode['Expand Phase 2 Queries'], pos, 40, sdNew);
        check(`${pos}: Tier 40 phase-2 queries identical to live, repeats included`, eq(o, n), n.join(' || '));
        check(`${pos}: Tier 40 phase-2 settings identical to live`, eq(sdOld.hhPhase2.x, sdNew.hhPhase2.x));
    }

    // ---- the whole Tier-20 search, as SerpAPI would be called ---------------
    console.log('\nBUDGET — one full Tier-20 search (exec 2039\'s queries), SerpAPI calls');
    const count = (tierCode: string, expandCode: string, mergeCode: string) => {
        const sd: Record<string, any> = {};
        const b = { searchId: 'b', position: r.position, location: LOCATION, minCandidateCount: 20 };
        const tier = run(tierCode, { body: b, sd })[0].json;
        const p1 = run(prepare, { body: b, sd, tier, input: r.phase1.map((q) => ({ json: { q } })) });
        run(mergeCode, { body: b, sd, tier, prepared: p1, input: p1.map((i) => answer(String(i.json.q), Number(i.json.start))) });
        const q2list = run(expandCode, { body: b, sd, tier, translation: { position: r.position, location: LOCATION } });
        const p2 = run(prepare, { body: b, sd, tier, input: q2list });
        const phase1Qs = new Set(p1.map((i) => `${i.json.q}|${i.json.start}`));
        const cached = p2.filter((i) => phase1Qs.has(`${i.json.q}|${i.json.start}`)).length;
        return { p1: p1.length, p2: p2.length, page2: [...p1, ...p2].filter((i) => Number(i.json.start) >= 10).length, cached };
    };
    const before = count(oldCode['Resolve Search Tier'], oldCode['Expand Phase 2 Queries'], oldCode['Merge Serp Results']);
    const after = count(newCode['Resolve Search Tier'], newCode['Expand Phase 2 Queries'], newCode['Merge Serp Results']);
    console.log(`    live: phase 1 ${before.p1} + phase 2 ${before.p2} = ${before.p1 + before.p2} calls (page 2: ${before.page2}, cache repeats: ${before.cached}, billed ${before.p1 + before.p2 - before.cached})`);
    console.log(`    new : phase 1 ${after.p1} + phase 2 ${after.p2} = ${after.p1 + after.p2} calls (page 2: ${after.page2}, cache repeats: ${after.cached}, billed ${after.p1 + after.p2 - after.cached})`);
    check('live today: 10 calls, 5 of them page 2, 2 of them cache repeats (as measured in production)', before.p1 === 4 && before.p2 === 6 && before.page2 === 5 && before.cached === 2);
    check('new: 4 calls, no page 2, no repeat — 4 billed instead of 8', after.p1 === 2 && after.p2 === 2 && after.page2 === 0 && after.cached === 0);

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
