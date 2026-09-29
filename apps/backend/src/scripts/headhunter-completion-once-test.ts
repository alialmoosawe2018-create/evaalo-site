/**
 * Head Hunter — "exactly one CORRECT completion" test (offline: no n8n, no network).
 *
 * Rebuilds `Prepare Complete Search` from
 *   docs/n8n-workflows/live/headhunter--AI_Head_hunter.json  (published 191c06f9)
 * + docs/n8n-workflows/pending/headhunter-completion-idempotency.patch.json
 * and runs the REAL patched code against ordered sequences of arrivals.
 *
 * Why a sequence test and not just the n8n repro: the n8n repro proves the fan-out
 * exists, but n8n happened to deliver the CORRECT payload first in both exec 2024 and
 * exec 2027. A guard that merely takes the first arrival would pass that by luck while
 * still being wrong. These cases force the wrong payload to arrive FIRST.
 *
 * Run: npm run test:headhunter-completion-once
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WF_DIR = join(HERE, '..', '..', 'docs', 'n8n-workflows');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  PASS  ${name}`); return; }
    failures++;
    console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`);
}

/** Apply the patch to the published node and return its jsCode. */
function patchedCode(): string {
    const patch = JSON.parse(readFileSync(join(WF_DIR, 'pending', 'headhunter-completion-idempotency.patch.json'), 'utf8'));
    // Base is the ARCHIVED pre-guard version; live/ now holds the published result.
    const wf = JSON.parse(readFileSync(join(WF_DIR, patch.baseFile), 'utf8'));
    if (wf.versionId !== patch.baseVersionId) throw new Error(`base mismatch: ${wf.versionId} vs ${patch.baseVersionId}`);
    // What THIS patch published was fea5fa60; live/ has since moved on (the location fix
    // shipped on top), so it is checked against the archived snapshot of the version this
    // patch actually produced.
    const published = JSON.parse(readFileSync(join(WF_DIR, 'archive', 'headhunter--AI_Head_hunter--fea5fa60-before-location-fix.json'), 'utf8'));
    if (published.versionId !== patch.publishedVersionId) throw new Error(`archived snapshot is not the published version: ${published.versionId}`);
    const edit = patch.parameterEdits[0];
    const node = wf.nodes.find((n: { name: string }) => n.name === edit.node);
    if (!node) throw new Error(`node ${edit.node} not found`);
    const code = String(node.parameters.jsCode);
    const hits = code.split(edit.find).length - 1;
    if (hits !== 1) throw new Error(`find anchor matched ${hits} times, expected exactly 1`);
    return code.replace(edit.find, edit.replace);
}

type Arrival = { label: string; json: Record<string, unknown> };
type Emitted = { label: string; body: Record<string, unknown> | null };

/**
 * Run the node once per arrival, sharing one staticData object across the sequence,
 * exactly as a single n8n execution would.
 */
function runSequence(code: string, searchId: string, arrivals: Arrival[], sd: Record<string, unknown>): Emitted[] {
    const out: Emitted[] = [];
    for (const a of arrivals) {
        const $ = () => ({ first: () => ({ json: { body: { searchId } } }) });
        const $input = { first: () => ({ json: a.json }) };
        const $getWorkflowStaticData = () => sd;
        // eslint-disable-next-line no-new-func
        const fn = new Function('$', '$input', '$getWorkflowStaticData', code);
        const res = fn($, $input, $getWorkflowStaticData) as { json: Record<string, unknown> }[];
        out.push({ label: a.label, body: Array.isArray(res) && res.length ? res[0].json : null });
    }
    return out;
}

/** The two payload shapes seen in exec 2024. */
const SPURIOUS_NO_CANDIDATES: Arrival = {
    label: 'spurious __completeOnly ("No candidates passed…")',
    json: { __completeOnly: true, errorMessage: 'No candidates passed the preliminary AI score threshold (25).' },
};
const SPURIOUS_WRONG_COUNT: Arrival = {
    label: 'spurious __completeOnly (totalSent: 4 — recomputed from destroyed state)',
    json: { __completeOnly: true, phase1Count: 4, totalSent: 4, minTarget: 20, targetMet: false, expansionRan: true },
};
const GENUINE_TERMINAL: Arrival = {
    label: 'GENUINE __completeSearch (totalSent: 13)',
    json: { __completeSearch: true, phase1Count: 4, totalSent: 13, minTarget: 20, targetMet: false, expansionRan: true },
};

function main(): void {
    console.log('='.repeat(96));
    console.log('Prepare Complete Search — exactly one CORRECT completion');
    console.log('='.repeat(96));
    const code = patchedCode();
    const ID = 'headhunter_d9aa4277';
    /** progress state as it stands once candidates have actually been sent */
    const sentProgress = () => ({ hhSendProgress: { [ID]: { expected: 9, sent: 9, phase: 2 } } } as Record<string, unknown>);

    console.log('\n🔴 THE DECISIVE CASE — wrong payload arrives FIRST');
    {
        const sd = sentProgress();
        const claimed = () => Boolean((sd.hhCompleted as Record<string, boolean> | undefined)?.[ID]);

        // Step the sequence one arrival at a time: the point of this case is the STATE
        // left behind by the wrong arrivals, which is only observable before the genuine
        // terminal runs and legitimately claims the search.
        const first = runSequence(code, ID, [SPURIOUS_NO_CANDIDATES], sd);
        check('the first (wrong) arrival sends nothing', first[0].body === null);
        check('and it does NOT claim the search — so it cannot win the race', !claimed());

        const second = runSequence(code, ID, [SPURIOUS_WRONG_COUNT], sd);
        check('the second (wrong) arrival sends nothing', second[0].body === null);
        check('still unclaimed after two wrong arrivals', !claimed());

        const third = runSequence(code, ID, [GENUINE_TERMINAL], sd);
        const emitted = [...first, ...second, ...third];
        emitted.forEach((e) => console.log(`     ${e.body ? 'SENT   ' : 'dropped'}  ${e.label}`));
        check('the genuine terminal IS sent', third[0].body !== null);
        check('only the genuine terminal claims the search', claimed());
        check('exactly one payload sent', emitted.filter((e) => e.body).length === 1);
        check('and it carries the CORRECT totalSent (13, not 4)', third[0].body?.totalSent === 13,
            String(third[0].body?.totalSent));
        check('no false "no candidates" message on it', !String(third[0].body?.errorMessage ?? '').includes('No candidates passed'));
    }

    console.log('\nthe ordering production actually produced — correct first, wrong after');
    {
        const sd = sentProgress();
        const emitted = runSequence(code, ID, [GENUINE_TERMINAL, SPURIOUS_NO_CANDIDATES, SPURIOUS_WRONG_COUNT, SPURIOUS_NO_CANDIDATES], sd);
        emitted.forEach((e) => console.log(`     ${e.body ? 'SENT   ' : 'dropped'}  ${e.label}`));
        check('exactly one payload sent', emitted.filter((e) => e.body).length === 1);
        check('it is the genuine one', emitted[0].body?.totalSent === 13);
    }

    console.log('\nwrong payloads ONLY, interleaved — must never fabricate a completion');
    {
        const sd = sentProgress();
        const emitted = runSequence(code, ID, [SPURIOUS_WRONG_COUNT, SPURIOUS_NO_CANDIDATES, SPURIOUS_WRONG_COUNT], sd);
        check('nothing is sent at all', emitted.every((e) => e.body === null));
        check('the search is left unclaimed, so a later genuine terminal still wins',
            !(sd.hhCompleted as Record<string, boolean> | undefined)?.[ID]);
        const late = runSequence(code, ID, [GENUINE_TERMINAL], sd);
        check('a late genuine terminal is still sent', late[0].body?.totalSent === 13);
    }

    console.log('\nPATHS THAT MUST STILL COMPLETE — nothing was ever sent');
    {
        const sd: Record<string, unknown> = {};   // no hhSendProgress at all
        const emitted = runSequence(code, ID, [SPURIOUS_NO_CANDIDATES], sd);
        check('a genuinely empty search still completes via __completeOnly', emitted[0].body !== null);
        check('and keeps its message', String(emitted[0].body?.errorMessage ?? '').includes('No candidates passed'));
    }
    {
        const sd: Record<string, unknown> = { hhSendProgress: { [ID]: { expected: 0, sent: 0, phase: 1 } } };
        const emitted = runSequence(code, ID, [{ label: 'all SERP pages failed', json: { __completeOnly: true, searchFailed: true, errorMessage: 'All search pages failed.' } }], sd);
        check('the all-SERP-pages-failed path still completes', emitted[0].body !== null);
        check('and keeps searchFailed', emitted[0].body?.searchFailed === true);
    }
    {
        const sd = sentProgress();
        const emitted = runSequence(code, ID, [{ label: 'phase-1-only terminal, no expansion', json: { __completeSearch: true, phase1Count: 24, totalSent: 24, minTarget: 20, targetMet: true, expansionRan: false } }], sd);
        check('a phase-1-only search completes', emitted[0].body !== null);
        check('with targetMet true and no error message', emitted[0].body?.targetMet === true && emitted[0].body?.errorMessage === undefined);
    }

    console.log('\nISOLATION');
    {
        const sd = sentProgress();
        (sd.hhSendProgress as Record<string, unknown>)['other_search'] = { expected: 5, sent: 5, phase: 2 };
        runSequence(code, ID, [GENUINE_TERMINAL], sd);
        const other = runSequence(code, 'other_search', [{ label: 'other search terminal', json: { __completeSearch: true, phase1Count: 5, totalSent: 5, minTarget: 20, targetMet: false, expansionRan: false } }], sd);
        check('completing one searchId does not block another', other[0].body !== null);
    }

    console.log('\nPUBLISHED-STATE FINGERPRINT');
    {
        const pub = JSON.parse(readFileSync(join(WF_DIR, 'archive', 'headhunter--AI_Head_hunter--fea5fa60-before-location-fix.json'), 'utf8'));
        const liveNow = JSON.parse(readFileSync(join(WF_DIR, 'live', 'headhunter--AI_Head_hunter.json'), 'utf8'));
        const byName = (n: string) => pub.nodes.find((x: { name: string }) => x.name === n);
        const liveByName = (n: string) => liveNow.nodes.find((x: { name: string }) => x.name === n);
        check('archive + patch reproduces the node this patch PUBLISHED, byte for byte',
            String(byName('Prepare Complete Search').parameters.jsCode) === code);
        check('and the guard is STILL live today, on top of later changes',
            String(liveByName('Prepare Complete Search').parameters.jsCode).includes('sd.hhCompleted'));
        check('the published reset fix is still intact',
            JSON.stringify(byName('Split In Batches').parameters.options) === '{"reset":"={{ $json.batchDone !== true }}"}');
        check('Stream Batch Done mode untouched — layer 1 stays rejected',
            byName('Stream Batch Done').parameters.mode === 'runOnceForEachItem');
    }

    console.log('\n' + '='.repeat(96));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED — order-independent, and archive + patch matches what is published.');
}

main();
