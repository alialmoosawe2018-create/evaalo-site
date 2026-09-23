/**
 * The browser's turn-log collector must never merge two different utterances.
 *
 * The central case is copied from the live check against the DEPLOYED agent on
 * 2026-09-23: three distinct utterances, all `turnIndex: 0`. Keyed on turnIndex
 * they collapsed into one; this suite fails if that ever comes back.
 *
 * Run: node src/utils/videoTurnLog.test.mjs   (from apps/frontend)
 */
import { mergeTurnLogRecord } from './videoTurnLog.js';

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

check('THE LIVE CASE: three utterances sharing turnIndex 0 all survive', () => {
    const list = [];
    // Exactly what the deployed agent sent on 2026-09-23 (greeting, then the
    // same question twice), now carrying the per-emission seq.
    mergeTurnLogRecord(list, { seq: 0, turnIndex: 0, kind: 'turn', openerUsed: 'حياك' });
    mergeTurnLogRecord(list, { seq: 1, turnIndex: 0, kind: 'turn', openerUsed: 'شنو' });
    mergeTurnLogRecord(list, { seq: 2, turnIndex: 0, kind: 'turn', openerUsed: 'شنو' });
    assert(list.length === 3, `collapsed to ${list.length} record(s) — the turnIndex bug is back`);
    assert(list[0].openerUsed === 'حياك', 'the greeting record was overwritten');
});

check('the same emission delivered twice is kept once', () => {
    const list = [];
    mergeTurnLogRecord(list, { seq: 5, turnIndex: 2, v: 'first' });
    mergeTurnLogRecord(list, { seq: 5, turnIndex: 2, v: 'redelivered' });
    assert(list.length === 1, `expected 1, got ${list.length}`);
    assert(list[0].v === 'redelivered', 'the redelivery did not replace');
});

check('the end record coexists with turns that share its sentinel index', () => {
    const list = [];
    mergeTurnLogRecord(list, { seq: 0, turnIndex: -1, kind: 'turn' });
    mergeTurnLogRecord(list, { seq: 1, turnIndex: -1, kind: 'end', endTrigger: 'agent_tool' });
    assert(list.length === 2, `expected 2, got ${list.length}`);
});

check('a record from an older agent (no seq) is appended, never merged', () => {
    const list = [];
    mergeTurnLogRecord(list, { turnIndex: 0, v: 'a' });
    mergeTurnLogRecord(list, { turnIndex: 0, v: 'b' });
    assert(list.length === 2, `an older-agent record was merged away (${list.length})`);
});

check('garbage is ignored, never a throw', () => {
    const list = [];
    mergeTurnLogRecord(list, null);
    mergeTurnLogRecord(list, 'text');
    mergeTurnLogRecord(null, { seq: 1 });
    assert(list.length === 0, 'garbage was stored');
});

console.log(`\n[videoTurnLog] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
