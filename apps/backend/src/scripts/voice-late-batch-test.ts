import {
    bumpSttPurgeToken,
    clearSttPurgeToken,
    getSttPurgeToken,
    shouldKeepLateBatch,
} from '../evaalo-only-voice/sttPurgeToken.js';

/**
 * Regression for the lost tail in voice session 6afff73c.
 *
 * Transcription runs in batches, not as a stream: a batch closes after ~1150ms
 * of silence, goes to Speechmatics, and comes back after a round trip. When the
 * candidate paused to think and then finished her sentence, the first batch came
 * back, armed the turn timer, and the turn was dispatched while her closing words
 * were still being transcribed. The purge token then threw them away.
 *
 * She said she preferred working alone. The transcript kept «انا افضل انه» and
 * the evaluator judged that fragment. It was never an interruption - she finished
 * speaking and the system lost the end.
 *
 * The rule under test: a late batch is kept only when the single thing that
 * overtook it was the turn being dispatched. If the agent has started speaking,
 * what arrives may be the echo of its own voice and must still be dropped.
 *
 * Run: npm run test:voice-late-batch
 */

let failures = 0;

function check(label: string, ok: boolean): void {
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}`);
}

const S = 'test-session-late-batch';

console.log('— the case that lost her words —');
clearSttPurgeToken(S);
bumpSttPurgeToken(S, 'listen_started');
let atBatchStart = getSttPurgeToken(S);
bumpSttPurgeToken(S, 'turn_dispatched');
check('a batch overtaken only by the dispatch is kept', shouldKeepLateBatch(S, atBatchStart));

console.log('\n— the case that must still be dropped —');
clearSttPurgeToken(S);
bumpSttPurgeToken(S, 'listen_started');
atBatchStart = getSttPurgeToken(S);
bumpSttPurgeToken(S, 'agent_speaking');
check('the agent is speaking — could be its own echo', !shouldKeepLateBatch(S, atBatchStart));

clearSttPurgeToken(S);
bumpSttPurgeToken(S, 'listen_started');
atBatchStart = getSttPurgeToken(S);
bumpSttPurgeToken(S, 'turn_dispatched');
bumpSttPurgeToken(S, 'agent_speaking');
check('dispatched AND then spoken — two steps behind, dropped', !shouldKeepLateBatch(S, atBatchStart));

clearSttPurgeToken(S);
bumpSttPurgeToken(S, 'listen_started');
atBatchStart = getSttPurgeToken(S);
check('nothing overtook it — not a late batch at all', !shouldKeepLateBatch(S, atBatchStart));

clearSttPurgeToken(S);
bumpSttPurgeToken(S, 'turn_dispatched');
atBatchStart = getSttPurgeToken(S);
bumpSttPurgeToken(S, 'listen_started');
check('a new listen window started — not the same turn, dropped', !shouldKeepLateBatch(S, atBatchStart));

console.log('\n— housekeeping —');
clearSttPurgeToken(S);
check('clearing resets the counter', getSttPurgeToken(S) === 0);
check('and a cleared session keeps nothing', !shouldKeepLateBatch(S, 0));

console.log(`\n${failures === 0 ? '✅ all passed' : `❌ ${failures} failed`}`);
process.exit(failures === 0 ? 0 : 1);
