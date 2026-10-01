/**
 * headhunter-enrich-cap-phase2-test
 *
 * THE GAP: phase-2 paid enrichment had no cap. `Limit Candidates` is meant to
 * keep the first maxEnrich items, but its expression calls
 * $getWorkflowStaticData, which does not exist in n8n expressions; it resolves
 * to undefined and the limit keeps everything (27 of 27 retained runs passed
 * their input through, up to 45 profiles in a phase 2 recorded as capped at 20
 * or 40). Only Filter New URLs capped, and only in phase 1.
 *
 * THE FIX: Filter New URLs - the one node where static data can be read - also
 * caps phase 2 at the maxEnrich Expand Phase 2 Queries records (20 for Tier 20,
 * 40 for Tier 40). Phase 1 is unchanged. A profile the cap leaves out is not
 * remembered as fetched.
 *
 * PUBLISHED 2026-10-01 as n8n version 6e0938bf (rollback = re-publish ae589a3d,
 * archived). This runs the REAL pre-change node (the archived ae589a3d) and the
 * REAL published node side by side, including the anonymised link lists of execs
 * 2035, 2036 and 2039 (hashed slugs only), and checks the published code is still
 * what live/ carries (the repo snapshot refreshed from production after each
 * publish - not production itself).
 *
 * Run: npm run test:headhunter-enrich-cap-phase2
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCarriesOrRecordedSuccessor } from './headhunter-recorded-successors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const PATCH_FILE = join(WF_DIR, 'pending', 'headhunter-enrich-cap-phase2.patch.json');
const FIXTURE = join(HERE, 'fixtures', 'headhunter-real-link-lists.json');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Sd = Record<string, any>;
function runNode(code: string, sd: Sd, body: Record<string, unknown>, tierMaxEnrich: number, links: string[]): string[] {
    const $ = (name: string) => {
        if (name === 'Webhook') return { first: () => ({ json: { body } }) };
        if (name === 'Resolve Search Tier') return { first: () => ({ json: { maxEnrich: tierMaxEnrich } }) };
        throw new Error(`the node read an unexpected node: ${name}`);
    };
    const $input = { all: () => links.map((link) => ({ json: { link } })) };
    // eslint-disable-next-line no-new-func
    const fn = new Function('$', '$input', '$getWorkflowStaticData', code);
    return (fn($, $input, () => sd) as { json: { link: string } }[]).map((o) => o.json.link);
}
const fetchedSlugs = (sd: Sd, id: string) => [...((sd.hhFetched && sd.hhFetched[id] && sd.hhFetched[id].slugs) || [])].sort();

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

type Exec = { location: string; tierMaxEnrich: number; runs: { h: string; sub: string }[][] };

function main(): void {
    console.log('='.repeat(96));
    console.log('Head Hunter — phase 2 gets a real cap on paid EnrichLayer profiles');
    console.log('='.repeat(96));

    const patch = JSON.parse(readFileSync(PATCH_FILE, 'utf8'));
    const live = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    // Published 2026-10-01 as 6e0938bf: the pre-change code lives in the archived base; live/ must carry the new code.
    const archived = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    const node = (name: string) => live.nodes.find((n: { name: string }) => n.name === name);
    const baseNode = (name: string) => String(archived.nodes.find((n: { name: string }) => n.name === name)?.parameters?.jsCode ?? '');
    const liveCode = (name: string) => String(node(name)?.parameters?.jsCode ?? '');
    const edit = patch.parameterEdits.find((e: { node: string }) => e.node === 'Filter New URLs');
    const oldCode = baseNode(edit.node);
    const code = readFileSync(join(WF_DIR, 'pending', edit.replaceWholeValueFromFile), 'utf8');
    const xEdit = patch.parameterEdits.find((e: { node: string }) => e.node === 'Expand Phase 2 Queries');
    const xOld = baseNode('Expand Phase 2 Queries');
    const xNew = xEdit ? readFileSync(join(WF_DIR, 'pending', xEdit.replaceWholeValueFromFile), 'utf8') : '';

    console.log('\nPATCH');
    check('patch base is the archived pre-change version', archived.versionId === patch.baseVersionId, `${archived.versionId} vs ${patch.baseVersionId}`);
    check('that base has the node count the patch expects', archived.nodes.length === patch.baseNodeCount);
    check('exactly two nodes are touched: Filter New URLs and Expand Phase 2 Queries',
        patch.parameterEdits.length === 2 && Boolean(edit) && Boolean(xEdit));
    const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    check('both files still hash to what was published (publishedSha256 = the jsCode production runs)',
        edit.publishedSha256 === sha(code) && xEdit?.publishedSha256 === sha(xNew));
    // CONTENT, not a version id - a version-id check breaks on every later, unrelated publish.
    for (const [name, published] of [['Filter New URLs', code], ['Expand Phase 2 Queries', xNew]] as [string, string][]) {
        const carried = liveCarriesOrRecordedSuccessor(WF_DIR, name, published, liveCode(name));
        check(`${name}: the published code or a recorded successor is STILL live, byte for byte (${carried.via})`, carried.ok);
    }
    check('the archived base had the phase-1-only cap this replaces', oldCode.includes(edit.expectBeforeContains));
    check('the replacement reads the phase-2 cap', code.includes(edit.expectAfterContains));
    const lost = onlyTheseLinesRemoved(oldCode, code, edit.removedLines);
    check('every other line of the base code is kept, in order', lost.length === 0, lost.slice(0, 3).join(' | '));
    const limitExpr = String(node('Limit Candidates')?.parameters?.maxItems ?? '');
    check('Limit Candidates still calls $getWorkflowStaticData in an expression, i.e. still caps nothing (this node stays the only cap)',
        limitExpr.includes('$getWorkflowStaticData'), limitExpr.slice(0, 80));

    // Expand Phase 2 Queries: its comment said maxEnrich "enforces nothing" - false once this ships. COMMENT ONLY.
    const isComment = (l: string) => l.trim().startsWith('//');
    const codeLines = (s: string) => s.split('\n').filter((l) => !isComment(l));
    check('Expand Phase 2 Queries: the archived base had the comment this replaces', xOld.includes(xEdit?.expectBeforeContains ?? '\u0000'));
    check('Expand Phase 2 Queries: the new comment says where the cap is enforced', xNew.includes(xEdit?.expectAfterContains ?? '\u0000'));
    check('Expand Phase 2 Queries: every removed line is a comment', (xEdit?.removedLines ?? []).every(isComment));
    check('Expand Phase 2 Queries: every other line is kept, in order', onlyTheseLinesRemoved(xOld, xNew, xEdit?.removedLines ?? []).length === 0);
    check('Expand Phase 2 Queries: not one executable line differs', eq(codeLines(xOld), codeLines(xNew)));
    // The cap this node records, read by its structure: Tier 40 -> 40, Tier 20 -> 20 (not just "both numbers appear").
    const tierMap = /tierMin >= 40\s*\?\s*\{[^}]*\bmaxEnrich: 40\b[^}]*\}[^\n]*\n\s*:\s*\{[^}]*\bmaxEnrich: 20\b[^}]*\}/;
    check('Expand Phase 2 Queries records maxEnrich 40 for Tier 40 and 20 for Tier 20 (base, published and live)',
        tierMap.test(xOld) && tierMap.test(xNew) && tierMap.test(liveCode('Expand Phase 2 Queries')));

    const iraq = { searchId: 's1', location: 'Baghdad, Iraq' };
    const www = (n: number, tag = 'p') => Array.from({ length: n }, (_, i) => `https://www.linkedin.com/in/${tag}${i}`);

    console.log('\nPHASE 1 — identical to live');
    const p1Cases: [string, string[], number][] = [
        ['10 profiles, Tier 20', www(10), 35],
        ['40 profiles, Tier 20 (cap 35)', www(40), 35],
        ['60 profiles, Tier 40 (cap 55)', www(60), 55],
        ['duplicates and foreign subdomains', [...www(5), 'https://ae.linkedin.com/in/x', 'https://iq.linkedin.com/in/p1', 'https://sy.linkedin.com/in/y', ...www(5)], 35],
    ];
    for (const [label, links, tierCap] of p1Cases) {
        const sdOld: Sd = {};
        const sdNew: Sd = {};
        const o = runNode(oldCode, sdOld, iraq, tierCap, links);
        const n = runNode(code, sdNew, iraq, tierCap, links);
        check(`${label}: same profiles sent, same record`, eq(o, n) && eq(fetchedSlugs(sdOld, 's1'), fetchedSlugs(sdNew, 's1')), `${o.length} vs ${n.length}`);
    }

    console.log('\nPHASE 2 — capped at the maxEnrich Expand Phase 2 Queries records');
    {
        const sd: Sd = { hhPhase2: { s1: { maxEnrich: 20 } } };
        const out = runNode(code, sd, iraq, 35, www(30));
        check('Tier 20, 30 new profiles: 20 sent, the first 20 in order', out.length === 20 && eq(out, www(20)));
        check('… and the 10 left out are NOT remembered (never skipped unevaluated)', fetchedSlugs(sd, 's1').length === 20);
        const old = runNode(oldCode, { hhPhase2: { s1: { maxEnrich: 20 } } }, iraq, 35, www(30));
        check('the previous live code (ae589a3d) sent all 30 (the gap this closed)', old.length === 30);
    }
    {
        const out = runNode(code, { hhPhase2: { s1: { maxEnrich: 40 } } }, iraq, 55, www(50));
        check('Tier 40, 50 new profiles: 40 sent', out.length === 40);
    }
    for (const [n, cap, label] of [[9, 20, 'the 9 that exec 2048 (Tier 20) sent'], [15, 40, 'the 15 that exec 2044 (Tier 40) sent']] as [number, number, string][]) {
        const o = runNode(oldCode, { hhPhase2: { s1: { maxEnrich: cap } } }, iraq, 35, www(n));
        const m = runNode(code, { hhPhase2: { s1: { maxEnrich: cap } } }, iraq, 35, www(n));
        check(`below the cap (synthetic list the size of ${label}): identical to live`, eq(o, m) && m.length === n);
    }
    {
        const links = [...www(5, 'old'), 'https://ae.linkedin.com/in/f1', 'https://qa.linkedin.com/in/f2', ...www(25)];
        const sd: Sd = { hhPhase2: { s1: { maxEnrich: 20 } }, hhFetched: { s1: { at: Date.now(), slugs: www(5, 'old').map((l) => l.split('/in/')[1]) } } };
        const out = runNode(code, sd, iraq, 35, links);
        check('already-fetched and foreign profiles do not use up the cap', out.length === 20 && eq(out, www(20)));
    }
    {
        // Two searches at once: another search's phase-2 record sits in the same static data.
        const sd: Sd = { hhPhase2: { other: { maxEnrich: 20 } } };
        const out = runNode(code, sd, iraq, 35, www(40));
        check("another search's phase 2 does not cap this search's phase 1 (35, not 20)", out.length === 35);
    }
    for (const [label, cfg] of [['missing', {}], ['0', { maxEnrich: 0 }], ['not a number', { maxEnrich: 'x' }]] as [string, Record<string, unknown>][]) {
        const o = runNode(oldCode, { hhPhase2: { s1: cfg } }, iraq, 35, www(30));
        const n = runNode(code, { hhPhase2: { s1: cfg } }, iraq, 35, www(30));
        check(`phase-2 maxEnrich ${label}: no cap, exactly as live`, eq(o, n) && n.length === 30);
    }

    console.log('\nREPLAY — real link lists, execs 2035 / 2036 / 2039 (pages-era runs)');
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Exec>;
    const linkOf = (l: { h: string; sub: string }) => `https://${l.sub || 'www'}.linkedin.com/in/${l.h}`;
    for (const [execId, ex] of Object.entries(fixture)) {
        const body = { searchId: `x${execId}`, location: ex.location };
        const counts = (c: string) => {
            const sd: Sd = {};
            return ex.runs.map((run, i) => {
                if (i === 1) sd.hhPhase2 = { [body.searchId]: { maxEnrich: 20 } }; // what Expand Phase 2 Queries records for Tier 20
                return runNode(c, sd, body, ex.tierMaxEnrich, run.map(linkOf)).length;
            });
        };
        const o = counts(oldCode);
        const n = counts(code);
        console.log(`    exec ${execId}: paid profiles per wave  live ${o.join(' + ')}  ->  new ${n.join(' + ')}`);
        check(`exec ${execId}: phase 1 unchanged`, o[0] === n[0]);
        // These real lists stay below 20, so they prove "no change below the cap" - NOT the cap itself
        // (the synthetic checks above do that). If a fixture ever exceeds 20, this checks the cut.
        check(`exec ${execId}: later waves = live, or live cut to 20 (${o.slice(1)} of 20: the cap does not bind here)`,
            n.slice(1).every((v, i) => v === Math.min(o[i + 1], 20)), `${o.slice(1)} -> ${n.slice(1)}`);
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
