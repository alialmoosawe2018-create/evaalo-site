/**
 * مرحلة 3 — smoke للـ M2M (حالات 2 و 3 + جزء من 1 و 5 عبر DB/service).
 *
 * تشغيل:
 *   npx tsx src/scripts/smokeM2mScenarios.ts
 *
 * ينشئ بريداً فريداً وحملتين تجريبيتين، يشغّل السيناريوهات، ثم يحذف بيانات التجربة.
 */
import dotenv from 'dotenv';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import {
    upsertCandidateApplication,
    refreshPersonApplicationCounters,
} from '../services/candidateApplicationService.js';
import {
    isVoiceLinkConsumedById,
    markVoiceLinkConsumed,
    clearVoiceLinkAccess,
} from '../services/interviewLinkAccess.js';

dotenv.config();

const TAG = `m2m_smoke_${Date.now()}`;
const EMAIL = `${TAG}@example.com`;

type Check = { name: string; ok: boolean; detail?: string };

function assert(checks: Check[], name: string, ok: boolean, detail?: string) {
    checks.push({ name, ok, detail });
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function applyLikePublic(opts: {
    orgId: string;
    campaignId: string;
    email: string;
    full_name: string;
    source?: string;
    sourceType?: string;
}): Promise<
    | { ok: true; personId: string; applicationId: string; createdNewPerson: boolean }
    | { ok: false; code: string; applicationId?: string }
> {
    const emailNorm = opts.email.trim().toLowerCase();
    const existing = await Candidate.findOne({
        organizationId: opts.orgId,
        email: emailNorm,
    });

    if (existing) {
        const existingApp = await CandidateApplication.findOne({
            candidateId: existing._id,
            campaignId: opts.campaignId,
            deletedAt: null,
        }).lean();
        if (existingApp) {
            return {
                ok: false,
                code: 'APPLICATION_EXISTS',
                applicationId: existingApp.applicationId,
            };
        }
    }

    let candidate;
    let createdNewPerson = false;
    if (existing) {
        await Candidate.findByIdAndUpdate(existing._id, {
            $set: { campaignId: opts.campaignId, full_name: opts.full_name },
        });
        candidate = await Candidate.findById(existing._id);
    } else {
        createdNewPerson = true;
        candidate = await Candidate.create({
            organizationId: opts.orgId,
            email: emailNorm,
            full_name: opts.full_name,
            phone: '+10000000000',
            position_applied_for: 'Smoke Role',
            years_of_experience: '1-2',
            campaignId: opts.campaignId,
            sourceType: opts.sourceType || 'public_screening',
            status: 'pending',
            entryStage: 'screening',
        });
    }
    if (!candidate) throw new Error('candidate missing');

    const application = await upsertCandidateApplication({
        organizationId: opts.orgId,
        candidate,
        campaignId: opts.campaignId,
        entryStage: 'screening',
        sourceType: opts.sourceType || 'public_screening',
        source: opts.source,
        status: 'pending',
        reuseExisting: true,
        eventType: 'applied',
    });

    await refreshPersonApplicationCounters(String(candidate._id));

    return {
        ok: true,
        personId: String(candidate._id),
        applicationId: application.applicationId,
        createdNewPerson,
    };
}

async function main() {
    await connectDatabase();
    const checks: Check[] = [];
    const createdCampaignIds: string[] = [];
    let personId = '';

    console.log(`\n=== M2M Smoke ${TAG} ===\nemail=${EMAIL}\n`);

    try {
        // حملتان تجريبيتان
        const orgId = 'org_m2m_smoke';
        const campA = crypto.randomBytes(16).toString('hex');
        const campB = crypto.randomBytes(16).toString('hex');
        for (const [campaignId, position] of [
            [campA, 'Smoke Role A'],
            [campB, 'Smoke Role B'],
        ] as const) {
            await RecruitmentCampaign.create({
                organizationId: orgId,
                campaignId,
                publicApplicationToken: crypto.randomBytes(12).toString('hex'),
                criteria: { position },
                status: 'active',
                createdByClerkUserId: 'user_m2m_smoke',
            });
            createdCampaignIds.push(campaignId);
        }
        console.log(`campaigns: A=${campA.slice(0, 8)}… B=${campB.slice(0, 8)}…\n`);

        // —— الحالة 2: نفس البريد → حملتان ——
        console.log('Scenario 2: same email → two campaigns');
        const r1 = await applyLikePublic({
            orgId,
            campaignId: campA,
            email: EMAIL,
            full_name: 'M2M Smoke Tester',
        });
        assert(checks, '2.1 apply to A succeeds', r1.ok === true, r1.ok ? r1.applicationId : r1.code);
        if (!r1.ok) throw new Error('cannot continue without first apply');
        personId = r1.personId;
        assert(checks, '2.2 first apply creates person', r1.createdNewPerson === true);

        const r2 = await applyLikePublic({
            orgId,
            campaignId: campB,
            email: EMAIL,
            full_name: 'M2M Smoke Tester',
        });
        assert(checks, '2.3 apply to B succeeds (no org-wide email block)', r2.ok === true, r2.ok ? r2.applicationId : r2.code);
        if (r2.ok) {
            assert(checks, '2.4 same personId', r2.personId === personId, `${r2.personId} vs ${personId}`);
            assert(checks, '2.5 different applicationId', r2.applicationId !== r1.applicationId);
        }

        const people = await Candidate.countDocuments({ organizationId: orgId, email: EMAIL });
        const apps = await CandidateApplication.find({
            candidateId: personId,
            deletedAt: null,
        }).lean();
        assert(checks, '2.6 exactly one Person', people === 1, `count=${people}`);
        assert(checks, '2.7 exactly two Applications', apps.length === 2, `count=${apps.length}`);
        const person = await Candidate.findById(personId).lean();
        assert(
            checks,
            '2.8 applicationsCount cache = 2',
            (person as any)?.applicationsCount === 2,
            `got=${(person as any)?.applicationsCount}`
        );

        // —— الحالة 3: نفس البريد + نفس الحملة ——
        console.log('\nScenario 3: same email + same campaign → reject');
        const r3 = await applyLikePublic({
            orgId,
            campaignId: campA,
            email: EMAIL,
            full_name: 'M2M Smoke Tester',
        });
        assert(checks, '3.1 reject duplicate on A', r3.ok === false && r3.code === 'APPLICATION_EXISTS', r3.ok ? 'unexpected success' : r3.code);
        const appsAfter = await CandidateApplication.countDocuments({
            candidateId: personId,
            deletedAt: null,
        });
        assert(checks, '3.2 still two Applications', appsAfter === 2, `count=${appsAfter}`);

        // —— الحالة 1 (جزئي): عزل رابط الصوت ——
        console.log('\nScenario 1 (partial): voice link isolation');
        const appA = apps.find((a) => a.campaignId === campA)!;
        const appB = apps.find((a) => a.campaignId === campB)!;
        await markVoiceLinkConsumed(personId, 'smoke-session-a', {
            applicationId: appA.applicationId,
            campaignId: campA,
        });
        const consumedA = await isVoiceLinkConsumedById(personId, {
            applicationId: appA.applicationId,
            campaignId: campA,
        });
        const consumedB = await isVoiceLinkConsumedById(personId, {
            applicationId: appB.applicationId,
            campaignId: campB,
        });
        assert(checks, '1.1 A voice link consumed', consumedA === true);
        assert(checks, '1.2 B voice link NOT consumed', consumedB === false);
        await clearVoiceLinkAccess(personId, {
            applicationId: appA.applicationId,
            campaignId: campA,
        });

        // —— الحالة 4 (جزئي): source HeadHunter على Application ——
        console.log('\nScenario 4 (partial): HeadHunter source on Application');
        const campC = crypto.randomBytes(16).toString('hex');
        await RecruitmentCampaign.create({
            organizationId: orgId,
            campaignId: campC,
            publicApplicationToken: crypto.randomBytes(12).toString('hex'),
            criteria: { position: 'Smoke HH Role' },
            status: 'active',
            createdByClerkUserId: 'user_m2m_smoke',
        });
        createdCampaignIds.push(campC);
        const rHh = await applyLikePublic({
            orgId,
            campaignId: campC,
            email: EMAIL,
            full_name: 'M2M Smoke Tester',
            source: 'HeadHunter',
            sourceType: 'headhunter',
        });
        assert(checks, '4.1 HH apply succeeds', rHh.ok === true);
        if (rHh.ok) {
            const hhApp = await CandidateApplication.findOne({
                applicationId: rHh.applicationId,
            }).lean();
            assert(
                checks,
                '4.2 Application.source = HeadHunter',
                (hhApp as any)?.source === 'HeadHunter',
                `got=${(hhApp as any)?.source}`
            );
        }

        // —— الحالة 5 (جزئي): تقييمات مستقلة ——
        console.log('\nScenario 5 (partial): independent evaluations');
        await CandidateApplication.updateOne(
            { applicationId: appA.applicationId },
            {
                $set: {
                    voiceInterviewEvaluation: {
                        overall_score: 95,
                        recommendation: 'Hire',
                        summary: 'smoke A',
                        strengths: [],
                        weaknesses: [],
                    },
                    videoInterviewEvaluation: {
                        overall_score: 88,
                        recommendation: 'Hire',
                        summary: 'smoke A video',
                    },
                },
            }
        );
        await CandidateApplication.updateOne(
            { applicationId: appB.applicationId },
            {
                $set: {
                    voiceInterviewEvaluation: {
                        overall_score: 72,
                        recommendation: 'Consider',
                        summary: 'smoke B',
                        strengths: [],
                        weaknesses: [],
                    },
                },
            }
        );
        const aReload = await CandidateApplication.findOne({ applicationId: appA.applicationId }).lean();
        const bReload = await CandidateApplication.findOne({ applicationId: appB.applicationId }).lean();
        assert(
            checks,
            '5.1 A voice=95 independent of B',
            Number((aReload as any)?.voiceInterviewEvaluation?.overall_score) === 95 &&
                Number((bReload as any)?.voiceInterviewEvaluation?.overall_score) === 72
        );
        assert(
            checks,
            '5.2 B has no video while A has video',
            Boolean((aReload as any)?.videoInterviewEvaluation?.overall_score) &&
                !(bReload as any)?.videoInterviewEvaluation?.overall_score
        );
    } finally {
        // تنظيف بيانات التجربة
        console.log('\nCleanup…');
        if (personId) {
            await CandidateApplication.deleteMany({ candidateId: personId });
            await Candidate.deleteOne({ _id: personId });
        } else {
            await Candidate.deleteMany({ email: EMAIL });
        }
        if (createdCampaignIds.length) {
            await RecruitmentCampaign.deleteMany({ campaignId: { $in: createdCampaignIds } });
        }
        // تنظيف أي بقايا من تشغيل فاشل سابق
        await RecruitmentCampaign.deleteMany({ createdByClerkUserId: 'user_m2m_smoke' });
        await Candidate.deleteMany({ organizationId: 'org_m2m_smoke' });
        await CandidateApplication.deleteMany({ organizationId: 'org_m2m_smoke' });
    }

    const failed = checks.filter((c) => !c.ok);
    const report = {
        ok: failed.length === 0,
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        failures: failed,
        email: EMAIL,
    };
    console.log('\n' + JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    process.exit(report.ok ? 0 : 2);
}

main().catch(async (e) => {
    console.error(e);
    try {
        await Candidate.deleteMany({ email: EMAIL });
        await CandidateApplication.deleteMany({ emailDenorm: EMAIL });
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
