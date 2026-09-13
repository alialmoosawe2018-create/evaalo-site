/**
 * Stage 2 competency display — pinned against a REAL stored evaluation.
 *
 * The fixture is candidate ليث محمود نجم's voice interview of 2026-09-13
 * (application 248f9a2f…, n8n execution 1822), trimmed to the fields the board
 * reads. It is the first interview scored by the ten-competency instrument, and
 * the one that showed the OLD five-column layout because this module did not
 * exist yet.
 *
 * Run: node src/utils/stage2CompetencyDisplay.test.mjs   (from apps/frontend)
 */
import {
    buildLegacyStage2Rows,
    buildStage2CompetencyRows,
    isLegacyStage2Evaluation,
    isInsufficientStage2Evaluation,
    isStage2CompetencyEvaluation,
    stage2CompetencyLabel,
    stage2Coverage,
    stage2RatingTone,
    STAGE2_COMPETENCY_ORDER,
} from './stage2CompetencyDisplay.js';

let failed = 0;
let passed = 0;
const ok = (name, cond, extra) => {
    if (cond) {
        passed++;
        console.log(`ok   ${name}${extra ? `  [${extra}]` : ''}`);
    } else {
        failed++;
        console.error(`FAIL ${name}${extra ? `  [${extra}]` : ''}`);
    }
};

/** Stand-in translator: returns the key, so a missing key is visible as the key. */
const t = (key) => key;

const LAITH = {
    status: 'scored',
    coverage: 100,
    overall_score: 57,
    recommendation: 'Consider',
    communication: 'Good',
    language_fluency: 'Intermediate',
    competencyScores: [
        { competencyKey: 'relevant_experience_role_fit', assessed: true, rating: 'Intermediate', evidence: ['المهمة اللي راح اسويها هي انه واراعي التوظيف.'], selfReported: false },
        { competencyKey: 'communication_skills', assessed: true, rating: 'Good', evidence: ['اني خريج طب أسنان جامعة بابل.'], selfReported: false },
        { competencyKey: 'professional_attitude', assessed: true, rating: 'Good', evidence: ['اهم شي عندي هو الوقت والالتزام.'], selfReported: false },
        { competencyKey: 'english_fluency', assessed: true, rating: 'Intermediate', evidence: ['My professional background.'], selfReported: false },
        { competencyKey: 'learning_and_adaptability', assessed: true, rating: 'Good', evidence: ['قمت بتطوير نفسي فيها.'], selfReported: false },
        { competencyKey: 'time_management_and_prioritization', assessed: true, rating: 'Intermediate', evidence: ['اعمل ساعات طويلة وتحت الضغط.'], selfReported: false },
        { competencyKey: 'teamwork_and_collaboration', assessed: true, rating: 'Good', evidence: ['احب العمل الجماعي.'], selfReported: false },
        { competencyKey: 'problem_solving', assessed: true, rating: 'Intermediate', evidence: ['انا شخصياً أقوم بملئها.'], selfReported: false },
        { competencyKey: 'confidence_level', assessed: true, rating: 'Good', evidence: ['اقود هذا الفريق.'], selfReported: false },
        { competencyKey: 'computer_skills', assessed: true, rating: 'Good', evidence: ['برنامج Adobe premiere والأفتر أفكت.'], selfReported: true },
    ],
};

// ── the shape the board used to miss entirely ────────────────────────────────
ok('a ten-competency evaluation is recognised', isStage2CompetencyEvaluation(LAITH) === true);
ok('an old flat-only evaluation is not', isStage2CompetencyEvaluation({ communication: 'Good', overall_score: 41 }) === false);
ok('an empty evaluation is not', isStage2CompetencyEvaluation({}) === false && isStage2CompetencyEvaluation(null) === false);
ok('an insufficient evaluation is recognised even with no competencies', isStage2CompetencyEvaluation({ status: 'insufficient_data' }) === true);

const rows = buildStage2CompetencyRows(LAITH, t);
ok('all ten competencies become rows', rows.length === 10, String(rows.length));
ok('the scorer order is kept', rows.map((r) => r.key).join(',') === STAGE2_COMPETENCY_ORDER.join(','));
ok('every row carries its verbatim quote', rows.every((r) => r.evidence.length === 1));
ok(
    'the five competencies the old board never showed are present',
    ['relevant_experience_role_fit', 'professional_attitude', 'learning_and_adaptability', 'time_management_and_prioritization', 'teamwork_and_collaboration']
        .every((k) => rows.some((r) => r.key === k)),
);

// ── tones: the colour is now the ONLY thing the chip says, so Intermediate
//    gets its own band — a LIGHTER green (`partial`), never a new hue ──────────
ok('Excellent and Good clear the bar', stage2RatingTone('Excellent') === 'met' && stage2RatingTone('Good') === 'met');
ok('Intermediate has its own band, so it cannot be mistaken for Good', stage2RatingTone('Intermediate') === 'partial');
ok('Bad is a miss', stage2RatingTone('Bad') === 'miss');
ok(
    'no tone outside the four bands is ever produced',
    ['Excellent', 'Good', 'Intermediate', 'Bad', 'Not Assessed', 'junk', null].every((r) => ['met', 'partial', 'miss', 'na'].includes(stage2RatingTone(r))),
);
ok(
    'Good and Intermediate never collapse onto one colour',
    stage2RatingTone('Good') !== stage2RatingTone('Intermediate'),
);
ok('Not Assessed / unknown / empty is na', ['Not Assessed', 'not_assessed', '', null, undefined, 'nonsense'].every((r) => stage2RatingTone(r) === 'na'));
ok('the tone reading is case- and separator-insensitive', stage2RatingTone('  INTERMEDIATE ') === 'partial' && stage2RatingTone('not-assessed') === 'na');
const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
ok('English Intermediate renders partial on the real record', byKey.english_fluency.tone === 'partial');
ok('Teamwork Good renders met on the real record', byKey.teamwork_and_collaboration.tone === 'met');
ok(
    "ليث's real record no longer comes out as ten identical chips",
    new Set(rows.map((r) => r.tone)).size > 1,
    [...new Set(rows.map((r) => r.tone))].join(','),
);

// ── the rating WORD is never printed; the colour carries it ─────────────────
ok('an assessed chip prints no rating word', byKey.communication_skills.mark === '', byKey.communication_skills.mark);
ok('every assessed chip in the real record is markless', rows.filter((r) => r.tone !== 'na').every((r) => r.mark === ''));
ok('but the word stays reachable on hover', byKey.communication_skills.markTitle === 'stageEval_rateGood', byKey.communication_skills.markTitle);
ok('and to a screen reader', byKey.communication_skills.markLabel === 'stageEval_rateGood');
ok('self-reported carries its note', byKey.computer_skills.note === 'stageEval_selfReported');
ok('an observed competency carries none', byKey.communication_skills.note === '');
ok('Stage 2 never shows a red flag (the scorer emits none)', rows.every((r) => r.redFlags.length === 0));

// ── labels ──────────────────────────────────────────────────────────────────
ok('every one of the ten has a translation key', STAGE2_COMPETENCY_ORDER.every((k) => stage2CompetencyLabel(k, t).startsWith('stageEval_col')));
ok('a key the scorer adds later is humanized, not dropped', stage2CompetencyLabel('negotiation_skill', t) === 'Negotiation skill');
ok('the row label comes from the key when the scorer sends no title', byKey.problem_solving.label === 'stageEval_colProblemSolving');
ok(
    'a title from the scorer wins when it sends one',
    buildStage2CompetencyRows({ competencyScores: [{ competencyKey: 'problem_solving', assessed: true, rating: 'Good', title: 'حل المشكلات المعقّدة' }] }, t)[0].label === 'حل المشكلات المعقّدة',
);

// ── unassessed sinks, and reads as a dash rather than a failure ──────────────
const mixed = buildStage2CompetencyRows({
    competencyScores: [
        { competencyKey: 'relevant_experience_role_fit', assessed: false, rating: 'Not Assessed', evidence: [] },
        { competencyKey: 'communication_skills', assessed: true, rating: 'Good', evidence: ['x'] },
        { competencyKey: 'english_fluency', assessed: true, rating: 'Bad', evidence: [] },
    ],
}, t);
ok('unassessed sinks to the bottom', mixed.map((r) => r.key).join(',') === 'communication_skills,english_fluency,relevant_experience_role_fit', mixed.map((r) => r.key).join(','));
ok('unassessed shows a dash, not ✗', mixed[2].mark === '–' && mixed[2].tone === 'na');
ok('unassessed explains itself on hover', mixed[2].markTitle === 'videoInterview_notAssessed');
ok('Bad still reads as a miss, not as unassessed', mixed[1].tone === 'miss');
ok(
    'assessed:true with a rating the scale does not know is treated as unassessed',
    buildStage2CompetencyRows({ competencyScores: [{ competencyKey: 'problem_solving', assessed: true, rating: 'Not Assessed' }] }, t)[0].tone === 'na',
);

// ── coverage + insufficiency ────────────────────────────────────────────────
ok('coverage is read from the evaluation', stage2Coverage(LAITH) === 100);
ok('a missing or impossible coverage is null', [undefined, null, '', 'abc', -1, 101].every((v) => stage2Coverage({ coverage: v }) === null));
ok('coverage is rounded', stage2Coverage({ coverage: 72.4 }) === 72);
ok('a scored evaluation is not insufficient', isInsufficientStage2Evaluation(LAITH) === false);
ok('an insufficient one is', isInsufficientStage2Evaluation({ status: 'insufficient_data' }) === true);
ok('no status is not insufficient', isInsufficientStage2Evaluation({}) === false);

// ── nothing throws on junk ──────────────────────────────────────────────────
ok('junk input yields no rows', buildStage2CompetencyRows(null, t).length === 0 && buildStage2CompetencyRows({ competencyScores: 'nope' }, t).length === 0);
ok('a row with no key still gets a React key', buildStage2CompetencyRows({ competencyScores: [{ rating: 'Good' }] }, t)[0].key === 'competency-0');

// ── the 31 evaluations written before the ten competencies ──────────────────
// They hold only the five flat ratings, and they are the majority of the board:
// 31 of 41 stored evaluations on 2026-09-13. They render as the same chips in the
// same single column rather than being dropped.
const LEGACY = {
    overall_score: 41,
    recommendation: 'Reject',
    communication: 'Intermediate',
    language_fluency: 'Bad',
    confidence: 'Intermediate',
    problem_solving: 'Intermediate',
    digital_skills: 'Good',
};
ok('a legacy evaluation is recognised', isLegacyStage2Evaluation(LEGACY) === true);
ok('the new shape is not legacy', isLegacyStage2Evaluation(LAITH) === false);
ok('a verdict-only row is not legacy — it has nothing to show', isLegacyStage2Evaluation({ recommendation: 'Incomplete' }) === false);
ok('an empty skeleton is not legacy', isLegacyStage2Evaluation({}) === false && isLegacyStage2Evaluation(null) === false);

const legacyRows = buildLegacyStage2Rows(LEGACY, t);
ok('all five flat ratings become chips', legacyRows.length === 5, String(legacyRows.length));
ok(
    'they keep the order their columns stood in',
    legacyRows.map((r) => r.key).join(',') === 'communication,language_fluency,confidence,problem_solving,digital_skills',
    legacyRows.map((r) => r.key).join(','),
);
ok('each carries its old column label', legacyRows[0].label === 'stageEval_colCommunicationSkills' && legacyRows[4].label === 'stageEval_colComputerSkills');
ok('the mark is the localized rating word', legacyRows[0].mark === 'stageEval_rateIntermediate', legacyRows[0].mark);
ok('Bad reads as a miss here too', legacyRows[1].tone === 'miss');
ok('legacy chips carry no evidence and no note', legacyRows.every((r) => r.evidence.length === 0 && r.note === ''));
ok('no tone outside the four bands appears', legacyRows.every((r) => ['met', 'partial', 'miss', 'na'].includes(r.tone)));
// A legacy row has NO evidence to open, so its rating word is the only thing it can
// ever say. It keeps the word even though the ten-competency rows dropped theirs —
// removing it would leave a bare coloured chip with nothing behind it.
ok('a legacy chip keeps its word, having no evidence to fall back on', legacyRows.every((r) => r.mark !== ''));

const legacyNa = buildLegacyStage2Rows({ communication: 'Good', language_fluency: 'Not Assessed', confidence: 'Good' }, t);
ok('a missing field is skipped, not shown empty', legacyNa.length === 3, String(legacyNa.length));
ok('Not Assessed sinks to the bottom with a dash', legacyNa[2].key === 'language_fluency' && legacyNa[2].mark === '–' && legacyNa[2].tone === 'na');

const legacyNum = buildLegacyStage2Rows({ communication: 8, problem_solving: 2 }, t);
ok('a 0–10 score is shown as the number', legacyNum[0].mark === '8' && legacyNum[0].tone === 'met');
ok('a low score reads as a miss', legacyNum.find((r) => r.key === 'problem_solving').tone === 'miss');
ok('junk yields no legacy rows', buildLegacyStage2Rows(null, t).length === 0 && buildLegacyStage2Rows({}, t).length === 0);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
