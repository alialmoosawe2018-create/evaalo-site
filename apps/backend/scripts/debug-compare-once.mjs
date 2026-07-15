import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI);

const cid = '6606bf9964a7b3d06430a4ba4ea75e1f';
const camp = await mongoose.connection.collection('recruitmentcampaigns').findOne({ campaignId: cid });
console.log('aiCompareTopResult:', camp?.aiCompareTopResult ?? null);

const apps = await mongoose.connection.collection('Applicants').find({ CampaignID: cid }).toArray();
console.log('Applicants count:', apps.length);
if (apps[0]) console.log('sample Applicant:', JSON.stringify(apps[0], null, 2));

const cands = await mongoose.connection.collection('candidates').find({ campaignId: cid }).project({ full_name: 1, writtenInterviewEvaluation: 1 }).toArray();
console.log('candidates:', cands.map((c) => ({ name: c.full_name, rec: c.writtenInterviewEvaluation?.recommendation, score: c.writtenInterviewEvaluation?.overall_score })));

const pw = await mongoose.connection.collection('processedwebhooks').find({ source: /ai-compare/ }).sort({ createdAt: -1 }).limit(5).toArray();
console.log('processed webhooks:', pw.map((p) => ({ source: p.source, key: p.idempotencyKey, status: p.status })));

const bal = await mongoose.connection.collection('creditbalances').findOne({ organizationId: 'org_default' });
console.log('credit balance:', bal);
const orgPlan = await mongoose.connection.collection('orgplanstates').findOne({ organizationId: 'org_default' });
console.log('org plan state:', orgPlan);
const led = await mongoose.connection.collection('creditledgers').find({ organizationId: 'org_default', source: /compare/i }).sort({ createdAt: -1 }).limit(5).toArray();
console.log('compare ledger:', led);

await mongoose.disconnect();
