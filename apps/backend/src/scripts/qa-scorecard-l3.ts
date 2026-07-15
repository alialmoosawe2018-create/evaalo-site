/**
 * L3 QA scorecard — Wave 1B + Wave 2 fixtures and Python runner.
 * Usage: npx tsx src/scripts/qa-scorecard-l3.ts
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_PACKS } from '../services/expertise/domainPacks.js';
import { WAVE_1B_PACK_VERSION } from '../services/expertise/wave1bDomainPacks.js';
import { WAVE_2_PACK_VERSION, WAVE_3_WAVE2_ENRICHED_KEYS } from '../services/expertise/wave2DomainPacks.js';
import { WAVE_3_ENRICHED_VERSION } from '../services/expertise/wave3EnrichedHelpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(
    __dirname,
    '../../../avatar-evaalov2/tests/fixtures/l3_pack_fixtures.json'
);
const AVATAR_ROOT = join(__dirname, '../../../avatar-evaalov2');

const WAVE_1B_KEYS = [
    'reservoir_engineer',
    'drilling_engineer',
    'civil_engineer',
    'site_engineer',
    'process_engineer',
] as const;

const WAVE_2_KEYS = [
    'frontend_developer',
    'devops_engineer',
    'data_analyst',
    'qa_engineer',
    'customer_support',
    'operations_coordinator',
    'accounts_payable',
    'financial_analyst',
    'internal_auditor',
] as const;

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function expectedPackVersion(packKey: string): string {
    if ((WAVE_1B_KEYS as readonly string[]).includes(packKey)) return WAVE_1B_PACK_VERSION;
    if (WAVE_3_WAVE2_ENRICHED_KEYS.has(packKey)) return WAVE_3_ENRICHED_VERSION;
    return WAVE_2_PACK_VERSION;
}

function testPackStructure(): void {
    for (const key of [...WAVE_1B_KEYS, ...WAVE_2_KEYS]) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key}`);
        assert(pack!.packVersion === expectedPackVersion(key), `${key} version`);
        assert((pack!.supportedExperienceTracks?.length ?? 0) >= 4, `${key} tracks`);
        assert((pack!.interviewPaths?.length ?? 0) >= 1, `${key} paths`);
        assert(pack!.competencies.length >= 4, `${key} competencies`);
        assert((pack!.terminology?.length ?? 0) >= 10, `${key} terminology`);
    }
}

function testFixturesFresh(): void {
    assert(existsSync(FIXTURES), `fixtures missing — run npm run export:l3-qa-fixtures`);
    const raw = JSON.parse(readFileSync(FIXTURES, 'utf8')) as {
        packCount: number;
        packs: Record<string, { packVersion: string }>;
    };
    assert(raw.packCount >= WAVE_1B_KEYS.length + WAVE_2_KEYS.length, 'fixture pack count');
    for (const key of [...WAVE_1B_KEYS, ...WAVE_2_KEYS]) {
        const p = raw.packs[key];
        assert(!!p, `fixture pack ${key}`);
        assert(p.packVersion === expectedPackVersion(key), `fixture ${key} version`);
    }
}

function runPythonScorecard(): void {
    execSync('uv run pytest tests/test_qa_scorecard_l3.py -q', {
        cwd: AVATAR_ROOT,
        stdio: 'inherit',
        env: process.env,
    });
}

function main(): void {
    testPackStructure();
    testFixturesFresh();
    runPythonScorecard();
    console.log('✅ qa-scorecard-l3: all passed');
}

main();
