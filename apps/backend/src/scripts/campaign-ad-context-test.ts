// ============================================
// scripts/campaign-ad-context-test.ts
// A stored job ad does not steer interviews unless CAMPAIGN_AD_AS_INTERVIEW_CONTEXT=true.
//
// 2026-10-01: campaigns start keeping their ad (the create route used to drop it), and
// three interview paths already read it — the voice interviewer's role context, the
// video agent's role_context, and the competency blueprint generator. None of them has
// ever run with an ad, and the ad is model-written. services/campaignAdContext.ts keeps
// them as they were; this test holds that.
//
// LIFECYCLE: the real ensureBlueprintForCampaign on an in-memory database, with the
// OpenAI SDK pointed at a local fake server that records what the model would be sent.
// A positive control (switch on) proves the fake server would see the ad if it leaked.
// Run: npm run test:campaign-ad-context — no external database, no network, no AI call.
// ============================================

process.env.BILLING_ENFORCE = 'false';
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'true';
// A fake key: even if a request escaped the fake server it could not reach a real model.
process.env.OPENAI_API_KEY = 'sk-test-campaign-ad-context';
delete process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/** Every non-script source file that mentions the ad, reviewed 2026-10-01. A new one
 *  must be looked at: if it feeds an interview or an evaluation, it goes through
 *  campaignAdForInterviewContext. */
const REVIEWED_AD_FILES = [
    'evaalo-only-voice/voiceSessionCore.ts', // interview — through the switch
    'models/RecruitmentCampaign.ts', // the field
    'routes/recruitmentCampaigns.ts', // stores, shows and generates the ad
    'routes/videoInterview.ts', // interview — through the switch
    'services/evaluationRubricService.ts', // keeps it out of the criteria
    'services/expertise/blueprintGenerator.ts', // receives it from ensureBlueprint
    'services/expertise/ensureBlueprint.ts', // interview — through the switch
    'services/headHunterCompetencyModel.ts', // a search query, not a campaign ad
    'services/llmService.ts', // prompt builders; the ad arrives as a parameter
    'services/n8nService.ts', // passes on what the voice session gives it
    'shared/formTemplates/rubric.ts', // keeps it out of the rubric
];

/** The interview readers and how many campaign reads each one routes through the switch. */
const INTERVIEW_READERS: Record<string, number> = {
    'evaalo-only-voice/voiceSessionCore.ts': 1,
    'routes/videoInterview.ts': 2,
    'services/expertise/ensureBlueprint.ts': 1,
};

function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'scripts' || entry.name === 'node_modules') continue;
            out.push(...listSourceFiles(full));
        } else if (/\.(ts|js)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

async function main(): Promise<void> {
    const { campaignAdForInterviewContext } = await import('../services/campaignAdContext.js');

    await test('the switch is off unless set to exactly "true"', () => {
        delete process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT;
        assert.equal(campaignAdForInterviewContext('An ad'), undefined);
        for (const v of ['false', 'TRUE', '1', 'yes', '']) {
            process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT = v;
            assert.equal(campaignAdForInterviewContext('An ad'), undefined, `value ${JSON.stringify(v)}`);
        }
        process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT = 'true';
        assert.equal(campaignAdForInterviewContext('An ad'), 'An ad');
        assert.equal(campaignAdForInterviewContext(''), undefined);
        assert.equal(campaignAdForInterviewContext('   '), undefined);
        assert.equal(campaignAdForInterviewContext(42), undefined);
        assert.equal(campaignAdForInterviewContext(undefined), undefined);
        delete process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT;
    });

    await test('every source file that mentions the ad has been reviewed', () => {
        const found = listSourceFiles(SRC)
            .filter((f) => fs.readFileSync(f, 'latin1').includes('jobAdvertisement'))
            .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
            .sort();
        const unreviewed = found.filter((f) => !REVIEWED_AD_FILES.includes(f));
        assert.deepEqual(unreviewed, [], `new reader(s) of the ad — review them: ${unreviewed.join(', ')}`);
    });

    await test('every interview reader takes the campaign ad through the switch', () => {
        for (const [rel, expectedCalls] of Object.entries(INTERVIEW_READERS)) {
            const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
            const reads = [...text.matchAll(/(?:\(camp as any\)|\bcamp|\bcampaign)\.jobAdvertisement\b/g)];
            assert.equal(reads.length, expectedCalls, `${rel}: expected ${expectedCalls} campaign read(s), found ${reads.length}`);
            for (const m of reads) {
                const before = text.slice(Math.max(0, (m.index ?? 0) - 'campaignAdForInterviewContext('.length), m.index);
                assert.equal(before, 'campaignAdForInterviewContext(', `${rel}: a raw campaign ad read: …${text.slice((m.index ?? 0) - 40, (m.index ?? 0) + 30)}…`);
            }
        }
    });

    // ── Lifecycle: what the blueprint model is sent ─────────────────────────────
    const sent: string[] = [];
    const fake = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            sent.push(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    id: 'chatcmpl-fake',
                    object: 'chat.completion',
                    created: 0,
                    model: 'fake',
                    choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                })
            );
        });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;

    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    try {
        const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
        const { ensureBlueprintForCampaign } = await import('../services/expertise/ensureBlueprint.js');

        const runBlueprint = async (campaignId: string, position: string, marker: string): Promise<string[]> => {
            await RecruitmentCampaign.create({
                campaignId,
                organizationId: 'org_test_ad_context',
                createdByClerkUserId: 'user_test_ad_context',
                criteria: { position, skills: 'Hive inspection; Honey extraction' },
                jobAdvertisement: `${position}\n\nKey Responsibilities:\n- ${marker}`,
                interviewLanguage: 'en',
            });
            const before = sent.length;
            try {
                await ensureBlueprintForCampaign(campaignId);
            } catch {
                /* the fake reply is not a blueprint — only the request matters here */
            }
            return sent.slice(before);
        };

        await test('switch off (production default): the blueprint model is NOT sent the ad', async () => {
            delete process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT;
            const marker = 'ZQX-AD-MARKER-OFF';
            const requests = await runBlueprint('c'.repeat(32), 'Synthetic Apiary Coordinator', marker);
            assert.ok(requests.length >= 1, 'the generator never reached the model — this test would prove nothing');
            assert.ok(
                requests.some((r) => r.includes('Synthetic Apiary Coordinator')),
                'the job itself is not in what the model is sent'
            );
            assert.equal(requests.some((r) => r.includes(marker)), false, 'the ad reached the blueprint model');
        });

        await test('positive control — switch on: the same path DOES send the ad', async () => {
            process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT = 'true';
            const marker = 'ZQX-AD-MARKER-ON';
            const requests = await runBlueprint('d'.repeat(32), 'Synthetic Apiary Supervisor', marker);
            delete process.env.CAMPAIGN_AD_AS_INTERVIEW_CONTEXT;
            assert.ok(requests.some((r) => r.includes(marker)), 'the ad did not arrive even with the switch on');
        });
    } finally {
        await mongoose.disconnect();
        await mongo.stop();
        await new Promise<void>((r) => fake.close(() => r()));
    }

    console.log(`\n[campaign-ad-context] ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
