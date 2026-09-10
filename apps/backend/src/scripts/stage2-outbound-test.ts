/**
 * Stage 2 outbound secure bundle wiring (offline, no network/n8n/MongoDB).
 * Run: npm run test:stage2-outbound
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { sendVoiceTranscriptToN8N } from '../services/n8nService.js';
import {
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
} from '../services/stageCallbackAuth.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = 'voice-sess-offline-test-001';
const INBOUND_SECRET = 'test-inbound-secret-32-bytes-min!!!';
const SIGNING_SECRET = 'test-signing-secret-32-bytes-min!!';
const N8N_VOICE_WEBHOOK = 'https://n8n.test.local/webhook/stage2-voice-offline';

const CONVERSATION = [
    { role: 'assistant' as const, content: 'Tell me about your experience.' },
    { role: 'user' as const, content: 'I have five years in customer support.' },
];

function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        prev[key] = process.env[key];
        const val = overrides[key];
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
    }
    const origDotenvConfig = dotenv.config;
    dotenv.config = (() => ({ parsed: {} })) as typeof dotenv.config;
    return Promise.resolve(fn()).finally(() => {
        dotenv.config = origDotenvConfig;
        for (const key of Object.keys(overrides)) {
            const val = prev[key];
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    });
}

type FetchCapture = { called: boolean; body: Record<string, unknown> | null };

function stubFetch(): { restore: () => void; capture: FetchCapture } {
    const capture: FetchCapture = { called: false, body: null };
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
        capture.called = true;
        if (typeof init?.body === 'string') {
            capture.body = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response('ok', { status: 200 });
    }) as typeof fetch;
    return { restore: () => { globalThis.fetch = orig; }, capture };
}

async function testRequiredModeIncludesSecureBundle(): Promise<void> {
    await withEnv(
        {
            N8N_VOICE_TRANSCRIPT_WEBHOOK_URL: N8N_VOICE_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVoiceTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    campaignId: 'camp-offline-test',
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.equal(capture.called, true);
                assert.ok(capture.body);
                assert.equal(capture.body!.evaluationSource, 'voice');
                assert.equal(capture.body!.sessionId, SESSION_ID);
                assert.equal(typeof capture.body!.callbackUrl, 'string');
                assert.equal(typeof capture.body!.inboundSecret, 'string');
                assert.equal(capture.body!.inboundSecret, INBOUND_SECRET);

                const url = new URL(String(capture.body!.callbackUrl));
                assert.ok(url.pathname.endsWith('/webhook/n8n/stage2'));
                assert.equal(url.searchParams.get('mode'), 'stage2');
                assert.equal(url.searchParams.get('candidateId'), CANDIDATE_ID);
                assert.equal(url.searchParams.get('sessionId'), SESSION_ID);
                assert.ok(url.searchParams.get('token'));
            } finally {
                restore();
            }
        }
    );
}

async function testPublicScreeningPreservesExtraFields(): Promise<void> {
    await withEnv(
        {
            N8N_PUBLIC_SCREENING_WEBHOOK_URL: 'https://n8n.test.local/webhook/public-screening',
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVoiceTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    campaignId: 'camp-public',
                    mode: 'public',
                    jobCriteria: { communication: 'strong' },
                    jobAdvertisement: 'Join our team',
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.ok(capture.body);
                assert.equal(capture.body!.source, 'public_screening');
                assert.equal(capture.body!.campaignId, 'camp-public');
                assert.ok(capture.body!.jobCriteria);
                assert.equal(capture.body!.jobAdvertisement, 'Join our team');
                assert.equal(typeof capture.body!.callbackUrl, 'string');
            } finally {
                restore();
            }
        }
    );
}

async function testRequiredModeMissingSecretsBlocksOutbound(): Promise<void> {
    await withEnv(
        {
            N8N_VOICE_TRANSCRIPT_WEBHOOK_URL: N8N_VOICE_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
            STAGE_CALLBACK_ALLOWLIST: undefined,
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            assert.throws(() => assertStageOutboundSecurityForTrigger(), StageCallbackConfigurationError);

            const { restore, capture } = stubFetch();
            try {
                await assert.rejects(
                    () =>
                        sendVoiceTranscriptToN8N({
                            sessionId: SESSION_ID,
                            candidateId: CANDIDATE_ID,
                            conversationHistory: CONVERSATION,
                        }),
                    (err: unknown) => err instanceof StageCallbackConfigurationError
                );
                assert.equal(capture.called, false);
            } finally {
                restore();
            }
        }
    );
}

async function testOptionalModeMissingSecretsLegacyOutbound(): Promise<void> {
    await withEnv(
        {
            N8N_VOICE_TRANSCRIPT_WEBHOOK_URL: N8N_VOICE_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
            STAGE_CALLBACK_ALLOWLIST: undefined,
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVoiceTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.equal(capture.called, true);
                assert.ok(capture.body);
                assert.equal(capture.body!.callbackUrl, undefined);
                assert.equal(capture.body!.inboundSecret, undefined);
                assert.equal(capture.body!.evaluationSource, 'voice');
            } finally {
                restore();
            }
        }
    );
}

/**
 * The shared-link path must carry the job too.
 *
 * ⚠️ 2026-09-10, measured over 16 real Stage 2 interviews and a perfect 16/16
 * split: the 10 started from a public link carried `jobCriteria`; the 6 that came
 * from the form → shared-link path carried NONE. `sessionMode` is set only by
 * `?mode=public` on the URL, and `buildCandidateInterviewQuery` — which builds
 * every link HR shares from the stage pages — never sets it, so
 * `loadPublicCampaignContext()` was never called for them.
 *
 * They were not merely SCORED without the job; they were CONDUCTED without it,
 * because jobCriteria also feeds question selection. Two of them came back with
 * byte-identical seven-label ratings.
 *
 * The sender was never the problem — this pins that: no `mode: 'public'`, and the
 * job must still reach the payload.
 */
async function testSharedLinkPathStillCarriesTheJob(): Promise<void> {
    await withEnv(
        {
            // ⚠️ The non-public path resolves N8N_VOICE_TRANSCRIPT_WEBHOOK_URL, then
            // falls back to N8N_WEBHOOK_URL. Both are pinned here: setting only the
            // public one let this test fall through to whatever the real .env holds,
            // and it logged the LIVE production webhook. The fetch stub caught it, so
            // nothing was sent — but an offline test must never be one stub away from
            // posting to production.
            N8N_VOICE_TRANSCRIPT_WEBHOOK_URL: N8N_VOICE_WEBHOOK,
            N8N_WEBHOOK_URL: N8N_VOICE_WEBHOOK,
            N8N_PUBLIC_SCREENING_WEBHOOK_URL: N8N_VOICE_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVoiceTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    campaignId: 'camp-from-form',
                    // NO mode: 'public' — this is the form → shared-link path.
                    jobCriteria: { position: 'Senior Petroleum Engineer', roleKey: 'petroleum_engineer' },
                    jobAdvertisement: 'Drilling operations, Basra',
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.ok(capture.body, 'no payload captured');
                assert.notEqual(capture.body!.source, 'public_screening');
                assert.ok(
                    capture.body!.jobCriteria,
                    'jobCriteria must reach Stage 2 even when the session is not public — ' +
                        'without it the evaluator judges role fit against a job it was never told'
                );
                assert.equal(
                    (capture.body!.jobCriteria as Record<string, unknown>).position,
                    'Senior Petroleum Engineer'
                );
                assert.equal(capture.body!.jobAdvertisement, 'Drilling operations, Basra');
            } finally {
                restore();
            }
        }
    );
}

/**
 * A source guard, deliberately, and the only honest way to pin this one.
 *
 * The actual regression lives inside the WebSocket session handler in
 * `voiceSessionCore.ts`, which cannot be unit-tested without standing up a live
 * socket, a campaign and a candidate. What CAN be pinned is the invariant that
 * was broken: loading the campaign must never again depend on `sessionMode`.
 * "Is this a public session?" is a question about origin and permissions;
 * "should we load the campaign?" is a question about context, and the answer to
 * the second is always yes when a campaign is resolvable.
 */
async function testCampaignContextIsNotGatedOnPublicMode(): Promise<void> {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../evaalo-only-voice/voiceSessionCore.ts', import.meta.url));
    const src = readFileSync(path, 'utf8');

    const loadCalls = [...src.matchAll(/loadPublicCampaignContext\(\)/g)];
    assert.ok(loadCalls.length > 0, 'loadPublicCampaignContext is never called');

    for (const m of loadCalls) {
        const before = src.slice(Math.max(0, m.index! - 200), m.index!);
        assert.ok(
            !/sessionMode\s*===\s*"public"\s*\r?\n?\s*\?[^?]*$/.test(before),
            'the campaign context load is gated on sessionMode === "public" again — ' +
                'that gate is what left the entire form → shared-link path running blind'
        );
    }

    assert.ok(
        /applyPublicCampaignContext\(await campaignContextPromise\)/.test(src),
        'the transcript send path must re-apply the campaign context unconditionally'
    );
    assert.ok(
        !/if \(sessionMode === "public"\) \{\s*const ctx = /.test(src),
        'the send path is gated on mode=public again'
    );
}

async function main(): Promise<void> {
    await testRequiredModeIncludesSecureBundle();
    console.log('✓ required mode → callbackUrl + inboundSecret + sessionId on Stage 2 voice payload');

    await testPublicScreeningPreservesExtraFields();
    console.log('✓ public_screening fields preserved alongside secure bundle');

    await testRequiredModeMissingSecretsBlocksOutbound();
    console.log('✓ required mode + missing secrets → outbound rejected');

    await testOptionalModeMissingSecretsLegacyOutbound();
    console.log('✓ optional mode + missing secrets → legacy outbound');

    await testSharedLinkPathStillCarriesTheJob();
    console.log('✓ non-public (form → shared link) session still carries jobCriteria');

    await testCampaignContextIsNotGatedOnPublicMode();
    console.log('✓ campaign context load is not gated on mode=public');

    console.log('\nstage2-outbound-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
