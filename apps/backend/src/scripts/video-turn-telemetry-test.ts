/**
 * Phase-0 telemetry: per-message timestamps, and the agent's turn log.
 *
 * Two things this pins, both learned from the 2026-09-23 HSE interview:
 *
 * 1. EVERY message in that session carried the identical timestamp
 *    (08:05:12.84x), so no turn could be timed after the fact. The cause was
 *    not the schema — `timestamp` is declared with `default: Date.now` — it was
 *    this normalizer dropping the field, after which Mongoose stamped the whole
 *    array in one save. A normalizer that silently loses `timestamp` again puts
 *    us straight back to an unmeasurable interview, and nothing else would
 *    notice, so it is asserted here.
 *
 * 2. The agent runs on LiveKit Cloud with no HTTP path to this backend, so the
 *    browser is the ONLY carrier for its turn log. That makes this normalizer
 *    the trust boundary: it takes whatever a tab posts. It must therefore drop
 *    anything that is not a record and cap the length, or a diagnostic aid
 *    becomes the thing that pushes the session document at the 16MB limit.
 *
 * Run: npx tsx src/scripts/video-turn-telemetry-test.ts
 */
import assert from 'node:assert';
import {
    MAX_TURN_LOG_ENTRIES,
    normalizeIncomingTranscript,
    normalizeIncomingTurnLog,
} from '../services/videoTurnTelemetry.js';

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

// ── Transcript timestamps ────────────────────────────────────────────────────

test('a per-message timestamp survives normalization', () => {
    const out = normalizeIncomingTranscript([
        { role: 'assistant', content: 'سؤال', timestamp: '2026-09-23T07:56:01.000Z' },
        { role: 'user', content: 'جواب', timestamp: '2026-09-23T07:56:44.000Z' },
    ]);
    assert.strictEqual(out.length, 2);
    assert.ok(out[0].timestamp instanceof Date);
    // The gap between turns is the whole point — it must be recoverable.
    const gapMs = (out[1].timestamp as Date).getTime() - (out[0].timestamp as Date).getTime();
    assert.strictEqual(gapMs, 43_000);
});

test('this is the regression: distinct times must not collapse into one', () => {
    const out = normalizeIncomingTranscript([
        { role: 'assistant', content: 'a', timestamp: '2026-09-23T07:56:01.000Z' },
        { role: 'user', content: 'b', timestamp: '2026-09-23T07:58:01.000Z' },
        { role: 'assistant', content: 'c', timestamp: '2026-09-23T08:01:01.000Z' },
    ]);
    const stamps = new Set(out.map((m) => (m.timestamp as Date).toISOString()));
    assert.strictEqual(stamps.size, 3, 'all three turns collapsed to the same instant');
});

test('a missing or unparseable timestamp is omitted, not forged', () => {
    // Omitted → Mongoose applies its schema default. Inventing a value here
    // would look like real timing data and silently poison the measurement.
    const out = normalizeIncomingTranscript([
        { role: 'user', content: 'no stamp' },
        { role: 'user', content: 'bad stamp', timestamp: 'not-a-date' },
    ]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].timestamp, undefined);
    assert.strictEqual(out[1].timestamp, undefined);
});

test('normalization still does its original job', () => {
    const out = normalizeIncomingTranscript([
        { role: 'assistant', content: '  مساحات  ' },
        { role: 'weird', content: 'unknown role becomes user' },
        { role: 'user', content: '   ' },
        { role: 'user', content: '' },
        null,
    ]);
    assert.strictEqual(out.length, 2, 'empty/blank messages must still be dropped');
    assert.strictEqual(out[0].content, 'مساحات');
    assert.strictEqual(out[1].role, 'user');
});

test('a non-array is empty, never a throw', () => {
    assert.deepStrictEqual(normalizeIncomingTranscript(undefined), []);
    assert.deepStrictEqual(normalizeIncomingTranscript('nope'), []);
    assert.deepStrictEqual(normalizeIncomingTranscript(null), []);
});

// ── Turn log ─────────────────────────────────────────────────────────────────

test('turn records pass through intact', () => {
    const out = normalizeIncomingTurnLog([
        { turnIndex: 0, competencyKey: 'risk_assessment', planSource: 'competency_engine' },
        { turnIndex: 1, competencyKey: 'permit_to_work', followupSkipReason: 'mentions_result' },
    ]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].competencyKey, 'risk_assessment');
    assert.strictEqual(out[1].followupSkipReason, 'mentions_result');
});

test('anything that is not a record is dropped — the browser is untrusted here', () => {
    const out = normalizeIncomingTurnLog([
        { turnIndex: 0 },
        'a string',
        42,
        null,
        undefined,
        ['an array is not a record'],
    ]);
    assert.strictEqual(out.length, 1);
});

test('the log is capped so telemetry cannot be what blows the document limit', () => {
    const huge = Array.from({ length: MAX_TURN_LOG_ENTRIES + 250 }, (_, i) => ({ turnIndex: i }));
    const out = normalizeIncomingTurnLog(huge);
    assert.strictEqual(out.length, MAX_TURN_LOG_ENTRIES);
    // Keep the MOST RECENT turns: the end of an interview is where it goes wrong.
    assert.strictEqual(out[out.length - 1].turnIndex, MAX_TURN_LOG_ENTRIES + 249);
});

test('a non-array turnLog is empty, never a throw', () => {
    assert.deepStrictEqual(normalizeIncomingTurnLog(undefined), []);
    assert.deepStrictEqual(normalizeIncomingTurnLog({ notAnArray: true }), []);
});

// -- Trust boundary: turnLog is stored as Mongoose `Mixed` -------------------

test('MongoDB operator keys are stripped, not stored', () => {
    const out = normalizeIncomingTurnLog([
        { turnIndex: 0, $set: { role: 'admin' }, 'a.b': 1, competencyKey: 'ok' },
    ]);
    assert.strictEqual(out.length, 1);
    assert.ok(!('$set' in out[0]), '$-prefixed key survived');
    assert.ok(!('a.b' in out[0]), 'dotted key survived');
    assert.strictEqual(out[0].competencyKey, 'ok', 'legitimate data was dropped');
});

test('prototype-polluting keys are stripped', () => {
    const hostile = JSON.parse('{"turnIndex":0,"__proto__":{"polluted":true},"constructor":1}');
    const out = normalizeIncomingTurnLog([hostile]);
    assert.ok(!Object.prototype.hasOwnProperty.call(out[0], '__proto__'), '__proto__ survived');
    // `in` walks the prototype chain, where every ordinary object has a
    // `constructor` — own-property is the only meaningful check here.
    assert.ok(
        !Object.prototype.hasOwnProperty.call(out[0], 'constructor'),
        'constructor survived as an own property'
    );
    assert.strictEqual((({} as any).polluted), undefined, 'Object.prototype was polluted');
});

test('nested objects are sanitized too', () => {
    const out = normalizeIncomingTurnLog([
        { turnIndex: 0, diag: { $where: 'evil', mentionsResult: true } },
    ]);
    assert.ok(!('$where' in out[0].diag), 'nested $-key survived');
    assert.strictEqual(out[0].diag.mentionsResult, true, 'nested data lost');
});

test('runaway nesting is truncated rather than stored', () => {
    let deep: any = { leaf: 1 };
    for (let i = 0; i < 12; i += 1) deep = { nest: deep };
    const out = normalizeIncomingTurnLog([{ turnIndex: 0, deep }]);
    assert.strictEqual(out.length, 1, 'a deeply nested record must still be accepted');
    let depth = 0;
    let cur: any = out[0].deep;
    while (cur && typeof cur === 'object' && cur.nest) { depth += 1; cur = cur.nest; }
    assert.ok(depth < 12, `nesting was not truncated (depth ${depth})`);
});

test('ordinary telemetry is untouched by sanitization', () => {
    const rec = {
        turnIndex: 3,
        kind: 'turn',
        competencyKey: 'risk_assessment',
        diag: { isSubstantiveAnswer: true, mentionsResult: false },
        competencyBudgetSpent: { risk_assessment: 1 },
    };
    const [out] = normalizeIncomingTurnLog([rec]);
    assert.deepStrictEqual(out, rec, 'a clean record must round-trip unchanged');
});

console.log(`\n[video-turn-telemetry] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
