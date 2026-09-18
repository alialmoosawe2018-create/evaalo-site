/**
 * The readiness gate's decision — the one rule that decides whether a candidate
 * can begin.
 *
 * Getting it wrong fails in both directions: too strict blocks every candidate,
 * too loose lets a blind specialist interview through. Three consecutive
 * public-path interviews ran without competencies and were then graded against
 * the full rubric — coverage 0.22, 0.11, 0, 0.33, one scored ZERO — which is
 * what the gate exists to stop.
 *
 * Run: node src/utils/blueprintGate.test.mjs   (from apps/frontend)
 */
import { blueprintGateDecision } from './blueprintGate.js';

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

check('ready opens the gate with no extra screen', () => {
    const d = blueprintGateDecision('ready');
    assert(d.blocked === false, 'a ready campaign must never be held');
    assert(d.note === '', 'a ready campaign must show no status note');
    assert(d.retry === false, 'nothing to retry');
});

check('generating holds the candidate, with no retry button', () => {
    const d = blueprintGateDecision('generating');
    assert(d.blocked === true, 'must not start without competencies');
    assert(d.note === 'preparing', 'the candidate must be told why');
    // Polling restarts a failed generation and joins a running one, so a button
    // here would only invite pointless clicking.
    assert(d.retry === false, 'a running generation needs no retry button');
});

check('absent is a clear, RETRYABLE failure — never an endless spinner', () => {
    const d = blueprintGateDecision('absent');
    assert(d.blocked === true, 'must not start without competencies');
    assert(d.note === 'failed', 'a terminal failure must not read as "preparing"');
    assert(d.retry === true, 'the owner asked for a retryable state, not a spinner');
});

check('⚠️ unknown must NOT block — it would stop every candidate', () => {
    // /prepare can be skipped by env or fail outright. The real enforcement is
    // the backend guard on /start; this screen only spares the candidate from
    // beginning something that would be refused.
    for (const unknown of [null, undefined, '', 'something-else']) {
        const d = blueprintGateDecision(unknown);
        assert(d.blocked === false, `unknown state ${JSON.stringify(unknown)} must not block`);
    }
});

check('only a blocked state ever carries a note or a retry', () => {
    for (const state of ['ready', null, undefined, 'weird']) {
        const d = blueprintGateDecision(state);
        assert(!d.note && !d.retry, `open gate must be silent for ${JSON.stringify(state)}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
