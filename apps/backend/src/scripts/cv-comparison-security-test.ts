/**
 * CV Comparison security offline tests.
 * Run: npm run test:cv-comparison-security
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import {
    assertCvComparisonCallbackAllowlistConfigured,
    assertCvComparisonCallbackOriginAllowed,
    assertCvComparisonOutboundReady,
    assertCvComparisonWebhookConfigured,
    buildCvComparisonCallbackUrl,
    CV_COMPARISON_ERROR,
    CvComparisonConfigurationError,
    cvComparisonConfigErrorResponse,
    generateCvComparisonCallbackToken,
    isCvComparisonCallbackOriginAllowed,
    parseCvComparisonCallbackAllowlist,
    resolveCvComparisonWebhookUrl,
    verifyCvComparisonCallbackToken,
    verifyCvComparisonInboundSecret,
} from '../services/cvComparisonSecurity.js';
import { buildCvComparisonIdempotencyKey } from '../services/webhookIdempotency.js';
import {
    clearCvComparisonRecordsForTests,
    postCvComparisonN8nInbound,
    seedCvComparisonRecordForTests,
    setCvComparisonInboundTestOverrides,
} from '../routes/cvComparison.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCAL_ALLOWLIST = 'http://localhost:5000,http://127.0.0.1:5000';
const INBOUND_SECRET = 'cv-comp-inbound-secret-test-value!!';
const CALLBACK_TOKEN = 'a'.repeat(64);

const BASE_ENV: Record<string, string> = {
    N8N_CV_COMPARISON_WEBHOOK_URL: 'https://n8n.example.test/webhook/cv-comparison',
    N8N_CV_COMPARISON_INBOUND_SECRET: INBOUND_SECRET,
    CV_COMPARISON_CALLBACK_ALLOWLIST: LOCAL_ALLOWLIST,
    PUBLIC_API_URL: 'http://localhost:5000',
};

function withEnv(patch: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
    const previous: Record<string, string | undefined> = {};
    for (const key of Object.keys(patch)) {
        previous[key] = process.env[key];
        const value = patch[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return Promise.resolve(fn()).finally(() => {
        for (const key of Object.keys(patch)) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    });
}

function withBaseEnv(fn: () => void | Promise<void>): Promise<void> {
    return withEnv(BASE_ENV, fn);
}

function mockReq(
    query: Record<string, string | undefined> = {},
    headers: Record<string, string | undefined> = {},
    body: Record<string, unknown> = {}
): Request {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) q[k] = v;
    }
    return { query: q, headers, body } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; jsonBody: unknown } {
    const res = {
        statusCode: 200,
        jsonBody: undefined as unknown,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: unknown) {
            this.jsonBody = body;
            return this;
        },
    };
    return res as Response & { statusCode: number; jsonBody: unknown };
}

async function testWebhookMissing(): Promise<void> {
    await withEnv({ N8N_CV_COMPARISON_WEBHOOK_URL: '' }, () => {
        assert.equal(resolveCvComparisonWebhookUrl(), '');
        assert.throws(
            () => assertCvComparisonWebhookConfigured(),
            (err: unknown) =>
                err instanceof CvComparisonConfigurationError &&
                err.code === CV_COMPARISON_ERROR.WEBHOOK_NOT_CONFIGURED
        );
        const resp = cvComparisonConfigErrorResponse(
            new CvComparisonConfigurationError(
                CV_COMPARISON_ERROR.WEBHOOK_NOT_CONFIGURED,
                'CV comparison webhook is not configured.'
            )
        );
        assert.equal(resp.status, 503);
        assert.equal(resp.body.error, CV_COMPARISON_ERROR.WEBHOOK_NOT_CONFIGURED);
    });
}

async function testInboundSecretMissingOnOutbound(): Promise<void> {
    await withEnv(
        {
            ...BASE_ENV,
            N8N_CV_COMPARISON_INBOUND_SECRET: '',
        },
        () => {
            assert.throws(
                () => assertCvComparisonOutboundReady(),
                (err: unknown) =>
                    err instanceof CvComparisonConfigurationError &&
                    err.code === CV_COMPARISON_ERROR.CALLBACK_SECRET_NOT_CONFIGURED
            );
        }
    );
}

async function testAllowlistMissing(): Promise<void> {
    await withEnv(
        {
            ...BASE_ENV,
            CV_COMPARISON_CALLBACK_ALLOWLIST: '',
        },
        () => {
            assert.deepEqual(parseCvComparisonCallbackAllowlist(), []);
            assert.throws(
                () => assertCvComparisonCallbackAllowlistConfigured(),
                (err: unknown) =>
                    err instanceof CvComparisonConfigurationError &&
                    err.code === CV_COMPARISON_ERROR.CALLBACK_NOT_CONFIGURED
            );
            assert.throws(
                () => assertCvComparisonOutboundReady(),
                (err: unknown) =>
                    err instanceof CvComparisonConfigurationError &&
                    err.code === CV_COMPARISON_ERROR.CALLBACK_NOT_CONFIGURED
            );
        }
    );
}

async function testOriginDenied(): Promise<void> {
    await withEnv(
        {
            CV_COMPARISON_CALLBACK_ALLOWLIST: LOCAL_ALLOWLIST,
            PUBLIC_API_URL: 'http://evil.example:5000',
        },
        () => {
            assert.equal(
                isCvComparisonCallbackOriginAllowed('http://evil.example:5000', LOCAL_ALLOWLIST),
                false
            );
            assert.throws(
                () => assertCvComparisonCallbackOriginAllowed('http://evil.example:5000', LOCAL_ALLOWLIST),
                (err: unknown) =>
                    err instanceof CvComparisonConfigurationError &&
                    err.code === CV_COMPARISON_ERROR.CALLBACK_ORIGIN_DENIED
            );
        }
    );
}

async function testLocalhostAllowedWhenExplicit(): Promise<void> {
    await withEnv({ CV_COMPARISON_CALLBACK_ALLOWLIST: LOCAL_ALLOWLIST }, () => {
        assert.equal(isCvComparisonCallbackOriginAllowed('http://localhost:5000', LOCAL_ALLOWLIST), true);
        const url = buildCvComparisonCallbackUrl(
            'http://localhost:5000',
            'cvcomp_test-id',
            CALLBACK_TOKEN,
            LOCAL_ALLOWLIST
        );
        assert.match(url, /^http:\/\/localhost:5000\/webhook\/n8n\/cv-comparison\?/);
        assert.match(url, /comparisonId=cvcomp_test-id/);
        assert.match(url, /token=/);
        assert.doesNotMatch(url, new RegExp(INBOUND_SECRET));
    });
}

async function testOutboundReady(): Promise<void> {
    await withBaseEnv(() => {
        const cfg = assertCvComparisonOutboundReady();
        assert.equal(cfg.webhookUrl, BASE_ENV.N8N_CV_COMPARISON_WEBHOOK_URL);
        assert.equal(cfg.inboundSecret, INBOUND_SECRET);
        assert.equal(cfg.publicApiBase, 'http://localhost:5000');
    });
}

async function testInvalidCallbackToken(): Promise<void> {
    await withBaseEnv(async () => {
        clearCvComparisonRecordsForTests();
        setCvComparisonInboundTestOverrides(null);
        seedCvComparisonRecordForTests({
            comparisonId: 'cvcomp_inbound_test',
            status: 'submitted',
            organizationId: 'org_test',
            userId: 'user_test',
            submittedAt: new Date().toISOString(),
            callbackToken: CALLBACK_TOKEN,
        });

        const req = mockReq(
            { comparisonId: 'cvcomp_inbound_test', token: 'wrong-token' },
            { 'x-cv-comparison-secret': INBOUND_SECRET },
            { ok: true }
        );
        const res = mockRes();
        await postCvComparisonN8nInbound(req, res);
        assert.equal(res.statusCode, 401);
    });
}

async function testInvalidInboundSecret(): Promise<void> {
    await withBaseEnv(async () => {
        clearCvComparisonRecordsForTests();
        setCvComparisonInboundTestOverrides(null);
        seedCvComparisonRecordForTests({
            comparisonId: 'cvcomp_secret_test',
            status: 'submitted',
            organizationId: 'org_test',
            userId: 'user_test',
            submittedAt: new Date().toISOString(),
            callbackToken: CALLBACK_TOKEN,
        });

        const req = mockReq(
            { comparisonId: 'cvcomp_secret_test', token: CALLBACK_TOKEN },
            { 'x-cv-comparison-secret': 'wrong-secret' },
            { ok: true }
        );
        const res = mockRes();
        await postCvComparisonN8nInbound(req, res);
        assert.equal(res.statusCode, 401);
    });
}

async function testInboundSecretNotConfigured(): Promise<void> {
    await withEnv(
        {
            ...BASE_ENV,
            N8N_CV_COMPARISON_INBOUND_SECRET: '',
        },
        async () => {
            clearCvComparisonRecordsForTests();
            seedCvComparisonRecordForTests({
                comparisonId: 'cvcomp_no_secret',
                status: 'submitted',
                organizationId: 'org_test',
                userId: 'user_test',
                submittedAt: new Date().toISOString(),
                callbackToken: CALLBACK_TOKEN,
            });

            const req = mockReq(
                { comparisonId: 'cvcomp_no_secret', token: CALLBACK_TOKEN },
                { 'x-cv-comparison-secret': INBOUND_SECRET },
                { ok: true }
            );
            const res = mockRes();
            await postCvComparisonN8nInbound(req, res);
            assert.equal(res.statusCode, 503);
            const body = res.jsonBody as { error?: string };
            assert.equal(body.error, CV_COMPARISON_ERROR.CALLBACK_SECRET_NOT_CONFIGURED);
        }
    );
}

function testIdempotencyKeyPriority(): void {
    const reqWithHeader = mockReq(
        { comparisonId: 'cvcomp_idem' },
        { 'x-idempotency-key': 'exec-123' },
        { ranking: [1, 2] }
    );
    assert.equal(
        buildCvComparisonIdempotencyKey(reqWithHeader, 'cvcomp_idem'),
        'cvcomp:exec-123'
    );

    const reqBody = mockReq({ comparisonId: 'cvcomp_idem' }, {}, { ranking: [1, 2] });
    const keyA = buildCvComparisonIdempotencyKey(reqBody, 'cvcomp_idem');
    const keyB = buildCvComparisonIdempotencyKey(reqBody, 'cvcomp_idem');
    assert.equal(keyA, keyB);
    assert.match(keyA, /^cvcomp:cvcomp_idem:hash:/);

    const reqOtherBody = mockReq({ comparisonId: 'cvcomp_idem' }, {}, { ranking: [3] });
    const keyC = buildCvComparisonIdempotencyKey(reqOtherBody, 'cvcomp_idem');
    assert.notEqual(keyA, keyC);
}

async function testDuplicateCallback(): Promise<void> {
    await withBaseEnv(async () => {
        clearCvComparisonRecordsForTests();
        setCvComparisonInboundTestOverrides({
            claimWebhook: async () => ({
                duplicate: true,
                record: { attemptCount: 2 } as never,
            }),
            completeWebhook: async () => undefined,
            failWebhook: async () => undefined,
        });

        seedCvComparisonRecordForTests({
            comparisonId: 'cvcomp_dup',
            status: 'submitted',
            organizationId: 'org_test',
            userId: 'user_test',
            submittedAt: new Date().toISOString(),
            callbackToken: CALLBACK_TOKEN,
        });

        const req = mockReq(
            { comparisonId: 'cvcomp_dup', token: CALLBACK_TOKEN },
            { 'x-cv-comparison-secret': INBOUND_SECRET },
            { ok: true }
        );
        const res = mockRes();
        await postCvComparisonN8nInbound(req, res);
        assert.equal(res.statusCode, 200);
        const body = res.jsonBody as { duplicate?: boolean };
        assert.equal(body.duplicate, true);

        setCvComparisonInboundTestOverrides(null);
    });
}

async function testSuccessfulInbound(): Promise<void> {
    await withBaseEnv(async () => {
        clearCvComparisonRecordsForTests();
        let claimCount = 0;
        setCvComparisonInboundTestOverrides({
            claimWebhook: async () => {
                claimCount += 1;
                return { duplicate: false, record: null };
            },
            completeWebhook: async () => undefined,
            failWebhook: async () => undefined,
        });

        seedCvComparisonRecordForTests({
            comparisonId: 'cvcomp_ok',
            status: 'submitted',
            organizationId: 'org_test',
            userId: 'user_test',
            submittedAt: new Date().toISOString(),
            callbackToken: CALLBACK_TOKEN,
        });

        const req = mockReq(
            { comparisonId: 'cvcomp_ok', token: CALLBACK_TOKEN },
            { 'x-cv-comparison-secret': INBOUND_SECRET },
            { ranking: [{ rank: 1 }] }
        );
        const res = mockRes();
        await postCvComparisonN8nInbound(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(claimCount, 1);
        const body = res.jsonBody as { duplicate?: boolean };
        assert.notEqual(body.duplicate, true);

        setCvComparisonInboundTestOverrides(null);
        clearCvComparisonRecordsForTests();
    });
}

function testTokenVerification(): void {
    const token = generateCvComparisonCallbackToken();
    assert.equal(verifyCvComparisonCallbackToken(token, token), true);
    assert.equal(verifyCvComparisonCallbackToken(token, 'wrong'), false);
    assert.equal(verifyCvComparisonInboundSecret(INBOUND_SECRET, INBOUND_SECRET), true);
    assert.equal(verifyCvComparisonInboundSecret(INBOUND_SECRET, 'nope'), false);
}

function testNoFetchWithoutConfig(): void {
    const routeSource = readFileSync(join(__dirname, '../routes/cvComparison.ts'), 'utf8');
    assert.match(routeSource, /assertCvComparisonOutboundReady\(\)/);
    const fetchIndex = routeSource.indexOf('await fetch(webhookUrl');
    const outboundIndex = routeSource.indexOf('assertCvComparisonOutboundReady');
    assert.ok(outboundIndex > 0 && fetchIndex > outboundIndex);
}

function testOptionalCriteriaPreserved(): void {
    const routeSource = readFileSync(join(__dirname, '../routes/cvComparison.ts'), 'utf8');
    for (const needle of [
        'parseOptionalCriteria',
        'optionalCriteria',
        'optionsPhrases',
        'optionsSummaryEn',
        'optionsSummaryAr',
        'requiredLanguages',
        'requiredSkills',
        'certifications',
        'company',
        'gender',
    ]) {
        assert.ok(routeSource.includes(needle), `missing ${needle} in cvComparison.ts`);
    }
}

function testNoHardcodedOriginsInSecurity(): void {
    const securitySource = readFileSync(
        join(__dirname, '../services/cvComparisonSecurity.ts'),
        'utf8'
    );
    assert.equal(securitySource.includes('api.evaalo.com'), false);
    assert.equal(securitySource.includes('100.73.82.78'), false);
    assert.equal(securitySource.includes('ALLOWED_CV_COMPARISON'), false);
}

function testCompareRouteNoSecretLogging(): void {
    const routeSource = readFileSync(join(__dirname, '../routes/cvComparison.ts'), 'utf8');
    assert.equal(routeSource.includes('callbackToken'), true);
    assert.doesNotMatch(routeSource, /console\.log\([^)]*callbackToken/);
    assert.doesNotMatch(routeSource, /console\.log\([^)]*inboundSecret/);
}

async function main(): Promise<void> {
    await testWebhookMissing();
    await testInboundSecretMissingOnOutbound();
    await testAllowlistMissing();
    await testOriginDenied();
    await testLocalhostAllowedWhenExplicit();
    await testOutboundReady();
    await testInvalidCallbackToken();
    await testInvalidInboundSecret();
    await testInboundSecretNotConfigured();
    testIdempotencyKeyPriority();
    await testDuplicateCallback();
    await testSuccessfulInbound();
    testTokenVerification();
    testNoFetchWithoutConfig();
    testOptionalCriteriaPreserved();
    testNoHardcodedOriginsInSecurity();
    testCompareRouteNoSecretLogging();
    console.log('cv-comparison-security-test: all passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
