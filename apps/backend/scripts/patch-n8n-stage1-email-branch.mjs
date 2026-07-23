/**
 * Patches Campaign Compare Stage 1 secure workflow on n8n SQLite DB:
 * - IF body.mode === 'email_dispatch_only' → format + Gmail + respond { emailSent: true }
 * - else → existing validate → LLM → callback
 *
 * Run on VPS: node patch-n8n-stage1-email-branch.mjs /root/n8n-data-old/database.sqlite
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { FORMAT_EMAIL_CODE } from './campaign-compare-stage1-phase15-prompt.mjs';

const dbPath = process.argv[2] || '/root/n8n-data-old/database.sqlite';
const WF_ID = 'tk2tAop5hzSjGSqv';

const formatEmailCode = FORMAT_EMAIL_CODE;

function n8nId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const db = new Database(dbPath);
const row = db.prepare('SELECT nodes, connections, activeVersionId FROM workflow_entity WHERE id = ?').get(WF_ID);
if (!row) throw new Error(`workflow ${WF_ID} not found`);

const nodes = JSON.parse(row.nodes);
const connections = JSON.parse(row.connections);

const webhook = nodes.find((n) => n.name === 'Webhook');
const validate = nodes.find((n) => n.name === 'Validate Inbound Secret');
if (!webhook || !validate) throw new Error('expected Webhook + Validate Inbound Secret nodes');

webhook.parameters.responseMode = 'responseNode';

const routeModeId = n8nId();
const formatEmailId = n8nId();
const sendEmailId = n8nId();
const respondEmailId = n8nId();
const respondCompareId = n8nId();

const routeMode = {
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: randomUUID(),
          leftValue: '={{ $json.body.mode }}',
          rightValue: 'email_dispatch_only',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [120, 0],
  id: routeModeId,
  name: 'Route Mode',
};

const formatEmail = {
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: formatEmailCode },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [360, -160],
  id: formatEmailId,
  name: 'Format Email',
};

const sendEmail = {
  parameters: {
    sendTo: '={{ $json.email }}',
    subject: '={{ $json.subject }}',
    emailType: 'text',
    message: '={{ $json.message }}',
    options: {},
  },
  type: 'n8n-nodes-base.gmail',
  typeVersion: 2.2,
  position: [600, -160],
  id: sendEmailId,
  name: 'Send Compare Email',
  credentials: { gmailOAuth2: { id: 'WwAUoVN05BkeF3Iy', name: 'Gmail account' } },
  onError: 'continueRegularOutput',
};

const respondEmail = {
  parameters: {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ ok: true, emailSent: true, requestId: $json.requestId || null }) }}',
    options: {},
  },
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: [840, -160],
  id: respondEmailId,
  name: 'Respond Email Success',
};

const respondCompare = {
  parameters: {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ ok: true, accepted: true }) }}',
    options: { responseCode: 200 },
  },
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: [360, 80],
  id: respondCompareId,
  name: 'Respond Compare Accepted',
};

const existingNames = new Set(nodes.map((n) => n.name));
for (const n of [routeMode, formatEmail, sendEmail, respondEmail, respondCompare]) {
  if (!existingNames.has(n.name)) nodes.push(n);
}

connections.Webhook = { main: [[{ node: 'Route Mode', type: 'main', index: 0 }]] };
connections['Route Mode'] = {
  main: [
    [
      { node: 'Format Email', type: 'main', index: 0 },
    ],
    [
      { node: 'Respond Compare Accepted', type: 'main', index: 0 },
    ],
  ],
};
connections['Format Email'] = { main: [[{ node: 'Send Compare Email', type: 'main', index: 0 }]] };
connections['Send Compare Email'] = { main: [[{ node: 'Respond Email Success', type: 'main', index: 0 }]] };
connections['Respond Compare Accepted'] = {
  main: [[{ node: 'Validate Inbound Secret', type: 'main', index: 0 }]],
};

const nodesJson = JSON.stringify(nodes);
const connectionsJson = JSON.stringify(connections);

db.prepare('UPDATE workflow_entity SET nodes = ?, connections = ? WHERE id = ?').run(
  nodesJson,
  connectionsJson,
  WF_ID
);

const activeVersionId = row.activeVersionId;
if (activeVersionId) {
  db.prepare('UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?').run(
    nodesJson,
    connectionsJson,
    activeVersionId
  );
}

console.log('patched workflow', WF_ID, 'activeVersionId', activeVersionId);
db.close();
