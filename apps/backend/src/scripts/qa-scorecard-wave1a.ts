/**
 * Wave 1A QA scorecard — pack structure + Python scenario runner.
 * Usage: npx tsx src/scripts/qa-scorecard-wave1a.ts
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    DOMAIN_PACKS,
    WAVE_1A_PACK_VERSION,
} from '../services/expertise/domainPacks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(
    __dirname,
    '../../../avatar-evaalov2/tests/fixtures/wave1a_pack_fixtures.json'
);
const AVATAR_ROOT = join(__dirname, '../../../avatar-evaalov2');

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function testPackStructure(): void {
    for (const key of ['hr_recruiter', 'petroleum_engineer', 'survey_engineer'] as const) {
        const pack = DOMAIN_PACKS.find((p) => p.packKey === key);
        assert(!!pack, `pack ${key}`);
        assert(pack!.packVersion === WAVE_1A_PACK_VERSION, `${key} version`);
        assert((pack!.supportedExperienceTracks?.length ?? 0) >= 4, `${key} tracks`);
        assert((pack!.interviewPaths?.length ?? 0) >= 1, `${key} paths`);
        assert(pack!.competencies.length >= 4, `${key} competencies`);
        assert((pack!.terminology?.length ?? 0) >= 10, `${key} terminology`);
        for (const q of pack!.suggestedAnchorQuestions) {
            const marks = (q.match(/[؟?]/g) || []).length;
            assert(marks <= 1, `${key} anchor single ?: ${q}`);
        }
    }
}

function testFixturesFresh(): void {
    assert(existsSync(FIXTURES), `fixtures missing — run npm run export:wave1a-qa-fixtures`);
    const raw = JSON.parse(readFileSync(FIXTURES, 'utf8')) as {
        wave1aPackVersion: string;
        packs: Record<string, { packVersion: string; competencyCount: number }>;
    };
    assert(raw.wave1aPackVersion === WAVE_1A_PACK_VERSION, 'fixture version drift');
    for (const key of ['hr_recruiter', 'petroleum_engineer', 'survey_engineer']) {
        const p = raw.packs[key];
        assert(!!p, `fixture pack ${key}`);
        assert(p.packVersion === WAVE_1A_PACK_VERSION, `fixture ${key} version`);
    }
}

function runPythonScorecard(): void {
    execSync('uv run pytest tests/test_qa_scorecard_wave1a.py -q', {
        cwd: AVATAR_ROOT,
        stdio: 'inherit',
        env: process.env,
    });
}

function main(): void {
    testPackStructure();
    testFixturesFresh();
    runPythonScorecard();
    console.log('✅ qa-scorecard-wave1a: all passed');
}

main();
