/** Shared constants for Stage 3 video: EN-only LLM + post-translate from Webhook body.language */

export const STAGE3_WORKFLOW_ID = 'dWJzDwAd4FiVPejl';

export const STAGE3_EN_RULE =
    '**Language rule (evaluation output):** Write the ENTIRE evaluation report in English only. ' +
    'The video interview transcript may be Arabic, English, or mixed — use all transcript content as evidence only. ' +
    'All narrative text (Summary, Role Understanding, Qualitative Narrative Analysis, Final HR Evaluation) must be in English. ' +
    'Structured competency fields must be numeric scores 0–10. Keep Recommendation as Hire / Consider / Reject (English tokens). ' +
    'Blueprint competency evidence strings must be in English.\n\n';

export const STAGE3_CHAIN_TEXT =
    '=Evaluate this video interview transcript.\n\nTranscript:\n{{ $json.body.fullTranscript }}\n\n' +
    'Job criteria (JSON):\n{{ JSON.stringify($json.body.jobCriteria || {}) }}\n\n' +
    'Blueprint competencies (JSON, empty if none):\n{{ JSON.stringify($json.body.blueprintSnapshot?.competencies || $json.body.blueprintSnapshot || {}) }}';

export const STAGE3_CHAIN1_TEXT =
    STAGE3_CHAIN_TEXT +
    '\n\nCustom evaluation criteria:\n{{ JSON.stringify($json.body.criteria || []) }}';

export const STAGE3_TRANSLATE_SYSTEM = `=You localize a Stage 3 video interview evaluation JSON for HR/candidate display.

Target output language code: {{ $('Webhook').item.json.body.language || 'ar' }}

Rules:
- If the target code is "en" (or starts with "en-"), return the input JSON unchanged.
- If the target is "ar", translate narrative fields to Modern Standard Arabic: summary, and every string in competencyScores[].evidence and competencyScores[].redFlags (when present).
- NEVER change numeric competency fields (role_understanding, professional_depth, problem_handling, decision_making, prioritization, process_thinking, responsibility, learning_ability, job_readiness, final_role_fit), overall_score (number), recommendation (Hire/Consider/Reject), or competencyScores[].score.
- Return ONE valid JSON object with exactly the same keys as input. No markdown.`;

export const STAGE3_TRANSLATE_TEXT =
    '=Input evaluation JSON (English):\n{{ JSON.stringify($json.output) }}';
