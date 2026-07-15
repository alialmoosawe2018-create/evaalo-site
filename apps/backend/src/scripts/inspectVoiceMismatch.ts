import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';

dotenv.config();

async function main() {
    await connectDatabase();
    const ids = ['69e481e95e4e1572c9e1f937', '69e4ffdc8a91b51b86d92554'];
    for (const id of ids) {
        const c = await Candidate.findById(id).lean();
        const a = await CandidateApplication.findOne({ candidateId: id }).lean();
        console.log(
            JSON.stringify(
                {
                    id,
                    email: c?.email,
                    cVoice: c?.voiceInterviewEvaluation ?? null,
                    aVoice: a?.voiceInterviewEvaluation ?? null,
                    cHas: Boolean(c?.voiceInterviewEvaluation),
                    aHas: Boolean(a?.voiceInterviewEvaluation),
                },
                null,
                2
            )
        );
    }
    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
