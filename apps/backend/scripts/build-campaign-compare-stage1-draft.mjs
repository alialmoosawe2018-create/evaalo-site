/**
 * Generates Campaign Compare Stage 1 secure n8n draft (inactive).
 * Output: docs/n8n-workflows/campaign-compare-stage1-secure-draft.json
 *
 * Run: node scripts/build-campaign-compare-stage1-draft.mjs
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BUILD_CALLBACK_CODE,
    CALLBACK_JSON_BODY,
    LLM_SYSTEM,
} from './campaign-compare-stage1-phase15-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'n8n-workflows');
const OUT_FILE = join(OUT_DIR, 'campaign-compare-stage1-secure-draft.json');

function n8nId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

const WEBHOOK_PATH = randomUUID();
const OPENAI_CRED = { id: 'xr8zb16RIutIemnJ', name: 'OpenAI account' };

const validateCode = `const body = $input.first().json.body || {};
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
if (body.compareStage !== 'stage1') throw new Error('CCMP_STAGE_MISMATCH');
if (!Array.isArray(body.candidatePool) || body.candidatePool.length === 0) {
  throw new Error('CCMP_EMPTY_POOL');
}

const topN = Math.min(Math.max(Number(body.topN) || body.candidatePool.length, 1), 10);
const candidates = body.candidatePool.slice(0, topN);

return [{
  json: {
    requestId: String(body.requestId),
    campaignId: String(body.campaignId),
    organizationId: String(body.organizationId),
    compareStage: 'stage1',
    topN,
    criteria: body.criteria,
    candidateSnapshotHash: String(body.candidateSnapshotHash),
    callbackUrl: String(body.callbackUrl),
    candidates_pool: candidates,
    pool_size: candidates.length,
  },
}];`;

const buildCode = BUILD_CALLBACK_CODE;

const llmPrompt = `=Target Role: {{ $('Validate Inbound Secret').item.json.criteria?.position || 'Not specified' }}
Campaign Criteria: {{ JSON.stringify($('Validate Inbound Secret').item.json.criteria || {}) }}
Candidates to compare ({{ $json.pool_size }}): {{ JSON.stringify($json.candidates_pool, null, 2) }}`;

const llmSystem = LLM_SYSTEM;

const workflow = {
    id: n8nId(),
    name: 'Campaign Compare — Stage 1 (Secure Draft)',
    description:
        'Secure Campaign Compare Stage 1: backend-owned candidatePool, inbound secret validation, signed callback with candidateSnapshotHash. Inactive — do not publish. Zero MongoDB nodes.',
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
            name: 'Compare Stage 1 LLM',
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
                jsonBody: CALLBACK_JSON_BODY,
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
        'Validate Inbound Secret': { main: [[{ node: 'Compare Stage 1 LLM', type: 'main', index: 0 }]] },
        'OpenAI Chat Model': {
            ai_languageModel: [[{ node: 'Compare Stage 1 LLM', type: 'ai_languageModel', index: 0 }]],
        },
        'Compare Stage 1 LLM': { main: [[{ node: 'Build Callback Body', type: 'main', index: 0 }]] },
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
    'Import into n8n as inactive draft. Set N8N_CAMPAIGN_COMPARE_STAGE1_WEBHOOK_URL after import (do not commit path to .env until then).'
);
