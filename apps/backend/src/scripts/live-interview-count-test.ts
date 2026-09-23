/**
 * "No deploy while an interview is live" — the owner's rule since launch
 * (2026-09-23), tested at every link of the chain that enforces it:
 *
 *   1. the COUNT — voice live + voice parked in its resume window + video live,
 *      and what must NOT count (an abandoned video tab, a finished session);
 *   2. `/api/health` — carries it as `activeInterviews`, keeps the old field;
 *   3. the VPS deployer's `live_interviews` (ops/deploy.sh) — run with bash on
 *      the new reply, on a reply from a container that predates the field, and
 *      on junk; and the gate itself has no ceiling any more;
 *   4. `scripts/check-live-interviews.mjs` — exit 1 while an interview is live;
 *   5. the `pre-push` hook — refuses `master` while one is live, lets other
 *      branches through.
 *
 * Run: npx tsx src/scripts/live-interview-count-test.ts
 * Uses mongodb-memory-server — no external database.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import VideoInterviewSession from '../models/VideoInterviewSession.js';
import healthRoutes from '../routes/health.js';
import { createSession, removeSession } from '../evaalo-only-voice/sessionStore.js';
import { dropParkedSession, parkSession } from '../evaalo-only-voice/voiceSessionResume.js';
import {
    countLiveVideoInterviews,
    liveInterviewSnapshot,
    refreshLiveInterviewCountNow,
    resetLiveInterviewCounterForTests,
    VIDEO_LIVE_WINDOW_MS,
} from '../services/liveInterviewCount.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

let failures = 0;
let passes = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        passes += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());

/* ── 1. the count ─────────────────────────────────────────────────────────── */
console.log('▶ what counts as a live interview');
{
    const now = Date.now();
    const recent = new Date(now - 10_000);
    const stale = new Date(now - VIDEO_LIVE_WINDOW_MS - 60_000);
    const base = { organizationId: 'org_t', roomName: 'r', candidateId: new mongoose.Types.ObjectId() };
    await VideoInterviewSession.collection.insertMany([
        // live: heartbeat 10 s ago
        { ...base, sessionId: 'v-live', status: 'active', startedAt: stale, lastActivityAt: recent },
        // live: started 10 s ago, first heartbeat not due yet
        { ...base, sessionId: 'v-starting', status: 'active', startedAt: recent },
        // NOT live: tab abandoned — still `active` in the database, silent for minutes
        { ...base, sessionId: 'v-abandoned', status: 'active', startedAt: stale, lastActivityAt: stale },
        // NOT live: never beat, started long ago
        { ...base, sessionId: 'v-never-beat', status: 'active', startedAt: stale },
        // NOT live: finished
        { ...base, sessionId: 'v-done', status: 'completed', startedAt: recent, lastActivityAt: recent },
    ]);
    check('video: a beating session and a just-started one count; abandoned and finished do not',
        await countLiveVideoInterviews(now), 2);

    resetLiveInterviewCounterForTests();
    check('before the first background count, video is reported as unknown — not as zero',
        liveInterviewSnapshot().activeVideoInterviews, null);
    await refreshLiveInterviewCountNow();

    createSession('voice-live-1');
    const parked = parkSession({ key: 'app:RT-PARKED', sessionId: 'voice-parked-1', candidateId: 'c1', onExpire: () => {} });
    check('a parked voice session was created', Boolean(parked), true);
    const snap = liveInterviewSnapshot();
    check('voice live', snap.activeVoiceInterviews, 1);
    check('voice parked in its resume window', snap.parkedVoiceInterviews, 1);
    check('video live', snap.activeVideoInterviews, 2);
    check('activeInterviews = voice + parked + video', snap.activeInterviews, 4);

    /* ── 2. /api/health ─────────────────────────────────────────────────── */
    console.log('\n▶ /api/health');
    const app = express();
    app.use('/api/health', healthRoutes);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as Record<string, unknown>;
    check('carries activeInterviews', body.activeInterviews, 4);
    check('keeps activeVoiceInterviews (the old deployer reads it)', body.activeVoiceInterviews, 1);
    check('carries parkedVoiceInterviews', body.parkedVoiceInterviews, 1);
    check('carries activeVideoInterviews', body.activeVideoInterviews, 2);
    const ready = (await (await fetch(`http://127.0.0.1:${port}/api/health/ready`)).json()) as Record<string, unknown>;
    check('/ready carries it too', ready.activeInterviews, 4);
    server.close();

    removeSession('voice-live-1');
    dropParkedSession('app:RT-PARKED');
    await VideoInterviewSession.collection.deleteMany({});
    await refreshLiveInterviewCountNow();
    check('all over ⇒ 0', liveInterviewSnapshot().activeInterviews, 0);
}

/* ── 3. the VPS deployer ─────────────────────────────────────────────────── */
console.log('\n▶ ops/deploy.sh');
const deploySh = readFileSync(join(ROOT, 'apps', 'backend', 'ops', 'deploy.sh'), 'utf8').replace(/\r\n/g, '\n');
check('no ceiling: it never deploys "anyway" during an interview', /deploying anyway|MAX_POSTPONE_SEC/.test(deploySh), false);
check('it postpones on the live count and exits', /POSTPONED: \$LIVE live interview\(s\)[^\n]*"\n\s*exit 0/.test(deploySh), true);
check('the gate reads live_interviews', /LIVE="\$\(live_interviews /.test(deploySh), true);
const fnStart = deploySh.indexOf('live_interviews() {');
const fnEnd = deploySh.indexOf('\n}\n', fnStart);
const fn = deploySh.slice(fnStart, fnEnd + 2);
const hasBash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';
if (!hasBash || fnStart < 0) {
    check('bash is available to run the deployer function (CI: ubuntu)', hasBash && fnStart >= 0, true);
} else {
    const run = (json: string) =>
        spawnSync('bash', ['-c', `${fn}\nlive_interviews "$1"`, 'x', json], { encoding: 'utf8' }).stdout.trim();
    check('new reply ⇒ activeInterviews',
        run('{"status":"ok","activeVoiceInterviews":0,"parkedVoiceInterviews":1,"activeVideoInterviews":2,"activeInterviews":3}'), '3');
    check('a reply from before the field ⇒ activeVoiceInterviews',
        run('{"status":"ok","database":"connected","activeVoiceInterviews":2,"timestamp":"x"}'), '2');
    check('"activeVoiceInterviews" is never mistaken for "activeInterviews"',
        run('{"activeVoiceInterviews":5,"activeInterviews":0}'), '0');
    check('no answer ⇒ nothing (fail-open: the container interviews nobody)', run(''), '');
    check('"OK" ⇒ nothing', run('OK'), '');
}

/* ── 4 + 5. the local check and the pre-push hook ─────────────────────────── */
console.log('\n▶ scripts/check-live-interviews.mjs and the pre-push hook');
{
    let reply = '';
    const fake = http.createServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(reply);
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/api/health`;
    const env = { ...process.env, EVAALO_HEALTH_URL: url };
    const checkScript = join(ROOT, 'scripts', 'check-live-interviews.mjs');
    // async, not spawnSync: the fake server lives in THIS process and must answer
    const runNode = (args: string[], opts: { input?: string; cwd?: string } = {}) =>
        new Promise<number | null>((resolve) => {
            const child = spawn(args[0], args.slice(1), { env, cwd: opts.cwd ?? ROOT, stdio: ['pipe', 'ignore', 'ignore'] });
            if (opts.input) child.stdin.write(opts.input);
            child.stdin.end();
            child.on('close', (code) => resolve(code));
        });

    reply = JSON.stringify({ activeVoiceInterviews: 0, parkedVoiceInterviews: 0, activeVideoInterviews: 1, activeInterviews: 1 });
    check('live interview ⇒ exit 1', await runNode([process.execPath, checkScript]), 1);
    reply = JSON.stringify({ activeVoiceInterviews: 0, parkedVoiceInterviews: 0, activeVideoInterviews: 0, activeInterviews: 0 });
    check('idle ⇒ exit 0', await runNode([process.execPath, checkScript]), 0);
    reply = JSON.stringify({ status: 'ok', activeVoiceInterviews: 1 });
    check('an older backend (voice only) with a live call ⇒ exit 1', await runNode([process.execPath, checkScript]), 1);
    reply = 'OK';
    check('unreadable ⇒ exit 0 (fail-open, with a warning)', await runNode([process.execPath, checkScript]), 0);

    if (hasBash) {
        const hook = join(ROOT, 'scripts', 'git-hooks', 'pre-push');
        reply = JSON.stringify({ activeInterviews: 2, activeVoiceInterviews: 2 });
        check('pre-push: master while live ⇒ refused',
            await runNode(['bash', hook, 'origin', 'x'], { input: 'refs/heads/master abc refs/heads/master def\n' }), 1);
        check('pre-push: another branch while live ⇒ allowed',
            await runNode(['bash', hook, 'origin', 'x'], { input: 'refs/heads/feat abc refs/heads/feat def\n' }), 0);
        reply = JSON.stringify({ activeInterviews: 0, activeVoiceInterviews: 0 });
        check('pre-push: master while idle ⇒ allowed',
            await runNode(['bash', hook, 'origin', 'x'], { input: 'refs/heads/master abc refs/heads/master def\n' }), 0);
    }
    fake.close();
}

await mongoose.disconnect();
await mongo.stop();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);

