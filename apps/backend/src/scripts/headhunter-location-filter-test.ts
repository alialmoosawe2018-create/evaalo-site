/**
 * headhunter-location-filter-test
 *
 * THE DEFECT (production, 2026-09-29): a search for "HR Business Partner, Baghdad,
 * Iraq" DELIVERED candidates located in `Cairo, EG` and `CH`. Of the 4 candidates
 * scoring >= 50, only one was actually in Iraq.
 *
 * Two causes, both proven from production data:
 *   1. `matchesLocation` decided residence from `allProfileLocationText()` — a blob
 *      that includes the summary and EVERY past job's location/title/company/
 *      description. `hasIraqTerm(blob)` therefore passes anyone who ever mentioned
 *      Iraq anywhere, so a Cairo resident with one past Iraqi role counted as Iraqi.
 *   2. City names were treated as proof of country. Production returned
 *      `"Erbil, SY"` — an Iraqi city with a SYRIAN country code — and `IRAQ_TERMS`
 *      contains `erbil`, so it was accepted. This is exactly why an allowlist built
 *      from city names would not fix the bug.
 *
 * This runs the REAL `Map Candidate Fields` node — before and after the patch —
 * against fixtures modelled on the actual location strings of all 47 candidates in
 * production, and replays the two real searches.
 *
 * `position` is deliberately empty in the webhook so `matchesPosition` passes
 * everything and the ONLY thing under test is the location decision.
 *
 * Run: npm run test:headhunter-location-filter
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

type Raw = Record<string, unknown>;

/** Build an EnrichLayer-shaped profile whose mapped `location` is city/state/country. */
function profile(name: string, loc: { city?: string; state?: string; country?: string; country_full_name?: string }, extra: Raw = {}): Raw {
    return {
        full_name: name,
        public_identifier: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        occupation: 'HR Assistant at Somewhere',
        headline: 'HR Assistant',
        summary: '',
        experiences: [],
        ...loc,
        ...extra,
    };
}

function applyPatch(): { before: string; after: string } {
    const patch = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-location-current-country.patch.json'), 'utf8'));
    // Base is the ARCHIVED pre-fix version: this patch has shipped, so live/ moved on.
    const wf = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    if (wf.versionId !== patch.baseVersionId) throw new Error(`${patch.baseFile} is ${wf.versionId}, patch expects ${patch.baseVersionId}`);
    if (wf.nodes.length !== patch.baseNodeCount) throw new Error(`node count ${wf.nodes.length} != ${patch.baseNodeCount}`);
    const edit = patch.parameterEdits[0];
    const node = wf.nodes.find((n: { name: string }) => n.name === edit.node);
    if (!node) throw new Error(`node ${edit.node} not found`);
    const raw = String(node.parameters.jsCode);
    const crlf = raw.includes('\r\n');
    const lf = raw.replace(/\r\n/g, '\n');
    const hits = lf.split(edit.find).length - 1;
    if (hits !== edit.expectFindCount) throw new Error(`find anchor matched ${hits} times, expected ${edit.expectFindCount}`);
    const patchedLf = lf.replace(edit.find, edit.replace);
    // Published with LF on purpose — see `_lineEndings` in the patch file. (The old
    // CRLF round-trip here was a no-op that already produced LF.)
    void crlf;
    return { before: lf, after: patchedLf };
}

/** Run the node body with the shims it actually uses: $('Webhook') and $input.all(). */
function runNode(code: string, webhookBody: Raw, profiles: Raw[]): Raw[] {
    const $ = () => ({ first: () => ({ json: { body: webhookBody } }) });
    const $input = { all: () => profiles.map((p) => ({ json: p })) };
    // eslint-disable-next-line no-new-func
    const fn = new Function('$', '$input', code);
    const out = fn($, $input) as { json: Raw }[];
    return out.map((o) => o.json);
}

const BAGHDAD = { searchId: 'test-loc', position: '', location: 'Baghdad, Iraq' };

/** true = kept (would be scored and can be delivered), false = dropped as __skip */
function kept(code: string, p: Raw): boolean {
    const out = runNode(code, BAGHDAD, [p]);
    return out.length === 1 && out[0].__skip !== true;
}

function main(): void {
    console.log('='.repeat(94));
    console.log('Head Hunter — location filter: current country, not the whole profile blob');
    console.log('='.repeat(94));

    const { before, after } = applyPatch();

    // The published version must still carry this fix on top of anything shipped later.
    const patchMeta = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-location-current-country.patch.json'), 'utf8'));
    const liveNow = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    const byName = (n: string) => liveNow.nodes.find((x: { name: string }) => x.name === n);

    console.log('\nPUBLISHED STATE');
    check('live/ holds the version this patch published',
        liveNow.versionId === patchMeta.publishedVersionId, `${liveNow.versionId} vs ${patchMeta.publishedVersionId}`);
    check('archive + patch reproduces the published node byte for byte',
        String(byName('Map Candidate Fields').parameters.jsCode) === after);
    check('the reset fix is still live on top of this change',
        JSON.stringify(byName('Split In Batches').parameters.options) === '{"reset":"={{ $json.batchDone !== true }}"}');
    check('the completion guard is still live on top of this change',
        String(byName('Prepare Complete Search').parameters.jsCode).includes('sd.hhCompleted'));

    console.log('\nPATCH');
    check('the find anchor matched exactly once', true);
    check('the patched code differs from the pre-fix base', before !== after);
    check('the blob test is gone from the Iraq branch', !after.includes('if (hasIraqTerm(blob) || isIraqCountryCode(raw)) return true;'));
    check('the country code is now decisive', after.includes("if (code) return code === 'iq';"));
    check('nothing else changed (only the Iraq branch)',
        before.replace(/  if \(isIraqSearch\(\)\) \{[\s\S]*?\n  \}/, 'X') === after.replace(/  if \(isIraqSearch\(\)\) \{[\s\S]*?\n  \}/, 'X'));

    // ---- the cases the owner asked for, plus the two traps ------------------
    console.log('\nCASES  (search = "Baghdad, Iraq")');
    const cases: { label: string; p: Raw; want: boolean; note?: string }[] = [
        { label: '"IQ" (bare country code)', p: profile('A', { country: 'IQ' }), want: true },
        { label: '"Baghdad Governorate, IQ"', p: profile('B', { city: 'Baghdad Governorate', country: 'IQ' }), want: true },
        { label: '"Baghdad, Baghdad Governorate, IQ"', p: profile('C', { city: 'Baghdad', state: 'Baghdad Governorate', country: 'IQ' }), want: true },
        { label: '"Erbil, IQ"', p: profile('D', { city: 'Erbil', country: 'IQ' }), want: true },
        { label: '"Al-Najaf, IQ"', p: profile('E', { city: 'Al-Najaf', country: 'IQ' }), want: true },
        { label: '"Basra Governorate, IQ"', p: profile('F', { city: 'Basra Governorate', country: 'IQ' }), want: true },
        { label: 'country_full_name "Iraq" with no code', p: profile('G', { country_full_name: 'Iraq' }), want: true },
        { label: '"Cairo, EG"  → must be REJECTED', p: profile('H', { city: 'Cairo', country: 'EG' }), want: false },
        { label: '"CH"  → must be REJECTED', p: profile('I', { country: 'CH' }), want: false },
        { label: '"GB"  → must be REJECTED', p: profile('J', { country: 'GB' }), want: false },
        { label: '"Dubai, AE"  → must be REJECTED', p: profile('K', { city: 'Dubai', country: 'AE' }), want: false },
        { label: 'country_full_name "United Arab Emirates"  → REJECTED', p: profile('L', { country_full_name: 'United Arab Emirates' }), want: false },
        { label: '"Salmiya, KW"  → must be REJECTED', p: profile('M', { city: 'Salmiya', country: 'KW' }), want: false },
        { label: '"Damascus Governorate, SY"  → REJECTED', p: profile('N', { city: 'Damascus Governorate', country: 'SY' }), want: false },
        { label: '🔴 "Erbil, SY" — Iraqi city, SYRIAN code → REJECTED', p: profile('O', { city: 'Erbil', country: 'SY' }), want: false, note: 'the city-name trap' },
        { label: 'empty location (no country at all) → kept', p: profile('P', {}), want: true, note: 'SERP already targeted Iraq' },
        {
            label: '🔴 Cairo resident with a PAST Iraqi job → REJECTED',
            p: profile('Q', { city: 'Cairo', country: 'EG' }, {
                summary: 'Worked across the region including Baghdad, Iraq.',
                experiences: [{ company: 'Acme Iraq', title: 'HR Officer', location: 'Baghdad, Iraq' }],
            }),
            want: false,
            note: 'THE defect that shipped Cairo and Switzerland',
        },
    ];

    let regressions = 0;
    for (const c of cases) {
        const b = kept(before, c.p);
        const a = kept(after, c.p);
        const verdict = a === c.want;
        if (!verdict) failures++;
        const changed = b !== a ? (a ? '  (live: rejected → now kept)' : '  (live: KEPT → now rejected ✅)') : '';
        console.log(`  ${verdict ? 'ok  ' : 'FAIL'}  live=${b ? 'kept' : 'drop'}  patched=${a ? 'kept' : 'drop'}  want=${c.want ? 'kept' : 'drop'}  ${c.label}${changed}${c.note ? '   [' + c.note + ']' : ''}`);
        if (c.want && !a) regressions++;
    }
    check('no Iraq-based case is lost by the patch', regressions === 0, `${regressions} Iraqi case(s) dropped`);

    // ---- replay the two real searches --------------------------------------
    console.log('\nREPLAY — the >=50 shortlist of the two real searches (locations verbatim from production)');
    const real: { exec: string; label: string; delivered: number; pool: { score: number; name: string; loc: Raw }[] }[] = [
        {
            exec: '2035', label: 'HR Business Partner 19:51', delivered: 3,
            pool: [
                { score: 83, name: 'Candidate 2035-A', loc: { country: 'IQ' } },
                { score: 61, name: 'Candidate 2035-B', loc: { city: 'Dubai', country: 'AE' } },
                { score: 55, name: 'Candidate 2035-C', loc: { city: 'Cairo', country: 'EG' } },
                { score: 54, name: 'Candidate 2035-D', loc: { country: 'CH' } },
            ],
        },
        {
            exec: '2036', label: 'HR Assistant 19:59', delivered: 2,
            pool: [
                { score: 65, name: 'Candidate 2036-A', loc: { city: 'Baghdad Governorate', country: 'IQ' } },
                { score: 60, name: 'Candidate 2036-B', loc: { city: 'Erbil', country: 'IQ' } },
                { score: 53, name: 'Candidate 2036-B', loc: { city: 'Erbil', country: 'IQ' } },
            ],
        },
    ];
    for (const r of real) {
        const survivors = r.pool.filter((c) => kept(after, profile(c.name, c.loc as never)));
        const unique = new Set(survivors.map((s) => s.name)).size;
        console.log(`  exec ${r.exec} — ${r.label}`);
        for (const c of r.pool) {
            const a = kept(after, profile(c.name, c.loc as never));
            console.log(`     score=${String(c.score).padStart(3)}  ${a ? 'kept  ' : 'DROPPED'}  ${c.name}`);
        }
        console.log(`     delivered today: ${r.delivered}  →  after the fix: ${unique} distinct person(s)`);
    }
    check('exec 2036 is unaffected — all its shortlist is genuinely in Iraq',
        new Set(real[1].pool.filter((c) => kept(after, profile(c.name, c.loc as never))).map((s) => s.name)).size === 2);
    check('exec 2035 keeps ONLY the Iraq-based candidate',
        real[0].pool.filter((c) => kept(after, profile(c.name, c.loc as never))).length === 1);

    console.log('\n' + '='.repeat(94));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
    console.log('Effect is deliberately FEWER candidates: exec 2035 goes 3 → 1, exec 2036 stays 2.');
    console.log('This fixes PRECISION only. Raising the count is the separate query-design work.');
    console.log('\nMUTATIONS that must turn this red:');
    console.log('  M1  restore `if (hasIraqTerm(blob) ...) return true;`        -> the past-Iraqi-job case');
    console.log('  M2  accept city names (add erbil/baghdad to the allowlist)   -> the "Erbil, SY" case');
    console.log('  M3  a substring form of the code test is NOT mutation-testable: no ISO-3166');
    console.log('       alpha-2 code other than IQ contains "iq", so real data cannot tell them apart.');
    console.log('  M4  drop the empty-location soft pass                        -> the empty-location case');
}

main();
