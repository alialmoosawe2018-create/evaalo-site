/**
 * Local Stage 1 inbound roundtrip against running backend (no n8n).
 * Requires: backend on PORT (default 5000), MongoDB, .env stage secrets.
 * Run: npm run dev  (separate terminal) then npm run test:stage1-local-roundtrip
 */
import '../loadEnv.js';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Candidate from '../models/Candidate.js';
import { connectDatabase } from '../config/database.js';
import { getStageInboundSecret, mintStageCallbackUrl } from '../services/stageCallbackAuth.js';

const PORT = process.env.PORT || '5000';
const BASE = `http://127.0.0.1:${PORT}`;

async function main(): Promise<void> {
    const health = await fetch(`${BASE}/api/health`).catch(() => null);
    if (!health?.ok) {
        console.error(`stage1-local-roundtrip: backend not reachable at ${BASE} — start with: npm run dev`);
        process.exit(1);
    }

    await connectDatabase();

    const candidate = await Candidate.findOne().sort({ createdAt: -1 }).select('_id email').lean();
    if (!candidate?._id) {
        console.error('stage1-local-roundtrip: no candidate in MongoDB — submit one via UI first');
        process.exit(1);
    }

    const candidateId = String(candidate._id);
    const minted = mintStageCallbackUrl({ mode: 'stage1', candidateId });
    const callback = new URL(minted.callbackUrl);
    const inboundSecret = getStageInboundSecret();
    assert.ok(inboundSecret);

    const targetUrl = `${BASE}${callback.pathname}${callback.search}`;
    const body = {
        id: candidateId,
        evaluationSource: 'written',
        ingress: 'stage1-local-roundtrip',
        overall_score: 71,
        recommendation: 'Consider',
        final_hr_evaluation:
            'Candidate shows foundational HR experience; recommend voice interview to assess strategic HR BP competencies.',
        strengths: ['Local roundtrip test strength'],
        weaknesses: ['Local roundtrip test weakness'],
        summary: 'Offline local inbound roundtrip verification.',
    };

    const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-n8n-stage-secret': inboundSecret,
        },
        body: JSON.stringify(body),
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        console.error('stage1-local-roundtrip: inbound failed', res.status, payload);
        process.exit(1);
    }

    const updated = await Candidate.findById(candidateId)
        .select('writtenInterviewEvaluation.overall_score writtenInterviewEvaluation.recommendation')
        .lean();
    const evalDoc = updated?.writtenInterviewEvaluation as
        | { overall_score?: number; recommendation?: string }
        | undefined;

    assert.equal(evalDoc?.overall_score, 71);
    assert.equal(evalDoc?.recommendation, 'Consider');

    console.log('stage1-local-roundtrip: OK');
    console.log(`  candidateId=${candidateId}`);
    console.log(`  inbound=${res.status} score=${evalDoc?.overall_score} rec=${evalDoc?.recommendation}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
