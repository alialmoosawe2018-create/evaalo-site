/**
 * Unified role-depth verification — all L3 waves + QA.
 * Usage: npx tsx src/scripts/verify-role-depth.ts
 */
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
const avatarRoot = join(__dirname, '../../../avatar-evaalov2');

const backendSteps = [
    'test:domain-packs-match',
    'test:blueprint-version',
    'test:taxonomy-l1',
    'test:taxonomy-l1-coverage',
    'test:wave-1a-packs',
    'test:wave-1b-packs',
    'test:wave-2-packs',
    'test:wave-3-packs',
    'test:wave-4-packs',
    'test:content-depth-unified',
    'test:phase-b-metadata',
    'test:bank-alignment-wave1a',
    'test:bank-alignment-wave1b',
    'test:bank-alignment-wave2',
    'export:l3-qa-fixtures',
    'test:qa-scorecard-l3',
];

function run(cmd: string, cwd: string): void {
    console.log(`\n▶ ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
}

function main(): void {
    for (const step of backendSteps) {
        run(`npm run ${step}`, backendRoot);
    }
    console.log('\n▶ pytest entity_policy + experience_tracks + qa_l3 + recruiter QA');
    execSync(
        'uv run pytest tests/test_entity_policy.py tests/test_experience_tracks.py tests/test_qa_scorecard_l3.py tests/test_qa_recruiter_active_question.py -q',
        { cwd: avatarRoot, stdio: 'inherit' }
    );
    console.log('\n✅ verify-role-depth: all steps passed');
}

main();
