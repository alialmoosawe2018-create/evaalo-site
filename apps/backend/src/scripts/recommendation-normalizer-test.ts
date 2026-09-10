/**
 * `normalizeRecommendation` — the free-text → Hire|Consider|Reject mapper that
 * every n8n stage callback passes through.
 *
 * Why this file exists: on 2026-09-10 the function read SEVEN negated phrasings
 * as a HIRE, `not recommended` and `never hire` among them. It was a chain of
 * bare substring tests, so any wording that separated the negator from the verb
 * fell through to the final `includes('hire')`. Nothing tested it, so a
 * rejection recorded as a hire would have been silent — `applyN8nRejectHandling`
 * derives `status: 'rejected'` from this value.
 *
 * Both directions are asserted on purpose. A guard that rejects everything
 * containing "no" would pass a one-sided test and be just as wrong.
 *
 * Run: npm run test:recommendation-normalizer
 */
import assert from 'node:assert/strict';
import { normalizeRecommendation, applyN8nRejectHandling } from '../services/stageWebhookMerge.js';

let failures = 0;
function check(input: unknown, expected: string | undefined, note = ''): void {
    const got = normalizeRecommendation(input);
    if (got === expected) {
        console.log(`ok   ${JSON.stringify(input)} -> ${String(got)}`);
        return;
    }
    failures += 1;
    console.error(
        `FAIL ${JSON.stringify(input)} -> expected ${String(expected)}, got ${String(got)}${note ? `  (${note})` : ''}`
    );
}

/** The canonical values our own workflows emit. These must never move. */
function testCanonicalValuesAreUntouched(): void {
    check('Hire', 'Hire');
    check('Consider', 'Consider');
    check('Reject', 'Reject');
    check('hire', 'Hire');
    check('consider', 'Consider');
    check('reject', 'Reject');
    check('HIRE', 'Hire');
    check('  Reject  ', 'Reject');
}

/**
 * ⚠️ THE REGRESSION. Every one of these was returning 'Hire' before the fix.
 * A failure here means a rejected candidate is being recorded as hired.
 */
function testNegatedPhrasingsAreNeverAHire(): void {
    for (const input of [
        'Not a hire',
        'not a hire',
        'Not a Hire',
        'not hire',
        'no hire',
        'No Hire',
        'Do not hire',
        'never hire',
        'not recommended',
        'Not recommended',
        'not a recommended candidate',
        'would not hire',
        'cannot recommend',
        'do not recommend',
        'not suitable',
        'not qualified',
        'unsuitable',
        // Separator-shaped enum values. Every one of these read as HIRE until
        // canonicalization was added — the separator kept the negator from ever
        // sitting next to the verb. These are the most realistic inputs here.
        'No-Hire',
        'no_hire',
        'NoHire',
        'NOT_RECOMMENDED',
        'not-recommended',
        'NotRecommended',
        'DO_NOT_HIRE',
        'No–Hire', // en dash
        'Recommendation: No-Hire',
        // Contractions: the apostrophe used to split the negator into "isn t".
        "isn't recommended",
        "can't hire",
        "isn't a hire",
        "couldn't recommend a hire",
        // key/value shapes
        'Hire: No',
        'Recommendation: No',
        'Hire: false',
        // Negators further from the verb than two words, and non-"not" negators.
        'Not a strong enough hire',
        'Not a good fit for hire',
        'Not enough experience to hire',
        'Unable to recommend for hire',
        'Do not move forward with hire',
        'Insufficient experience to hire',
        'Not worth considering',
        'Not recommending this candidate',
        'Hardly a hire',
        // Arabic — these interviews are Arabic, and a lost rejection is a
        // silent failure just like an inverted one.
        'مرفوض',
        'لا يُنصح بالتوظيف',
        // Every separator spelling of the same token. A normalizer that handled
        // "No Hire" but inverted "No-Hire" was inconsistent with itself.
        'NO_HIRE',
        'No_Hire',
        'no-hire',
        'no.hire',
        'no/hire',
        'not.recommended',
        'NOT_HIRE',
        'do_not_hire',
        'Strong No-Hire',
    ]) {
        check(input, 'Reject', 'negated decision must never read as Hire');
    }
}

/**
 * Two phrasings the adversarial pass confirmed that this function still does
 * not classify correctly. Neither is an inversion, so neither is pinned to a
 * value — what is asserted is the direction that would actually hurt.
 *
 *   "Could not be more qualified"    -> undefined (abstains; caller leaves the
 *                                       field alone, which is safe)
 *   "No further review needed, hire" -> Consider (the literal word "review"
 *                                       wins over "hire")
 *
 * Asserting `!== 'Reject'` guards the harm without freezing today's wrong
 * answer as if it were correct.
 */
function testKnownLimitationsStillFailSafe(): void {
    for (const input of ['Could not be more qualified', 'No further review needed, hire']) {
        const got = normalizeRecommendation(input);
        if (got === 'Reject') {
            failures += 1;
            console.error(`FAIL ${JSON.stringify(input)} -> must never be Reject, got ${String(got)}`);
        } else {
            console.log(`ok   ${JSON.stringify(input)} -> ${String(got)} (not a rejection)`);
        }
    }
}

/**
 * The other direction: a negator somewhere in a positive verdict must not turn
 * it into a rejection. This is the harm the fix itself could have introduced.
 */
function testPositiveVerdictsWithANegatorSurvive(): void {
    check('no concerns, hire', 'Hire');
    check('no red flags; recommended', 'Hire');
    check('not the strongest, but hire', 'Hire');
    check('not perfect, still recommended', 'Hire');
    check('not only recommended but excellent', 'Hire', '"not only X but Y" is praise, not negation');
    check('strong hire, no reservations', 'Hire');
    check('recommended, no issues found', 'Hire');
    check('no gaps, consider for interview', 'Consider');
    check('not sure, consider', 'Consider');
    // Negating a NEGATIVE noun is praise, not rejection.
    check('No concerns about hiring', 'Hire');
    check('no doubt hire', 'Hire');
    check('No brainer hire', 'Hire');
    check('Would not hesitate to recommend', 'Hire');
    check('Cannot recommend more highly', 'Hire', 'fixed idiom, not compositional negation');
    check('Not a bad hire', 'Hire');
    /**
     * ⚠️ The comma is load-bearing. `\w+` cannot cross it, and that is the only
     * thing stopping the negation window from reaching into the next clause. An
     * earlier attempt stripped punctuation before matching and turned these
     * three into rejections. Do not "tidy up" the input before the fuzzy pass.
     */
    check('not the strongest, but hire', 'Hire');
    check('not perfect, still recommended', 'Hire');
    check('recommended, no issues found', 'Hire');
}

function testPositiveAndMiddleVerdicts(): void {
    check('strong hire', 'Hire');
    check('recommended', 'Hire');
    check('highly recommended', 'Hire');
    check('recommended for hire', 'Hire');
    check('maybe', 'Consider');
    check('review further', 'Consider');
    check('consider for interview', 'Consider');
}

/** Unclassifiable input must yield undefined so the caller leaves the field alone. */
function testUnknownStaysUndefined(): void {
    check(undefined, undefined);
    check(null, undefined);
    check('', undefined);
    check('   ', undefined);
    check('N/A', undefined);
    check('borderline', undefined);
}

/**
 * The value feeds a real status write, so pin the end-to-end consequence too:
 * a negated recommendation must actually mark the record rejected.
 */
function testRejectionReachesTheStatusField(): void {
    const updateData: Record<string, unknown> = {};
    applyRejectFor('not recommended', updateData);
    assert.equal(updateData.status, 'rejected', '"not recommended" must set status=rejected');

    const hired: Record<string, unknown> = {};
    applyRejectFor('Hire', hired);
    assert.equal(hired.status, undefined, 'a hire must not be marked rejected');
}

/** Mirrors the real caller: server.ts passes the patch through to this. */
function applyRejectFor(recommendation: string, updateData: Record<string, unknown>): void {
    applyN8nRejectHandling({}, updateData, { recommendation });
}

testCanonicalValuesAreUntouched();
testNegatedPhrasingsAreNeverAHire();
testPositiveVerdictsWithANegatorSurvive();
testPositiveAndMiddleVerdicts();
testUnknownStaysUndefined();
testKnownLimitationsStillFailSafe();
testRejectionReachesTheStatusField();

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nrecommendation-normalizer-test: all passed');
