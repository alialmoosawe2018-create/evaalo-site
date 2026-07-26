/** Shared prompts / code for Stage 1 written evaluation: EN-only LLM + post-translate node. */

export const STAGE1_WORKFLOW_ID = '93b459bc-4db3-4829-822a-1b9e4c39ac00';

export const STAGE1_EVAL_LLM_SYSTEM = `=You are an Expert HR Screener and Senior Recruiter.

Target Job Role: {{ $('Webhook').item.json.body.position_applied_for }}
Employer's Campaign Criteria: {{ $('Webhook').item.json.body.criteria }}

Write the ENTIRE evaluation in English only. Do not use Arabic, Kurdish, or mixed languages in any narrative field.

Return ONE JSON object only. No markdown, no code fences, no prose outside JSON.

Required keys (all mandatory — never omit or leave empty):
- overall_score: number 0-100
- recommendation: exactly one of Hire, Consider, Reject (English token)
- strengths: non-empty array of English strings
- weaknesses: non-empty array of English strings
- red_flags: array of strings (use [] when none)
- summary: non-empty English string (2–4 sentences)
- fit_for_role: non-empty English string describing suitability for the role
- final_hr_evaluation: non-empty English string (HR decision paragraph)

Never output N/A, null, placeholder text, or empty strings for required fields.`;

export const STAGE1_EVAL_LLM_TEXT = `=criteria:
{{ $('Webhook').item.json.body.criteria }}

candidate info:
full name: {{ $('Webhook').item.json.body.full_name }}
position applied for: {{ $('Webhook').item.json.body.position_applied_for }}
years of experience: {{ $('Webhook').item.json.body.years_of_experience }}
current company: {{ $('Webhook').item.json.body.current_company }}
location: {{ $('Webhook').item.json.body.location }}
highest education: {{ $('Webhook').item.json.body.highest_education_level }}
skills: {{ $('Webhook').item.json.body.skills }}
languages: {{ $('Webhook').item.json.body.languages }}
certifications: {{ $('Webhook').item.json.body.certifications }}
salary: {{ $('Webhook').item.json.body.salaryMin }}-{{ $('Webhook').item.json.body.salaryMax }} {{ $('Webhook').item.json.body.salaryCurrency }}
availability: {{ $('Webhook').item.json.body.availability }}
cover letter: {{ $('Webhook').item.json.body.coverLetter }}
linkedin: {{ $('Webhook').item.json.body.linkedin }}

CV:
{{ $('Message a model').item.json.output[0].content[0].text }}`;

export const VALIDATE_STAGE1_EVAL_CODE = `const items = $input.all();
const INVALID_TEXT = new Set(['', 'undefined', 'null', 'nan', 'n/a']);
function isValidHrText(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  return s.length > 0 && !INVALID_TEXT.has(s.toLowerCase());
}
function isNonEmptyTextArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.some((x) => isValidHrText(x));
}
return items.map((item) => {
  let o = item.json.output ?? item.json.text ?? item.json;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch { o = {}; }
  }
  if (o && typeof o === 'object' && o.output && typeof o.output === 'object') {
    o = o.output;
  }
  const REC = new Set(['Hire', 'Consider', 'Reject']);
  const score = Number(o.overall_score);
  const scoreOk = Number.isFinite(score) && score >= 0 && score <= 100;
  const rec = typeof o.recommendation === 'string' ? o.recommendation.trim() : '';
  const recOk = REC.has(rec);
  const strOk = isNonEmptyTextArray(o.strengths);
  const weakOk = isNonEmptyTextArray(o.weaknesses);
  const finalHrOk = isValidHrText(o.final_hr_evaluation);
  const summaryOk = isValidHrText(o.summary);
  const fitOk = isValidHrText(o.fit_for_role);
  const valid = scoreOk && recOk && strOk && weakOk && finalHrOk && summaryOk && fitOk;
  return {
    json: {
      valid,
      errorCategory: valid ? null : 'stage1_evaluation_incomplete',
      evaluation: {
        overall_score: scoreOk ? score : undefined,
        recommendation: recOk ? rec : undefined,
        strengths: strOk ? o.strengths : [],
        weaknesses: weakOk ? o.weaknesses : [],
        summary: summaryOk ? String(o.summary).trim() : undefined,
        fit_for_role: fitOk ? String(o.fit_for_role).trim() : undefined,
        final_hr_evaluation: finalHrOk ? String(o.final_hr_evaluation).trim() : undefined,
        red_flags: Array.isArray(o.red_flags) ? o.red_flags : [],
      },
    },
    binary: item.binary,
  };
});`;

export const STAGE1_TRANSLATE_LLM_SYSTEM = `=You localize a Stage 1 written HR evaluation JSON for display to the candidate/recruiter.

Target output language code: {{ $('Webhook').item.json.body.evaluationLanguage || 'ar' }}

Rules:
- If the target code is "en", return the input JSON unchanged (identical keys and English values).
- If the target is "ar" (Arabic UI, including Kurdish users mapped to ar), translate every narrative string and every item in strengths, weaknesses, and red_flags to Modern Standard Arabic.
- NEVER change overall_score (keep as number).
- NEVER change recommendation — it must stay exactly one of: Hire, Consider, Reject (English tokens only).
- Return ONE valid JSON object with keys: overall_score, recommendation, strengths, weaknesses, red_flags, summary, fit_for_role, final_hr_evaluation.
- No markdown, no commentary, no extra keys.`;

export const STAGE1_TRANSLATE_LLM_TEXT = `=Input evaluation JSON (English):
{{ JSON.stringify($('Validate Stage 1 Evaluation Output').item.json.evaluation) }}`;

export const APPLY_STAGE1_LOCALIZATION_CODE = `const items = $input.all();
const INVALID_TEXT = new Set(['', 'undefined', 'null', 'nan']);

function parseJsonLoose(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  s = s.replace(/^\\`\\`\\`(?:json)?\\s*/i, '').replace(/\\s*\\`\\`\\`$/i, '').trim();
  try { return JSON.parse(s); } catch { return null; }
}

function pickEval(item) {
  const validated = $('Validate Stage 1 Evaluation Output').first().json.evaluation;
  let o = parseJsonLoose(item.json.output ?? item.json.text ?? item.json);
  if (o && o.output && typeof o.output === 'object') o = o.output;
  if (!o || typeof o !== 'object') o = validated;
  const lang = String($('Webhook').first().json.body?.evaluationLanguage || 'ar').trim().toLowerCase();
  if (lang === 'en') return validated;
  const merged = { ...validated, ...o };
  return {
    overall_score: merged.overall_score,
    recommendation: merged.recommendation,
    strengths: merged.strengths,
    weaknesses: merged.weaknesses,
    red_flags: merged.red_flags ?? [],
    summary: merged.summary,
    fit_for_role: merged.fit_for_role,
    final_hr_evaluation: merged.final_hr_evaluation,
  };
}

return items.map((item) => ({
  json: {
    valid: true,
    evaluation: pickEval(item),
  },
  binary: item.binary,
}));`;
