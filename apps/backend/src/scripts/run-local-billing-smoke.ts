/**
 * Local billing smoke — runs type-check prerequisites + Mongo verify scripts.
 *
 * Run from apps/backend:
 *   npm run verify:billing-smoke
 *
 * Requires MONGODB_URI in .env. Does not contact live Stripe.
 */
import '../loadEnv.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');

function run(label: string, args: string[]): number {
    console.log(`\n▶ ${label}`);
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
        cwd: backendRoot,
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
    });
    const code = result.status ?? 1;
    console.log(code === 0 ? `✓ ${label}` : `✗ ${label} (exit ${code})`);
    return code;
}

async function main(): Promise<void> {
    if (!process.env.MONGODB_URI?.trim()) {
        console.error('[billing-smoke] MONGODB_URI is required. Copy env.example → .env');
        process.exit(1);
    }

    const steps: Array<[string, string[]]> = [
        ['TypeScript', ['tsc', '--noEmit']],
        ['verify-billing-phase2a', ['tsx', 'src/scripts/verify-billing-phase2a.ts']],
        ['verify-billing-phase2b', ['tsx', 'src/scripts/verify-billing-phase2b.ts']],
    ];

    const codes: number[] = [];
    for (const [label, args] of steps) {
        codes.push(run(label, args));
    }

    console.log('\n---');
    if (codes.every((c) => c === 0)) {
        console.log('ALL LOCAL BILLING SMOKE CHECKS PASS');
        console.log('Next: stripe listen --forward-to localhost:5000/webhook/stripe');
        console.log('See docs/local-billing-testing.md for manual E2E.');
        process.exit(0);
    }
    console.log('SOME CHECKS FAILED — fix before Stripe E2E');
    process.exit(1);
}

main();
