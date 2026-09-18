/**
 * The LAST hop before the scorer may not invent a blueprint.
 *
 * `sendVideoTranscriptToN8N` is the final piece of code an interview passes
 * through on its way to Stage 3. Until 2026-09-18 it rebuilt the blueprint from
 * the campaign whenever the caller handed it none — so removing the same
 * recovery from the `/end` route bought nothing at all: the back door stayed
 * open one module downstream.
 *
 * Caught live on 2026-09-18 at 12:13Z. A retired blind prewarm session — one
 * with no session row in the database whatsoever — reached this function, was
 * handed 10 recovered competencies, and produced a SECOND Stage 3 evaluation
 * (0 / Reject) for an interview it never conducted:
 *
 *     [n8n video] recovered blueprint snapshot for campaign e8efdd0… (10 competencies)
 *     [n8n video] payload | mode=screening … blueprintCompetencies=10
 *
 * ⚠️ Why this test needs a real database. The obvious version of it — call the
 * sender with no snapshot and assert none comes out — is DEAD against the buggy
 * code: with no mongo connection the recovery lookup simply throws, gets caught,
 * and the test passes while the defect sits untouched. The campaign's blueprint
 * must genuinely be there and genuinely be findable, so that code which wants to
 * reach for it succeeds. Verified by mutation: restoring the old block turns the
 * first case red.
 *
 * Companion to the source detector (`blueprint-pin-invariant`), which proves the
 * code is absent; this proves the effect is absent.
 *
 * Run: npm run test:blueprint-no-recovery-at-send
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import InterviewBlueprint from '../models/InterviewBlueprint.js';
import { sendVideoTranscriptToN8N } from '../services/n8nService.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const CAMPAIGN_ID = 'camp-no-recovery-001';
const WEBHOOK = 'https://n8n.test.local/webhook/no-recovery';

const CONVERSATION = [
    { role: 'assistant' as const, content: 'حدثني عن خبرتك.' },
    { role: 'user' as const, content: 'اشتغلت على إعادة هيكلة فريق الموارد البشرية.' },
];

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

type Capture = { called: boolean; body: Record<string, unknown> | null };

function stubFetch(): { restore: () => void; capture: Capture } {
    const capture: Capture = { called: false, body: null };
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
        capture.called = true;
        if (typeof init?.body === 'string') {
            capture.body = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response('ok', { status: 200 });
    }) as typeof fetch;
    return {
        restore: () => {
            globalThis.fetch = orig;
        },
        capture,
    };
}

function competency(i: number) {
    return {
        competencyKey: `c${i}`,
        title: `كفاءة ${i}`,
        questionObjective: 'هدف',
        expectedEvidence: ['دليل'],
        redFlags: [],
        followUpRules: [],
        priority: 'high',
    };
}

/** How many competencies actually reached the scorer. */
function sentCompetencies(body: Record<string, unknown> | null): number | null {
    const snap = body?.blueprintSnapshot as { competencies?: unknown } | undefined;
    if (!snap) return null;
    return Array.isArray(snap.competencies) ? snap.competencies.length : 0;
}

async function send(
    sessionId: string,
    blueprintSnapshot?: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
    const { restore, capture } = stubFetch();
    try {
        const ok = await sendVideoTranscriptToN8N({
            sessionId,
            candidateId: CANDIDATE_ID,
            campaignId: CAMPAIGN_ID,
            conversationHistory: CONVERSATION,
            ...(blueprintSnapshot ? { blueprintSnapshot } : {}),
        });
        assert.equal(ok, true, 'the transcript must still be sent');
        assert.ok(capture.called, 'the webhook must be called');
        return capture.body;
    } finally {
        restore();
    }
}

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    delete process.env.VIDEO_INTERVIEW_USE_BLUEPRINT;
    process.env.N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL = WEBHOOK;
    process.env.STAGE_CALLBACK_SECURITY_MODE = 'optional';
    // The sender re-reads .env on every call; keep it off our environment.
    dotenv.config = (() => ({ parsed: {} })) as typeof dotenv.config;

    // The campaign's blueprint is REAL and findable — that is the whole point.
    await InterviewBlueprint.create({
        blueprintId: 'bp-no-recovery',
        profileId: 'prof-no-recovery',
        campaignId: CAMPAIGN_ID,
        status: 'locked',
        lockedAt: new Date(),
        language: 'ar',
        anchorQuestions: ['سؤال؟'],
        competencies: Array.from({ length: 10 }, (_, i) => competency(i)),
    });
    console.log('[no-recovery-at-send] campaign blueprint locked with 10 competencies\n');

    await test('🔴 a session with NO pin sends NO competencies, though the campaign has 10', async () => {
        const body = await send('video-sess-unpinned');
        assert.equal(
            sentCompetencies(body),
            null,
            'the campaign blueprint was recovered and shipped — the candidate is being ' +
                'graded on competencies the interview never asked about'
        );
    });

    await test('…and the transcript still reaches the scorer (we drop the blueprint, not the interview)', async () => {
        const body = await send('video-sess-unpinned-2');
        assert.ok(body, 'a body must be sent');
        assert.equal(body!.stage, 3);
        assert.ok(String(body!.fullTranscript || '').length > 0, 'the transcript must survive');
    });

    await test('a pinned snapshot IS forwarded (the sender is not just dropping the field)', async () => {
        const pinned = { competencies: [competency(0), competency(1)] };
        const body = await send('video-sess-pinned', pinned);
        assert.equal(sentCompetencies(body), 2);
    });

    await test('🔴 the PIN wins over a richer campaign blueprint — 2 pinned, 10 locked', async () => {
        // The historical truth of the interview, not the best blueprint available now.
        const pinned = { competencies: [competency(0), competency(1)] };
        const body = await send('video-sess-partial', pinned);
        assert.equal(
            sentCompetencies(body),
            2,
            'the pin was topped up from the campaign — the past was rewritten'
        );
    });

    await test('⚠️ an EMPTY pin is not a licence to go and find a better one', async () => {
        const body = await send('video-sess-empty', {});
        assert.equal(sentCompetencies(body), null);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
