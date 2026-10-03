/**
 * headhunter-phase2-send-all-test
 *
 * "More than 20 / 40" is a minimum (owner decision 2026-10-03; the UI says "Minimum
 * candidates to return", the backend sends "Return more than 20 candidates"). Phase 1
 * never capped, but Finalize Phase 2 Send sent only the shortfall
 * (`.slice(0, target - phase1Sent)`) and dropped qualified people it had already paid
 * to fetch and evaluate: exec 2069 found 5 qualified in phase 2, sent 3, dropped 2.
 * The record pending/headhunter-phase2-send-all.* sends every new qualified candidate;
 * each is billed 6 credits as usual. PUBLISHED 2026-10-03 as n8n version 71b7970f
 * (rollback 9e38c333); the PUBLISHED section pins live/ to the tested rebuild.
 *
 * On synthetic data, with the shared engine:
 *   1. PATCH / GRAPH - one node, only the shortfall cut goes.
 *   2. LIFECYCLE - the exec-2069 shape: 22 delivered instead of 20, one completion
 *      that says 22; a search phase 1 fills is unchanged.
 *   3. GENERATED - random searches: phase 1 and every paid call identical to the base;
 *      phase 2 sends a superset of what it sent; nobody twice; one completion;
 *      the bound (Tier 20 <= 39, Tier 40 <= 79) holds.
 *
 * Run: npm run test:headhunter-phase2-send-all
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch, bodyOf, canon, eq, runSearch, slugOf, url, type Resp, type Run, type Scenario, type Wf } from './lib/headhunterWorkflowEngine.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const rec = JSON.parse(read('headhunter-phase2-send-all.patch.json'));

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const BASE: Wf = JSON.parse(readFileSync(join(WF_DIR, rec.baseFile), 'utf8'));
const NEW: Wf = applyPatch(BASE, rec, PENDING);
const NODE = 'Finalize Phase 2 Send';
const nodeIn = (wf: Wf, name: string) => wf.nodes.find((n) => n.name === name);
const codeOf = (wf: Wf) => String(nodeIn(wf, NODE)?.parameters?.jsCode ?? '');
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
const phase1 = (r: Run) => r.sends.filter((s) => !s.__finalPhase).map((s) => slugOf(String(s.linkedin_url)));
const phase2 = (r: Run) => r.sends.filter((s) => s.__finalPhase).map((s) => slugOf(String(s.linkedin_url)));

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

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — phase 2 sends every new qualified candidate (${rec.publishedVersionId ? 'published ' + String(rec.publishedVersionId).slice(0, 8) : 'pending'}, base ${String(rec.baseVersionId).slice(0, 8)})`);
    console.log('='.repeat(96));

    console.log('\nPATCH / GRAPH');
    check(`base is ${rec.baseFile} (${String(rec.baseVersionId).slice(0, 8)}, ${rec.baseNodeCount} nodes)`, BASE.versionId === rec.baseVersionId && BASE.nodes.length === rec.baseNodeCount);
    const d = lineDiff(codeOf(BASE).split('\n'), codeOf(NEW).split('\n'));
    check('code: the shortfall cut goes, nothing else',
        eq(d.removed.filter((l) => !isComment(l)), [
            'const phase1Sent = (sd.hhPhase1SentCount && sd.hhPhase1SentCount[searchId]) || 0;',
            'const remaining = Math.max(0, minTarget - phase1Sent);',
            'const toSend = shortlist.filter((j) => !sentKeys.has(profileKey(j))).slice(0, remaining);',
        ]) && eq(d.added.filter((l) => !isComment(l)), ['const toSend = shortlist.filter((j) => !sentKeys.has(profileKey(j)));'])
        && d.added.every((l) => [...l].every((ch) => ch.charCodeAt(0) < 128)), JSON.stringify(d));
    check('every other node byte-identical; connections and settings unchanged',
        BASE.nodes.filter((n) => n.name !== NODE).every((n) => canon(n) === canon(nodeIn(NEW, n.name))) && canon(NEW.connections) === canon(BASE.connections) && canon(NEW.settings) === canon(BASE.settings));

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

    console.log('\nLIFECYCLE');
    const people = (p: string, n: number) => Array.from({ length: n }, (_, i) => url(`${p}-${i}`));
    const scores = (links: string[], f: (i: number) => number | 'skip') => Object.fromEntries(links.map((l, i) => [slugOf(l), f(i)]));
    {
        // The exec-2069 shape: Person Search 20, 17 qualify; phase 2 finds 6 new (4 known), 5 qualify.
        const ps = people('ps', 20); const fresh = people('g2', 6);
        const sc: Scenario = {
            label: '2069', body: bodyOf({ searchId: 'headhunter_2069-shape' }), ps, p1: [], p2: [{ links: [...ps.slice(0, 4), ...fresh] }, { web: 10 }, { web: 10 }],
            verdict: { ...scores(ps, (i) => (i < 17 ? 85 : 0)), ...scores(fresh, (i) => (i < 5 ? 90 : 20)) },
        };
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        const c = n.completions[0] || {};
        check(`exec-2069 shape: the base delivers ${b.sends.length} (17 + 3), now ${n.sends.length} (17 + 5)`, b.sends.length === 20 && n.sends.length === 22, `${b.sends.length} / ${n.sends.length}`);
        check('one completion that says 22, target met; the same paid calls as the base',
            n.completions.length === 1 && c.totalSent === 22 && c.targetMet === true && eq(n.enriched, b.enriched) && eq(n.serpCalls, b.serpCalls) && n.psCalls === b.psCalls, JSON.stringify(c));
        check('nobody sent twice, and phase 1 is untouched', new Set(n.sends.map((s) => slugOf(String(s.linkedin_url)))).size === n.sends.length && eq(phase1(n), phase1(b)));
    }
    for (const [target, p1Count] of [[20, 19], [40, 39]] as const) {
        // The bound: phase 1 one short of the target, phase 2 fetches its full cap and all qualify.
        // Synthetic: one answer carries more links than a real Google page (10), so the cap binds.
        const g1 = people(`b${target}-p1`, p1Count); const g2 = people(`b${target}-p2`, target + 15);
        const sc: Scenario = {
            label: `bound-${target}`, body: bodyOf({ searchId: `headhunter_bound-${target}`, minCandidateCount: target }), ps: [],
            p1: [{ links: g1 }, 'none'], p2: [{ links: g2 }, 'none'],
            verdict: { ...scores(g1, () => 80), ...scores(g2, () => 80) },
        };
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        const c = n.completions[0] || {};
        const max = p1Count + target;
        check(`the bound, Tier ${target}: phase 1 sends ${phase1(n).length}, phase 2 fetches ${n.enriched.length - p1Count} -> base ${b.sends.length}, now ${n.sends.length} (= ${max}, the most a Tier ${target} search can deliver)`,
            phase1(n).length === p1Count && b.sends.length === target && n.sends.length === max && n.completions.length === 1 && c.totalSent === max && eq(n.enriched, b.enriched), JSON.stringify(c));
    }
    {
        // Phase 1 fills the target on its own: no phase 2, nothing changes.
        const g = people('g1', 30);
        const sc: Scenario = { label: 'p1-fills', body: bodyOf({ searchId: 'headhunter_p1-fills' }), ps: [], p1: [{ links: g.slice(0, 15) }, { links: g.slice(15) }], p2: ['none'], verdict: scores(g, (i) => (i < 25 ? 80 : 10)) };
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        check(`a search phase 1 fills (${n.sends.length} delivered): identical to the base`, eq(n.sends, b.sends) && eq(n.completions, b.completions) && eq(n.trace, b.trace));
    }

    console.log('\nGENERATED');
    {
        let seed = 20261006;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const N = 300;
        let ok = 0; let firstBad = ''; let grew = 0; let extra = 0; let maxT20 = 0; let maxT40 = 0;
        for (let k = 0; k < N; k++) {
            const target = rnd() < 0.3 ? 40 : 20;
            const pool = Array.from({ length: 90 }, (_, i) => `p${k}-${i}`);
            const mk = (): Resp | 'fail' => { const r = rnd(); return r < 0.1 ? 'fail' : r < 0.18 ? 'none' : r < 0.25 ? { web: 3 } : { links: Array.from({ length: 4 + Math.floor(rnd() * 11) }, () => url(pick(pool))) }; };
            const verdict: Record<string, number | 'skip'> = {};
            const strong = rnd() < 0.5;
            for (const s of pool) verdict[s] = rnd() < 0.15 ? 'skip' : strong ? 40 + Math.floor(rnd() * 61) : Math.floor(rnd() * 101);
            const ps = rnd() < 0.5 ? pool.slice(0, Math.floor(rnd() * (target + 1))).map((s) => url(s)) : [];
            const sc: Scenario = { label: `gen-${k}`, body: bodyOf({ searchId: `headhunter_p2all-${k}`, minCandidateCount: target }), ps, p1: Array.from({ length: 4 }, mk) as Resp[], p2: Array.from({ length: 3 }, mk) as Resp[], verdict };
            const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
            const c = n.completions[0] || {};
            const slugs = n.sends.map((s) => slugOf(String(s.linkedin_url)));
            const why =
                n.completions.length !== 1 ? `${n.completions.length} completions`
                : new Set(slugs).size !== slugs.length ? 'sent twice'
                : n.sends.length && c.totalSent !== n.sends.length ? `totalSent ${c.totalSent} vs ${n.sends.length}`
                : !eq(phase1(n), phase1(b)) ? 'phase 1 changed'
                : !phase2(b).every((s) => phase2(n).includes(s)) ? 'phase 2 lost a candidate the base sent'
                : !(eq(n.enriched, b.enriched) && eq(n.serpCalls, b.serpCalls) && n.psCalls === b.psCalls) ? 'paid calls changed'
                : (target === 20 ? n.sends.length > 39 : n.sends.length > 79) ? `over the bound: ${n.sends.length}`
                : '';
            if (!why) ok++; else firstBad = firstBad || `${sc.label}: ${why}`;
            if (n.sends.length > b.sends.length) { grew++; extra += n.sends.length - b.sends.length; }
            if (target === 20) maxT20 = Math.max(maxT20, n.sends.length); else maxT40 = Math.max(maxT40, n.sends.length);
        }
        check(`${N} searches: one completion, nobody twice, phase 1 and every paid call identical, phase 2 a superset, within the bound`, ok === N, firstBad);
        check(`coverage: ${grew} searches delivered more (${extra} extra candidates in all); most delivered: Tier 20 ${maxT20}, Tier 40 ${maxT40}`, grew >= 15);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
