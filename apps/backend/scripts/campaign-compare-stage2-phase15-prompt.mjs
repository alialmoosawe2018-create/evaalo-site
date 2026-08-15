/**
 * Phase 1.5 prompt + n8n fragments for Campaign Compare Stage 2 (voice).
 */
import {
    CALLBACK_JSON_BODY,
    FORMAT_EMAIL_CODE,
    makeBuildCallbackCode,
    makeCompareLlmSystem,
    STAGE2_DECISION_ACTIONS,
} from './campaign-compare-phase15-shared.mjs';

export { CALLBACK_JSON_BODY, FORMAT_EMAIL_CODE };

export const LLM_SYSTEM = makeCompareLlmSystem({
    purpose:
        'Identify candidates who should proceed to the Stage 3 video interview. Frame every recommendation as progression to deep role assessment, never as a final hiring decision. The top candidate is the Best Voice-Interview Candidate at this stage only.',
    evidence:
        'Stage 2 overallScore, communication, professionalAttitude, English/languageFluency if assessed, problemSolving, digitalSkills, role fit, summary, strengths, weaknesses, finalHrEvaluation, dataCompleteness / notAssessedDimensions. Do not use the transcript. Do not use Stage 1 or Stage 3 scores.',
    decisionActions: STAGE2_DECISION_ACTIONS,
});

export const BUILD_CALLBACK_CODE = makeBuildCallbackCode({
    compareStage: 'stage2',
    contextSetup: `const ctx = $('Validate Inbound Secret').first().json;`,
    poolAllowedExpr: 'ctx.candidatePool || ctx.candidates_pool || []',
    metaFromContext: `requestId: ctx.requestId,
    candidateSnapshotHash: ctx.candidateSnapshotHash,
    callbackUrl: ctx.callbackUrl,`,
    interviewFocusExpr:
        "trimStr(parsed.interviewFocus || parsed.video_interview_focus || parsed.voice_interview_focus || parsed.next_stage_focus, 4000)",
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
if (body.compareStage !== 'stage2') throw new Error('CCMP_STAGE_MISMATCH');
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
    requestId: String(body.requestId),
    campaignId: String(body.campaignId),
    organizationId: String(body.organizationId),
    compareStage: 'stage2',
    topN: requestedTopN,
    rankingLimit,
    criteria: body.criteria,
    candidateSnapshotHash: String(body.candidateSnapshotHash),
    callbackUrl: String(body.callbackUrl),
    candidatePool,
    pool_size: candidatePool.length,
  },
}];`;

export const LLM_USER_PROMPT = `=Target Role: {{ $('Validate Inbound Secret').item.json.criteria?.position || 'Not specified' }}
Campaign Criteria: {{ JSON.stringify($('Validate Inbound Secret').item.json.criteria || {}) }}
Full Stage 2 voice-evaluated candidate pool ({{ $json.pool_size }} candidates): {{ JSON.stringify($json.candidatePool, null, 2) }}
Return exactly {{ $json.rankingLimit }} ranked candidates (at most min(topN, pool size)).`;
