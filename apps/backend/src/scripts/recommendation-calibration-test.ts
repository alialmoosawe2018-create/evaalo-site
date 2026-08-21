/**
 * Unit test for recommendation ↔ score calibration.
 *
 * Fixes the prod case: Stage 2 voice returned overall_score=61 with
 * Recommendation="Hire" while the narrative said "advance to Stage 3 to verify".
 * The clamp downgrades an over-optimistic label to the score band; it never
 * inflates a cautious one.
 *
 * Run: npx tsx src/scripts/recommendation-calibration-test.ts
 */
import { clampRecommendationToScore } from '../services/recommendationCalibration.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        console.log(`ok   ${name}`);
    } else {
        failures += 1;
        console.error(`FAIL ${name}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

// The exact prod defect.
check('61 + Hire → Consider (the prod case)', clampRecommendationToScore('Hire', 61), 'Consider');

// Band boundaries (defaults: Hire ≥ 70, Consider ≥ 50).
check('70 + Hire stays Hire', clampRecommendationToScore('Hire', 70), 'Hire');
check('69 + Hire → Consider', clampRecommendationToScore('Hire', 69), 'Consider');
check('50 + Consider stays Consider', clampRecommendationToScore('Consider', 50), 'Consider');
check('49 + Consider → Reject', clampRecommendationToScore('Consider', 49), 'Reject');
check('45 + Hire → Reject', clampRecommendationToScore('Hire', 45), 'Reject');

// Never inflate a more cautious label.
check('61 + Reject stays Reject (no inflation)', clampRecommendationToScore('Reject', 61), 'Reject');
check('90 + Consider stays Consider (no inflation)', clampRecommendationToScore('Consider', 90), 'Consider');

// Pass-through when we cannot calibrate.
check('no score → unchanged', clampRecommendationToScore('Hire', undefined), 'Hire');
check('no recommendation → undefined', clampRecommendationToScore(undefined, 61), undefined);
check('NaN score → unchanged', clampRecommendationToScore('Hire', Number.NaN), 'Hire');

// Kill switch.
process.env.STAGE_REC_SCORE_CLAMP = 'false';
check('disabled via env → unchanged', clampRecommendationToScore('Hire', 61), 'Hire');
delete process.env.STAGE_REC_SCORE_CLAMP;
check('re-enabled after env cleared', clampRecommendationToScore('Hire', 61), 'Consider');

if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
}
console.log('\nrecommendation-calibration-test: OK');
