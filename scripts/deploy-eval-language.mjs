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
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text;
}

const LANG_EXPR = "{{ $('Webhook').item.json.body.language || 'auto' }}";
const MARKER = 'Output Language (STRICT';

function directive(sections) {
  return (
    `**${MARKER} — HIGHEST PRIORITY):** Evaluation language code = ${LANG_EXPR}. ` +
    `Write EVERY narrative/text field (${sections}) fully in that language: 'ar' => Arabic, 'en' => English. ` +
    `If the code is 'auto' or empty, detect the dominant language of the CANDIDATE's answers in the transcript and write in that language. ` +
    `Do NOT mix languages in the narrative. Keep the Recommendation token exactly one of Hire / Consider / Reject (English only). ` +
    `Skill ratings stay exactly one of Excellent / Good / Intermediate / Bad; any competency scores stay numeric.`
  );
}

const STAGE2_SECTIONS =
  'Executive Summary, Key Strengths, Weaknesses, Professional Attitude, Final HR Evaluation and its Justification';
const STAGE3_SECTIONS =
  'Summary, Role Understanding, Qualitative Narrative Analysis, Final HR Evaluation paragraph, competency evidence';

function readDump(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).workflow.nodes;
}

function injectDirective(message, sections, nodeName) {
  if (message.includes(MARKER)) {
    console.log(`  (skip) ${nodeName}: directive already present`);
    return message;
  }
  const dir = directive(sections);
  // message starts with '=' (n8n expression). Insert directive right after it.
  if (message.startsWith('=')) {
    return `=${dir}\n\n${message.slice(1)}`;
  }
  return `${dir}\n\n${message}`;
}

function buildOps(nodes, sections) {
  const ops = [];
  for (const nodeName of ['Basic LLM Chain', 'Basic LLM Chain1']) {
    const n = nodes.find((x) => x.name === nodeName);
    if (!n) {
      console.warn(`  WARN: node ${nodeName} not found`);
      continue;
    }
    const params = JSON.parse(JSON.stringify(n.parameters));
    const mv = params.messages?.messageValues?.[0];
    if (!mv || typeof mv.message !== 'string') {
      console.warn(`  WARN: ${nodeName} has no message`);
      continue;
    }
    mv.message = injectDirective(mv.message, sections, nodeName);
    ops.push({ type: 'updateNodeParameters', nodeName, parameters: params });
  }
  return ops;
}

const targets = [
  {
    id: 'BB87WRQQYEiLdMsk',
    label: 'Stage 2 (voice)',
    dump: 'C:/Users/Alnaji-AliMD/.cursor/projects/c-Users-Alnaji-AliMD-cursor/agent-tools/baf7adfe-5cdc-4f69-b3d5-2821e6675d8d.txt',
    sections: STAGE2_SECTIONS,
  },
  {
    id: 'dWJzDwAd4FiVPejl',
    label: 'Stage 3 (video)',
    dump: 'C:/Users/Alnaji-AliMD/.cursor/projects/c-Users-Alnaji-AliMD-cursor/agent-tools/9822bd6e-84a3-4016-92c1-6fb52bad532e.txt',
    sections: STAGE3_SECTIONS,
  },
];

for (const tgt of targets) {
  console.log(`\n=== ${tgt.label} (${tgt.id}) ===`);
  const nodes = readDump(tgt.dump);
  const operations = buildOps(nodes, tgt.sections);
  if (operations.length === 0) {
    console.log('  no operations, skipping');
    continue;
  }
  const out = await mcpCall('update_workflow', { workflowId: tgt.id, operations });
  const m = out.match(/"appliedOperations":\s*(\d+)/);
  console.log(`  appliedOperations: ${m ? m[1] : '?'}`);
  const pub = await mcpCall('publish_workflow', { workflowId: tgt.id });
  const v = pub.match(/"activeVersionId":"([^"]+)"/);
  console.log(`  published activeVersionId: ${v ? v[1] : '(see raw)'}`);
}

console.log('\nDone.');
