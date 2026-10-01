// ============================================
// scripts/campaign-ad-saved-route-test.ts
// A job created with an ad keeps its ad.
//
// 2026-10-01: POST /api/recruitment-campaigns read the ad from `criteria` AFTER
// stripRubricAndTemplateKeysFromCriteria had removed it, so the ad was always
// undefined and no campaign ever stored one (0 of 68 in production). The new
// «Create Job» step creates the job WITH the ad the recruiter just generated, so
// the route has to keep it.
//
// LIFECYCLE: the real router on an in-memory database; the request bodies are
// built by the frontend's own builders (screening) or mirror buildCriteriaPayload
// (start process); the campaign is read back from the database.
// Run: npm run test:campaign-ad-saved — no external database, no network, no AI call.
// ============================================

process.env.BILLING_ENFORCE = 'false';
process.env.RBAC_ENFORCEMENT = 'off';
process.env.ENFORCE_AUTH = 'off';
// The route warms the interview blueprint in the background — never reach a model.
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
process.env.OPENAI_API_KEY = '';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
// The frontend's own builder for the AI-screening (form) flow — the exact body the page
// sends. Loaded from the real source with a computed specifier, as cv-file-types-test does.
const FRONTEND_SRC = new URL('../../../frontend/src/', import.meta.url).href;
const { buildScreeningCampaignCreateBody }: any = await import(`${FRONTEND_SRC}utils/screeningCampaignPayload.js`);

type Json = Record<string, any>;
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

const AD = '## HR Specialist\n\nSynthetic Company is hiring an HR Specialist in Baghdad.\n\n- Recruitment\n- Onboarding';

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const express = (await import('express')).default;
    const routes = (await import('../routes/recruitmentCampaigns.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const AuditLog = (await import('../models/AuditLog.js')).default;
    let created = 0;

    const app = express();
    app.use(express.json());
    app.use('/api/recruitment-campaigns', routes);
    let server: Server | null = null;
    try {
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const create = async (body: Json): Promise<Json> => {
            const res = await fetch(`${base}/api/recruitment-campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = (await res.json()) as Json;
            assert.equal(res.status < 300, true, `create failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
            assert.ok(json.campaignId, 'no campaignId');
            created += 1;
            const saved = await RecruitmentCampaign.findOne({ campaignId: json.campaignId }).lean();
            assert.ok(saved, 'campaign not in the database');
            return saved as Json;
        };

        // «Start process»: the wizard spreads buildCriteriaPayload() and adds the ad on top.
        const startProcess = (extra: Json = {}): Json => ({
            position: 'HR Specialist',
            experienceYears: '2-3',
            skills: 'Recruitment; Onboarding',
            interviewLanguage: 'en',
            language: 'en',
            ...extra,
        });

        await test('start process: the ad is stored with the job', async () => {
            const saved = await create(startProcess({ jobAdvertisement: AD }));
            assert.equal(saved.jobAdvertisement, AD);
        });

        await test('the ad is never a criterion (it must not be scored)', async () => {
            const saved = await create(startProcess({ jobAdvertisement: AD }));
            assert.equal('jobAdvertisement' in (saved.criteria || {}), false);
            assert.equal(saved.criteria.skills, 'Recruitment; Onboarding', 'the real criteria are kept');
        });

        await test('surrounding whitespace is trimmed', async () => {
            const saved = await create(startProcess({ jobAdvertisement: `\n  ${AD}  \n` }));
            assert.equal(saved.jobAdvertisement, AD);
        });

        await test('no ad, an empty ad or a whitespace-only ad stores no ad field', async () => {
            for (const extra of [{}, { jobAdvertisement: '' }, { jobAdvertisement: '   ' }, { jobAdvertisement: 42 }]) {
                const saved = await create(startProcess(extra));
                assert.equal(saved.jobAdvertisement, undefined, JSON.stringify(extra));
            }
        });

        await test('AI screening (form) flow — body from the frontend builder — stores the ad too', async () => {
            const body = buildScreeningCampaignCreateBody({
                jobDetails: { position: 'HR Specialist', experienceYears: '2-3' },
                selectedCriteria: { position: true, experienceYears: true },
                certificationRows: [''],
                skillRows: [''],
                languageRows: [''],
                aiCompareEmailRows: [''],
                customCriteria: [],
                essentialCriteria: {},
                formTemplateId: 'template-remote',
                jobAdvertisement: AD,
                language: 'en',
                interviewLanguage: 'en',
            });
            assert.equal(body.jobAdvertisement, AD, 'the builder sends the ad');
            const saved = await create(body);
            assert.equal(saved.jobAdvertisement, AD);
            assert.equal('jobAdvertisement' in (saved.criteria || {}), false);
        });
    } finally {
        if (server) await new Promise<void>((r) => server!.close(() => r()));
        // The route writes its audit row after it answers; let the last ones land so the
        // disconnect below does not cut one off mid-write (a harmless but noisy error).
        for (let i = 0; i < 50 && (await AuditLog.countDocuments({ action: 'campaign.created' })) < created; i += 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
        await mongoose.disconnect();
        await mongo.stop();
    }
    console.log(`\n[campaign-ad-saved] ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
