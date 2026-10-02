/**
 * headhunter-completion-notice-test
 *
 * The recruiter's note when a Head Hunter search falls short (owner decisions
 * 2026-10-02: only on a short result, 0 included; never suggest searching again)
 * lives in the frontend - apps/frontend/src/utils/headHunterCompletionNotice.js and
 * its node test. CI runs only the frontend's lint and build, never its test scripts,
 * so this backend suite (which CI does run) runs that test and pins the page wiring:
 *
 *   - the helper's own test (real helper, real en/ar/ku translation table) passes;
 *   - AIHeadHunter.jsx copies serpHealth and source from /last-result, and BOTH places
 *     that see a search end call the helper - the poll (with candidates, with none,
 *     and failed) and the HeadHunterSearchCompleted socket handler, which used to stop
 *     the poll without ever showing the note;
 *   - with 0 candidates the note takes the results card's error line, and the card's
 *     generic "no candidate profiles" line then stays hidden instead of contradicting it.
 *
 * The source checks are text checks on purpose: they fail when a call site is
 * deleted, which is exactly the regression nothing else would catch.
 *
 * Run: npm run test:headhunter-completion-notice
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}

const FRONTEND = new URL('../../../frontend/src/', import.meta.url);
const HELPER_TEST = fileURLToPath(new URL('utils/headHunterCompletionNotice.test.mjs', FRONTEND));
const PAGE = readFileSync(new URL('pages/AIHeadHunter.jsx', FRONTEND), 'utf8');
const WORKSPACE = readFileSync(new URL('components/headhunter/HeadHunterResultsWorkspace.jsx', FRONTEND), 'utf8');

/** The source between `start` and the next `end` after it ('' when start is missing). */
function section(src: string, start: string, end: string): string {
    const i = src.indexOf(start);
    if (i < 0) return '';
    const j = src.indexOf(end, i + start.length);
    return src.slice(i, j < 0 ? undefined : j);
}

function main(): void {
    console.log('='.repeat(90));
    console.log('Head Hunter — the short-result note: helper test + page wiring');
    console.log('='.repeat(90));

    console.log('\nHELPER (apps/frontend/src/utils/headHunterCompletionNotice.test.mjs)');
    const run = spawnSync(process.execPath, [HELPER_TEST], { encoding: 'utf8' });
    const summary = /(\d+) passed, (\d+) failed/.exec(run.stdout || '');
    check(`the frontend helper test passes (${summary ? `${summary[1]} passed` : 'no summary'})`,
        run.status === 0 && Boolean(summary) && summary![2] === '0' && Number(summary![1]) >= 20,
        (run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' | '));

    console.log('\nPAGE WIRING (apps/frontend/src/pages/AIHeadHunter.jsx)');
    check('imports the helper', /import \{ headHunterCompletionNotice \} from '\.\.\/utils\/headHunterCompletionNotice\.js';/.test(PAGE));
    const fetchFn = section(PAGE, 'const fetchLastN8nResult = useCallback(', 'const syncCampaignHistory');
    check('fetchLastN8nResult returns serpHealth and source from /last-result',
        /serpHealth: data\?\.serpHealth \?\? null/.test(fetchFn) && /source: data\?\.source \?\? null/.test(fetchFn));
    const helperCb = section(PAGE, 'const showCompletionNotice = useCallback(', 'const startPollForNewResult');
    check('showCompletionNotice passes status, count, wanted, serpHealth and source to the helper',
        ['status: res?.status', 'candidateCount', 'wanted', 'serpHealth: res?.serpHealth', 'source: res?.source'].every((s) => helperCb.includes(s)));
    check('…and puts a 0-candidate note on the results card, any other on the feedback line',
        /if \(candidateCount === 0\) setN8nInbound\(\(prev\) => \(\{ \.\.\.prev, error: notice\.text \}\)\);/.test(helperCb) && /else setFeedback\(notice\);/.test(helperCb));
    const poll = section(PAGE, 'const pollOnce = async () => {', 'void pollOnce();');
    const failedBranch = section(poll, "if (res.status === 'failed') {", 'return;');
    const dataBranch = section(poll, 'if (res.hasData) {', 'return;');
    const emptyBranch = section(poll, "if (res.status === 'completed' && !res.hasData) {", 'return;');
    check('poll, failed search: shows the note (it replaces the generic error line when it applies)', failedBranch.includes('showCompletionNotice(res, criteria?.minCandidateCount);'));
    check('poll, search with candidates: shows the note once it has completed', dataBranch.includes('showCompletionNotice(res, criteria?.minCandidateCount);'));
    check('poll, completed with none: shows the note', emptyBranch.includes('showCompletionNotice(res, criteria?.minCandidateCount);'));
    const socket = section(PAGE, "onEvent('HeadHunterSearchCompleted'", '}, [');
    check('socket: the completion event shows the note too, for the search still on screen, with its requested count',
        /fetchLastN8nResult\(id\)\.then\(\(res\) => \{/.test(socket) && /if \(res\?\.success && activeSearchIdRef\.current === id\) showCompletionNotice\(res, wanted\);/.test(socket)
        && socket.includes('activeCriteriaRef.current?.minCandidateCount'));
    check('the running search keeps its criteria for the socket path', PAGE.includes('activeCriteriaRef.current = criteria;'));
    const submit = section(PAGE, 'stopPollForNewResult();\n        // Let go of the previous search', "apiClient.post('/api/head-hunter/search'");
    check("a new submission lets go of the previous search first, so that search's completion cannot show its note meanwhile",
        submit.includes('activeSearchIdRef.current = null;') && submit.includes('activeCriteriaRef.current = null;'));

    console.log('\nRESULTS CARD (apps/frontend/src/components/headhunter/HeadHunterResultsWorkspace.jsx)');
    const emptyLine = section(WORKSPACE, 'visibleList.length === 0 ? (', "{t('aiHeadHunterResultsEmpty')}");
    check('a 0-candidate note is not contradicted: the generic "no candidate profiles" line shows only when no error line does',
        /n8nInbound\.receivedAt && !n8nInbound\.loading && !n8nInbound\.error \? \(/.test(emptyLine));
    check('the old inline sentence (and its unprovable claim) is gone from the page', !PAGE.includes(".replace('{count}', String(nCandidates))") && !/no further matches/i.test(PAGE));

    console.log('\n' + '='.repeat(90));
    if (failures) { console.log(`FAILED — ${failures} check(s)`); process.exit(1); }
    console.log('ALL CHECKS PASSED.');
}

main();
