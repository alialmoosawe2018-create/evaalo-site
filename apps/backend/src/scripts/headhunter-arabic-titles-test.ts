/**
 * headhunter-arabic-titles-test
 *
 * An Arabic job title reaches n8n raw when the recruiter types one the catalog does
 * not resolve. Google's queries already used its English translation (Apply
 * Translation), but two places did not (2026-10-03, verified on the live code):
 *   - the title gate in Map Candidate Fields matched profile titles against the
 *     Arabic words only, so an Arabic "accountant" search kept only the few profiles
 *     titled in Arabic and dropped every "Accountant";
 *   - Person Search Plan skipped Person Search ("title is not plain English").
 * The record pending/headhunter-arabic-titles.* fixes both: the gate ALSO matches the
 * translation, and Person Search uses it. An English search is unchanged.
 * PUBLISHED 2026-10-03 as n8n version 9e38c333 (rollback 4496e0fe); the PUBLISHED
 * section pins live/ to the tested rebuild.
 *
 * On synthetic data (the repo is public), with the shared engine:
 *   1. PATCH / GRAPH - two nodes, jsCode only; the gate block is unchanged apart from
 *      being wrapped (compared without indentation).
 *   2. GATE - the node itself: Arabic keeps exactly (English gate on the translation)
 *      UNION (the old Arabic gate); an English search keeps exactly what it kept and
 *      never reads the translation.
 *   3. PLAN - Arabic uses the translation, a broken translation still skips; English as before.
 *   4. LIFECYCLE / GENERATED - whole searches: Arabic searches now deliver; English
 *      searches are identical to the base.
 *
 * Run: npm run test:headhunter-arabic-titles
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyPatch, bodyOf, canon, eq, runCode, runSearch, slugOf, url,
    type Ctx, type Item, type Resp, type Run, type Scenario, type Wf,
} from './lib/headhunterWorkflowEngine.js';
import { structureSha256, withRecordedPublishesAfter } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PENDING = join(WF_DIR, 'pending');
const read = (f: string) => readFileSync(join(PENDING, f), 'utf8');
const rec = JSON.parse(read('headhunter-arabic-titles.patch.json'));

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const BASE: Wf = JSON.parse(readFileSync(join(WF_DIR, rec.baseFile), 'utf8'));
const NEW: Wf = applyPatch(BASE, rec, PENDING);
const MAP = 'Map Candidate Fields';
const PLAN = 'Person Search Plan';
const nodeIn = (wf: Wf, name: string) => wf.nodes.find((n) => n.name === name);
const codeOf = (wf: Wf, name: string) => String(nodeIn(wf, name)?.parameters?.jsCode ?? '');
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
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
const code = (lines: string[]) => lines.filter((l) => !isComment(l) && l.trim() !== '');

/** Run the gate node on synthetic profiles; returns the kept titles and which nodes it read. */
function gate(wf: Wf, position: string, titles: string[], translation?: string | null): { kept: string[]; reads: string[] } {
    const reads: string[] = [];
    const items: Item[] = titles.map((t, i) => ({ json: { public_identifier: `g${i}`, linkedin_profile_url: url(`g${i}`), full_name: `Synthetic G${i}`, occupation: `${t} at Example Co`, headline: t, summary: '', city: 'Baghdad', country: 'IQ', country_full_name: 'Iraq', experiences: [{ title: t, company: 'Example Co' }] } }));
    const ctx: Ctx = {
        body: { searchId: 'headhunter_gate', position, location: 'Baghdad, Iraq' }, sd: {}, liveFallback: false,
        out: (n) => { reads.push(n); return n === 'Apply Translation' && translation != null ? [{ json: { position: translation, location: 'Baghdad, Iraq' } }] : undefined; },
    };
    const out = runCode(nodeIn(wf, MAP), items, ctx)[0];
    return { kept: out.filter((o) => !o.json.__skip).map((o) => String(o.json.headline)), reads };
}
const set = (xs: string[]) => [...new Set(xs)].sort();
const union = (a: string[], b: string[]) => set([...a, ...b]);

function plan(wf: Wf, position: string, translation?: string | null): any {
    const ctx: Ctx = {
        body: bodyOf({ searchId: 'headhunter_plan', position }), sd: {}, liveFallback: false,
        out: (n) => (n === 'Resolve Search Tier' ? [{ json: { minCount: 20 } }] : n === 'Apply Translation' && translation != null ? [{ json: { position: translation, location: 'Baghdad, Iraq' } }] : undefined),
    };
    return runCode(nodeIn(wf, PLAN), [{ json: {} }], ctx)[0][0].json;
}

function broken(r: Run, sc: Scenario): string {
    if (r.completions.length !== 1) return `${r.completions.length} completions`;
    const slugs = r.sends.map((s) => slugOf(String(s.linkedin_url)));
    if (new Set(slugs).size !== slugs.length) return 'a candidate was sent twice';
    const ps = new Set((sc.ps || []).map(slugOf));
    const credits = 3 * (r.psCalls ? (sc.ps || []).length : 0) + r.enriched.reduce((s, l) => s + (ps.has(slugOf(l)) ? 1 : 2), 0);
    const target = Number(sc.body.minCandidateCount) >= 40 ? 40 : 20;
    if (credits > CEILING[target]) return `${credits} credits > ${CEILING[target]}`;
    return '';
}
const sameRun = (a: Run, b: Run) => eq(a.completions, b.completions) && eq(a.sends, b.sends) && eq(a.serpCalls, b.serpCalls) && eq(a.enriched, b.enriched) && a.psCalls === b.psCalls && eq(a.trace, b.trace);

const TITLES = ['Accountant', 'Senior Accountant', 'Chief Accountant', 'محاسب', 'محاسب أول', 'Sales Manager', 'Regional Sales Manager', 'مدير مبيعات', 'HR Specialist', 'Human Resources Specialist', 'أخصائي موارد بشرية', 'Software Engineer', 'Procurement Officer', 'مسؤول مشتريات', 'Driver', 'Executive Secretary', 'سكرتير تنفيذي'];
const ARABIC_CASES: [string, string][] = [
    ['محاسب', 'Accountant'],
    ['مدير مبيعات', 'Sales Manager'],
    ['أخصائي موارد بشرية', 'Human Resources Specialist'],
    ['مسؤول مشتريات', 'Procurement Officer'],
    // No Arabic mapping in the English gate: only the Arabic gate keeps the Arabic-titled profile.
    ['سكرتير', 'Secretary'],
];

function main(): void {
    console.log('='.repeat(96));
    console.log(`Head Hunter — Arabic job titles (${rec.publishedVersionId ? 'published ' + String(rec.publishedVersionId).slice(0, 8) : 'pending'}, base ${String(rec.baseVersionId).slice(0, 8)})`);
    console.log('='.repeat(96));

    // ================================================================ 1. PATCH / GRAPH
    console.log('\nPATCH');
    check(`base is ${rec.baseFile} (${String(rec.baseVersionId).slice(0, 8)}, ${rec.baseNodeCount} nodes)`, BASE.versionId === rec.baseVersionId && BASE.nodes.length === rec.baseNodeCount);
    check('two edits (Map Candidate Fields, Person Search Plan), nothing else in the record', eq(rec.parameterEdits.map((e: any) => e.node), [MAP, PLAN]) && !rec.addNodes && !rec.removeNodes && !rec.connections && !rec.parameterSets);
    {
        const oldM = codeOf(BASE, MAP).split('\n'); const newM = codeOf(NEW, MAP).split('\n');
        const d = lineDiff(oldM.map((l) => l.trim()), newM.map((l) => l.trim()));
        // The added lines as a set: braces line up differently under the diff, the content is what matters.
        check('Map Candidate Fields: only the gate wrapper changes (indentation ignored)',
            eq(code(d.removed), ['function matchesPosition(titles) {', 'if (!matchesPosition(profileTitles(profile, experiences))) {'])
            && eq(set(code(d.added)), set([
                'function makePositionMatcher(position) {', 'function matches(titles) {', 'return matches;', '}',
                'const POSITION_MATCHERS = [makePositionMatcher(position)];', 'if (/\\p{Script=Arabic}/u.test(position)) {', "let translated = '';", 'try {',
                "translated = String($('Apply Translation').first().json.position || '').toLowerCase().trim();", '} catch (e) {}',
                'if (translated && translated !== position.trim() && /^[\\x20-\\x7e]+$/.test(translated) && /[a-z]/.test(translated)) {',
                'POSITION_MATCHERS.push(makePositionMatcher(translated));', '}', '}', 'function matchesAnyPosition(titles) {',
                'return POSITION_MATCHERS.some((matches) => matches(titles));', '}', 'if (!matchesAnyPosition(profileTitles(profile, experiences))) {',
            ])) && code(d.added).length <= 20, JSON.stringify({ removed: code(d.removed), added: code(d.added) }));
        check('Map Candidate Fields: the added lines are ASCII (the Arabic in it is the old word lists, only re-indented)', d.added.every((l) => [...l].every((ch) => ch.charCodeAt(0) < 128)));
        const oldP = codeOf(BASE, PLAN).split('\n'); const newP = codeOf(NEW, PLAN).split('\n');
        const p = lineDiff(oldP, newP);
        check('Person Search Plan: only the title source changes',
            eq(code(p.removed), ["  const title = rawPosition", "  const ascii = (s) => /^[\\x20-\\x7e]*$/.test(s);", "  else if (!title || !/[a-z]/.test(title) || !ascii(title) || !ascii(rawPosition)) decision.reason = 'title is not plain English';"])
            && eq(code(p.added), ["  const ascii = (s) => /^[\\x20-\\x7e]*$/.test(s);", '  let titleSource = rawPosition;', '  if (!ascii(rawPosition)) {', '    try {', "      titleSource = String($('Apply Translation').first().json.position || '');", '    } catch (e) {', "      titleSource = '';", '    }', '  }', '  const title = titleSource', "  else if (!title || !/[a-z]/.test(title) || !ascii(title) || !ascii(titleSource)) decision.reason = 'title is not plain English';"])
            && p.added.every((l) => [...l].every((ch) => ch.charCodeAt(0) < 128)), JSON.stringify({ removed: code(p.removed), added: code(p.added) }));
    }
    console.log('\nGRAPH');
    check('every other node byte-identical; connections and settings unchanged',
        BASE.nodes.filter((n) => n.name !== MAP && n.name !== PLAN).every((n) => canon(n) === canon(nodeIn(NEW, n.name))) && NEW.nodes.length === BASE.nodes.length
        && canon(NEW.connections) === canon(BASE.connections) && canon(NEW.settings) === canon(BASE.settings));
    for (const name of [MAP, PLAN]) check(`${name}: only its jsCode differs`, canon({ ...nodeIn(BASE, name), parameters: {} }) === canon({ ...nodeIn(NEW, name), parameters: {} }));

    if (rec.publishedVersionId) {
        console.log(`\nPUBLISHED (${String(rec.publishedVersionId).slice(0, 8)}) — live/ must be the tested rebuild, carried through the recorded publishes since`);
        const pub: Wf = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const carried = withRecordedPublishesAfter(WF_DIR, String(rec.publishedVersionId), NEW);
        console.log(`        later recorded publishes: ${carried.via.join(', ') || 'none'}`);
        const P = new Map(pub.nodes.map((x) => [x.name, x]));
        check('every node of live/ equals the tested rebuild carried through the recorded publishes (ids included)',
            pub.nodes.length === carried.wf.nodes.length && carried.wf.nodes.every((x) => P.has(x.name) && canon(x) === canon(P.get(x.name))));
        check("every connection and the settings of live/ equal the rebuild's", canon(pub.connections) === canon(carried.wf.connections) && canon(pub.settings) === canon(BASE.settings));
        check('each replacement file still hashes to its recorded publishedSha256', rec.parameterEdits.every((e: any) => e.publishedSha256 === createHash('sha256').update(read(e.replaceWholeValueFromFile), 'utf8').digest('hex')));
        check("the record's graph section still hashes to its recorded publishedStructureSha256", Boolean(rec.publishedStructureSha256) && structureSha256(rec) === rec.publishedStructureSha256);
    }

    // ================================================================ 2. GATE
    console.log('\nGATE — Map Candidate Fields itself');
    for (const [ar, en] of ARABIC_CASES) {
        const now = gate(NEW, ar, TITLES, en).kept;
        const want = union(gate(BASE, en, TITLES).kept, gate(BASE, ar, TITLES).kept);
        const before = gate(BASE, ar, TITLES, en).kept;
        check(`"${ar}" (translation "${en}"): keeps the English gate's titles plus the Arabic ones — ${set(now).length} kept (was ${set(before).length})`,
            eq(set(now), want) && set(now).length > set(before).length, `now ${JSON.stringify(set(now))} want ${JSON.stringify(want)}`);
    }
    check('"محاسب" keeps Accountant / Senior Accountant / محاسب and drops Sales Manager',
        ['Accountant', 'Senior Accountant', 'محاسب'].every((t) => gate(NEW, 'محاسب', TITLES, 'Accountant').kept.includes(t)) && !gate(NEW, 'محاسب', TITLES, 'Accountant').kept.includes('Sales Manager'));
    for (const [label, tr] of [['no translation (the node failed)', null], ['an Arabic "translation"', 'محاسب'], ['an empty translation', ''], ['a translation with no letters', '1234'], ['a different Arabic translation', 'مدير حسابات']] as const) {
        check(`Arabic search with ${label}: exactly the old gate`, eq(set(gate(NEW, 'محاسب', TITLES, tr).kept), set(gate(BASE, 'محاسب', TITLES, tr).kept)));
    }
    {
        let same = 0; let readsTr = 0; const englishTitles = ['Accountant', 'Sales Manager', 'HR Business Partner', 'Procurement Officer', 'Software Engineer', 'Driver', 'Business Development Specialist', 'Field Engineer'];
        for (const en of englishTitles) {
            // A translation that differs on purpose: an English search must never read it.
            const n = gate(NEW, en, TITLES, 'Something Else Entirely'); const b = gate(BASE, en, TITLES);
            if (eq(set(n.kept), set(b.kept))) same++;
            if (n.reads.includes('Apply Translation')) readsTr++;
        }
        check(`${englishTitles.length} English searches: exactly the old gate, and the translation is never read`, same === englishTitles.length && readsTr === 0, `${same} same, ${readsTr} read it`);
    }

    // ================================================================ 3. PLAN
    console.log('\nPLAN — Person Search for an Arabic title');
    {
        const d = plan(NEW, 'محاسب', 'Accountant');
        check('Arabic + English translation: Person Search, by the translated title', d.usePs === true && d.query?.current_role_title === '"accountant"', JSON.stringify(d));
        check('the base skipped it', plan(BASE, 'محاسب', 'Accountant').reason === 'title is not plain English');
        for (const [label, tr] of [['no translation', null], ['an Arabic translation', 'محاسب'], ['an empty one', ''], ['one with no letters', '42']] as const) {
            check(`Arabic + ${label}: still skips, as before`, plan(NEW, 'محاسب', tr).reason === 'title is not plain English');
        }
        const same = ['Sales Manager', 'HR Generalist', 'Accountant', '"Quoted" Title'].every((en) => eq(plan(NEW, en, 'Something Else'), plan(BASE, en, 'Something Else')));
        check('English titles: exactly the base decision, even when a different translation exists', same);
    }

    // ================================================================ 4. LIFECYCLE / GENERATED
    console.log('\nLIFECYCLE — whole searches');
    const people = (p: string, n: number) => Array.from({ length: n }, (_, i) => url(`${p}-${i}`));
    const scores = (links: string[], f: (i: number) => number | 'skip') => Object.fromEntries(links.map((l, i) => [slugOf(l), f(i)]));
    const caseOf = (label: string, o: Partial<Scenario>): Scenario => ({ label, body: bodyOf(), p1: ['none'], p2: ['none'], verdict: {}, ...o } as Scenario);
    const g10 = people('ar', 10);
    const ps20 = people('arps', 20);
    {
        // Arabic search, Iraq: Person Search through the translation; English-titled profiles.
        const sc = caseOf('arabic iraq', { body: bodyOf({ position: 'محاسب' }), translation: { position: 'Accountant', location: 'Baghdad, Iraq' }, profileTitle: 'Accountant', ps: ps20, p1: [{ links: g10 }, { web: 3 }], p2: ['none'], verdict: { ...scores(ps20, () => 85), ...scores(g10, () => 80) } });
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        check(`Arabic Iraq search: Person Search used (base ${b.psCalls}, now ${n.psCalls}) and ${n.sends.length} delivered (base ${b.sends.length}); one completion, ceiling held`,
            b.psCalls === 0 && n.psCalls === 1 && n.sends.length > b.sends.length && n.sends.length >= 20 && !broken(n, sc), broken(n, sc));
    }
    {
        // Arabic search where Person Search finds nobody: the Google route; the gate is what changes.
        // (The engine's synthetic profiles live in Baghdad, so the search stays in Iraq.)
        const sc = caseOf('arabic google', { body: bodyOf({ position: 'مدير مبيعات' }), translation: { position: 'Sales Manager', location: 'Baghdad, Iraq' }, profileTitle: 'Sales Manager', ps: [], p1: [{ links: g10 }, { web: 2 }], p2: ['none'], verdict: scores(g10, () => 80) });
        const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
        check(`Arabic search, Person Search finds nobody: the Google route, and the gate now keeps English titles (${b.sends.length} -> ${n.sends.length} delivered)`,
            n.psCalls === 1 && n.serpCalls.some((s) => s.startsWith('p1')) && n.sends.length > b.sends.length && !broken(n, sc), broken(n, sc));
    }

    console.log('\nGENERATED — English searches identical, Arabic searches sound');
    {
        let seed = 20261005;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const N = 240;
        let same = 0; let sound = 0; let arDelivered = 0; let arBaseDelivered = 0; let firstBad = '';
        for (let k = 0; k < N; k++) {
            const arabic = k % 2 === 1;
            const [ar, en] = pick(ARABIC_CASES);
            const pool = Array.from({ length: 60 }, (_, i) => `gp${k}-${i}`);
            const mk = (): Resp | 'fail' => { const r = rnd(); return r < 0.1 ? 'fail' : r < 0.18 ? 'none' : r < 0.26 ? { web: 3 } : { links: Array.from({ length: Math.floor(rnd() * 14) }, () => url(pick(pool))) }; };
            const verdict: Record<string, number | 'skip'> = {};
            for (const s of pool) verdict[s] = rnd() < 0.2 ? 'skip' : Math.floor(rnd() * 101);
            const ps = rnd() < 0.5 ? pool.slice(0, rnd() < 0.5 ? 20 : Math.floor(rnd() * 20)).map((s) => url(s)) : [];
            const location = rnd() < 0.8 ? 'Baghdad, Iraq' : 'Dubai, United Arab Emirates';
            const sc: Scenario = {
                label: `gen-${k}`, body: bodyOf({ searchId: `headhunter_ar-${k}`, position: arabic ? ar : en, location, minCandidateCount: rnd() < 0.3 ? 40 : 20 }),
                p1: Array.from({ length: 4 }, mk) as Resp[], p2: Array.from({ length: 3 }, mk) as Resp[], verdict, ps,
                translation: { position: arabic ? en : 'Something Else', location }, profileTitle: en,
            };
            const b = runSearch(BASE, sc); const n = runSearch(NEW, sc);
            if (!arabic) { if (sameRun(n, b)) same++; else firstBad = firstBad || `${sc.label}: English search differs`; }
            else {
                const why = broken(n, sc);
                if (!why) sound++; else firstBad = firstBad || `${sc.label}: ${why}`;
                arDelivered += n.sends.length; arBaseDelivered += b.sends.length;
            }
        }
        check(`${N / 2} English searches: identical to the base (sends, completions, paid calls, node runs)`, same === N / 2, firstBad);
        check(`${N / 2} Arabic searches: one completion, nobody twice, ceiling held`, sound === N / 2, firstBad);
        check(`Arabic searches delivered ${arDelivered} candidates in total (base: ${arBaseDelivered})`, arDelivered > arBaseDelivered * 2 && arDelivered > 200);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
