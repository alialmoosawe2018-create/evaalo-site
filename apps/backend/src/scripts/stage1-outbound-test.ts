/**
 * Stage 1 outbound secure bundle wiring (offline, no network/n8n/MongoDB).
 * Run: npm run test:stage1-outbound
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { sendToN8N } from '../services/n8nService.js';
import {
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
} from '../services/stageCallbackAuth.js';

const CANDIDATE_ID = '507f1f77bcf86cd799439011';
const INBOUND_SECRET = 'test-inbound-secret-32-bytes-min!!!';
const SIGNING_SECRET = 'test-signing-secret-32-bytes-min!!';
const N8N_WEBHOOK = 'https://n8n.test.local/webhook/stage1-offline-test';

const CANDIDATE_STUB = {
    _id: CANDIDATE_ID,
    full_name: 'Stage1 Outbound Test',
    email: 'stage1-outbound-test@example.invalid',
    phone: '+10000000000',
    position_applied_for: 'Test Role',
    years_of_experience: '1',
};

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
            N8N_WEBHOOK_URL: N8N_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'required',
            N8N_STAGE_INBOUND_SECRET: INBOUND_SECRET,
            STAGE_CALLBACK_SIGNING_SECRET: SIGNING_SECRET,
            STAGE_CALLBACK_ALLOWLIST: 'http://localhost:5000',
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            const { restore, capture } = stubFetch();
            try {
                const ok = await sendToN8N(CANDIDATE_STUB);
                assert.equal(ok, true);
                assert.equal(capture.called, true);
                assert.ok(capture.body);
                assert.equal(typeof capture.body!.callbackUrl, 'string');
                assert.equal(typeof capture.body!.inboundSecret, 'string');
                assert.equal(capture.body!.inboundSecret, INBOUND_SECRET);

                const url = new URL(String(capture.body!.callbackUrl));
                assert.ok(url.pathname.endsWith('/webhook/n8n/stage1'));
                assert.equal(url.searchParams.get('mode'), 'stage1');
                assert.equal(url.searchParams.get('candidateId'), CANDIDATE_ID);
                assert.ok(url.searchParams.get('token'));
                assert.ok(url.searchParams.get('issuedAt'));
                assert.ok(url.searchParams.get('expiresAt'));
            } finally {
                restore();
            }
        }
    );
}

async function testRequiredModeMissingSecretsBlocksOutbound(): Promise<void> {
    await withEnv(
        {
            N8N_WEBHOOK_URL: N8N_WEBHOOK,
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
                    () => sendToN8N(CANDIDATE_STUB),
                    (err: unknown) => err instanceof StageCallbackConfigurationError
                );
                assert.equal(capture.called, false, 'n8n fetch must not run when required config is missing');
            } finally {
                restore();
            }
        }
    );
}

async function testOptionalModeMissingSecretsLegacyOutbound(): Promise<void> {
    await withEnv(
        {
            N8N_WEBHOOK_URL: N8N_WEBHOOK,
            STAGE_CALLBACK_SECURITY_MODE: 'optional',
            N8N_STAGE_INBOUND_SECRET: undefined,
            STAGE_CALLBACK_SIGNING_SECRET: undefined,
            STAGE_CALLBACK_ALLOWLIST: undefined,
            PUBLIC_API_URL: 'http://localhost:5000',
        },
        async () => {
            assert.doesNotThrow(() => assertStageOutboundSecurityForTrigger());

            const { restore, capture } = stubFetch();
            try {
                const ok = await sendToN8N(CANDIDATE_STUB);
                assert.equal(ok, true);
                assert.equal(capture.called, true);
                assert.ok(capture.body);
                // Optional + no secrets: legacy outbound — no secure callback fields appended.
                assert.equal(capture.body!.callbackUrl, undefined);
                assert.equal(capture.body!.inboundSecret, undefined);
                assert.equal(capture.body!.evaluationSource, 'written');
                assert.equal(capture.body!.stage, 1);
            } finally {
                restore();
            }
        }
    );
}

async function main(): Promise<void> {
    await testRequiredModeIncludesSecureBundle();
    console.log('✓ required mode + test secrets → callbackUrl + inboundSecret on Stage 1 payload');

    await testRequiredModeMissingSecretsBlocksOutbound();
    console.log('✓ required mode + missing secrets → outbound rejected, fetch not invoked');

    await testOptionalModeMissingSecretsLegacyOutbound();
    console.log('✓ optional mode + missing secrets → legacy outbound (no callbackUrl/inboundSecret)');

    console.log('  ↳ structured three-bucket payload: npm run test:stage1-structured-payload');

    console.log('\nstage1-outbound-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
