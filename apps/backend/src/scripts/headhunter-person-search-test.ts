/**
 * headhunter-person-search-test
 *
 * Person Search first, Google as backup (owner-approved design 2026-10-01; NOT published).
 * Six new phase-1 nodes put EnrichLayer Person Search links in front of the existing path;
 * Filter New URLs gains a shared EnrichLayer ceiling (120 / 240 per search) and
 * Enrichlayer Profile Fetch asks for the cached profile (use_cache=if-present) for
 * Person Search links only. The loop, evaluation, sending, completion and billing are
 * untouched.
 *
 * This test rebuilds the patched workflow IN MEMORY from live/ + the patch, then:
 *   - checks the patch and the graph (every untouched node byte-identical, positions too);
 *   - runs each new node's real code over a matrix of cases;
 *   - chains the new nodes with the REAL production code downstream (Filter New URLs,
 *     Expand Phase 2 Queries, Prepare Serp Pages, Finalize Top N Send, Track Send Progress);
 *   - proves the shared ceiling holds in the worst cases and on random ones;
 *   - THE OWNER'S GATE: after a Person Search phase 1 that falls short, Google's phase 2
 *     really starts and sends a full set of queries - not one weak query.
 * Synthetic data only (the repository is public).
 *
 * Run: npm run test:headhunter-person-search
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const patch = JSON.parse(readFileSync(join(PENDING, 'headhunter-person-search.patch.json'), 'utf8'));

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.keys(v).sort().reduce((a: any, k) => { a[k] = v[k]; return a; }, {}) : v);

type Wf = { versionId: string; nodes: any[]; connections: Record<string, any> };
const live: Wf = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const liveCode = (name: string) => String(live.nodes.find((n) => n.name === name)?.parameters?.jsCode ?? '');

function rebuild(): Wf {
    const wf: Wf = JSON.parse(JSON.stringify(live));
    for (const add of patch.addNodes) {
        const n = JSON.parse(JSON.stringify(add));
        delete n.publishedSha256; // record metadata, not part of the node
        if (n.parameters.jsCodeFile) n.parameters = { jsCode: read(n.parameters.jsCodeFile) };
        wf.nodes.push(n);
    }
    for (const e of patch.parameterEdits) wf.nodes.find((n) => n.name === e.node).parameters.jsCode = read(e.replaceWholeValueFromFile);
    for (const r of patch.parameterReplace) wf.nodes.find((n) => n.name === r.node).parameters = JSON.parse(JSON.stringify(r.after));
    for (const [f, fo, t, ti] of patch.connections.remove) {
        wf.connections[f].main[fo] = wf.connections[f].main[fo].filter((c: any) => !(c.node === t && c.index === ti));
    }
    for (const [f, fo, t, ti] of patch.connections.add) {
        wf.connections[f] = wf.connections[f] || { main: [] };
        while (wf.connections[f].main.length <= fo) wf.connections[f].main.push([]);
        wf.connections[f].main[fo].push({ node: t, type: 'main', index: ti });
    }
    return wf;
}
const wf = rebuild();
const node = (name: string) => wf.nodes.find((n) => n.name === name);
const code = (name: string) => String(node(name)?.parameters?.jsCode ?? '');
const outs = (name: string, o = 0) => ((wf.connections[name]?.main?.[o]) || []).map((c: any) => `${c.node}[${c.index}]`).sort();
const ins = (name: string) => Object.entries(wf.connections).flatMap(([f, c]: [string, any]) =>
    (c.main || []).flatMap((arr: any[], o: number) => (arr || []).filter((x) => x.node === name).map(() => `${f}[${o}]`))).sort();

type Ctx = { body: Record<string, unknown>; sd: Record<string, any>; tier?: Record<string, unknown>; translation?: Record<string, unknown>; plan?: Record<string, unknown>; input?: { json: any }[] };
function run(src: string, ctx: Ctx): any[] {
    const $ = (name: string) => {
        if (name === 'Webhook') return { first: () => ({ json: { body: ctx.body } }) };
        if (name === 'Resolve Search Tier') return { first: () => ({ json: ctx.tier || {} }) };
        if (name === 'Apply Translation') return { first: () => ({ json: ctx.translation || { position: ctx.body.position, location: ctx.body.location } }) };
        if (name === 'Person Search Plan') return { first: () => ({ json: ctx.plan || {} }) };
        throw new Error(`the node read an unexpected node: ${name}`);
    };
    const items = ctx.input || [];
    const $input = { all: () => items, first: () => items[0] };
    // eslint-disable-next-line no-new-func
    return new Function('$', '$input', '$getWorkflowStaticData', src)($, $input, () => ctx.sd);
}
const tierOf = (target: number) => (target >= 40
    ? { minCount: 40, queryVariants: 4, pagesPerQuery: 1, maxEnrich: 55, streamBatchSize: 20 }
    : { minCount: 20, queryVariants: 2, pagesPerQuery: 1, maxEnrich: 35, streamBatchSize: 20 });
const body = (o: Record<string, unknown> = {}) => ({ searchId: 's1', organizationId: 'org_test', position: 'Sales Manager', location: 'Baghdad, Iraq', ...o });
const PLAN = code('Person Search Plan');
const PLAN_ON = PLAN.replace('enabled: false,', 'enabled: true,');
const LINKS = code('Person Search Links');
const ADD = code('Add Person Search Links');
const FILTER_NEW = code('Filter New URLs');
const FILTER_OLD = liveCode('Filter New URLs');
const psUrl = (i: number, sub = 'www') => `https://${sub}.linkedin.com/in/ps-person-${i}`;
const gUrl = (i: number, sub = 'www') => `https://${sub}.linkedin.com/in/google-person-${i}`;
const psResponse = (n: number, total = 1000, status = 200) => ({ json: { statusCode: status, body: { results: Array.from({ length: n }, (_, i) => ({ linkedin_profile_url: psUrl(i), profile: null, last_updated: null })), next_page: null, total_result_count: total } } });

function main(): void {
    console.log('='.repeat(96));
    console.log('Head Hunter — Person Search first, Google as backup (published dark: a2b5cbec)');
    console.log('='.repeat(96));

    // ---------------------------------------------------------------- patch
    console.log('\nPATCH');
    check('patch base is the version in live/ (6e0938bf, 44 nodes)', live.versionId === patch.baseVersionId && live.nodes.length === patch.baseNodeCount);
    for (const e of patch.parameterEdits) {
        const before = liveCode(e.node);
        const after = read(e.replaceWholeValueFromFile);
        check(`${e.node}: live has what this replaces`, before.includes(e.expectBeforeContains));
        check(`${e.node}: the replacement carries the change`, after.includes(e.expectAfterContains));
        const a = after.split('\n');
        let j = 0; const lost: string[] = [];
        for (const line of before.split('\n')) {
            if (e.removedLines.includes(line)) continue;
            while (j < a.length && a[j] !== line) j++;
            if (j >= a.length) { lost.push(line); j = 0; continue; }
            j++;
        }
        check(`${e.node}: every other line is kept, in order`, lost.length === 0, lost.slice(0, 2).join(' | '));
    }
    for (const r of patch.parameterReplace) {
        check(`${r.node}: live parameters are exactly what the patch replaces`, canon(live.nodes.find((n) => n.name === r.node).parameters) === canon(r.before));
    }
    for (const f of ['headhunter-person-search.links.node.js', 'headhunter-person-search.add-links.node.js']) {
        check(`${f}: ASCII only`, /^[\x00-\x7f]*$/.test(read(f)));
    }
    // The n8n tool decodes \u escapes, so the Plan node carries the same real characters production
    // stores (as Map Candidate Fields and Filter New URLs do): only the Iraq words and the curly quotes.
    const planNonAscii = [...new Set([...read('headhunter-person-search.plan.node.js')].filter((c) => c.charCodeAt(0) > 127))].sort().join('');
    check('Person Search Plan: its only non-ASCII characters are the two Arabic Iraq words and the curly quotes',
        planNonAscii === [...new Set([...'عراقبغداد“”'])].sort().join(''), planNonAscii);
    check('Person Search Plan ships DARK (enabled: false)', /enabled: false,/.test(PLAN) && !/enabled: true,/.test(PLAN));
    check('ceiling is 120 / 240', PLAN.includes('ceiling: { 20: 120, 40: 240 }'));

    // ---------------------------------------------------------------- published = tested
    if (patch.publishedVersionId) {
        console.log('\nPUBLISHED (' + String(patch.publishedVersionId).slice(0, 8) + ') — live/ must be exactly the tested rebuild, carried through the recorded publishes since');
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        // Later publishes (the position gate, the empty-chain close ...) change the graph through their own
        // records: apply exactly those, so anything else that changed live/ still fails here.
        const carried = withRecordedPublishesAfter(WF_DIR, String(patch.publishedVersionId), wf);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const newNames = new Set<string>([...patch.addNodes.map((a: any) => a.name), ...carried.added]);
        const strip = (n: any) => { const c = JSON.parse(JSON.stringify(n)); delete c.credentials; if (newNames.has(c.name)) delete c.id; return c; };
        const P = new Map(pub.nodes.map((n) => [n.name, n]));
        // Content, not a version id: a later publish that replaces one of these nodes must go through its own record.
        // A node whose ONLY difference is its jsCode passes when live/'s code is a recorded successor of the
        // rebuild's (e.g. the position gate that replaced Map Candidate Fields on 2026-10-02).
        const sameNode = (n: any): boolean => {
            const p = P.get(n.name);
            if (!p) return false;
            if (canon(strip(n)) === canon(strip(p))) return true;
            const a = strip(n), b = strip(p);
            const codeA = a.parameters?.jsCode, codeB = b.parameters?.jsCode;
            if (typeof codeA !== 'string' || typeof codeB !== 'string') return false;
            delete a.parameters.jsCode; delete b.parameters.jsCode;
            return canon(a) === canon(b) && liveCarriesOrRecordedSuccessor(WF_DIR, n.name, codeA, codeB).ok;
        };
        const same = carried.wf.nodes.every(sameNode);
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (new-node ids and credentials aside)', pub.nodes.length === carried.wf.nodes.length && same);
        const cs = (w: Wf) => Object.entries(w.connections).flatMap(([f, v]: [string, any]) => (v.main || []).flatMap((arr: any[], o: number) => (arr || []).map((x) => `${f}[${o}]->${x.node}[${x.index}]`))).sort();
        check('every connection of live/ equals the tested rebuild carried through the recorded publishes', eq(cs(pub), cs(carried.wf)));
        const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
        check('each published file still hashes to its recorded publishedSha256',
            patch.parameterEdits.every((e: any) => e.publishedSha256 === sha(read(e.replaceWholeValueFromFile)))
            && patch.addNodes.filter((a: any) => a.parameters.jsCodeFile).every((a: any) => a.publishedSha256 === sha(read(a.parameters.jsCodeFile))));
    }

    // ---------------------------------------------------------------- graph
    console.log('\nGRAPH');
    check('50 nodes after the patch', wf.nodes.length === 50, String(wf.nodes.length));
    const changed = new Set(['Filter New URLs', 'Enrichlayer Profile Fetch']);
    const untouched = live.nodes.filter((n) => !changed.has(n.name));
    check('the 42 untouched nodes are byte-identical (positions included)', untouched.length === 42 && untouched.every((n) => canon(n) === canon(node(n.name))));
    const strip = (n: any, keys: string[]) => { const c = JSON.parse(JSON.stringify(n)); for (const k of keys) delete c[k]; return c; };
    check('Enrichlayer Profile Fetch: only its parameters differ', canon(strip(live.nodes.find((n) => n.name === 'Enrichlayer Profile Fetch'), ['parameters'])) === canon(strip(node('Enrichlayer Profile Fetch'), ['parameters'])));
    const fl = live.nodes.find((n) => n.name === 'Filter New URLs');
    check('Filter New URLs: only its jsCode differs', canon({ ...fl, parameters: {} }) === canon({ ...node('Filter New URLs'), parameters: {} }) && Object.keys(fl.parameters).join() === 'jsCode');
    const expectOut: [string, number, string[]][] = [
        ['Apply Translation', 0, ['Person Search Plan[0]']],
        ['Person Search Plan', 0, ['Try Person Search?[0]']],
        ['Try Person Search?', 0, ['Person Search[0]']],
        ['Try Person Search?', 1, ['Build Search Query[0]']],
        ['Person Search', 0, ['Person Search Links[0]']],
        ['Person Search Links', 0, ['Skip Google?[0]']],
        ['Skip Google?', 0, ['Add Person Search Links[0]']],
        ['Skip Google?', 1, ['Build Search Query[0]']],
        ['Filter LinkedIn URLs', 0, ['Add Person Search Links[0]']],
        ['Add Person Search Links', 0, ['Filter New URLs[0]']],
        ['Build Search Query', 0, ['Expand Search Queries[0]']],
        ['Filter New URLs', 0, ['Limit Candidates[0]']],
    ];
    for (const [n, o, want] of expectOut) check(`${n}[${o}] -> ${want.join(', ')}`, eq(outs(n, o), want), outs(n, o).join(', '));
    check('Build Search Query is fed ONLY by the two "go Google" branches', eq(ins('Build Search Query'), ['Skip Google?[1]', 'Try Person Search?[1]']), ins('Build Search Query').join(', '));
    check('Filter New URLs is fed ONLY by Add Person Search Links', eq(ins('Filter New URLs'), ['Add Person Search Links[0]']), ins('Filter New URLs').join(', '));
    check('Add Person Search Links is fed by Skip Google?[0] and Filter LinkedIn URLs[0]', eq(ins('Add Person Search Links'), ['Filter LinkedIn URLs[0]', 'Skip Google?[0]']));
    const allOtherConns = (w: Wf) => canon(Object.fromEntries(Object.entries(w.connections).filter(([k]) => !['Apply Translation', 'Filter LinkedIn URLs'].includes(k) && !patch.addNodes.some((a: any) => a.name === k))));
    check('every other connection is unchanged', allOtherConns(live) === allOtherConns(wf));
    const ps = node('Person Search');
    check('Person Search: GET search/person, credential, no retry, continueRegularOutput, 60 s, full response, never error',
        ps.parameters.url === 'https://enrichlayer.com/api/v2/search/person' && ps.parameters.method === 'GET'
        && ps.credentials?.httpHeaderAuth?.id === 'QjNDjTve6w2mI1WZ' && !ps.retryOnFail && ps.onError === 'continueRegularOutput'
        && ps.parameters.options.timeout === 60000 && ps.parameters.options.response.response.fullResponse === true && ps.parameters.options.response.response.neverError === true
        && ps.parameters.jsonQuery === '={{ JSON.stringify($json.query) }}');
    for (const name of ['Try Person Search?', 'Skip Google?']) {
        check(`${name}: tests $json only (no static data inside an expression)`, !JSON.stringify(node(name).parameters).includes('$getWorkflowStaticData'));
    }
    // Every new node reachable from the Webhook.
    const seen = new Set<string>(['Webhook']); const queue = ['Webhook'];
    while (queue.length) { const x = queue.shift() as string; for (const arr of (wf.connections[x]?.main || [])) for (const c of (arr || [])) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); } }
    check('every new node is reachable from the Webhook', patch.addNodes.every((a: any) => seen.has(a.name)));

    // ---------------------------------------------------------------- Enrichlayer use_cache
    console.log('\nENRICHLAYER PROFILE FETCH — use_cache');
    const jq = String(node('Enrichlayer Profile Fetch').parameters.jsonQuery);
    // eslint-disable-next-line no-new-func
    const evalJq = (json: any) => JSON.parse(new Function('$json', 'return ' + jq.replace(/^=\{\{/, '').replace(/\}\}$/, ''))(json));
    check('a Google link sends exactly what it sends today: profile_url only', eq(evalJq({ link: gUrl(1) }), { profile_url: gUrl(1) }));
    check('a Person Search link asks for the cached profile (if-present, 1 credit)', eq(evalJq({ link: psUrl(1), __ps: true }), { profile_url: psUrl(1), use_cache: 'if-present' }));
    check('__ps must be exactly true (a truthy string does not switch it)', eq(evalJq({ link: gUrl(2), __ps: 'yes' }), { profile_url: gUrl(2) }));

    // ---------------------------------------------------------------- Plan
    console.log('\nPERSON SEARCH PLAN');
    {
        const sd: any = {};
        const out = run(PLAN, { body: body(), sd, tier: tierOf(20) });
        check('shipped (dark): never uses Person Search, writes no static data', out.length === 1 && out[0].json.usePs === false && out[0].json.reason === 'disabled' && Object.keys(sd).length === 0);
    }
    {
        const sd: any = {};
        const out = run(PLAN_ON, { body: body(), sd, tier: tierOf(20) })[0].json;
        check('on, Baghdad, Tier 20: Person Search with 20 links and a 120 ceiling', out.usePs === true && eq(out.query, { country: 'IQ', current_role_title: '"sales manager"', enrich_profiles: 'skip', page_size: '20' }) && sd.hhSpend.s1.ceiling === 120 && sd.hhSpend.s1.spent === 0);
        const sd40: any = {};
        const o40 = run(PLAN_ON, { body: body({ minCandidateCount: 40 }), sd: sd40, tier: tierOf(40) })[0].json;
        check('Tier 40: 40 links and a 240 ceiling', o40.query.page_size === '40' && sd40.hhSpend.s1.ceiling === 240 && o40.target === 40);
    }
    const planCase = (label: string, b: Record<string, unknown>, want: boolean, reason?: string, extra: Partial<Ctx> = {}, src = PLAN_ON) => {
        const out = run(src, { body: body(b), sd: {}, tier: tierOf(20), ...extra })[0].json;
        check(`${label}: ${want ? 'uses' : 'skips'} Person Search${reason ? ` (${reason})` : ''}`, out.usePs === want && (!reason || out.reason === reason), `${out.usePs} / ${out.reason}`);
    };
    planCase('Dubai, UAE', { location: 'Dubai, UAE' }, false, 'not an Iraq search');
    planCase('Arabic city بغداد', { location: 'بغداد' }, true);
    planCase('Erbil, Iraq', { location: 'Erbil, Iraq' }, true);
    planCase('Arabic title typed by the user', { position: 'مدير مبيعات' }, false, 'title is not plain English', { translation: { position: 'Sales Manager', location: 'Baghdad, Iraq' } });
    {
        const out = run(PLAN_ON, { body: body(), sd: {}, tier: tierOf(20), translation: { position: 'Sales Manager (Retail)', location: 'Baghdad, Iraq' } })[0].json;
        check("the query uses the recruiter's own title, never the LLM translation", out.query.current_role_title === '"sales manager"', out.query.current_role_title);
    }
    planCase('no searchId', { searchId: '' }, false, 'no searchId');
    planCase('empty title', { position: '' }, false, 'title is not plain English');
    planCase('allowlist without this organisation', {}, false, 'organisation not in the allowlist', {}, PLAN_ON.replace('orgAllowlist: [],', "orgAllowlist: ['org_other'],"));
    planCase('allowlist with this organisation', {}, true, undefined, {}, PLAN_ON.replace('orgAllowlist: [],', "orgAllowlist: ['org_test'],"));
    {
        const out = run(PLAN_ON, { body: body({ position: '  Sales  "Manager" ' }), sd: {}, tier: tierOf(20) })[0].json;
        check('quotes and spaces are cleaned from the title', out.usePs === true && out.query.current_role_title === '"sales manager"', String(out.query?.current_role_title));
        const curly = run(PLAN_ON, { body: body({ position: 'Sales “Manager”' }), sd: {}, tier: tierOf(20) })[0].json;
        check('a title carrying non-ASCII punctuation is not sent (plain English only)', curly.usePs === false && curly.reason === 'title is not plain English');
        const long = run(PLAN_ON, { body: body({ position: 'x'.repeat(120) }), sd: {}, tier: tierOf(20) })[0].json;
        check('title capped at 80 characters', long.query.current_role_title === '"' + 'x'.repeat(80) + '"');
    }
    {
        const thrown = (() => { try { return new Function('$', '$input', '$getWorkflowStaticData', PLAN_ON)(() => { throw new Error('boom'); }, {}, () => ({})); } catch (e) { return 'THREW'; } })();
        check('if reading a node throws, Plan returns "use Google" instead of throwing', thrown !== 'THREW' && thrown[0].json.usePs === false && /plan error/.test(thrown[0].json.reason));
    }
    {
        const old = Date.now() - 25 * 3600 * 1000;
        const sd: any = { hhSpend: { gone: { at: old } }, hhPersonSearch: { gone: { at: old } }, hhPsLinks: { gone: { at: old, links: ['x'] } } };
        run(PLAN_ON, { body: body(), sd, tier: tierOf(20) });
        check('records older than 24 hours are pruned', !sd.hhSpend.gone && !sd.hhPersonSearch.gone && !sd.hhPsLinks.gone);
    }

    // ---------------------------------------------------------------- Links
    console.log('\nPERSON SEARCH LINKS');
    const links = (resp: any, target = 20, sdIn: any = null) => {
        const sd = sdIn || { hhSpend: { s1: { ceiling: target >= 40 ? 240 : 120, spent: 0, at: Date.now() } } };
        const out = run(LINKS, { body: body(), sd, plan: { target }, input: [resp] })[0].json;
        return { out, sd };
    };
    {
        const { out, sd } = links(psResponse(20, 2408));
        check('20 links for a Tier-20 search: route ps, 60 credits on the record', out.__psRoute === 'ps' && out.links === 20 && sd.hhSpend.s1.spent === 60 && sd.hhPsLinks.s1.links.length === 20 && out.total === 2408);
    }
    {
        const { out, sd } = links(psResponse(26, 26), 40);
        check('26 links for a Tier-40 search: route google (does not fill 40), links kept, 78 credits', out.__psRoute === 'google' && sd.hhPsLinks.s1.links.length === 26 && sd.hhSpend.s1.spent === 78);
    }
    {
        const { out, sd } = links(psResponse(19, 19));
        check('19 links for Tier 20: route google (minPool = target)', out.__psRoute === 'google' && sd.hhSpend.s1.spent === 57);
    }
    {
        const { out, sd } = links(psResponse(0, 0));
        check('no result: route google, nothing stored, 0 credits', out.__psRoute === 'google' && !sd.hhPsLinks.s1 && sd.hhSpend.s1.spent === 0);
    }
    {
        const resp = psResponse(20);
        resp.json.body.results[5].linkedin_profile_url = psUrl(1, 'iq');
        resp.json.body.results[6].linkedin_profile_url = '';
        const { out, sd } = links(resp);
        check('a duplicate (other subdomain) and a result without URL are not links but ARE billed', out.links === 18 && out.__psRoute === 'google' && sd.hhSpend.s1.spent === 60);
    }
    for (const [label, resp] of [
        ['403 (no credits)', { json: { statusCode: 403, body: { description: 'insufficient credits' } } }],
        ['503', { json: { statusCode: 503, data: 'Service unavailable' } }],
        ['200 without results', { json: { statusCode: 200, body: { total_result_count: 5 } } }],
    ] as [string, any][]) {
        const { out, sd } = links(resp);
        check(`${label}: route google, 0 credits, no links`, out.__psRoute === 'google' && sd.hhSpend.s1.spent === 0 && !(sd.hhPsLinks && sd.hhPsLinks.s1));
    }
    {
        const { out, sd } = links({ json: { error: { message: 'timeout of 60000ms exceeded' } } });
        check('no answer (timeout): route google, books the WORST case 3 x 20 = 60, reason kept', out.__psRoute === 'google' && sd.hhSpend.s1.spent === 60 && /timeout/.test(out.error));
        const t40 = links({ json: { error: { message: 'socket hang up' } } }, 40);
        check('…Tier 40 books 120', t40.sd.hhSpend.s1.spent === 120);
    }
    {
        const planItem = { json: { usePs: true, reason: 'person search first', target: 20, query: { country: 'IQ' } } };
        const { out, sd } = links(planItem);
        check('the Person Search node failed as a whole (n8n passed its input on): google, 0 booked, reason recorded', out.__psRoute === 'google' && sd.hhSpend.s1.spent === 0 && /node failed/.test(out.error) && /node failed/.test(sd.hhPersonSearch.s1.error));
    }
    {
        const resp = psResponse(20);
        resp.json.body.results.forEach((r: any, i: number) => { r.linkedin_profile_url = psUrl(i, i % 2 ? 'ae' : 'qa') + '/'; });
        const { out, sd } = links(resp);
        check('links on country subdomains are rewritten to www (the search already filtered country=IQ)', out.__psRoute === 'ps' && sd.hhPsLinks.s1.links.every((u: string) => /^https:\/\/www\.linkedin\.com\/in\/ps-person-\d+$/.test(u)));
    }

    // ---------------------------------------------------------------- Add Person Search Links
    console.log('\nADD PERSON SEARCH LINKS');
    const g = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ json: { link: gUrl(from + i), title: 'x' } }));
    {
        const sd: any = { hhPsLinks: { s1: { at: Date.now(), links: Array.from({ length: 20 }, (_, i) => psUrl(i)) } } };
        const out = run(ADD, { body: body(), sd, input: [{ json: { __psRoute: 'ps' } }] });
        check('route ps: the control item becomes the 20 Person Search links, each marked __ps', out.length === 20 && out.every((o: any) => o.json.__ps === true) && !sd.hhPsLinks.s1);
        const again = run(ADD, { body: body(), sd, input: [{ json: { __psRoute: 'ps' } }] });
        check('the links are handed on once only', again.length === 0);
    }
    {
        const sd: any = { hhPsLinks: { s1: { at: Date.now(), links: [psUrl(0), psUrl(1), psUrl(2)] } } };
        const gi = g(10);
        const out = run(ADD, { body: body(), sd, input: gi });
        check('route google: Person Search links FIRST, then Google\'s in their order', out.length === 13 && out.slice(0, 3).every((o: any) => o.json.__ps === true) && eq(out.slice(3).map((o: any) => o.json), gi.map((i) => i.json)));
    }
    {
        const gi = g(10);
        const out = run(ADD, { body: body(), sd: {}, input: gi });
        check('no Person Search (dark launch): Google\'s list passes through unchanged', out.length === 10 && out.every((o: any, i: number) => o === gi[i]));
    }
    {
        const sd: any = { hhPhase2: { s1: { maxEnrich: 20 } }, hhPsLinks: { s1: { at: Date.now(), links: [psUrl(0)] } } };
        const gi = g(5);
        const out = run(ADD, { body: body(), sd, input: gi });
        check('phase 2: untouched, and does not consume stored links', eq(out, gi) && sd.hhPsLinks.s1.links.length === 1);
    }

    // ---------------------------------------------------------------- dark launch = today
    console.log('\nDARK LAUNCH (enabled: false) — Filter New URLs identical to the published code');
    let darkSame = 0; let darkCases = 0;
    for (const target of [20, 40]) for (const n of [0, 5, 35, 60]) for (const phase2 of [false, true]) {
        const mk = () => ({ ...(phase2 ? { hhPhase2: { s1: { maxEnrich: target >= 40 ? 40 : 20 } } } : {}) });
        const input = g(n);
        const sdO: any = mk(); const sdN: any = mk();
        const o = run(FILTER_OLD, { body: body(), sd: sdO, tier: tierOf(target), input }).map((i: any) => i.json.link);
        const nn = run(FILTER_NEW, { body: body(), sd: sdN, tier: tierOf(target), input }).map((i: any) => i.json.link);
        darkCases++;
        if (eq(o, nn) && eq(sdO.hhFetched?.s1?.slugs, sdN.hhFetched?.s1?.slugs)) darkSame++;
    }
    check(`no spend record: same profiles and same record as today in ${darkSame}/${darkCases} cases`, darkSame === darkCases);

    {
        // An exhausted budget must never hand phase 2 an empty list: n8n would stop the chain and the
        // search would end with no completion. Phase 1 keeps a 2-credit reserve, so this is reachable
        // only if the spend record undercounts (e.g. n8n's whole-node retry) - enforced anyway.
        for (const spent of [119, 120, 130]) {
            const sd: any = { hhPhase2: { s1: { maxEnrich: 20 } }, hhSpend: { s1: { ceiling: 120, spent, at: Date.now() } } };
            const out = run(FILTER_NEW, { body: body(), sd, tier: tierOf(20), input: g(10) });
            check(`budget exhausted (spent ${spent} of 120): phase 2 still sends 1, never an empty list`, out.length === 1, String(out.length));
        }
    }

    // ---------------------------------------------------------------- full chains with REAL downstream code
    console.log('\nCHAINS (real Filter New URLs / Expand Phase 2 Queries / Prepare Serp Pages)');
    const phase2Setup = (sd: any, target: number, title = 'Sales Manager') =>
        run(liveCode('Expand Phase 2 Queries'), { body: body({ position: title, minCandidateCount: target }), sd, tier: tierOf(target) });
    function chain(target: number, psLinks: number, googlePhase1: number, googlePhase2: number, overlap = 0, unusable = 0) {
        const sd: any = {};
        const b = body({ minCandidateCount: target });
        const plan = run(PLAN_ON, { body: b, sd, tier: tierOf(target) })[0].json;
        const resp = psResponse(psLinks + unusable, 5000);
        for (let i = psLinks; i < psLinks + unusable; i++) resp.json.body.results[i].linkedin_profile_url = ''; // billed, no link
        const lk = run(LINKS, { body: b, sd, plan, input: [resp] })[0].json;
        if (lk.__psRoute === 'google' && googlePhase1 === 0) {
            // Merge Serp Results closes the search before Add Person Search Links (known limit): no phase 1, no phase 2.
            return { route: lk.__psRoute, closed: true, p1: [], p2: [], afterP1: sd.hhSpend.s1.spent, total: sd.hhSpend.s1.spent, ceiling: sd.hhSpend.s1.ceiling, sd };
        }
        const addIn = lk.__psRoute === 'ps' ? [{ json: lk }] : g(googlePhase1);
        const p1 = run(FILTER_NEW, { body: b, sd, tier: tierOf(target), input: run(ADD, { body: b, sd, input: addIn }) });
        const afterP1 = sd.hhSpend.s1.spent;
        phase2Setup(sd, target);
        const p2in = [...Array.from({ length: overlap }, (_, i) => ({ json: { link: psUrl(i, 'iq') } })), ...g(googlePhase2, 1000)];
        const p2 = run(FILTER_NEW, { body: b, sd, tier: tierOf(target), input: p2in });
        return { route: lk.__psRoute, closed: false, p1, p2, afterP1, total: sd.hhSpend.s1.spent, ceiling: sd.hhSpend.s1.ceiling, sd };
    }
    {
        const c = chain(20, 20, 0, 40, 5);
        check('Tier 20, ps route: 20 Person Search profiles in phase 1, all __ps, 80 credits', c.route === 'ps' && c.p1.length === 20 && c.p1.every((i: any) => i.json.__ps === true) && c.afterP1 === 80);
        check('…the people Person Search found are NOT paid for again by Google in phase 2', !c.p2.some((i: any) => /ps-person-/.test(i.json.link)));
        check('…phase 2 still gets its full 20 (budget 40 left = 20 profiles): total 120 = ceiling', c.p2.length === 20 && c.total === 120, `${c.p2.length} / ${c.total}`);
    }
    {
        const c = chain(40, 40, 0, 80);
        check('Tier 40, ps route: 160 after phase 1, phase 2 keeps its 40, total 240 = ceiling', c.route === 'ps' && c.afterP1 === 160 && c.p2.length === 40 && c.total === 240, `${c.afterP1} / ${c.p2.length} / ${c.total}`);
    }
    {
        const c = chain(20, 19, 60, 60);
        check('Tier 20, merged route worst case (19 links + Google): phase 1 = 108, phase 2 cut to 6, total 120', c.route === 'google' && c.afterP1 === 108 && c.p2.length === 6 && c.total === 120, `${c.afterP1} / ${c.p2.length} / ${c.total}`);
        check('…phase 1 put the 19 Person Search profiles first', c.p1.slice(0, 19).every((i: any) => i.json.__ps === true) && c.p1.length === 35);
    }
    {
        const c = chain(40, 39, 80, 80);
        check('Tier 40, merged route worst case: phase 1 = 188, phase 2 cut to 26, total 240', c.route === 'google' && c.afterP1 === 188 && c.p2.length === 26 && c.total === 240, `${c.afterP1} / ${c.p2.length} / ${c.total}`);
    }
    {
        // The review's case: Person Search bills 20 results but none carries a usable link, and Google
        // fills phase 1 to its cap. Phase 1 must stop at ceiling - 2 so phase 2 still fits.
        const c = chain(20, 0, 35, 40, 0, 20);
        check('20 billed results without links + 35 Google: phase 1 stops at 118, phase 2 sends 1, total 120', c.afterP1 === 118 && c.p2.length === 1 && c.total === 120, `${c.afterP1} / ${c.p2.length} / ${c.total}`);
        const d = chain(20, 10, 35, 40, 0, 10);
        check('10 usable of 20 billed + 35 Google: still within 120', d.total <= 120 && d.p2.length >= 1, `${d.afterP1} / ${d.p2.length} / ${d.total}`);
    }
    {
        const c = chain(20, 5, 0, 40);
        check('google route with NO Google profile in phase 1: Merge closes the search (known limit), the 15 credits for links are spent', c.closed === true && c.total === 15);
    }
    {
        let worst = 0; let breaches = 0; let zeroPhase2 = 0; let closed = 0;
        for (let k = 0; k < 600; k++) {
            const target = k % 2 ? 40 : 20;
            const ps = Math.floor((Math.sin(k * 7.3) + 1) * 0.5 * (target + 1));
            const unusable = Math.min(target - Math.min(ps, target), Math.floor((Math.cos(k * 5.9) + 1) * 0.5 * 12));
            const c = chain(target, Math.min(ps, target), Math.floor((Math.cos(k * 3.1) + 1) * 40), Math.floor((Math.sin(k * 1.7) + 1) * 50) + 1, k % 5, unusable);
            if (c.closed) { closed++; continue; }
            worst = Math.max(worst, c.total / c.ceiling);
            if (c.total > c.ceiling) breaches++;
            if (c.p2.length === 0 && c.afterP1 < c.ceiling) zeroPhase2++;
        }
        check(`600 generated searches (incl. billed results without links): the ceiling is never exceeded (worst ${(worst * 100).toFixed(0)}% of it; ${closed} closed by Merge)`, breaches === 0);
        check('…and phase 2 is never handed an empty list while budget remains', zeroPhase2 === 0);
    }

    // ---------------------------------------------------------------- THE OWNER'S GATE
    console.log('\nGATE — Google\'s phase 2 after a Person Search phase 1 (no phase-1 SERP record)');
    for (const title of ['Sales Manager', 'HR Generalist', 'HR Business Partner', 'Procurement Officer']) for (const target of [20, 40]) {
        const sd: any = {};
        const b = body({ position: title, minCandidateCount: target });
        const items = run(liveCode('Expand Phase 2 Queries'), { body: b, sd, tier: tierOf(target) });
        const qs = items.map((i: any) => i.json.q);
        const pages = run(liveCode('Prepare Serp Pages'), { body: b, sd, tier: tierOf(target), input: items });
        const titleAnd = `site:linkedin.com/in/ "${title}" AND ("Baghdad" OR "Iraq")`;
        check(`${title}, Tier ${target}: 3 distinct queries incl. "${title}" AND <loc>, page 1 each, phase-2 cap ${target}`,
            qs.length === 3 && new Set(qs).size === 3 && qs.includes(titleAnd) && pages.length === 3 && pages.every((p: any) => Number(p.json.start) === 0) && sd.hhPhase2.s1.maxEnrich === target,
            `${qs.length} queries, ${pages.length} pages, cap ${sd.hhPhase2?.s1?.maxEnrich}`);
        const today = run(liveCode('Expand Search Queries'), { body: b, sd: {}, tier: tierOf(target), input: [{ json: { text: '[LLM query]' } }] }).map((i: any) => i.json.q);
        const missing = today.filter((q: string) => !qs.includes(q)).map((q: string) => q.replace('site:linkedin.com/in/ ', '').replace(' AND ("Baghdad" OR "Iraq")', ' AND <loc>'));
        console.log(`        not sent on the ps route (today's phase 1 only): ${missing.join(' || ') || 'none'}`);
    }
    {
        // Phase 1 by Person Search delivered 15 of 20: does phase 2 really start?
        const sd: any = { hhStats: { s1: { enrichOk: 20, enrichErr: 0 } }, hhCandidates: { s1: Array.from({ length: 15 }, (_, i) => ({ name: `C${i}`, match_score: 80, linkedin_url: psUrl(i), location: 'Iraq' })) } };
        const b = body();
        const shortlist = run(liveCode('Finalize Top N Send'), { body: b, sd, tier: tierOf(20) });
        const track = run(liveCode('Track Send Progress'), { body: b, sd, tier: tierOf(20), input: shortlist });
        check('a short Person Search phase 1 (15 of 20) sends its 15 and then STARTS phase 2', shortlist.length === 15 && track.length === 1 && track[0].json.__startPhase2 === true, JSON.stringify(track[0]?.json));
        const full: any = { hhStats: { s1: { enrichOk: 20, enrichErr: 0 } }, hhCandidates: { s1: Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, match_score: 80, linkedin_url: psUrl(i), location: 'Iraq' })) } };
        const sl2 = run(liveCode('Finalize Top N Send'), { body: b, sd: full, tier: tierOf(20) });
        const tr2 = run(liveCode('Track Send Progress'), { body: b, sd: full, tier: tierOf(20), input: sl2 });
        check('a full Person Search phase 1 (20 of 20) completes without phase 2', tr2[0].json.__completeSearch === true && tr2[0].json.expansionRan === false);
        // KNOWN LIMIT, shown explicitly: a ps-route phase 1 with NO candidate at all ends the search
        // without asking Google (same as a Google phase 1 today; Track Send Progress needs a send).
        const none: any = { hhStats: { s1: { enrichOk: 20, enrichErr: 0 } }, hhCandidates: { s1: [] } };
        const sl3 = run(liveCode('Finalize Top N Send'), { body: b, sd: none, tier: tierOf(20) });
        check('KNOWN LIMIT: a ps phase 1 with zero candidates ends the search (no phase 2)', sl3.length === 1 && sl3[0].json.__completeOnly === true);
        console.log(`        -> "${sl3[0].json.errorMessage}" — Google is not asked in this case`);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
