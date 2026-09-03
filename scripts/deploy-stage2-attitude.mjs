import fs from 'fs';

// The n8n API token must come from the environment. It was previously hard-coded
// here and is therefore burned in git history — it MUST be rotated in n8n.
const TOKEN = process.env.N8N_API_TOKEN;
if (!TOKEN) {
  console.error('Missing N8N_API_TOKEN. Export it before running this script.');
  process.exit(1);
}
const MCP_URL = 'https://n8n.evaalo.com/mcp-server/http';
const WORKFLOW_ID = 'BB87WRQQYEiLdMsk';

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

const ATTITUDE_DESC =
  "Professional Attitude: extract the FULL descriptive paragraph (2-3 complete sentences) from the 'Professional Attitude' section of the markdown, describing the candidate's professionalism, engagement, motivation and demeanor with brief evidence. IMPORTANT: return the full explanatory text, NOT a single rating word such as 'Excellent', 'Good', 'Intermediate' or 'Bad'.";

// The 12 attributes are identical for both Information Extractor nodes.
function buildAttributes() {
  return [
    { name: 'Summary', description: 'the summary', required: true },
    { name: 'Strengths', description: 'key strengths without the quotes ', required: true },
    { name: 'Weaknesses', description: 'Areas of concern/weaknesses without the quotes ', required: true },
    { name: 'Final HR Evaluation', description: ' Final HR justification without the quotes ', required: true },
    { name: 'Confidence Level', description: 'the confidence level', required: true },
    { name: 'Communication Skills', description: 'Communication Skills', required: true },
    { name: 'English Fluency', description: 'English Fluency', required: true },
    { name: 'Computer Skills', description: 'Computer Skills rate', required: true },
    { name: 'Professional Attitude', description: ATTITUDE_DESC, required: true },
    { name: 'Problem Solving', description: 'Problem Solving rate', required: true },
    { name: 'Recommendation', description: 'the final HR recommendation', required: true },
    { name: 'Overall-score', description: 'the final score ', required: true },
  ];
}

const extractorParams = {
  text: '={{ $json.text }}',
  attributes: { attributes: buildAttributes() },
  options: {},
};

// Strengthen the "Professional Attitude" markdown section in both LLM chains.
const ATTITUDE_SECTION_OLD = '### 4. Professional Attitude\n[Evaluate based on the script with 2-3 sentences]';
const ATTITUDE_SECTION_NEW =
  '### 4. Professional Attitude\n[Write a descriptive paragraph of 2-3 FULL sentences evaluating the candidate\'s professional attitude, engagement, motivation and demeanor, with brief evidence from the transcript. This MUST be an explanation like the Summary and Weaknesses sections — do NOT output a single rating word such as Excellent/Good/Intermediate/Bad.]';

const dump = JSON.parse(
  fs.readFileSync(
    'C:/Users/Alnaji-AliMD/.cursor/projects/c-Users-Alnaji-AliMD-cursor/agent-tools/36ba3000-ac0e-4bcb-8b13-3efe23876a48.txt',
    'utf8',
  ),
);
const nodes = dump.workflow.nodes;

function patchedChainParams(nodeName) {
  const n = nodes.find((x) => x.name === nodeName);
  const params = JSON.parse(JSON.stringify(n.parameters));
  const msg = params.messages.messageValues[0].message;
  if (!msg.includes(ATTITUDE_SECTION_OLD)) {
    console.warn(`WARN: attitude section marker not found in ${nodeName}`);
  }
  params.messages.messageValues[0].message = msg.replace(ATTITUDE_SECTION_OLD, ATTITUDE_SECTION_NEW);
  return params;
}

const operations = [
  { type: 'updateNodeParameters', nodeName: 'Information Extractor', parameters: extractorParams },
  { type: 'updateNodeParameters', nodeName: 'Information Extractor2', parameters: extractorParams },
  { type: 'updateNodeParameters', nodeName: 'Basic LLM Chain', parameters: patchedChainParams('Basic LLM Chain') },
  { type: 'updateNodeParameters', nodeName: 'Basic LLM Chain1', parameters: patchedChainParams('Basic LLM Chain1') },
];

console.log('Applying updates...');
const out = await mcpCall('update_workflow', { workflowId: WORKFLOW_ID, operations });
console.log(out.slice(0, 1500));

console.log('Publishing...');
const pub = await mcpCall('publish_workflow', { workflowId: WORKFLOW_ID });
console.log(pub.slice(0, 800));
