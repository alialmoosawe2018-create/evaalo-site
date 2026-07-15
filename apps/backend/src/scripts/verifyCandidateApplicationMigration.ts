/**
 * تحقق ما بعد الهجرة: مقارنة Candidate ↔ Application على عينات.
 * تشغيل: npx tsx src/scripts/verifyCandidateApplicationMigration.ts
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';

dotenv.config();

function scoreOf(ev: unknown): string {
    if (!ev || typeof ev !== 'object') return '';
    const o = ev as Record<string, unknown>;
    const score = o.overall_score;
    const rec = o.recommendation;
    const hasScore = score !== undefined && score !== null && String(score).trim() !== '';
    const hasRec = typeof rec === 'string' && rec.trim().length > 0;
    if (!hasScore && !hasRec) return ''; // هيكل فارغ = بلا تقييم
    return `${hasScore ? score : ''}|${hasRec ? rec : ''}`;
}

function mismatchesFor(c: any, a: any): string[] {
    const issues: string[] = [];
    if (String(c.email || '').toLowerCase() !== String(a.emailDenorm || '').toLowerCase()) {
        issues.push('email');
    }
    if ((c.campaignId || '') !== (a.campaignId || '')) issues.push('campaignId');
    if (scoreOf(c.writtenInterviewEvaluation) !== scoreOf(a.writtenInterviewEvaluation)) {
        issues.push('written');
    }
    if (scoreOf(c.voiceInterviewEvaluation) !== scoreOf(a.voiceInterviewEvaluation)) {
        issues.push('voice');
    }
    if (scoreOf(c.videoInterviewEvaluation) !== scoreOf(a.videoInterviewEvaluation)) {
        issues.push('video');
    }
    if ((c.voiceRecording?.key || '') !== (a.voiceRecording?.key || '')) {
        issues.push('voiceRecording');
    }
    const cVoice = c.voiceInterviewLinkConsumedAt ? new Date(c.voiceInterviewLinkConsumedAt).toISOString() : '';
    const aVoice = a.voiceInterviewLinkConsumedAt ? new Date(a.voiceInterviewLinkConsumedAt).toISOString() : '';
    if (cVoice !== aVoice) issues.push('voiceLink');
    const cVideo = c.videoInterviewLinkConsumedAt ? new Date(c.videoInterviewLinkConsumedAt).toISOString() : '';
    const aVideo = a.videoInterviewLinkConsumedAt ? new Date(a.videoInterviewLinkConsumedAt).toISOString() : '';
    if (cVideo !== aVideo) issues.push('videoLink');
    if ((c.status || 'pending') !== (a.status || 'pending')) issues.push('status');
    const cFiles = Array.isArray(c.files) ? c.files.length : 0;
    const aAtt = Array.isArray(a.attachments) ? a.attachments.length : 0;
    if (cFiles !== aAtt) issues.push(`files(${cFiles}≠${aAtt})`);
    if (!Array.isArray(a.timeline) || a.timeline.length === 0) issues.push('timeline');
    if (!a.applicationId) issues.push('applicationId');
    if (!a.applicationSnapshot) issues.push('snapshot');
    return issues;
}

async function main() {
    await connectDatabase();

    const [candidates, apps, appCount, peopleWithApps] = await Promise.all([
        Candidate.find({}).lean(),
        CandidateApplication.find({ deletedAt: null }).lean(),
        CandidateApplication.countDocuments({ deletedAt: null }),
        CandidateApplication.distinct('candidateId', { deletedAt: null }),
    ]);

    const byPerson = new Map<string, any[]>();
    for (const a of apps) {
        const k = String(a.candidateId);
        if (!byPerson.has(k)) byPerson.set(k, []);
        byPerson.get(k)!.push(a);
    }

    let missingApp = 0;
    let multiApp = 0;
    let mismatchCount = 0;
    const mismatchSamples: Array<Record<string, unknown>> = [];
    const matchSamples: Array<Record<string, unknown>> = [];

    // قارن كل المرشحين (78 صغير)
    for (const c of candidates) {
        const list = byPerson.get(String(c._id)) || [];
        if (list.length === 0) {
            missingApp += 1;
            mismatchSamples.push({ email: c.email, issue: 'no_application' });
            continue;
        }
        if (list.length > 1) multiApp += 1;
        // الهجرة 1:1 — خذ أول Application
        const a = list[0];
        const issues = mismatchesFor(c, a);
        if (issues.length) {
            mismatchCount += 1;
            if (mismatchSamples.length < 20) {
                mismatchSamples.push({
                    email: c.email,
                    candidateId: String(c._id),
                    applicationId: a.applicationId,
                    issues,
                });
            }
        } else if (matchSamples.length < 15) {
            matchSamples.push({
                email: c.email,
                full_name: c.full_name,
                applicationId: a.applicationId,
                campaignId: a.campaignId || null,
                written: scoreOf(c.writtenInterviewEvaluation) || null,
                voice: scoreOf(c.voiceInterviewEvaluation) || null,
                video: scoreOf(c.videoInterviewEvaluation) || null,
                voiceRecording: Boolean(c.voiceRecording?.key),
                voiceLink: Boolean(c.voiceInterviewLinkConsumedAt),
                videoLink: Boolean(c.videoInterviewLinkConsumedAt),
                status: a.status,
                files: Array.isArray(a.attachments) ? a.attachments.length : 0,
                campaignRef: a.campaignRef ? String(a.campaignRef) : null,
                counters: {
                    applicationsCount: (c as any).applicationsCount,
                    lastCampaignId: (c as any).lastCampaignId,
                },
            });
        }
    }

    // عينات غنية بالتقييمات
    const rich = apps
        .filter(
            (a) =>
                a.writtenInterviewEvaluation ||
                a.voiceInterviewEvaluation ||
                a.videoInterviewEvaluation ||
                a.voiceRecording?.key
        )
        .slice(0, 20)
        .map((a) => ({
            email: a.emailDenorm,
            applicationId: a.applicationId,
            campaignId: a.campaignId || null,
            written: scoreOf(a.writtenInterviewEvaluation) || null,
            voice: scoreOf(a.voiceInterviewEvaluation) || null,
            video: scoreOf(a.videoInterviewEvaluation) || null,
            recordingKey: a.voiceRecording?.key || null,
        }));

    const report = {
        ok: missingApp === 0 && mismatchCount === 0,
        inventory: {
            candidates: candidates.length,
            applications: appCount,
            peopleWithAtLeastOneApp: peopleWithApps.length,
            peopleWithMultipleApps: multiApp,
        },
        verification: {
            missingApplication: missingApp,
            fieldMismatches: mismatchCount,
            reRunSafeHint: 'Running migrate again should skip all (alreadyHasApplication).',
        },
        mismatchSamples,
        matchedSample: matchSamples,
        richEvalSample: rich,
    };

    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    process.exit(report.ok ? 0 : 2);
}

main().catch(async (e) => {
    console.error(e);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
