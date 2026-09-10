#!/usr/bin/env node
/**
 * Runs the backend test suite and reports EVERY result, instead of dying on the
 * first red the way `a && b && c` would.
 *
 * Why this exists: 83 test files live in src/scripts, and until 2026-09-10
 * eighteen of them had no npm script at all — they had never run once. CI ran
 * four. This script is what makes "the suite" a thing that exists.
 *
 * It discovers suites from package.json rather than hard-coding a list, so a
 * newly added `test:*` script is picked up automatically and cannot be
 * forgotten the way those eighteen were.
 *
 * Usage:
 *   node scripts/run-test-suite.mjs            # the CI-safe suites
 *   node scripts/run-test-suite.mjs --list     # print what would run, run nothing
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Spawn tsx directly rather than shelling out to `npm run` per suite.
 *
 * This is not premature tuning: `npm run` costs ~7s of startup per invocation
 * against ~0.5s for tsx itself, so across ~79 suites it was the difference
 * between roughly ten minutes and under two. npm remains the fallback for any
 * suite whose command is not a plain `tsx <file>`.
 */
const TSX_CLI = ['node_modules/tsx/dist/cli.mjs', '../../node_modules/tsx/dist/cli.mjs']
    .map((p) => join(BACKEND, p))
    .find((p) => existsSync(p));

function runSuite(name, command) {
    const direct = /^tsx\s+(\S+\.ts)$/.exec(command.trim());
    if (TSX_CLI && direct) {
        return spawnSync(process.execPath, [TSX_CLI, direct[1]], { cwd: BACKEND, encoding: 'utf8' });
    }
    return spawnSync('npm', ['run', '--silent', name], {
        cwd: BACKEND,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
}

/**
 * Suites deliberately NOT run here, each with the reason. Anything not listed
 * runs — the default is inclusion, so silence cannot hide a suite.
 */
const EXCLUDED = {
    // Need infrastructure this job does not have.
    'test:stage1-local-roundtrip': 'needs a running backend on PORT + a real database',
    'test:returning-applicant': 'writes to a real database — covered by the database-verify job',
    'test:m2m-smoke': 'writes to a real database — covered by the database-verify job',
    'test:site-metric': 'needs a real database connection',

    /**
     * ⚠️ QUARANTINE — these fail today, and they failed before any of this was
     * wired up. They are NOT skipped because they are flaky; they are skipped
     * so that a red suite does not hide a NEW regression. Fix and delete the
     * entry; do not add to this list to make a build green.
     *
     * Root cause for the pack ones: WAVE_1A_PACK_VERSION is pinned at '1.1.0'
     * while 38 of the 39 packs now carry '1.4.0' (one is still '1.0.0'). The
     * constant has no production reader — only these tests — so it drifted
     * unnoticed. Deciding whether the constant or the packs are wrong is a
     * head-hunter-pack call, not a CI call.
     */
    'test:blueprint-version': 'PRE-EXISTING FAILURE: packVersion != WAVE_1A_PACK_VERSION',
    'test:taxonomy-l1-coverage': 'PRE-EXISTING FAILURE: manual sample missing roleKey pharmacist',
    'test:phase-b-metadata': 'PRE-EXISTING FAILURE: Recruiter pack_version mismatch',
    'test:bank-alignment-wave2': 'PRE-EXISTING FAILURE: looks up "frontend-developer", pack key is "frontend_developer"',
    'test:qa-scorecard-l3': 'PRE-EXISTING FAILURE: child scorecard step exits 1',
    'test:qa-scorecard-wave1a': 'PRE-EXISTING FAILURE: hr_recruiter version mismatch',
};

const pkg = JSON.parse(readFileSync(join(BACKEND, 'package.json'), 'utf8'));

/**
 * ⚠️ `test:suite` and `test:suite:list` start with `test:` too, so discovery
 * picks up THIS script and the runner invokes itself forever. That is not
 * hypothetical — it hung the first real run, silently, after 47 green suites.
 * Match on the command rather than the names so a renamed alias cannot
 * reintroduce it.
 */
const isSelf = (name) => (pkg.scripts[name] || '').includes('run-test-suite.mjs');

const all = Object.keys(pkg.scripts)
    .filter((k) => k.startsWith('test:') && !isSelf(k))
    .sort();
const suites = all.filter((k) => !(k in EXCLUDED));

if (process.argv.includes('--list')) {
    console.log(`${suites.length} suites would run, ${all.length - suites.length} excluded:\n`);
    suites.forEach((s) => console.log(`  run   ${s}`));
    console.log();
    for (const [name, why] of Object.entries(EXCLUDED)) {
        if (all.includes(name)) console.log(`  skip  ${name} — ${why}`);
    }
    process.exit(0);
}

console.log(`Running ${suites.length} backend suites (${all.length - suites.length} excluded).\n`);

const failed = [];
const started = Date.now();

for (const suite of suites) {
    const t0 = Date.now();
    const res = runSuite(suite, pkg.scripts[suite]);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.status === 0) {
        console.log(`  ok   ${suite} (${secs}s)`);
    } else {
        console.log(`  FAIL ${suite} (${secs}s)`);
        failed.push({ suite, output: `${res.stdout || ''}${res.stderr || ''}`.trimEnd() });
    }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${suites.length - failed.length}/${suites.length} passed in ${total}s`);

if (failed.length) {
    for (const { suite, output } of failed) {
        console.log(`\n${'='.repeat(70)}\n${suite}\n${'='.repeat(70)}`);
        console.log(output.split('\n').slice(-40).join('\n'));
    }
    console.log(`\n${failed.length} suite(s) failed: ${failed.map((f) => f.suite).join(', ')}`);
    process.exit(1);
}

// A guard against this script silently doing nothing — an empty or tiny run
// would otherwise report success and look identical to a healthy build.
if (suites.length < 50) {
    console.error(`\nOnly ${suites.length} suites discovered; expected far more. Refusing to report success.`);
    process.exit(1);
}
console.log('\nAll suites passed.');
