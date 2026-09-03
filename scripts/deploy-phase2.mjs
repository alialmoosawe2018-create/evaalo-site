import fs from 'fs';

// The n8n API token must come from the environment. It was previously hard-coded
// here and is therefore burned in git history — it MUST be rotated in n8n.
// Load the gitignored root .env if present, so the token never has to be exported
// by hand. process.loadEnvFile is built into Node 20.6+/22+ — no dependency.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env here — fall back to a real environment variable */
}
const TOKEN = process.env.N8N_API_TOKEN;
if (!TOKEN) {
  console.error('Missing N8N_API_TOKEN. Put it in the gitignored root .env, or export it.');
  process.exit(1);
}
const MCP_URL = 'https://n8n.evaalo.com/mcp-server/http';

async function mcpCall(toolName, args) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

function readJs(name) {
  return fs.readFileSync(
    new URL(`../docs/${name}`, import.meta.url),
    'utf8',
  );
}

const finalize = readJs('n8n-headhunter-finalize-top-n-send.js');
const track = readJs('n8n-headhunter-track-send-progress.js');
const expand = readJs('n8n-headhunter-expand-phase2-queries.js');
const filter = readJs('n8n-headhunter-filter-new-urls.js');
const fin2 = readJs('n8n-headhunter-finalize-phase2-send.js');

const batches = [
  {
    name: 'nodes',
    operations: [
      {
        type: 'updateNodeParameters',
        nodeName: 'Finalize Top N Send',
        parameters: { jsCode: finalize, mode: 'runOnceForAllItems' },
      },
      {
        type: 'addNode',
        node: {
          name: 'Track Send Progress',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [2608, -128],
          parameters: { jsCode: track, mode: 'runOnceForEachItem' },
        },
      },
      {
        type: 'addNode',
        node: {
          name: 'Start Phase 2?',
          type: 'n8n-nodes-base.if',
          typeVersion: 2,
          position: [2768, -208],
          parameters: {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 2,
              },
              combinator: 'and',
              conditions: [
                {
                  id: 'start-phase2',
                  leftValue: '={{ $json.__startPhase2 }}',
                  rightValue: '',
                  operator: { type: 'boolean', operation: 'true', singleValue: true },
                },
              ],
            },
          },
        },
      },
      {
        type: 'addNode',
        node: {
          name: 'Complete Search Now?',
          type: 'n8n-nodes-base.if',
          typeVersion: 2,
          position: [2768, -48],
          parameters: {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 2,
              },
              combinator: 'and',
              conditions: [
                {
                  id: 'complete-search',
                  leftValue: '={{ $json.__completeSearch }}',
                  rightValue: '',
                  operator: { type: 'boolean', operation: 'true', singleValue: true },
                },
              ],
            },
          },
        },
      },
      {
        type: 'addNode',
        node: {
          name: 'Expand Phase 2 Queries',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [-96, 128],
          parameters: { jsCode: expand, mode: 'runOnceForAllItems' },
        },
      },
      {
        type: 'addNode',
        node: {
          name: 'Filter New URLs',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [640, -32],
          parameters: { jsCode: filter, mode: 'runOnceForAllItems' },
        },
      },
      {
        type: 'addNode',
        node: {
          name: 'Finalize Phase 2 Send',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [2464, 96],
          parameters: { jsCode: fin2, mode: 'runOnceForAllItems' },
        },
      },
    ],
  },
  {
    name: 'connections',
    operations: JSON.parse(
      fs.readFileSync(new URL('../.tmp-phase2-batch2.json', import.meta.url), 'utf8'),
    ).operations,
  },
];

for (const batch of batches) {
  console.log(`Deploying ${batch.name}...`);
  const out = await mcpCall('update_workflow', {
    workflowId: 'GlhDGC23n5tT6jVv',
    operations: batch.operations,
  });
  console.log(out.slice(0, 2000));
}

console.log('Publishing...');
const pub = await mcpCall('publish_workflow', { workflowId: 'GlhDGC23n5tT6jVv' });
console.log(pub.slice(0, 1000));
