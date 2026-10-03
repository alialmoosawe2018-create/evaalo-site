// ============================================
// scripts/lib/headhunterWorkflowEngine.ts
// A small offline model of the n8n engine, enough to run the AI Head hunter
// workflow (GlhDGC23n5tT6jVv) end to end on SYNTHETIC data: it runs the REAL code
// of every Code node and stubs only the paid calls (SerpAPI, EnrichLayer, Person
// Search, the model) and the callbacks to Evaalo.
//
// Shared by the Head Hunter patch tests (empty-chain-close, completion-hardening).
// Before a test trusts it, the test makes it replay recorded production traces run
// for run (executions 2048 and 2057) - the model is only as good as that replay.
// ============================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Item = { json: any; error?: any };
export type Wf = { versionId: string; nodes: any[]; connections: Record<string, any>; settings?: any };

export const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.keys(v).sort().reduce((a: any, k) => { a[k] = v[k]; return a; }, {}) : v);
export const clone = <T>(o: T): T => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
export const multisetSubset = (a: string[], b: string[]) => { const m = new Map<string, number>(); for (const x of b) m.set(x, (m.get(x) || 0) + 1); return a.every((x) => { const n = m.get(x) || 0; if (!n) return false; m.set(x, n - 1); return true; }); };

// ============================================================================ patches
/**
 * Applies a pending patch record (pending/*.patch.json) to a workflow snapshot, the way the
 * publish applies it: parameter edits, parameter sets, added and removed nodes, connections.
 * A removed node takes all its connections with it (n8n's removeNode); every connection the
 * record lists under `remove` must exist in the base.
 */
const MODELLED_RECORD_KEYS = new Set([
    'workflowId', 'baseVersionId', 'baseNodeCount', 'baseFile', 'basePatch', 'publishedVersionId', 'publishedNodeIds', 'publishedStructureSha256',
    'addNodes', 'removeNodes', 'removeNodesExpect', 'connections', 'parameterEdits', 'parameterSets',
]);
export function applyPatch(base: Wf, patch: any, pendingDir: string): Wf {
    // A record shape this function does not model (parameterReplace, a singular addNode, a node whose code
    // lives in a jsCodeFile ...) fails loudly instead of being skipped.
    const unknown = Object.keys(patch).filter((k) => !k.startsWith('_') && !MODELLED_RECORD_KEYS.has(k));
    if (unknown.length) throw new Error(`applyPatch: record shape not modelled: ${unknown.join(', ')}`);
    for (const a of patch.addNodes || []) if (a.parameters?.jsCodeFile) throw new Error(`applyPatch: ${a.name}: jsCodeFile not modelled`);
    const wf: Wf = clone(base);
    const node = (name: string) => {
        const n = wf.nodes.find((x) => x.name === name);
        if (!n) throw new Error(`applyPatch: no node ${name}`);
        return n;
    };
    for (const add of patch.addNodes || []) {
        if (wf.nodes.some((x) => x.name === add.name)) throw new Error(`applyPatch: ${add.name} already exists`);
        wf.nodes.push(clone(add));
    }
    for (const e of patch.parameterEdits || []) {
        if (e.path !== 'parameters.jsCode' || !e.replaceWholeValueFromFile) throw new Error(`applyPatch: edit not modelled on ${e.node}`);
        node(e.node).parameters.jsCode = readFileSync(join(pendingDir, e.replaceWholeValueFromFile), 'utf8');
    }
    for (const s of patch.parameterSets || []) {
        const keys = String(s.path).split('.');
        let at = node(s.node).parameters;
        for (const k of keys.slice(0, -1)) at = at[k];
        if (canon(at[keys[keys.length - 1]]) !== canon(s.expectBefore)) throw new Error(`applyPatch: ${s.node} ${s.path} is not what the record expects`);
        at[keys[keys.length - 1]] = clone(s.set);
    }
    for (const [f, fo, t, ti] of patch.connections?.remove || []) {
        const arr = wf.connections[f]?.main?.[fo] || [];
        if (!arr.some((c: any) => c.node === t && c.index === ti)) throw new Error(`applyPatch: no connection ${f}[${fo}] -> ${t}[${ti}]`);
        wf.connections[f].main[fo] = arr.filter((c: any) => !(c.node === t && c.index === ti));
    }
    for (const name of patch.removeNodes || []) {
        node(name);
        wf.nodes = wf.nodes.filter((x) => x.name !== name);
        delete wf.connections[name];
        for (const c of Object.values(wf.connections) as any[]) {
            if (!Array.isArray(c.main)) continue;
            c.main = c.main.map((arr: any[] | null) => (arr && arr.some((x) => x.node === name) ? arr.filter((x) => x.node !== name) : arr));
        }
    }
    for (const [f, fo, t, ti] of patch.connections?.add || []) {
        node(f); node(t);
        wf.connections[f] = wf.connections[f] || { main: [] };
        while (wf.connections[f].main.length <= fo) wf.connections[f].main.push([]);
        wf.connections[f].main[fo].push({ node: t, type: 'main', index: ti });
    }
    return wf;
}

// ============================================================================ the engine
// Modelled from n8n 2.25.6 on the server (read 2026-10-02):
//   workflow-execute.js  a child runs only if its parent's output on that branch is non-empty;
//                        executionOrder v1 sorts a node's children by canvas position (top
//                        first, then left) and unshifts them onto the stack (depth first); a
//                        node whose connections all use input 0 runs once per emission.
//   SplitInBatchesV3     reset/first run: take a batch, remember the rest, clear processedItems;
//                        otherwise: next batch, processedItems += the items that came back;
//                        no batch left: done branch = processedItems (it fires again on every
//                        later loop-back).
//   IfV2 + filter-parameter  strict types; null/undefined are valid; boolean true -> value,
//                        false -> !value; string notEmpty / equals on (value ?? '').
//   expression.js        a failing expression (other than an ExpressionError) renders as
//                        undefined on the backend - $getWorkflowStaticData does not exist in
//                        expressions, so `Is Phase 2?`'s fallback and Limit Candidates' maxItems
//                        are undefined.
//   WorkflowDataProxy    $('X').all(branchIndex, runIndex = last run) / first() / last(). n8n's default
//                        branch is the output the connection leaves from - 0 for every call without
//                        arguments in this workflow, so 0 here (read in n8n-workflow 2.12.0 locally).
//   SplitOut / Limit     execute() as in the source.
const fnCache = new Map<string, Function>();
function compiled(args: string[], src: string): Function {
    const key = args.join(',') + '\u0000' + src;
    let f = fnCache.get(key);
    // eslint-disable-next-line no-new-func
    if (!f) { f = new Function(...args, src); fnCache.set(key, f); }
    return f;
}
/** out(name, branch, run): a node's output items on that branch of that run (default: branch 0, last run). */
export type Ctx = { body: any; sd: any; out: (name: string, branch?: number, run?: number) => Item[] | undefined; liveFallback: boolean };
function accessor(ctx: Ctx) {
    return (name: string) => {
        const at = (branch?: number, run?: number) => {
            const items = name === 'Webhook' ? [{ json: { body: ctx.body } }] : ctx.out(name, branch, run);
            if (!items) throw new Error(`read a node that has not run: ${name}`);
            return items;
        };
        return {
            first: (b?: number, r?: number) => at(b, r)[0],
            all: (b?: number, r?: number) => at(b, r),
            last: (b?: number, r?: number) => { const items = at(b, r); return items[items.length - 1]; },
        };
    };
}
export function evalExpr(expr: unknown, json: any, ctx: Ctx): unknown {
    if (typeof expr !== 'string') return expr;
    const m = /^=\{\{([\s\S]*)\}\}$/.exec(expr.trim());
    if (!m) return expr;
    try {
        return compiled(['$json', '$', '$getWorkflowStaticData'], `return (${m[1]});`)(json, accessor(ctx), ctx.liveFallback ? () => ctx.sd : undefined);
    } catch {
        return undefined;
    }
}
export function runIf(node: any, items: Item[], ctx: Ctx): Item[][] {
    const c = node.parameters.conditions;
    const strict = c.options?.typeValidation === 'strict';
    const t: Item[] = []; const f: Item[] = [];
    for (const item of items) {
        const results = c.conditions.map((cond: any) => {
            const left = evalExpr(cond.leftValue, item.json, ctx);
            const right = evalExpr(cond.rightValue, item.json, ctx);
            const { type, operation } = cond.operator;
            if (strict && left !== null && left !== undefined && typeof left !== type) throw new Error(`${node.name}: wrong type ${typeof left}, expecting ${type}`);
            if (type === 'boolean' && operation === 'true') return Boolean(left);
            if (type === 'boolean' && operation === 'false') return !left;
            if (type === 'string' && operation === 'notEmpty') return String(left ?? '').length !== 0;
            if (type === 'string' && operation === 'equals') return String(left ?? '') === String(right ?? '');
            throw new Error(`${node.name}: operator not modelled ${type}/${operation}`);
        });
        ((c.combinator === 'or') ? results.some(Boolean) : results.every(Boolean)) ? t.push(item) : f.push(item);
    }
    return [t, f];
}
export function runCode(node: any, items: Item[], ctx: Ctx, srcOverride?: string): Item[][] {
    const src = srcOverride ?? String(node.parameters.jsCode);
    const input = clone(items); // the Code node runs in a task runner: items cross a serialisation boundary
    const sdFn = () => ctx.sd;
    let out: any;
    if (node.parameters.mode === 'runOnceForEachItem') {
        out = input.map((it, i) => {
            const r = compiled(['$', '$input', '$json', '$itemIndex', '$getWorkflowStaticData'], src)(accessor(ctx), { item: it, all: () => input, first: () => input[0] }, it.json, i, sdFn);
            return r && r.json ? r : { json: r };
        });
    } else {
        out = compiled(['$', '$input', '$getWorkflowStaticData'], src)(accessor(ctx), { all: () => input, first: () => input[0] }, sdFn);
    }
    if (!Array.isArray(out) || out.some((o) => !o || typeof o.json !== 'object' || o.json === null)) throw new Error(`${node.name}: output is not [{ json }]`);
    return [clone(out)];
}
export function runSplitOut(node: any, items: Item[]): Item[][] {
    const field = String(node.parameters.fieldToSplitOut);
    const out: Item[] = [];
    for (const it of items) {
        let v = it.json[field];
        if (v === undefined) v = [];
        if (typeof v !== 'object' || v === null) v = [v];
        if (!Array.isArray(v)) v = Object.values(v);
        for (const el of v) out.push(typeof el === 'object' && el !== null ? { json: { ...el } } : { json: { [field]: el } });
    }
    return [out];
}
export function runSplitInBatches(node: any, items: Item[], ctx: Ctx, nc: any): Item[][] {
    const batchSize = Number(evalExpr(node.parameters.batchSize, items[0]?.json, ctx));
    const reset = evalExpr(node.parameters.options?.reset, items[0]?.json, ctx) === true;
    const incoming = items.slice();
    let ret: Item[];
    if (nc.items === undefined || reset) {
        ret = incoming.splice(0, batchSize); nc.items = [...incoming]; nc.processedItems = [];
    } else {
        ret = nc.items.splice(0, batchSize); nc.processedItems = [...nc.processedItems, ...incoming];
    }
    if (ret.length === 0) return [nc.processedItems.slice(), []];
    return [[], ret];
}
export function runLimit(node: any, items: Item[], ctx: Ctx): Item[][] {
    const maxItems = evalExpr(node.parameters.maxItems, items[0]?.json, ctx) as any;
    if (maxItems > items.length) return [items];
    return [items.slice(0, maxItems)];
}

// ---------------------------------------------------------------- scenarios (synthetic)
export type Resp = { links?: string[]; web?: number } | 'none' | 'fail';
export type Scenario = {
    label: string;
    body: Record<string, unknown>;
    p1: Resp[];                       // phase-1 SerpAPI answers, by call index
    p2: Resp[];                       // phase-2 SerpAPI answers, by call index
    verdict: Record<string, number | 'skip'>; // per slug: the model's score, or a profile Map Candidate Fields skips
    nameless?: string[];              // slugs whose profile has a title but no name (Has Match? drops them)
    ps?: string[] | null;             // Person Search switched on and returning these links
    pinned?: { google: Resp[]; enrich: string[]; ai: number[]; sends?: number };
    plan?: string;                    // Person Search Plan code override (switched on)
    translation?: { position?: string; location?: string } | string; // Translate Inputs' answer (an Arabic search); a string is returned as the raw model text
    profileTitle?: string;            // the title synthetic profiles carry (default: the searched position)
};
export const url = (slug: string, sub = 'www') => `https://${sub}.linkedin.com/in/${slug}`;
export const slugOf = (link: string) => (String(link).match(/linkedin\.com\/in\/([^?#/]+)/i)?.[1] || '').toLowerCase();
export const bodyOf = (o: Record<string, unknown> = {}) => ({
    searchId: 'headhunter_test-0001', organizationId: 'org_test', position: 'Sales Manager', location: 'Baghdad, Iraq',
    minCandidateCount: 20, callbackUrl: 'https://api.evaalo.com/webhook/n8n/head-hunter/test', inboundSecret: 'test', ...o,
});
export function serpItem(resp: Resp, q: string, start: number): Item {
    if (resp === 'fail') return { json: { error: 'Service unavailable' }, error: { message: 'Service unavailable' } };
    const meta = { search_metadata: { id: 'synthetic', status: 'Success' }, search_parameters: { engine: 'google', q, start } };
    if (resp === 'none') return { json: { ...meta, search_information: { total_results: 0 }, error: "Google hasn't returned any results for this query." } };
    const organic = [
        ...(resp.links || []).map((link, i) => ({ position: i + 1, title: 'Synthetic profile', link, snippet: 'synthetic' })),
        ...Array.from({ length: resp.web || 0 }, (_, i) => ({ position: 50 + i, title: 'Job board', link: `https://jobs.example.com/l/${q.length}-${start}-${i}`, snippet: 'synthetic' })),
    ];
    return { json: { ...meta, search_information: { total_results: 1000 }, organic_results: organic } };
}
export function profileOf(slug: string, sc: Scenario): any {
    const v = sc.verdict[slug];
    const abroad = v === 'skip';
    const position = String(sc.profileTitle ?? sc.body.position);
    return {
        public_identifier: slug, linkedin_profile_url: url(slug), full_name: sc.nameless?.includes(slug) ? '' : `Synthetic ${slug}`,
        occupation: `${position} at Example Co`, headline: position, summary: '',
        city: abroad ? 'Dubai' : 'Baghdad', country: abroad ? 'AE' : 'IQ', country_full_name: abroad ? 'United Arab Emirates' : 'Iraq',
        experiences: [{ title: position, company: 'Example Co' }],
    };
}

// ---------------------------------------------------------------- recorded executions
// Exec 2048 (2026-10-01, df1b0a66, Tier 20): counts per node run as recorded by n8n.
// Synthetic inputs with the same shape: 20 SerpAPI profiles (5 on a foreign subdomain),
// 15 enriched, 12 matched / 3 abroad, 12 sent; phase 2: 17 profiles (6 already fetched,
// 2 foreign), 9 enriched, 3 matched / 6 abroad, scores 46/100/68, 2 sent.
export function scenario2048(): Scenario {
    const P1 = Array.from({ length: 20 }, (_, i) => (i < 15 ? url(`p1-${i}`) : url(`p1-${i}`, 'ae')));
    const P2 = [...Array.from({ length: 6 }, (_, i) => url(`p1-${i}`)), url('p2-x0', 'ae'), url('p2-x1', 'ae'), ...Array.from({ length: 9 }, (_, i) => url(`p2-${i}`))];
    const verdict: Record<string, number | 'skip'> = {};
    [100, 100, 100, 100, 100, 100, 100, 68, 54, 100, 100, 100].forEach((s, i) => { verdict[`p1-${i}`] = s; });
    for (let i = 12; i < 15; i++) verdict[`p1-${i}`] = 'skip';
    ['skip', 'skip', 'skip', 'skip', 'skip', 'skip', 46, 100, 68].forEach((s, i) => { verdict[`p2-${i}`] = s as any; });
    return { label: '2048', body: bodyOf(), p1: [{ links: P1.slice(0, 10) }, { links: P1.slice(10) }], p2: [{ links: P2.slice(0, 10) }, { links: P2.slice(10) }], verdict };
}
export const REC_2048 = [
    'Validate Search Input#0 [1]', 'Validate Callback URL#0 [1]', 'Input Valid#0 [1/0]', 'Resolve Search Tier#0 [1]', 'Needs Translation?#0 [0/1]', 'Apply Translation#0 [1]',
    'Build Search Query#0 [1]', 'Expand Search Queries#0 [2]', 'Prepare Serp Pages#0 [2]', 'Google SerpAPI Search#0 [2]', 'Merge Serp Results#0 [1]', 'All Serp Pages Failed?#0 [0/1]',
    'Split Out#0 [20]', 'Filter LinkedIn URLs#0 [20]', 'Filter New URLs#0 [15]', 'Limit Candidates#0 [15]', 'Split In Batches#0 [0/15]', 'Enrichlayer Profile Fetch#0 [15]',
    'Count Enrich Batch#0 [15]', 'Map Candidate Fields#0 [15]', 'Has Match?#0 [12/3]', 'AI Analyze Candidate#0 [12]', 'Apply AI Analysis#0 [12]', 'Accumulate Candidate#0 [12]',
    'Stream Batch Done#0 [12]', 'Split In Batches#1 [12/0]', 'Is Phase 2?#0 [0/12]', 'Finalize Top N Send#0 [12]', 'Has Final Candidates?#0 [12/0]', 'Send Candidate to Evaalo#0 [12]',
    'Track Send Progress#0 [1]', 'Start Phase 2?#0 [1/0]', 'Expand Phase 2 Queries#0 [2]', 'Prepare Serp Pages#1 [2]', 'Google SerpAPI Search#1 [2]', 'Merge Serp Results#1 [1]',
    'All Serp Pages Failed?#1 [0/1]', 'Split Out#1 [17]', 'Filter LinkedIn URLs#1 [17]', 'Filter New URLs#1 [9]', 'Limit Candidates#1 [9]', 'Split In Batches#2 [0/9]',
    'Enrichlayer Profile Fetch#1 [9]', 'Count Enrich Batch#1 [9]', 'Map Candidate Fields#1 [9]', 'Has Match?#1 [3/6]', 'AI Analyze Candidate#1 [3]', 'Apply AI Analysis#1 [3]',
    'Accumulate Candidate#1 [3]', 'Stream Batch Done#1 [3]', 'Split In Batches#3 [3/0]', 'Is Phase 2?#1 [3/0]', 'Finalize Phase 2 Send#0 [2]', 'Has Final Candidates?#1 [2/0]',
    'Send Candidate to Evaalo#1 [2]', 'Track Send Progress#1 [1]', 'Start Phase 2?#1 [0/1]', 'Complete Search Now?#0 [1/0]', 'Prepare Complete Search#0 [1]', 'Complete Search#0 [1]',
    'Stream Batch Done#2 [6]', 'Split In Batches#4 [9/0]', 'Is Phase 2?#2 [3/6]', 'Finalize Top N Send#1 [1]', 'Has Final Candidates?#2 [0/1]', 'Prepare Complete Search#1 [0]',
    'Finalize Phase 2 Send#1 [1]', 'Has Final Candidates?#3 [0/1]', 'Prepare Complete Search#2 [0]', 'Stream Batch Done#3 [3]', 'Split In Batches#5 [12/0]', 'Is Phase 2?#3 [3/9]',
    'Finalize Top N Send#2 [1]', 'Has Final Candidates?#4 [0/1]', 'Prepare Complete Search#3 [0]', 'Finalize Phase 2 Send#2 [1]', 'Has Final Candidates?#5 [0/1]', 'Prepare Complete Search#4 [0]',
];


export type Run = { completions: any[]; sends: any[]; serpCalls: string[]; enriched: string[]; psCalls: number; trace: string[]; sd: any; runs: Record<string, Item[][][]> };
/**
 * `inject` forces an order n8n v1 does not produce today: right after run `run` of node `after`
 * (its children already queued), an EXTRA run of `node` with `items(r)` goes next - e.g. one more
 * held-back Stream Batch Done run arriving in front of a finalize node's send. The original
 * held-back runs still run later.
 */
export type RunOpts = { liveFallback?: boolean; inject?: { after: string; run: number; node: string; items: (r: Run) => Item[] } };
export function runSearch(wf: Wf, sc: Scenario, opts: RunOpts = {}): Run {
    const sd: any = {};
    const runs: Record<string, Item[][][]> = {};
    const nodeCtx: Record<string, any> = {};
    const ctx: Ctx = {
        body: sc.body, sd, liveFallback: Boolean(opts.liveFallback),
        out: (n, branch = 0, run = -1) => { const rs = runs[n]; if (!rs) return undefined; return rs[run < 0 ? rs.length + run : run]?.[branch]; },
    };
    const r: Run = { completions: [], sends: [], serpCalls: [], enriched: [], psCalls: 0, trace: [], sd, runs };
    const byName = new Map(wf.nodes.map((n) => [n.name, n]));
    const stack: { node: string; items: Item[] }[] = [{ node: 'Validate Search Input', items: [{ json: { body: sc.body } }] }];
    let steps = 0;
    while (stack.length) {
        if (++steps > 5000) throw new Error('engine: runaway');
        const { node: name, items } = stack.shift() as { node: string; items: Item[] };
        const node = byName.get(name);
        if (!node) throw new Error(`engine: no node ${name}`);
        if (node.disabled) throw new Error(`engine: reached a disabled node: ${name}`);
        const input = node.executeOnce ? items.slice(0, 1) : items;
        let outputs: Item[][];
        if (name === 'Google SerpAPI Search') {
            outputs = [input.map((it, i) => {
                r.serpCalls.push(`${it.json.__phase2 ? 'p2' : 'p1'} ${it.json.q} @${it.json.start}`);
                const list = sc.pinned ? sc.pinned.google : (it.json.__phase2 ? sc.p2 : sc.p1);
                return serpItem(list[i] ?? list[list.length - 1] ?? 'none', it.json.q, it.json.start);
            })];
            if (sc.pinned) outputs = [sc.pinned.google.map((resp) => serpItem(resp, 'pinned', 0))];
        } else if (name === 'Translate Inputs') {
            const tr = sc.translation ?? { position: sc.body.position, location: sc.body.location };
            outputs = [[{ json: { text: typeof tr === 'string' ? tr : JSON.stringify(tr) } }]];
        } else if (name === 'Build Search Query') {
            outputs = [[{ json: { text: `site:linkedin.com/in/ ("${sc.body.position}") AND ("Baghdad" OR "Iraq") llm` } }]];
        } else if (name === 'Person Search') {
            r.psCalls++;
            const links = sc.ps || [];
            outputs = [[{ json: { statusCode: 200, body: { results: links.map((l) => ({ linkedin_profile_url: l, profile: null })), total_result_count: links.length } } }]];
        } else if (name === 'Enrichlayer Profile Fetch') {
            r.enriched.push(...input.map((it) => String(it.json.link)));
            outputs = [sc.pinned ? sc.pinned.enrich.map((s) => ({ json: profileOf(s, sc) })) : input.map((it) => ({ json: profileOf(slugOf(it.json.link), sc) }))];
        } else if (name === 'AI Analyze Candidate') {
            // The model answers about the item it actually received.
            outputs = [input.map((it, i) => {
                const v = sc.pinned ? sc.pinned.ai[i] : sc.verdict[slugOf(it.json.linkedin_url)];
                return { json: { text: JSON.stringify({ match_score: typeof v === 'number' ? v : 0, match_insights: [] }) } };
            })];
        } else if (name === 'Send Candidate to Evaalo') {
            r.sends.push(...input.map((it) => clone(it.json)));
            outputs = [input.map(() => ({ json: { ok: true } }))];
        } else if (name === 'Complete Search') {
            r.completions.push(clone(ctx.out('Prepare Complete Search')?.[0]?.json));
            outputs = [[{ json: { ok: true } }]];
        } else if (name === 'Person Search Plan' && sc.plan) {
            outputs = runCode(node, input, ctx, sc.plan);
        } else if (node.type === 'n8n-nodes-base.code') {
            outputs = runCode(node, input, ctx);
        } else if (node.type === 'n8n-nodes-base.if') {
            outputs = runIf(node, input, ctx);
        } else if (node.type === 'n8n-nodes-base.splitOut') {
            outputs = runSplitOut(node, input);
        } else if (node.type === 'n8n-nodes-base.splitInBatches') {
            outputs = runSplitInBatches(node, input, ctx, (nodeCtx[name] = nodeCtx[name] || {}));
        } else if (node.type === 'n8n-nodes-base.limit') {
            outputs = runLimit(node, input, ctx);
        } else {
            throw new Error(`engine: node not modelled: ${name} (${node.type})`);
        }
        (runs[name] = runs[name] || []).push(outputs);
        r.trace.push(`${name}#${runs[name].length - 1} [${outputs.map((o) => o.length).join('/')}]`);
        const toAdd: { node: string; items: Item[]; pos: number[] }[] = [];
        (wf.connections[name]?.main || []).forEach((conns: any[], oi: number) => {
            if (!outputs[oi] || !outputs[oi].length) return;
            for (const c of conns || []) toAdd.push({ node: c.node, items: outputs[oi], pos: byName.get(c.node).position });
        });
        toAdd.sort((a, b) => (a.pos[1] < b.pos[1] ? 1 : a.pos[1] > b.pos[1] ? -1 : a.pos[0] > b.pos[0] ? -1 : 0));
        for (const t of toAdd) stack.unshift({ node: t.node, items: t.items });
        const inj = opts.inject;
        if (inj && inj.after === name && inj.run === runs[name].length - 1) {
            const injected = inj.items(r);
            if (injected.length) stack.unshift({ node: inj.node, items: injected });
        }
    }
    return r;
}
export const nodeOf = (t: string) => t.replace(/#\d+ \[.*$/, '');
export const without = (trace: string[], names: Set<string>) => trace.filter((t) => !names.has(nodeOf(t)));
export const renumber = (trace: string[]) => { const k: Record<string, number> = {}; return trace.map((t) => { const n = nodeOf(t); const i = k[n] = (k[n] ?? -1) + 1; return t.replace(/#\d+ /, `#${i} `); }); };
export const closeFired = (r: Run) => Object.values(r.runs).some((rs) => rs.some((o) => o.some((b) => b.some((i) => i.json && i.json.__nothingToEnrich === true))));
export const sendKey = (s: any) => String(s.linkedin_url || s.name);
// Everything Prepare Complete Search may put in a body. Nothing here looks like a candidate to the
// backend (no name / title / location / experience / skills / education / candidate list), so a
// completion is never stored or billed as a candidate (routes/headHunter.ts isShellCandidate).
export const COMPLETION_KEYS = new Set(['searchId', 'searchComplete', 'searchFailed', 'errorMessage', 'phase1Count', 'totalSent', 'minTarget', 'targetMet', 'expansionRan']);
export const completionOnly = (r: Run) => r.completions.every((c) => c && Object.keys(c).every((k) => COMPLETION_KEYS.has(k)));
