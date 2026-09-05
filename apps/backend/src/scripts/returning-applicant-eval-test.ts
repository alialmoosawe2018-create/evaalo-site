/**
 * The founder applied to a second campaign with the same email and the new
 * application arrived carrying the first campaign's score and write-up.
 * Guards that a returning applicant's new application starts unevaluated.
 *
 *   npx tsx src/scripts/returning-applicant-eval-test.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { upsertCandidateApplication } from '../services/candidateApplicationService.js';

dotenv.config();

const ORG = 'org_returning_eval_test';
const EMAIL = `returning_${Date.now()}@example.com`;
const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function check(name: string, pass: boolean, detail = '') {
    results.push({ name, pass, detail });
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
    await mongoose.connect(process.env.MONGODB_URI as string);

    // A person who already carries a verdict from an earlier campaign.
    const person = await new Candidate({
        organizationId: ORG,
        email: EMAIL,
        full_name: 'Returning Applicant',
        phone: '07800000000',
        years_of_experience: '2-3',
        location: 'Baghdad',
        campaignId: 'campaign_one',
        position_applied_for: 'Compensation Specialist',
        writtenInterviewEvaluation: { overall_score: 25, recommendation: 'Reject' },
        voiceInterviewEvaluation: { overall_score: 66, recommendation: 'Consider' },
        videoInterviewEvaluation: { overall_score: 37, recommendation: 'Reject' },
    }).save();

    // They now apply to a different campaign.
    person.campaignId = 'campaign_two';
    person.position_applied_for = 'HR Assistant';
    const app = await upsertCandidateApplication({
        organizationId: ORG,
        candidate: person,
        campaignId: 'campaign_two',
        reuseExisting: true,
        eventType: 'applied',
    });

    const fresh = await CandidateApplication.findById(app._id).lean();
    /* Mongoose fills these paths with empty default shells; what must never carry
       over is the previous campaign's verdict. Assert on the verdict itself. */
    for (const field of [
        'writtenInterviewEvaluation',
        'voiceInterviewEvaluation',
        'videoInterviewEvaluation',
    ] as const) {
        const e = fresh?.[field] as { overall_score?: number; recommendation?: string } | undefined;
        check(
            `${field} carries no inherited score`,
            e?.overall_score === undefined,
            `got=${JSON.stringify(e?.overall_score)}`
        );
        check(
            `${field} carries no inherited recommendation`,
            e?.recommendation === undefined,
            `got=${JSON.stringify(e?.recommendation)}`
        );
    }
    check(
        'the person keeps its own history untouched',
        (person.writtenInterviewEvaluation as { overall_score?: number } | undefined)?.overall_score === 25
    );

    await CandidateApplication.deleteMany({ organizationId: ORG });
    await Candidate.deleteMany({ organizationId: ORG });
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.pass);
    console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length }, null, 2));
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
