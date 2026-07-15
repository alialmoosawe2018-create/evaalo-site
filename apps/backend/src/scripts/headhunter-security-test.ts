/**
 * Head Hunter security offline tests.
 * Run: npm run test:headhunter-security
 */
import assert from 'node:assert/strict';
import {
    assertHeadHunterCallbackAllowlistConfigured,
    assertHeadHunterCallbackOriginAllowed,
    assertHeadHunterWebhookConfigured,
    buildHeadHunterCallbackUrl,
    HEADHUNTER_ERROR,
    HeadHunterConfigurationError,
    isHeadHunterCallbackOriginAllowed,
    normalizeAgeRange,
    normalizeYearsOfExperience,
    parseHeadHunterCallbackAllowlist,
    resolveHeadHunterWebhookUrl,
    resolveSearchExperienceFilters,
} from '../services/headHunterSecurity.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isHeadHunterContextOwnedByOrganization,
} from '../services/headHunterSourcingContextService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCAL_ALLOWLIST = 'http://localhost:5000,http://127.0.0.1:5000';
const TAILSCALE_ALLOWLIST = 'http://100.73.82.78:5000';

function withEnv(
    patch: Record<string, string | undefined>,
    fn: () => void
): void {
    const previous: Record<string, string | undefined> = {};
    for (const key of Object.keys(patch)) {
        previous[key] = process.env[key];
        const value = patch[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        fn();
    } finally {
        for (const key of Object.keys(patch)) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
}

function testWebhookMissing(): void {
    withEnv({ N8N_HEADHUNTER_WEBHOOK_URL: '' }, () => {
        assert.equal(resolveHeadHunterWebhookUrl(), '');
        assert.throws(
            () => assertHeadHunterWebhookConfigured(),
            (err: unknown) =>
                err instanceof HeadHunterConfigurationError &&
                err.code === HEADHUNTER_ERROR.NOT_CONFIGURED
        );
    });
}

function testAllowlistMissing(): void {
    withEnv({ HEAD_HUNTER_CALLBACK_ALLOWLIST: '' }, () => {
        assert.deepEqual(parseHeadHunterCallbackAllowlist(), []);
        assert.throws(
            () => assertHeadHunterCallbackAllowlistConfigured(),
            (err: unknown) =>
                err instanceof HeadHunterConfigurationError &&
                err.code === HEADHUNTER_ERROR.CALLBACK_NOT_CONFIGURED
        );
    });
}

function testOriginDenied(): void {
    withEnv(
        {
            HEAD_HUNTER_CALLBACK_ALLOWLIST: LOCAL_ALLOWLIST,
            PUBLIC_API_URL: 'http://evil.example:5000',
        },
        () => {
            assert.equal(
                isHeadHunterCallbackOriginAllowed('http://evil.example:5000', LOCAL_ALLOWLIST),
                false
            );
            assert.throws(
                () => assertHeadHunterCallbackOriginAllowed('http://evil.example:5000', LOCAL_ALLOWLIST),
                (err: unknown) =>
                    err instanceof HeadHunterConfigurationError &&
                    err.code === HEADHUNTER_ERROR.CALLBACK_ORIGIN_DENIED
            );
        }
    );
}

function testOriginAllowed(): void {
    withEnv({ HEAD_HUNTER_CALLBACK_ALLOWLIST: LOCAL_ALLOWLIST }, () => {
        assert.equal(isHeadHunterCallbackOriginAllowed('http://localhost:5000', LOCAL_ALLOWLIST), true);
        const url = buildHeadHunterCallbackUrl(
            'http://localhost:5000',
            'headhunter_test-id',
            'a'.repeat(64),
            LOCAL_ALLOWLIST
        );
        assert.match(url, /^http:\/\/localhost:5000\/webhook\/n8n\/head-hunter\?/);
        assert.match(url, /searchId=headhunter_test-id/);
        assert.match(url, /token=/);
    });
}

function testTailscaleExplicitOnly(): void {
    withEnv({ HEAD_HUNTER_CALLBACK_ALLOWLIST: TAILSCALE_ALLOWLIST }, () => {
        assert.equal(
            isHeadHunterCallbackOriginAllowed('http://100.73.82.78:5000', TAILSCALE_ALLOWLIST),
            true
        );
        assert.equal(
            isHeadHunterCallbackOriginAllowed('http://100.64.99.1:5000', TAILSCALE_ALLOWLIST),
            false
        );
    });
}

function testOrgScope(): void {
    assert.equal(isHeadHunterContextOwnedByOrganization({ organizationId: 'org_a' }, 'org_a'), true);
    assert.equal(isHeadHunterContextOwnedByOrganization({ organizationId: 'org_a' }, 'org_b'), false);
    assert.equal(isHeadHunterContextOwnedByOrganization({ organizationId: '' }, 'org_a'), false);
}

function testNoPublicContextByIdRoute(): void {
    const routeSource = readFileSync(join(__dirname, '../routes/headHunter.ts'), 'utf8');
    assert.equal(routeSource.includes("'/public-role-context/:id'"), false);
    assert.equal(routeSource.includes('getPublicHeadHunterRoleContext'), false);
}

function testNormalizerEnumAndCustom(): void {
    const yearsEnum = resolveSearchExperienceFilters({ yearsOfExperience: '10+' });
    assert.equal(yearsEnum.ok, true);
    if (yearsEnum.ok) {
        assert.equal(yearsEnum.filters.yearsOfExperience, '10-plus');
        assert.deepEqual(yearsEnum.filters.optionalCriteriaExtras, {});
    }

    const yearsCustom = resolveSearchExperienceFilters({ yearsOfExperience: '8 years in HR' });
    assert.equal(yearsCustom.ok, true);
    if (yearsCustom.ok) {
        assert.equal(yearsCustom.filters.yearsOfExperience, undefined);
        assert.equal(yearsCustom.filters.optionalCriteriaExtras.yearsOfExperience, '8 years in HR');
    }

    const ageEnum = normalizeAgeRange('25-34');
    assert.equal(ageEnum.ok, true);
    if (ageEnum.ok && ageEnum.result) {
        assert.equal(ageEnum.result.kind, 'enum');
        assert.equal(ageEnum.result.value, '25-34');
    }
}

function testNormalizerRejectsUnsafe(): void {
    const empty = normalizeYearsOfExperience('   ');
    assert.equal(empty.ok, false);

    const html = normalizeAgeRange('<script>alert(1)</script>');
    assert.equal(html.ok, false);

    const json = normalizeYearsOfExperience('{"evil":true}');
    assert.equal(json.ok, false);

    const long = normalizeAgeRange('a'.repeat(81));
    assert.equal(long.ok, false);
}

function testNoSecretsInCallbackUrl(): void {
    withEnv({ HEAD_HUNTER_CALLBACK_ALLOWLIST: LOCAL_ALLOWLIST }, () => {
        const secret = 'super-secret-inbound-value';
        const url = buildHeadHunterCallbackUrl(
            'http://127.0.0.1:5000',
            'headhunter_abc',
            'callback-token-value',
            LOCAL_ALLOWLIST
        );
        assert.doesNotMatch(url, new RegExp(secret));
        assert.match(url, /token=/);
    });
}

function main(): void {
    testWebhookMissing();
    testAllowlistMissing();
    testOriginDenied();
    testOriginAllowed();
    testTailscaleExplicitOnly();
    testOrgScope();
    testNoPublicContextByIdRoute();
    testNormalizerEnumAndCustom();
    testNormalizerRejectsUnsafe();
    testNoSecretsInCallbackUrl();
    console.log('headhunter-security-test: all passed');
}

main();
