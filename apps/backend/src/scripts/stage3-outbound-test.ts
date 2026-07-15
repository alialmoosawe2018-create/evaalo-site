/**
 * Stage 3 outbound secure bundle wiring (offline, no network/n8n/MongoDB).
 * Run: npm run test:stage3-outbound
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { sendVideoTranscriptToN8N } from '../services/n8nService.js';
import {
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
} from '../services/stageCallbackAuth.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = 'video-sess-offline-test-001';
const INBOUND_SECRET = 'test-inbound-secret-32-bytes-min!!!';
const SIGNING_SECRET = 'test-signing-secret-32-bytes-min!!';
const N8N_VIDEO_WEBHOOK = 'https://n8n.test.local/webhook/stage3-video-offline';

const CONVERSATION = [
    { role: 'assistant' as const, content: 'Describe your approach to prioritization.' },
    { role: 'user' as const, content: 'I rank tasks by impact and urgency.' },
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
            N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL: N8N_VIDEO_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVideoTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    campaignId: 'camp-offline-test',
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.equal(capture.called, true);
                assert.ok(capture.body);
                assert.equal(capture.body!.evaluationSource, 'video');
                assert.equal(capture.body!.sessionId, SESSION_ID);
                assert.equal(typeof capture.body!.callbackUrl, 'string');
                assert.equal(typeof capture.body!.inboundSecret, 'string');
                assert.equal(capture.body!.inboundSecret, INBOUND_SECRET);

                const url = new URL(String(capture.body!.callbackUrl));
                assert.ok(url.pathname.endsWith('/webhook/n8n/stage3'));
                assert.equal(url.searchParams.get('mode'), 'stage3');
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
            N8N_PUBLIC_VIDEO_SCREENING_WEBHOOK_URL: 'https://n8n.test.local/webhook/public-video-screening',
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVideoTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    campaignId: 'camp-public',
                    mode: 'public',
                    jobCriteria: { leadership: 'strong' },
                    blueprintSnapshot: { version: 1 },
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.ok(capture.body);
                assert.equal(capture.body!.source, 'public_screening');
                assert.equal(capture.body!.campaignId, 'camp-public');
                assert.ok(capture.body!.jobCriteria);
                assert.ok(capture.body!.blueprintSnapshot);
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
            N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL: N8N_VIDEO_WEBHOOK,
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
                        sendVideoTranscriptToN8N({
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
            N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL: N8N_VIDEO_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
            STAGE_CALLBACK_ALLOWLIST: undefined,
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendVideoTranscriptToN8N({
                    sessionId: SESSION_ID,
                    candidateId: CANDIDATE_ID,
                    conversationHistory: CONVERSATION,
                });
                assert.equal(ok, true);
                assert.equal(capture.called, true);
                assert.ok(capture.body);
                assert.equal(capture.body!.callbackUrl, undefined);
                assert.equal(capture.body!.inboundSecret, undefined);
                assert.equal(capture.body!.evaluationSource, 'video');
            } finally {
                restore();
            }
        }
    );
}

async function main(): Promise<void> {
    await testRequiredModeIncludesSecureBundle();
    console.log('✓ required mode → callbackUrl + inboundSecret + sessionId on Stage 3 video payload');

    await testPublicScreeningPreservesExtraFields();
    console.log('✓ public_screening fields preserved alongside secure bundle');

    await testRequiredModeMissingSecretsBlocksOutbound();
    console.log('✓ required mode + missing secrets → outbound rejected');

    await testOptionalModeMissingSecretsLegacyOutbound();
    console.log('✓ optional mode + missing secrets → legacy outbound');

    console.log('\nstage3-outbound-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
