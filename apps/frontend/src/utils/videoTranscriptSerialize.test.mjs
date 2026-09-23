/**
 * The transcript the page sends, and the per-message timestamp it carries.
 *
 * The central case here is `a partial removed from the middle`. An earlier
 * version of this code kept timestamps in a side array indexed by position, and
 * it was wrong in a way no green suite would have caught: the page's merge logic
 * drops partials out of the array, so an entry can vanish from the MIDDLE and
 * shift every index after it. Turn times would then be attributed to the wrong
 * turns — and we are about to compute per-turn latency from exactly this field,
 * so a plausible wrong number is worse than a missing one.
 *
 * Run: node src/utils/videoTranscriptSerialize.test.mjs   (from apps/frontend)
 */
import {
    MSG_TS,
    serializeTranscript,
    stampNewMessages,
} from './videoTranscriptSerialize.js';

let failed = 0;
let passed = 0;

function check(name, fn) {
    try {
        fn();
        console.log('  ✓', name);
        passed += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', err.message);
        failed += 1;
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const msg = (role, content, extra = {}) => ({ role, content, isFinal: true, ...extra });

check('a stamped message carries its time to the wire', () => {
    const history = [msg('assistant', 'سؤال')];
    stampNewMessages(history, Date.parse('2026-09-23T07:56:01.000Z'));
    const out = serializeTranscript(history);
    assert(out.length === 1, 'one message expected');
    assert(out[0].timestamp === '2026-09-23T07:56:01.000Z', `got ${out[0].timestamp}`);
});

check('distinct turns keep distinct times (the 2026-09-23 regression)', () => {
    const history = [msg('assistant', 'a')];
    stampNewMessages(history, 1_000_000);
    history.push(msg('user', 'b'));
    stampNewMessages(history, 1_043_000);

    const out = serializeTranscript(history);
    const gap = Date.parse(out[1].timestamp) - Date.parse(out[0].timestamp);
    assert(gap === 43_000, `turn gap lost: ${gap}ms`);
});

check('a message is never re-stamped — a turn is timed from its START', () => {
    const history = [msg('user', 'first half')];
    stampNewMessages(history, 5_000);
    // A later merge corrects the content of the same turn.
    history[0] = { ...history[0], content: 'first half and the rest' };
    stampNewMessages(history, 9_999);

    assert(history[0][MSG_TS] === 5_000, `re-stamped to ${history[0][MSG_TS]}`);
});

check('THE BUG: a partial removed from the MIDDLE must not shift any time', () => {
    // Exactly the page's sequence: an assistant partial is still in the array
    // when a user final is appended after it, then the assistant's final arrives
    // and the partial is filtered out of the middle.
    const a0 = msg('assistant', 'سؤال أول');
    const partial = { role: 'assistant', content: 'جزئي…', isFinal: false };
    const u0 = msg('user', 'جواب المستخدم');

    let history = [a0, partial, u0];
    stampNewMessages(history, 100);
    // Give the user turn a clearly different time so a shift is detectable.
    u0[MSG_TS] = 700;

    // The assistant's final arrives: partials of that role are dropped, the
    // final is appended at the END. `u0` moves from index 2 to index 1.
    history = history.filter((m) => !(m.role === 'assistant' && m.isFinal === false));
    history.push(msg('assistant', 'سؤال ثاني'));
    stampNewMessages(history, 900);

    const out = serializeTranscript(history);
    const byContent = Object.fromEntries(out.map((m) => [m.content, m.timestamp]));
    assert(
        byContent['جواب المستخدم'] === new Date(700).toISOString(),
        `user turn time followed the index shift: ${byContent['جواب المستخدم']}`
    );
    assert(
        byContent['سؤال أول'] === new Date(100).toISOString(),
        `first question time moved: ${byContent['سؤال أول']}`
    );
    assert(
        byContent['سؤال ثاني'] === new Date(900).toISOString(),
        `new question mis-stamped: ${byContent['سؤال ثاني']}`
    );
});

check('the stamp survives a spread-based merge', () => {
    const history = [msg('user', 'نصف')];
    stampNewMessages(history, 321);
    history[0] = { ...history[0], content: 'نصف وكمل', isFinal: true };
    const out = serializeTranscript(history);
    assert(out[0].timestamp === new Date(321).toISOString(), 'merge dropped the stamp');
});

check('partials and blanks are still excluded from the wire', () => {
    const history = [
        msg('assistant', '  مساحات  '),
        { role: 'user', content: 'جزئي', isFinal: false },
        msg('user', '   '),
        msg('weird', 'دور غير معروف يصير user'),
        null,
    ];
    stampNewMessages(history, 1);
    const out = serializeTranscript(history);
    assert(out.length === 2, `expected 2, got ${out.length}`);
    assert(out[0].content === 'مساحات', 'content not trimmed');
    assert(out[1].role === 'user', 'unknown role must fall back to user');
});

check('an unstamped message is sent WITHOUT a timestamp, never a forged one', () => {
    // Omitted → the server applies its schema default. Inventing a time here
    // would look like real measurement data and quietly poison the round.
    const out = serializeTranscript([msg('user', 'بلا طابع')]);
    assert(!('timestamp' in out[0]), 'a timestamp was invented');
});

check('non-arrays are empty, never a throw', () => {
    assert(serializeTranscript(undefined).length === 0, 'undefined');
    assert(serializeTranscript(null).length === 0, 'null');
    assert(serializeTranscript('nope').length === 0, 'string');
    stampNewMessages(undefined, 1); // must not throw
});

console.log(`\n[videoTranscriptSerialize] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
