#!/usr/bin/env node
/**
 * Installs the repository's versioned git hooks into .git/hooks.
 *
 * Only `pre-push` today: it refuses to push `master` while an interview is live
 * (see scripts/git-hooks/pre-push). Existing hooks with other names — the
 * graphify post-commit / post-checkout — are left alone. An existing pre-push
 * that is not ours is never overwritten.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = execSync('git rev-parse --git-path hooks', { cwd: ROOT, encoding: 'utf8' }).trim();
const source = join(ROOT, 'scripts', 'git-hooks', 'pre-push');
const target = join(ROOT, hooksDir, 'pre-push');

if (existsSync(target) && !readFileSync(target, 'utf8').includes('check-live-interviews.mjs')) {
    console.error(`⛔ ${target} exists and is not ours — not overwriting it. Merge it by hand.`);
    process.exit(1);
}
copyFileSync(source, target);
try {
    chmodSync(target, 0o755);
} catch {
    /* Windows: git runs hooks through its own shell regardless */
}
console.log(`✓ installed ${target}`);
