/**
 * Patches live Campaign Compare Stage 1 workflow (tk2tAop5hzSjGSqv) for Phase 1.5:
 * - LLM system prompt (rich report schema)
 * - Build Callback Body (passes Phase 1.5 fields)
 * - Callback HTTP jsonBody
 * - Format Email (rich text sections)
 *
 * Run on VPS:
 *   node patch-n8n-stage1-phase15.mjs /root/n8n-data-old/database.sqlite
 */
import Database from 'better-sqlite3';
import {
    BUILD_CALLBACK_CODE,
    CALLBACK_JSON_BODY,
    FORMAT_EMAIL_CODE,
    LLM_SYSTEM,
} from './campaign-compare-stage1-phase15-prompt.mjs';

const dbPath = process.argv[2] || '/root/n8n-data-old/database.sqlite';
const WF_ID = 'tk2tAop5hzSjGSqv';

const db = new Database(dbPath);
const row = db.prepare('SELECT nodes, connections, activeVersionId FROM workflow_entity WHERE id = ?').get(WF_ID);
if (!row) throw new Error(`workflow ${WF_ID} not found`);

const nodes = JSON.parse(row.nodes);

const llm = nodes.find((n) => n.name === 'Compare Stage 1 LLM');
const build = nodes.find((n) => n.name === 'Build Callback Body');
const callback = nodes.find((n) => n.name === 'Callback to Backend');
const formatEmail = nodes.find((n) => n.name === 'Format Email');

if (!llm || !build || !callback) {
    throw new Error('missing Compare Stage 1 LLM / Build Callback Body / Callback to Backend nodes');
}

if (llm.parameters?.messages?.messageValues?.[0]) {
    llm.parameters.messages.messageValues[0].message = LLM_SYSTEM;
}

build.parameters.jsCode = BUILD_CALLBACK_CODE;
callback.parameters.jsonBody = CALLBACK_JSON_BODY;

if (formatEmail) {
    formatEmail.parameters.jsCode = FORMAT_EMAIL_CODE;
}

const nodesJson = JSON.stringify(nodes);
const connectionsJson = row.connections;

db.prepare('UPDATE workflow_entity SET nodes = ? WHERE id = ?').run(nodesJson, WF_ID);

const activeVersionId = row.activeVersionId;
if (activeVersionId) {
    db.prepare('UPDATE workflow_history SET nodes = ? WHERE versionId = ?').run(nodesJson, activeVersionId);
}

console.log('patched Phase 1.5 prompt on workflow', WF_ID, 'activeVersionId', activeVersionId);
console.log('updated nodes:', ['Compare Stage 1 LLM', 'Build Callback Body', 'Callback to Backend', formatEmail ? 'Format Email' : '(no Format Email)'].join(', '));
db.close();
