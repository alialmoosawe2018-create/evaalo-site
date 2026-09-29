/**
 * headhunter-enrich-dedupe-test
 *
 * Every profile that leaves `Filter New URLs` is paid for at EnrichLayer (2 credits
 * each: 1 base + 1 for the default `use_cache=if-recent`). Measured on exec 2039:
 * 46 paid profiles for 37 distinct people, 24 of them living outside Iraq.
 *
 * This runs the REAL replacement node against the REAL link lists of execs 2035,
 * 2036 and 2039 — in the order Google returned them, across both waves, with the
 * workflow static data carried between waves exactly as n8n carries it — and
 * checks the two things that matter:
 *
 *   1. fewer paid calls (no person twice, no foreign-subdomain profile), and
 *   2. NO LOSS: every Iraqi profile the live system enriched is still enriched.
 *
 * The fixture is anonymised because this repository is public: LinkedIn slugs are
 * replaced by a 12-character hash (equality preserved), and each carries only its
 * subdomain and the country EnrichLayer reported.
 *
 * Run: npm run test:headhunter-enrich-dedupe
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');
const NODE_FILE = join(WF_DIR, 'pending', 'headhunter-enrich-dedupe.node.js');
const FIXTURE = join(HERE, 'fixtures', 'headhunter-real-link-lists.json');
const CREDITS_PER_PROFILE = 2;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

type Link = { h: string; sub: string };
type Exec = {
    location: string;
    tierMaxEnrich: number;
    livePassed: number[];
    enriched: number;
    runs: Link[][];
    country: Record<string, string | null>;
};

const linkOf = (l: Link) => `https://${l.sub}.linkedin.com/in/${l.h}`;

/** Run the REAL node once, with the shims it uses and a shared static-data object. */
function runNode(code: string, sd: Record<string, unknown>, body: Record<string, unknown>, tierMaxEnrich: number, links: string[]): string[] {
    const $ = (name: string) => ({
        first: () => ({ json: name === 'Webhook' ? { body } : { maxEnrich: tierMaxEnrich } }),
    });
    const $input = { all: () => links.map((link) => ({ json: { link } })) };
    const $getWorkflowStaticData = () => sd;
    // eslint-disable-next-line no-new-func
    const fn = new Function('$', '$input', '$getWorkflowStaticData', code);
    return (fn($, $input, $getWorkflowStaticData) as { json: { link: string } }[]).map((o) => o.json.link);
}

const slugOf = (link: string) => (link.match(/linkedin\.com\/in\/([^?#/]+)/i)?.[1] ?? '').toLowerCase();

function main(): void {
    console.log('='.repeat(92));
    console.log('Head Hunter — pay EnrichLayer once per person, and never for a foreign subdomain');
    console.log('='.repeat(92));

    const code = readFileSync(NODE_FILE, 'utf8');
    const patch = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-enrich-dedupe.patch.json'), 'utf8'));
    const live = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Exec>;
    const byName = (n: string) => live.nodes.find((x: { name: string }) => x.name === n);
    const edit = patch.parameterEdits[0];

    console.log('\nPATCH');
    check('only one node is touched', patch.parameterEdits.length === 1);
    // Published: the pre-fix node lives in the archived base; live/ must carry the new code.
    const base = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    const baseNode = base.nodes.find((x: { name: string }) => x.name === edit.node);
    check('patch base is the archived pre-fix version', base.versionId === patch.baseVersionId, `${base.versionId} vs ${patch.baseVersionId}`);
    check('the base node had the shortlist-only record this replaces',
        String(baseNode?.parameters?.jsCode).includes(edit.expectBeforeContains));
    // CONTENT, not a version id - a version-id check breaks on every later, unrelated publish.
    check('the published node is STILL live, byte for byte', String(byName(edit.node)?.parameters?.jsCode) === code);
    check('the replacement records every fetched profile', code.includes(edit.expectAfterContains));
    const limitExpr = String(byName('Limit Candidates')?.parameters?.maxItems ?? '');
    check("Limit Candidates still falls back to Resolve Search Tier's maxEnrich (the phase-1 cap mirrored here)",
        limitExpr.includes("$('Resolve Search Tier').first().json.maxEnrich"), limitExpr);
    check('Limit Candidates still comes right after this node',
        live.connections['Filter New URLs']?.main?.[0]?.[0]?.node === 'Limit Candidates');

    // ---- replay the three real searches ------------------------------------
    console.log('\nREPLAY — real link lists, both waves, static data carried between them');
    let liveTotal = 0;
    let newTotal = 0;
    for (const [execId, ex] of Object.entries(fixture)) {
        const sd: Record<string, unknown> = {};
        const body = { searchId: `test-${execId}`, location: ex.location };
        const sent: string[] = [];
        ex.runs.forEach((run, i) => {
            if (i === 1) sd.hhPhase2 = { [body.searchId]: { maxEnrich: 20 } }; // what Expand Phase 2 Queries sets
            sent.push(...runNode(code, sd, body, ex.tierMaxEnrich, run.map(linkOf)));
        });
        const sentSlugs = sent.map(slugOf);
        const liveIraqi = Object.entries(ex.country).filter(([, c]) => c === 'IQ').map(([h]) => h);
        const dropped = ex.runs.flat().filter((l) => !sentSlugs.includes(l.h));
        const droppedIraqi = [...new Set(dropped.filter((l) => ex.country[l.h] === 'IQ').map((l) => l.h))];
        const droppedByUrl = [...new Set(dropped.filter((l) => /^[a-z]{2}$/.test(l.sub) && !['www', 'iq', 'sy'].includes(l.sub)).map((l) => l.h))];

        liveTotal += ex.enriched;
        newTotal += sent.length;
        console.log(`\n  exec ${execId}  (${ex.location})`);
        console.log(`    paid EnrichLayer calls:  live ${ex.enriched}  ->  new ${sent.length}` +
            `   (credits ${ex.enriched * CREDITS_PER_PROFILE} -> ${sent.length * CREDITS_PER_PROFILE})`);
        console.log(`    distinct people Google returned: ${new Set(ex.runs.flat().map((l) => l.h)).size}` +
            ` · skipped as foreign by URL: ${droppedByUrl.length}`);
        check(`exec ${execId}: nobody is paid for twice`, new Set(sentSlugs).size === sentSlugs.length);
        check(`exec ${execId}: NO Iraqi profile the live system enriched is lost`,
            liveIraqi.every((h) => sentSlugs.includes(h)), `lost ${liveIraqi.filter((h) => !sentSlugs.includes(h)).length}`);
        check(`exec ${execId}: no Iraqi dropped by the subdomain rule`, droppedIraqi.length === 0, droppedIraqi.join(','));
        check(`exec ${execId}: every URL-dropped profile we can check was foreign`,
            droppedByUrl.every((h) => ex.country[h] == null || ex.country[h] !== 'IQ'));
        check(`exec ${execId}: phase 1 respects the tier cap`, runNode(code, {}, body, ex.tierMaxEnrich, ex.runs[0].map(linkOf)).length <= ex.tierMaxEnrich);
    }
    console.log(`\n  TOTAL paid calls across the three searches:  live ${liveTotal}  ->  new ${newTotal}` +
        `   (credits ${liveTotal * CREDITS_PER_PROFILE} -> ${newTotal * CREDITS_PER_PROFILE})`);
    check('the change pays for fewer profiles', newTotal < liveTotal);

    // ---- behaviours that must hold -----------------------------------------
    console.log('\nRULES');
    const IRAQ = { searchId: 's1', location: 'Baghdad, Iraq' };
    const one = (links: string[], body: Record<string, unknown> = IRAQ, sd: Record<string, unknown> = {}, cap = 35) =>
        runNode(code, sd, body, cap, links);

    check('the same person twice in one batch is paid once',
        one(['https://iq.linkedin.com/in/a', 'https://iq.linkedin.com/in/a']).length === 1);
    check('the same person on two subdomains is paid once',
        one(['https://www.linkedin.com/in/a', 'https://iq.linkedin.com/in/a']).length === 1);
    check('a percent-encoded slug matches its decoded form',
        one(['https://iq.linkedin.com/in/%D8%A3%D8%AD%D9%85%D8%AF', 'https://www.linkedin.com/in/أحمد']).length === 1);
    {
        const sd: Record<string, unknown> = {};
        one(['https://iq.linkedin.com/in/a', 'https://iq.linkedin.com/in/b'], IRAQ, sd);
        sd.hhPhase2 = { s1: { maxEnrich: 20 } };
        const second = one(['https://www.linkedin.com/in/a', 'https://iq.linkedin.com/in/c'], IRAQ, sd);
        check('🔴 a profile enriched in phase 1 is NOT paid for again in phase 2 — even if it was rejected',
            second.length === 1 && second[0].endsWith('/c'), second.join(' '));
    }
    check('www, iq and sy are kept for an Iraq search',
        one(['https://www.linkedin.com/in/a', 'https://iq.linkedin.com/in/b', 'https://sy.linkedin.com/in/c']).length === 3);
    check('a foreign country subdomain is skipped for an Iraq search',
        one(['https://ae.linkedin.com/in/a', 'https://uk.linkedin.com/in/b', 'https://ch.linkedin.com/in/c']).length === 0);
    check('a non-country subdomain is kept', one(['https://mobile.linkedin.com/in/a']).length === 1);
    check('for a NON-Iraq search nothing is filtered by URL',
        one(['https://ae.linkedin.com/in/a', 'https://qa.linkedin.com/in/b'], { searchId: 's2', location: 'Dubai, UAE' }).length === 2);
    check('phase 1 stops at the tier cap',
        one(Array.from({ length: 50 }, (_, i) => `https://iq.linkedin.com/in/p${i}`), IRAQ, {}, 35).length === 35);
    {
        const sd: Record<string, unknown> = { hhPhase2: { s1: { maxEnrich: 20 } } };
        check('phase 2 is NOT capped here (Limit Candidates keeps today’s behaviour)',
            one(Array.from({ length: 30 }, (_, i) => `https://iq.linkedin.com/in/q${i}`), IRAQ, sd, 35).length === 30);
    }
    {
        const sd: Record<string, unknown> = {};
        one(Array.from({ length: 50 }, (_, i) => `https://iq.linkedin.com/in/r${i}`), IRAQ, sd, 35);
        const rec = (sd.hhFetched as Record<string, { slugs: string[] }>).s1;
        check('only what passed the cap is remembered — a cut profile is never marked as paid',
            rec.slugs.length === 35 && !rec.slugs.includes('r40'), String(rec.slugs.length));
    }
    {
        const sd: Record<string, unknown> = { hhFetched: { old: { at: Date.now() - 25 * 3600 * 1000, slugs: ['x'] } } };
        one(['https://iq.linkedin.com/in/a'], IRAQ, sd);
        check('records older than 24 hours are pruned', !(sd.hhFetched as Record<string, unknown>).old);
    }
    check('the old shortlist record is still honoured',
        one(['https://iq.linkedin.com/in/a'], IRAQ, { hhSeenUrls: { s1: ['https://iq.linkedin.com/in/a'] } }).length === 0);

    console.log('\n' + '='.repeat(92));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
    console.log('\nMUTATIONS that must turn this red:');
    console.log('  M1  record only the shortlist again (drop the hhFetched write)  -> phase-2 repeat + "nobody paid twice"');
    console.log('  M2  key on the full URL instead of the slug                     -> "two subdomains is paid once"');
    console.log('  M3  drop sy from the kept subdomains                            -> "www, iq and sy are kept"');
    console.log('  M4  record before the cap instead of after it                   -> "a cut profile is never marked"');
    console.log('  M5  cap phase 2 as well                                         -> "phase 2 is NOT capped here"');
}

main();
