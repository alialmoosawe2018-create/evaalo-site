/**
 * ينظّف تقييمات فارغة (هياكل mongoose الافتراضية بدون score/recommendation)
 * أُنشئت أثناء الهجرة على بعض Applications.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import CandidateApplication from '../models/CandidateApplication.js';

dotenv.config();

function isEmptyEval(ev: unknown): boolean {
    if (!ev || typeof ev !== 'object') return true;
    const o = ev as Record<string, unknown>;
    const score = o.overall_score;
    const rec = o.recommendation;
    const hasScore = score !== undefined && score !== null && String(score).trim() !== '';
    const hasRec = typeof rec === 'string' && rec.trim().length > 0;
    return !hasScore && !hasRec;
}

async function main() {
    await connectDatabase();
    const apps = await CandidateApplication.find({ deletedAt: null }).lean();
    let cleaned = 0;
    for (const a of apps) {
        const unset: Record<string, 1> = {};
        if (isEmptyEval(a.voiceInterviewEvaluation) && a.voiceInterviewEvaluation) {
            unset.voiceInterviewEvaluation = 1;
        }
        if (isEmptyEval(a.writtenInterviewEvaluation) && a.writtenInterviewEvaluation) {
            unset.writtenInterviewEvaluation = 1;
        }
        if (isEmptyEval(a.videoInterviewEvaluation) && a.videoInterviewEvaluation) {
            unset.videoInterviewEvaluation = 1;
        }
        if (Object.keys(unset).length === 0) continue;
        await CandidateApplication.updateOne({ _id: a._id }, { $unset: unset });
        cleaned += 1;
    }
    console.log(JSON.stringify({ ok: true, scanned: apps.length, cleaned }, null, 2));
    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
