/**
 * Phase 1.5 prompt + n8n fragments for Campaign Compare Stage 3 (video).
 */
import {
    CALLBACK_JSON_BODY,
    FORMAT_EMAIL_CODE,
    makeBuildCallbackCode,
    makeCompareLlmSystem,
    STAGE3_DECISION_ACTIONS,
} from './campaign-compare-phase15-shared.mjs';

export { CALLBACK_JSON_BODY, FORMAT_EMAIL_CODE };

export const LLM_SYSTEM = makeCompareLlmSystem({
    purpose:
        'Identify the strongest candidates for the hiring decision based on the completed role assessment. You may recommend a candidate as the strongest hiring option at this stage. The final hiring decision remains with the human HR decision-maker. Never state that a candidate is hired. The top candidate is the Best Role-Assessment Candidate at this stage only.',
    evidence:
        'Stage 3 overallScore, roleUnderstanding, professionalDepth, problemHandling, decisionMaking, prioritization, processThinking, responsibility, learningAbility, jobReadiness, finalRoleFit, summary, competencyScores (required/importance/status/redFlags/evidence). Treat status=not_assessed as missing evidence, not a zero. Do not use Stage 1 or Stage 2 scores.',
    decisionActions: STAGE3_DECISION_ACTIONS,
});

export const BUILD_CALLBACK_CODE = makeBuildCallbackCode({
    compareStage: 'stage3',
    contextSetup: `const cb = $('Validate Inbound Secret').first().json.callback;`,
    poolAllowedExpr: 'cb.candidatePool || []',
    metaFromContext: `requestId: cb.requestId,
    candidateSnapshotHash: cb.candidateSnapshotHash,
    callbackUrl: cb.callbackUrl,`,
    interviewFocusExpr:
        "trimStr(parsed.interviewFocus || parsed.final_hire_focus || parsed.video_interview_focus, 4000)",
});

export const VALIDATE_CODE = `const body = $input.first().json.body || {};
const expected = String($env.N8N_CAMPAIGN_COMPARE_INBOUND_SECRET || '').trim();
const received = String(body.inboundSecret ?? '').trim();

if (!expected) throw new Error('CCMP_INBOUND_SECRET_UNCONFIGURED');
if (!received || received.length !== expected.length) throw new Error('CCMP_INBOUND_SECRET_REJECTED');
if (received !== expected) throw new Error('CCMP_INBOUND_SECRET_REJECTED');

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

export const PREPARE_LLM_CODE = `const llm = $('Validate Inbound Secret').first().json.llm;
if (!llm || !Array.isArray(llm.candidatePool) || llm.candidatePool.length === 0) {
  throw new Error('CCMP_EMPTY_POOL');
}
return [{ json: llm }];`;

export const LLM_USER_PROMPT = `=Target Role: {{ $json.criteria?.position || 'Not specified' }}
Campaign Criteria: {{ JSON.stringify($json.criteria || {}) }}
Full Stage 3 video-evaluated candidate pool ({{ $json.pool_size }} candidates): {{ JSON.stringify($json.candidatePool, null, 2) }}
Return exactly {{ $json.rankingLimit }} ranked candidates (at most min(topN, pool size)).`;
