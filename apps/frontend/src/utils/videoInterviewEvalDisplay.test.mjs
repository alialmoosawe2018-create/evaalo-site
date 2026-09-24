/**
 * A Stage 3 candidate with no evaluation must never read as 0%.
 *
 * Production (2026-09-24, bundle index-BUPSQseX.js) rendered the score cell as
 * `${overall_score ?? 0}%` in red, so every interview still being scored — and,
 * since n8n 93a52261, every evaluation the scorer refused to fake — looked like
 * a failing 0%. The share report did the same (`overall_score || 0`).
 *
 * Run: node src/utils/videoInterviewEvalDisplay.test.mjs   (from apps/frontend)
 */
import { videoOverallScoreForDisplay } from './videoInterviewEvalDisplay.js';

let failed = 0;
let passed = 0;
function check(name, actual, expected) {
    if (Object.is(actual, expected)) {
        console.log('  ✓', name);
        passed += 1;
    } else {
        console.error('  ✗', name, `\n      expected ${String(expected)}, got ${String(actual)}`);
        failed += 1;
    }
}

const assessedRow = { competencyKey: 'k', score: 1, assessed: true };

console.log('No evaluation -> no score (a dash, never 0%)');
check('candidate without any evaluation', videoOverallScoreForDisplay(undefined), null);
check('null evaluation', videoOverallScoreForDisplay(null), null);
check('empty evaluation object', videoOverallScoreForDisplay({}), null);
check('evaluation with a null score', videoOverallScoreForDisplay({ overall_score: null, competencyScores: [] }), null);
check('evaluation with an empty-string score', videoOverallScoreForDisplay({ overall_score: '' }), null);
check('evaluation with a non-numeric score', videoOverallScoreForDisplay({ overall_score: 'n/a', competencyScores: [assessedRow] }), null);

console.log('Insufficient interviews stay hidden (unchanged)');
check('status insufficient_data with its forced 0', videoOverallScoreForDisplay({ status: 'insufficient_data', overall_score: 0, recommendation: 'Reject' }), null);
check('degenerate verdict with no competency evidence', videoOverallScoreForDisplay({ overall_score: 0, recommendation: 'Reject' }), null);

console.log('Real scores are shown as they are');
check('a GENUINE scored 0 still shows 0', videoOverallScoreForDisplay({ status: 'scored', overall_score: 0, recommendation: 'Reject', competencyScores: [assessedRow] }), 0);
check('an ordinary score', videoOverallScoreForDisplay({ status: 'scored', overall_score: 57, competencyScores: [assessedRow] }), 57);
check('a numeric string score from an older record', videoOverallScoreForDisplay({ overall_score: '42', professional_depth: 6 }), 42);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
