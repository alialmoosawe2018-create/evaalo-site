/**
 * Shared Phase 1.5 prompt + n8n code fragments for Campaign Compare Stage 1.
 */
import {
    makeCompareLlmSystem,
    STAGE1_DECISION_ACTIONS,
} from './campaign-compare-phase15-shared.mjs';

export const CALLBACK_JSON_BODY =
    '={{ JSON.stringify({ requestId: $json.requestId, compareStage: $json.compareStage, candidateSnapshotHash: $json.candidateSnapshotHash, comparativeSummary: $json.comparativeSummary, decisionSummary: $json.decisionSummary, contextualIntroduction: $json.contextualIntroduction, comparativeInsights: $json.comparativeInsights, whyTopCandidateWins: $json.whyTopCandidateWins, finalRecommendation: $json.finalRecommendation, candidateRanking: $json.candidateRanking, topRecommendation: $json.topRecommendation, interviewFocus: $json.interviewFocus, decisionOptions: $json.decisionOptions, decisionDependencies: $json.decisionDependencies, decisionConfidence: $json.decisionConfidence, wildcard: $json.wildcard ?? null }) }}';

export const LLM_SYSTEM = makeCompareLlmSystem({
    purpose:
        'Identify candidates who should proceed to the Stage 2 voice interview. Frame every recommendation as screening progression, never as a hiring conclusion. Top at this stage = Best Screening Candidate.',
    evidence:
        'Screening overallScore, job criteria, basic eligibility / rubricResults, relevant experience, fitForRole, summary, strengths, weaknesses, finalHrEvaluation. Do not use voice or video scores.',
    decisionActions: STAGE1_DECISION_ACTIONS,
});

export const BUILD_CALLBACK_CODE = `const item = $input.first().json;
const ctx = $('Validate Inbound Secret').first().json;
const allowed = new Set(
  (ctx.candidatePool || ctx.candidates_pool || [])
    .map((c) => String(c.candidateId || c.candidate_id || '').trim())
    .filter(Boolean)
);

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
  // @n8n/n8n-nodes-langchain.chainLlm returns { response: "<json string>" }
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
}

function trimDataQuality(v) {
  const s = String(v || '').trim();
  if (s === 'High' || s === 'Medium' || s === 'Low') return s;
  return undefined;
}

function trimDecisionOptions(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const item of v.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const action = trimStr(item.action, 200);
    const when = trimStr(item.when, 800);
    const benefit = trimStr(item.benefit, 800);
    if (!action) continue;
    out.push({ action, when, benefit });
  }
  return out.length ? out : undefined;
}

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
    decisionAction: trimStr(r.decisionAction || r.decision_action, 120) || undefined,
    decisionReason: trimStr(r.decisionReason || r.decision_reason, 2000) || undefined,
    keyDecisionFactor: trimStr(r.keyDecisionFactor || r.key_decision_factor, 200) || undefined,
    decisionOptions: trimDecisionOptions(r.decisionOptions || r.decision_options),
    decisionDependencies: trimList(r.decisionDependencies || r.decision_dependencies, 6, 400),
    dataQuality: trimDataQuality(r.dataQuality || r.data_quality),
    keyGaps: trimList(r.keyGaps || r.key_gaps, 4, 2000),
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
    requestId: ctx.requestId,
    compareStage: 'stage1',
    candidateSnapshotHash: ctx.candidateSnapshotHash,
    contextualIntroduction: trimStr(parsed.contextualIntroduction || parsed.contextual_introduction, 8000),
    decisionSummary: trimStr(parsed.decisionSummary || parsed.decision_summary, 8000),
    comparativeSummary: trimStr(parsed.comparativeSummary || parsed.comparative_summary, 8000),
    comparativeInsights: normalizeInsights(parsed.comparativeInsights || parsed.comparative_insights),
    whyTopCandidateWins: trimStr(parsed.whyTopCandidateWins || parsed.why_top_candidate_wins, 8000),
    finalRecommendation: trimStr(parsed.finalRecommendation || parsed.final_recommendation, 8000),
    candidateRanking,
    topRecommendation: trimStr(parsed.topRecommendation || parsed.top_recommendation, 300),
    interviewFocus: trimStr(parsed.interviewFocus || parsed.voice_interview_focus || parsed.next_stage_focus, 4000),
    decisionOptions: trimDecisionOptions(parsed.decisionOptions || parsed.decision_options),
    decisionDependencies: trimList(parsed.decisionDependencies || parsed.decision_dependencies, 8, 400),
    decisionConfidence: trimDataQuality(parsed.decisionConfidence || parsed.decision_confidence),
    wildcard,
    callbackUrl: ctx.callbackUrl,
  },
}];`;

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
