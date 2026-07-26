/** Shared constants for Stage 2 voice: EN-only LLM + post-translate from Webhook body.language */

export const STAGE2_WORKFLOW_ID = 'BB87WRQQYEiLdMsk';

export const STAGE2_EN_RULE =
    '**Language rule (evaluation output):** Write the ENTIRE evaluation report in English only. ' +
    'The interview transcript may be Arabic, English, or mixed (including an English proficiency test) — ' +
    'use all transcript content as evidence only. All narrative text (Executive Summary, Strengths, ' +
    'Weaknesses, Professional Attitude, Justification, Rating Rationale inside Final HR Evaluation) must be in English. ' +
    'Keep Recommendation as Hire / Consider / Reject. Competency fields (Communication, English Fluency, Confidence, ' +
    'Problem Solving, Computer Skills) are EXACTLY one rating word: Excellent / Good / Intermediate / Bad — no phrases.';

export const STAGE2_CHAIN_TEXT = '= full transcript of the interview: {{ $json.body.fullTranscript }}';

export const STAGE2_CHAIN1_TEXT =
    '= full transcript of the interview: {{ $json.body.fullTranscript }}\n\n' +
    'criteria: {{ $json.body.criteria }}';

export const STAGE2_TRANSLATE_SYSTEM = `=You localize a Stage 2 voice interview evaluation JSON for HR/candidate display.

Target output language code: {{ $('Webhook').item.json.body.language || 'ar' }}

Rules:
- If the target code is "en" (or starts with "en-"), return the input JSON unchanged.
- If the target is "ar", translate narrative fields to Modern Standard Arabic: Summary, Strengths, Weaknesses, Final HR Evaluation, Professional Attitude.
- NEVER change: Recommendation, Communication Skills, English Fluency, Confidence Level, Computer Skills, Problem Solving (Excellent/Good/Intermediate/Bad), Overall-score.
- Return ONE valid JSON object with exactly the same keys as input. No markdown.`;

export const STAGE2_TRANSLATE_TEXT =
    '=Input evaluation JSON (English):\n{{ JSON.stringify($json.output) }}';
