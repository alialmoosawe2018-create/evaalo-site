/**
 * Shared Phase 1.5 n8n fragments for Campaign Compare (all stages).
 */

export const CALLBACK_JSON_BODY =
    '={{ JSON.stringify({ requestId: $json.requestId, compareStage: $json.compareStage, candidateSnapshotHash: $json.candidateSnapshotHash, comparativeSummary: $json.comparativeSummary, decisionSummary: $json.decisionSummary, contextualIntroduction: $json.contextualIntroduction, comparativeInsights: $json.comparativeInsights, whyTopCandidateWins: $json.whyTopCandidateWins, finalRecommendation: $json.finalRecommendation, candidateRanking: $json.candidateRanking, topRecommendation: $json.topRecommendation, interviewFocus: $json.interviewFocus, wildcard: $json.wildcard ?? null }) }}';

export const FORMAT_EMAIL_CODE = `const body = $input.first().json.body || {};
const emails = Array.isArray(body.emails)
  ? body.emails.map((e) => String(e).trim()).filter(Boolean)
  : [];
if (emails.length === 0) throw new Error('CCMP_EMAIL_NO_RECIPIENTS');

const decisionSummary = String(body.decisionSummary || '').trim();
const contextualIntroduction = String(body.contextualIntroduction || '').trim();
const summary = String(body.summary || body.comparativeSummary || '').trim();
const whyTop = String(body.whyTopCandidateWins || '').trim();
const finalRec = String(body.finalRecommendation || '').trim();
const interviewFocus = String(body.interviewFocus || '').trim();
const ranking = Array.isArray(body.ranking) ? body.ranking : [];
const insights = body.comparativeInsights && typeof body.comparativeInsights === 'object' && !Array.isArray(body.comparativeInsights)
  ? body.comparativeInsights
  : {};

const top = ranking.find((r) => Number(r.rank) === 1) || ranking[0];
const topName = String(top?.candidateName || body.executiveStats?.topCandidate || '—').trim();

const stage = String(body.stage || 'screening');
const stageLabel =
  stage === 'voice' ? 'المرحلة الثانية' : stage === 'video' ? 'المرحلة الثالثة' : 'المرحلة الأولى';
const subject = 'تقرير مقارنة المرشحين — ' + stageLabel;

function section(title, text) {
  if (!text) return '';
  return title + ':\\n' + text + '\\n\\n';
}

const insightLines = Object.entries(insights)
  .map(([k, v]) => '• ' + k + ': ' + String(v || '').trim())
  .filter(Boolean)
  .join('\\n');

const cardLines = ranking
  .map((r) => {
    const rank = r.rank ?? '?';
    const name = r.candidateName || '—';
    const score = r.score ?? r.stageScore ?? '—';
    const rec = r.overallRecommendation || r.recommendation || '';
    const comment = String(r.executiveComment || r.reason || r.competitiveAdvantage || '').trim();
    const conf = r.confidence != null && Number.isFinite(Number(r.confidence)) ? ' | ثقة: ' + Math.round(Number(r.confidence)) + '%' : '';
    const reasons = Array.isArray(r.reasons) && r.reasons.length
      ? '\\n   أسباب: ' + r.reasons.join('؛ ')
      : '';
    const risks = Array.isArray(r.risks) && r.risks.length
      ? '\\n   مخاطر: ' + r.risks.join('؛ ')
      : '';
    return rank + '. ' + name + ' (' + score + ')' + (rec ? ' — ' + rec : '') + conf +
      (comment ? '\\n   ' + comment : '') + reasons + risks;
  })
  .join('\\n\\n');

let message = 'تقرير مقارنة المرشحين — ' + stageLabel + '\\n\\n';
message += section('الخلاصة التنفيذية', decisionSummary);
message += section('السياق', contextualIntroduction);
message += section('ملخص المقارنة', summary);
if (insightLines) message += section('تحليل مقارن', insightLines);
message += section('الترتيب والبطاقات', cardLines);
message += section('لماذا المتصدر', whyTop);
message += section('التوصية النهائية', finalRec);
message += section('تركيز المقابلة القادمة', interviewFocus);
message += 'المرشح الأول: ' + topName + '\\n\\n— evaalo';

return emails.map((email) => ({
  json: { email, subject, message, requestId: String(body.requestId || '') },
}));`;

const PARSE_HELPERS = `
function stripMarkdownFence(s) {
  return String(s || '').replace(/^\\\`\\\`\\\`(?:json)?\\s*/i, '').replace(/\\s*\\\`\\\`\\\`$/i, '').trim();
}

function hasComparePayload(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Boolean(
    obj.comparativeSummary || obj.comparative_summary ||
    obj.candidateRanking || obj.candidate_ranking ||
    obj.decisionSummary || obj.decision_summary
  );
}

function extractLlmText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw !== 'object' || Array.isArray(raw)) return '';
  if (typeof raw.response === 'string' && raw.response.trim()) return raw.response;
  if (raw.response && typeof raw.response === 'object') {
    const fromResponse = extractLlmText(raw.response);
    if (fromResponse) return fromResponse;
  }
  if (typeof raw.text === 'string' && raw.text.trim()) return raw.text;
  if (typeof raw.output === 'string' && raw.output.trim()) return raw.output;
  if (raw.output && typeof raw.output === 'object') {
    const nested = extractLlmText(raw.output);
    if (nested) return nested;
  }
  if (typeof raw.message === 'string' && raw.message.trim()) return raw.message;
  if (raw.message && typeof raw.message === 'object') {
    if (typeof raw.message.content === 'string') return raw.message.content;
    if (Array.isArray(raw.message.content)) {
      return raw.message.content
        .map((part) => (typeof part === 'string' ? part : (part && part.text) || ''))
        .join('');
    }
  }
  if (Array.isArray(raw.generations) && raw.generations.length) {
    const g = raw.generations[0];
    if (typeof g === 'string') return g;
    if (g && typeof g.text === 'string') return g.text;
  }
  return '';
}

function parseLlmJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (hasComparePayload(raw)) return raw;
    if (raw.output != null) {
      const fromOutput = parseLlmJson(raw.output);
      if (hasComparePayload(fromOutput)) return fromOutput;
    }
    if (raw.data != null) {
      const fromData = parseLlmJson(raw.data);
      if (hasComparePayload(fromData)) return fromData;
    }
    if (raw.response != null) {
      const fromResponse = parseLlmJson(raw.response);
      if (hasComparePayload(fromResponse)) return fromResponse;
    }
  }
  const text = stripMarkdownFence(extractLlmText(raw));
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    const match = text.match(/\\{[\\s\\S]*\\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        return {};
      }
    }
  }
  return {};
}

function trimStr(v, max) {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function trimList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => trimStr(x, maxLen)).filter(Boolean).slice(0, maxItems);
  return out.length ? out : undefined;
}

function clampConf(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeInsights(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  let count = 0;
  for (const [k, val] of Object.entries(v)) {
    if (count >= 8) break;
    const key = trimStr(k, 100);
    const value = trimStr(val, 2000);
    if (!key || !value) continue;
    out[key] = value;
    count += 1;
  }
  return count ? out : undefined;
}`;

/**
 * @param {{
 *   compareStage: 'stage1' | 'stage2' | 'stage3',
 *   contextSetup: string,
 *   poolAllowedExpr: string,
 *   metaFromContext: string,
 *   interviewFocusExpr: string,
 * }} opts
 */
export function makeBuildCallbackCode(opts) {
    return `const item = $input.first().json;
${opts.contextSetup}
const allowed = new Set(
  (${opts.poolAllowedExpr})
    .map((c) => String(c.candidateId || c.candidate_id || '').trim())
    .filter(Boolean)
);
${PARSE_HELPERS}

const parsed = parseLlmJson(item);
const rawRanking = Array.isArray(parsed.candidateRanking)
  ? parsed.candidateRanking
  : (Array.isArray(parsed.candidate_ranking) ? parsed.candidate_ranking : []);

const candidateRanking = rawRanking.map((row, idx) => {
  const r = row && typeof row === 'object' ? row : {};
  const candidateId = String(r.candidateId || r.candidate_id || r.CandidateID || '').trim();
  const rank = Number(r.rank ?? idx + 1);
  const rec = String(r.recommendation || r.Recommendation || '').trim();
  const recommendation = rec === 'Hire' || rec === 'Consider' || rec === 'Reject' ? rec : undefined;
  return {
    rank,
    candidateId,
    candidateName: trimStr(r.candidateName || r.candidate_name || r.ApplicantName, 300),
    stageScore: r.stageScore ?? r.initial_screening_score ?? r.OverallScore ?? r.overallScore ?? '',
    competitiveAdvantage: trimStr(r.competitiveAdvantage || r.competitive_advantage, 2000),
    recommendation,
    overallRecommendation: trimStr(r.overallRecommendation || r.overall_recommendation, 300) || undefined,
    executiveComment: trimStr(r.executiveComment || r.executive_comment, 2000) || undefined,
    confidence: clampConf(r.confidence),
    confidence_rationale: trimStr(r.confidence_rationale || r.confidenceRationale, 2000) || undefined,
    reasons: trimList(r.reasons, 6, 2000),
    strengths: trimList(r.strengths, 6, 2000),
    risks: trimList(r.risks, 6, 2000),
    watchOut: trimStr(r.watchOut || r.watch_out, 2000) || undefined,
    differenceFromNext: trimStr(r.differenceFromNext || r.difference_from_next, 2000) || undefined,
  };
}).filter((row) => row.candidateId && allowed.has(row.candidateId));

if (candidateRanking.length === 0) {
  throw new Error('CCMP_EMPTY_RANKING');
}

let wildcard = parsed.wildcard ?? null;
if (wildcard && typeof wildcard === 'object') {
  wildcard = {
    candidateId: String(wildcard.candidateId || '').trim(),
    candidateName: trimStr(wildcard.candidateName, 300),
    reason: trimStr(wildcard.reason, 2000),
  };
  if (!wildcard.candidateId) wildcard = null;
}

return [{
  json: {
    ${opts.metaFromContext}
    compareStage: '${opts.compareStage}',
    contextualIntroduction: trimStr(parsed.contextualIntroduction || parsed.contextual_introduction, 8000),
    decisionSummary: trimStr(parsed.decisionSummary || parsed.decision_summary, 8000),
    comparativeSummary: trimStr(parsed.comparativeSummary || parsed.comparative_summary, 8000),
    comparativeInsights: normalizeInsights(parsed.comparativeInsights || parsed.comparative_insights),
    whyTopCandidateWins: trimStr(parsed.whyTopCandidateWins || parsed.why_top_candidate_wins, 8000),
    finalRecommendation: trimStr(parsed.finalRecommendation || parsed.final_recommendation, 8000),
    candidateRanking,
    topRecommendation: trimStr(parsed.topRecommendation || parsed.top_recommendation, 300),
    interviewFocus: ${opts.interviewFocusExpr},
    wildcard,
  },
}];`;
}

export const PHASE15_RANKING_ITEM_RULES = `Each candidateRanking item MUST include:
- rank (integer starting at 1, unique)
- candidateId (from pool)
- candidateName (from pool)
- stageScore (number or string; use pool overallScore when appropriate)
- competitiveAdvantage (string, one-line edge summary)
- recommendation (Hire | Consider | Reject)
- overallRecommendation (short label, e.g. "Consider with training")
- executiveComment (string, 1–2 sentence executive take)
- confidence (integer 0–100, how confident in this rank vs peers)
- confidence_rationale (string, explains the confidence number)
- reasons (array of 2–4 strings: why ranked here)
- strengths (array of 2–4 strings)
- risks (array of 1–3 strings: real hiring risks)
- watchOut (string, optional advisory — onboarding/monitoring note, not duplicate of risks)
- differenceFromNext (string, for every row except the last: why ranked above the next candidate)

Optional top-level:
- wildcard: { candidateId, candidateName, reason } for a notable non-top pick`;

export const PHASE15_TOP_LEVEL_KEYS = `REQUIRED top-level keys (camelCase):
- contextualIntroduction (string, 2–4 sentences: scenario + what is being compared)
- decisionSummary (string, 1–3 sentences: decisive executive headline — who leads and why)
- comparativeSummary (string, detailed narrative comparison paragraph)
- comparativeInsights (object with 3–6 string keys = dimension labels, values = who wins that dimension and why)
- candidateRanking (array, sorted best to worst)
- whyTopCandidateWins (string: why #1 beats #2 despite #2 strengths)
- finalRecommendation (string: clear hire/proceed guidance + who NOT to prioritize)
- topRecommendation (string, full name of rank #1)
- interviewFocus (string)`;
