/**
 * S5 test matrix runner — executes all dynamic-rubric offline tests.
 * Run: npm run test:dynamic-rubric-s5
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', '..');

const S5_SCRIPTS: Array<{ name: string; script: string; matrix: string[] }> = [
    {
        name: 'form-template-service',
        script: 'test:form-template-service',
        matrix: ['Registry baseline', 'Snapshot hash'],
    },
    {
        name: 'application-submit-validation',
        script: 'test:application-submit-validation',
        matrix: ['POST field not in snapshot', 'Missing required field', 'CV validation'],
    },
    {
        name: 'form-template-immutability',
        script: 'test:form-template-immutability',
        matrix: [
            'Registry change after campaign created',
            'Legacy campaign without formBinding',
            'firstCandidateAt lock',
            'Custom criterion without expectation',
            'Duplicate label',
        ],
    },
    {
        name: 'dynamic-rubric-public-security',
        script: 'test:dynamic-rubric-public-security',
        matrix: ['pub token random', 'No internal data leak in form-config'],
    },
    {
        name: 'stage1-structured-payload',
        script: 'test:stage1-structured-payload',
        matrix: ['Three-bucket n8n payload', 'submittedApplication vs availableFieldIds'],
    },
    {
        name: 'stage1-evaluation-outbox',
        script: 'test:stage1-evaluation-outbox',
        matrix: [
            'n8n retry idempotency key',
            'insufficient_evidence',
            'Prompt injection guardrails',
        ],
    },
    {
        name: 'stage1-outbound',
        script: 'test:stage1-outbound',
        matrix: ['Stage 1 outbound secure bundle (legacy flat + callback)'],
    },
    {
        name: 'stage1-inbound',
        script: 'test:stage1-inbound',
        matrix: ['Stage 1 inbound idempotency', 'rubricResults persistence path'],
    },
];

function runNpmScript(script: string): { ok: boolean; output: string } {
    const result = spawnSync('npm', ['run', script], {
        cwd: backendRoot,
        encoding: 'utf8',
        shell: true,
        env: process.env,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    return { ok: result.status === 0, output };
}

function main() {
    console.log('Dynamic Rubric S5 — offline test matrix\n');
    const failed: string[] = [];

    for (const entry of S5_SCRIPTS) {
        process.stdout.write(`▶ ${entry.name} … `);
        const { ok, output } = runNpmScript(entry.script);
        if (ok) {
            console.log('OK');
        } else {
            console.log('FAILED');
            failed.push(entry.name);
            console.log(output.trim());
        }
    }

    console.log('\n--- S5 matrix coverage (offline) ---');
    for (const entry of S5_SCRIPTS) {
        console.log(`• ${entry.name}: ${entry.matrix.join('; ')}`);
    }
    console.log('\nManual / integration (not in offline runner):');
    console.log('• CV prompt injection → n8n LLM workflow');
    console.log('• n8n failure → candidate pending_evaluation + outbox retry (requires Mongo + n8n)');
    console.log('• Org A vs Org B → 403 (requires auth integration test)');

    if (failed.length > 0) {
        console.error(`\n${failed.length} suite(s) failed: ${failed.join(', ')}`);
        process.exit(1);
    }
    console.log('\n✓ dynamic-rubric-s5: all suites passed');
}

main();
