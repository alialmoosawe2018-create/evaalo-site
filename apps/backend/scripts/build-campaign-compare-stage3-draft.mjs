/**
 * Generates Campaign Compare Stage 3 secure n8n draft (inactive).
 * Output: ../../docs/n8n-workflows/campaign-compare-stage3-secure-draft.json
 *
 * Run: node scripts/build-campaign-compare-stage3-draft.mjs
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'n8n-workflows');
const OUT_FILE = join(OUT_DIR, 'campaign-compare-stage3-secure-draft.json');

function n8nId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

const WEBHOOK_PATH = randomUUID();
const OPENAI_CRED = { id: 'xr8zb16RIutIemnJ', name: 'OpenAI account' };

const validateCode = `const crypto = require('crypto');
const body = $input.first().json.body || {};
const expected = String($env.N8N_CAMPAIGN_COMPARE_INBOUND_SECRET || '').trim();
const received = String(body.inboundSecret ?? '').trim();

if (!expected) throw new Error('CCMP_INBOUND_SECRET_UNCONFIGURED');
if (!received || received.length !== expected.length) throw new Error('CCMP_INBOUND_SECRET_REJECTED');
if (!crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
  throw new Error('CCMP_INBOUND_SECRET_REJECTED');
}

const required = [
  'requestId','campaignId','organizationId','compareStage','topN',
  'criteria','candidatePool','candidateSnapshotHash','callbackUrl','inboundSecret',
];
for (const key of required) {
  const val = body[key];
  if (val === undefined || val === null || val === '') {
    throw new Error('CCMP_MISSING_FIELD:' + key);
  }
}
if (body.compareStage !== 'stage3') throw new Error('CCMP_STAGE_MISMATCH');
if (!Array.isArray(body.candidatePool) || body.candidatePool.length === 0) {
  throw new Error('CCMP_EMPTY_POOL');
}

const candidatePool = body.candidatePool;
const requestedTopN = Number(body.topN);
if (!Number.isFinite(requestedTopN) || requestedTopN < 1) {
  throw new Error('CCMP_INVALID_TOPN');
}
const rankingLimit = Math.min(Math.floor(requestedTopN), candidatePool.length, 10);

return [{
  json: {
    llm: {
      compareStage: 'stage3',
      topN: requestedTopN,
      rankingLimit,
      criteria: body.criteria,
      candidatePool,
      pool_size: candidatePool.length,
    },
    callback: {
      requestId: String(body.requestId),
      compareStage: 'stage3',
      callbackUrl: String(body.callbackUrl),
      candidateSnapshotHash: String(body.candidateSnapshotHash),
      candidatePool,
    },
  },
}];`;

const prepareLlmCode = `const llm = $('Validate Inbound Secret').first().json.llm;
if (!llm || !Array.isArray(llm.candidatePool) || llm.candidatePool.length === 0) {
  throw new Error('CCMP_EMPTY_POOL');
}
return [{ json: llm }];`;

const buildCode = `const item = $input.first().json;
const cb = $('Validate Inbound Secret').first().json.callback;
const allowed = new Set((cb.candidatePool || []).map((c) => String(c.candidateId)));

function stripMarkdownFence(s) {
  return String(s || '').replace(/^\\\`\\\`\\\`(?:json)?\\s*/i, '').replace(/\\s*\\\`\\\`\\\`$/i, '').trim();
}

function parseLlmJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.comparativeSummary || raw.candidateRanking || raw.comparative_summary || raw.candidate_ranking) return raw;
    if (raw.output && typeof raw.output === 'object') return raw.output;
  }
  const text = stripMarkdownFence(typeof raw === 'string' ? raw : (raw.text || raw.output || ''));
  if (!text) return {};
  try { return JSON.parse(text); } catch {
    const match = text.match(/\\{[\\s\\S]*\\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { return {}; } }
    return {};
  }
}

const parsed = parseLlmJson(item);
const rawRanking = Array.isArray(parsed.candidateRanking)
  ? parsed.candidateRanking
  : (Array.isArray(parsed.candidate_ranking) ? parsed.candidate_ranking : []);

const candidateRanking = rawRanking.map((row, idx) => {
  const r = row && typeof row === 'object' ? row : {};
  const candidateId = String(r.candidateId || r.candidate_id || r.CandidateID || '').trim();
  const rank = Number(r.rank ?? idx + 1);
  return {
    rank,
    candidateId,
    candidateName: String(r.candidateName || r.candidate_name || r.ApplicantName || '').trim(),
    stageScore: r.stageScore ?? r.initial_screening_score ?? r.OverallScore ?? r.overallScore ?? '',
    competitiveAdvantage: String(r.competitiveAdvantage || r.competitive_advantage || '').trim(),
    recommendation: r.recommendation || r.Recommendation,
  };
}).filter((row) => row.candidateId && allowed.has(row.candidateId));

if (candidateRanking.length === 0) {
  throw new Error('CCMP_EMPTY_RANKING');
}

let wildcard = parsed.wildcard ?? null;
if (wildcard && typeof wildcard === 'object') {
  wildcard = {
    candidateId: String(wildcard.candidateId || '').trim(),
    candidateName: String(wildcard.candidateName || '').trim(),
    reason: String(wildcard.reason || '').trim(),
  };
  if (!wildcard.candidateId) wildcard = null;
}

return [{
  json: {
    requestId: cb.requestId,
    compareStage: 'stage3',
    candidateSnapshotHash: cb.candidateSnapshotHash,
    comparativeSummary: String(parsed.comparativeSummary || parsed.comparative_summary || '').trim(),
    candidateRanking,
    topRecommendation: String(parsed.topRecommendation || parsed.top_recommendation || '').trim(),
    interviewFocus: String(parsed.interviewFocus || parsed.video_interview_focus || parsed.final_hire_focus || '').trim(),
    wildcard,
    callbackUrl: cb.callbackUrl,
  },
}];`;

const llmPrompt = `=Target Role: {{ $json.criteria?.position || 'Not specified' }}
Campaign Criteria: {{ JSON.stringify($json.criteria || {}) }}
Full Stage 3 video-evaluated candidate pool ({{ $json.pool_size }} candidates): {{ JSON.stringify($json.candidatePool, null, 2) }}
Return exactly {{ $json.rankingLimit }} ranked candidates (at most min(topN, pool size)).`;

const llmSystem = `Role & Task:
You are a Senior Talent Selection Panel AI. Compare ALL Stage 3 video-interview candidates in the supplied candidatePool. Rank the best candidates for final hire decision.

Rules:
- Compare the complete candidatePool first. Do not ignore any candidate during analysis.
- Return candidateRanking with exactly rankingLimit items (or fewer only if the pool is smaller), sorted best (#1) to worst.
- rankingLimit = min(topN, candidatePool.length) and must not exceed 10.
- Use candidateId and candidateName exactly from the supplied pool. Do not invent IDs or add candidates outside the pool.
- Weigh overallScore plus video competencies: roleUnderstanding, professionalDepth, problemHandling, decisionMaking, prioritization, processThinking, responsibility, learningAbility, jobReadiness, finalRoleFit, summary, and competencyScores when present.
- stageScore in ranking should reflect pool overallScore (0-100).
- recommendation per row must be one of: Hire, Consider, Reject (when present).
- Respond in Arabic if evaluations are primarily Arabic; otherwise English.
- Return ONLY a single JSON object (no markdown, no code fences).

REQUIRED top-level keys (camelCase, all mandatory):
- comparativeSummary (string)
- candidateRanking (array, length <= rankingLimit, sorted best to worst)
- topRecommendation (string, full name of rank #1)
- interviewFocus (string; final hire / onboarding focus)

Each candidateRanking item MUST include:
- rank (integer starting at 1, unique)
- candidateId (from pool)
- candidateName (from pool)
- stageScore (number or string)
- competitiveAdvantage (string)
- recommendation (optional: Hire | Consider | Reject)

Optional:
- wildcard: { candidateId, candidateName, reason }`;

const workflow = {
    id: n8nId(),
    name: 'Campaign Compare — Stage 3 (Secure Draft)',
    description:
        'Secure Campaign Compare Stage 3: backend-owned candidatePool only (no MongoDB), dual LLM/callback context, signed callback with candidateSnapshotHash. Inactive — do not publish. Do NOT use NoOp z5gBWWSO0B0pKIzj.',
    active: false,
    nodes: [
        {
            parameters: { httpMethod: 'POST', path: WEBHOOK_PATH, responseMode: 'onReceived', options: {} },
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2.1,
            position: [0, 0],
            id: randomUUID(),
            name: 'Webhook',
            webhookId: WEBHOOK_PATH,
        },
        {
            parameters: { jsCode: validateCode },
            type: 'n8n-nodes-base.code',
            typeVersion: 2,
            position: [240, 0],
            id: randomUUID(),
            name: 'Validate Inbound Secret',
        },
        {
            parameters: { jsCode: prepareLlmCode },
            type: 'n8n-nodes-base.code',
            typeVersion: 2,
            position: [480, 0],
            id: randomUUID(),
            name: 'Prepare LLM Context',
        },
        {
            parameters: {
                promptType: 'define',
                text: llmPrompt,
                messages: { messageValues: [{ message: llmSystem }] },
                batching: {},
            },
            type: '@n8n/n8n-nodes-langchain.chainLlm',
            typeVersion: 1.9,
            position: [720, 0],
            id: randomUUID(),
            name: 'Compare Stage 3 LLM',
        },
        {
            parameters: {
                model: { __rl: true, value: 'gpt-4.1', mode: 'list', cachedResultName: 'gpt-4.1' },
                builtInTools: {},
                options: {},
            },
            type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
            typeVersion: 1.3,
            position: [720, 180],
            id: randomUUID(),
            name: 'OpenAI Chat Model',
            credentials: { openAiApi: OPENAI_CRED },
        },
        {
            parameters: { jsCode: buildCode },
            type: 'n8n-nodes-base.code',
            typeVersion: 2,
            position: [960, 0],
            id: randomUUID(),
            name: 'Build Callback Body',
        },
        {
            parameters: {
                method: 'POST',
                url: '={{ $json.callbackUrl }}',
                sendHeaders: true,
                headerParameters: {
                    parameters: [
                        {
                            name: 'X-Campaign-Compare-Secret',
                            value: '={{ $env.N8N_CAMPAIGN_COMPARE_INBOUND_SECRET }}',
                        },
                        { name: 'X-Idempotency-Key', value: '={{ $execution.id }}' },
                    ],
                },
                sendBody: true,
                specifyBody: 'json',
                jsonBody:
                    '={{ JSON.stringify({ requestId: $json.requestId, compareStage: $json.compareStage, candidateSnapshotHash: $json.candidateSnapshotHash, comparativeSummary: $json.comparativeSummary, candidateRanking: $json.candidateRanking, topRecommendation: $json.topRecommendation, interviewFocus: $json.interviewFocus, wildcard: $json.wildcard ?? null }) }}',
                options: {},
            },
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.4,
            position: [1200, 0],
            id: randomUUID(),
            name: 'Callback to Backend',
            retryOnFail: true,
            maxTries: 3,
            waitBetweenTries: 2000,
            onError: 'continueRegularOutput',
        },
    ],
    connections: {
        Webhook: { main: [[{ node: 'Validate Inbound Secret', type: 'main', index: 0 }]] },
        'Validate Inbound Secret': { main: [[{ node: 'Prepare LLM Context', type: 'main', index: 0 }]] },
        'Prepare LLM Context': { main: [[{ node: 'Compare Stage 3 LLM', type: 'main', index: 0 }]] },
        'OpenAI Chat Model': {
            ai_languageModel: [[{ node: 'Compare Stage 3 LLM', type: 'ai_languageModel', index: 0 }]],
        },
        'Compare Stage 3 LLM': { main: [[{ node: 'Build Callback Body', type: 'main', index: 0 }]] },
        'Build Callback Body': { main: [[{ node: 'Callback to Backend', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', availableInMCP: false },
    tags: [],
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify([workflow], null, 2));
console.log('Wrote', OUT_FILE);
console.log('WEBHOOK_PATH=' + WEBHOOK_PATH);
console.log(
    'Import into n8n as inactive draft. Set N8N_CAMPAIGN_COMPARE_STAGE3_WEBHOOK_URL after import (do not commit path to .env until then).'
);
