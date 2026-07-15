import 'dotenv/config';
import mongoose from 'mongoose';

const since = new Date(Date.now() - 2 * 60 * 60 * 1000);

await mongoose.connect(process.env.MONGODB_URI!);
const db = mongoose.connection.db;
if (!db) throw new Error('mongoose connection has no db handle');

const recent = await db
    .collection('candidates')
    .find({ $or: [{ createdAt: { $gte: since } }, { updatedAt: { $gte: since } }] })
    .sort({ updatedAt: -1 })
    .limit(6)
    .project({
        full_name: 1,
        email: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1,
        campaignId: 1,
        'writtenInterviewEvaluation.recommendation': 1,
        'writtenInterviewEvaluation.overall_score': 1,
        'writtenInterviewEvaluation.summary': 1,
        'writtenInterviewEvaluation.strengths': 1,
        'writtenInterviewEvaluation.weaknesses': 1,
        'writtenInterviewEvaluation.final_hr_evaluation': 1,
        notes: 1,
    })
    .toArray();

console.log('recent', JSON.stringify(recent, null, 2));

const out = await db
    .collection('stage1_evaluation_outbox')
    .find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

console.log(
    'outbox',
    JSON.stringify(
        out.map((o) => ({
            candidateId: o.candidateId,
            status: o.status,
            attempts: o.attempts,
            lastError: o.lastError,
            createdAt: o.createdAt,
            deliveredAt: o.deliveredAt,
        })),
        null,
        2
    )
);

await mongoose.disconnect();
