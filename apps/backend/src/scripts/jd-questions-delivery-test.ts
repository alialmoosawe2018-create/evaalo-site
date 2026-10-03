// ============================================
// scripts/jd-questions-delivery-test.ts
// Part one of the video interview, phase D: the job-description questions reach the
// agent. Through the REAL /prepare and /start routes, on an in-memory database, with
// LiveKit replaced by a local fake that records every dispatch:
//  - /prepare sends `jd_questions` with the room and records the set on the
//    handoff — and freezes nothing (a candidate who prepares may never start);
//  - /start, on the reuse branch AND on the full path, stores the set the agent got
//    on the session and freezes the campaign's set — once; a later interview never
//    moves the date;
//  - a room prepared before the set was ready (or with another set) is rebuilt;
//  - an incomplete set, or one in another language, is never sent;
//  - with JD_INTERVIEW_QUESTIONS_DELIVER off, nothing is sent, stored or frozen.
// Run: npm run test:jd-questions-delivery — no external database, network or AI.
// ============================================

process.env.BILLING_ENFORCE = 'false';
process.env.RBAC_ENFORCEMENT = 'off';
process.env.ENFORCE_AUTH = 'off';
process.env.AGENT_EXTERNAL_MODE = 'true';
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
process.env.INTERVIEW_REBUILD_GRACE_MS = '0';
process.env.OPENAI_API_KEY = 'sk-test-jd-questions-delivery';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-that-is-long-enough-for-hs256';
delete process.env.STAGE_CALLBACK_SECURITY_MODE;

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

type Json = Record<string, any>;
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

// ── Fake LiveKit (Twirp JSON) ───────────────────────────────────────────────
const rooms = new Set<string>();
const deleted: string[] = [];
const dispatches: Array<{ room: string; metadata: Json }> = [];
const livekit = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        const data = body ? JSON.parse(body) : {};
        const method = String(req.url || '').split('/').pop();
        let out: Json = {};
        if (method === 'CreateRoom') {
            rooms.add(data.name);
            out = { name: data.name, sid: `RM_${rooms.size}` };
        } else if (method === 'ListRooms') {
            out = { rooms: [...rooms].map((name) => ({ name })) };
        } else if (method === 'DeleteRoom') {
            rooms.delete(data.room);
            deleted.push(data.room);
        } else if (method === 'CreateDispatch') {
            dispatches.push({ room: data.room, metadata: data.metadata ? JSON.parse(data.metadata) : {} });
            out = { id: `AD_${dispatches.length}`, room: data.room, agentName: data.agentName ?? data.agent_name };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
    });
});
await new Promise<void>((r) => livekit.listen(0, '127.0.0.1', () => r()));
process.env.LIVEKIT_URL = `http://127.0.0.1:${(livekit.address() as AddressInfo).port}`;

// ── fixtures (synthetic) ─────────────────────────────────────────────────────
const QUESTIONS = [
    {
        question: 'صرف الرواتب، إذا اكتشفت قبل يوم الصرف إن ساعات الإضافي لقسم كامل محسوبة غلط، شلون راح تتصرف؟',
        clarifyHint: 'مثلاً جهاز البصمة سجّل الإضافي مرتين لنفس الموظفين',
        duty: 'payroll run',
    },
    {
        question: 'مراجعة الحضور، إذا لگيت إجازات مسجلة بدون موافقة المدير، شنو أول شي راح تتأكد منه؟',
        clarifyHint: 'مثلاً موظف عنده ثلاث أيام إجازة بالنظام وما أكو ورقة موقعة',
        duty: 'attendance review',
    },
    {
        question: 'استفسارات الموظفين، إذا موظف اعترض على خصم براتبه، شنو راح تگله أول؟',
        clarifyHint: 'مثلاً خصم سلفة الموظف ما يتذكرها',
        duty: 'employee questions',
    },
];
const DESCRIPTION = 'Payroll Specialist. Duties: monthly payroll, attendance and overtime, employee questions about salaries.';
const readySet = (extra: Json = {}): Json => ({
    status: 'ready',
    questions: QUESTIONS.map((q, i) => ({ id: `q${i + 1}`, ...q })),
    source: 'preview',
    language: 'ar',
    jdHash: 'jdhash-test-1',
    promptVersion: '2026-10-03.v4',
    generatedAt: new Date(),
    ...extra,
});

async function main(): Promise<void> {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const express = (await import('express')).default;
    const routes = (await import('../routes/videoInterview.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const Candidate = (await import('../models/Candidate.js')).default;
    const VideoInterviewSession = (await import('../models/VideoInterviewSession.js')).default;
    const VideoPrewarmSession = (await import('../models/VideoPrewarmSession.js')).default;
    const delivery = await import('../services/jdQuestionsDelivery.js');
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/video-interview', routes);
    let server: Server | null = null;
    let n = 0;
    try {
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/video-interview`;
        const call = async (url: string, body: Json): Promise<{ status: number; json: Json }> => {
            const res = await fetch(`${base}${url}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return { status: res.status, json: (await res.json()) as Json };
        };
        const campaign = async (fields: Json = {}): Promise<string> => {
            const campaignId = `jdd-camp-${(n += 1)}`;
            await RecruitmentCampaign.create({
                campaignId,
                criteria: { position: 'Payroll Specialist' },
                interviewType: 'video',
                interviewLanguage: 'ar',
                jobDescription: DESCRIPTION,
                jdInterviewQuestions: readySet(),
                ...fields,
            });
            return campaignId;
        };
        const candidate = async (campaignId: string): Promise<string> => {
            const c = await Candidate.create({
                full_name: `Test Candidate ${(n += 1)}`,
                email: `jdd-${n}@example.test`,
                phone: '07800000000',
                position_applied_for: 'Payroll Specialist',
                years_of_experience: '3-5 years',
                campaignId,
            });
            return String(c._id);
        };
        const frozenAt = async (campaignId: string): Promise<Date | undefined> =>
            ((await RecruitmentCampaign.findOne({ campaignId }).lean()) as Json)?.jdInterviewQuestions?.frozenAt;
        const lastDispatch = () => dispatches[dispatches.length - 1];
        const expectedKey = delivery.jdQuestionsSetKey(QUESTIONS.map((q, i) => ({ id: `q${i + 1}`, ...q })));

        console.log('[jd-questions-delivery] running tests\n');
        process.env.JD_INTERVIEW_QUESTIONS_DELIVER = 'true';

        // ── 1. /prepare → /start on the reuse branch ───────────────────────────
        const c1 = await campaign();
        const p1 = await candidate(c1);
        let prepared: Json = {};
        await test('/prepare sends the three questions with the room', async () => {
            const before = dispatches.length;
            const r = await call('/prepare', { candidateId: p1, campaignId: c1 });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.ok(r.json.livekit?.roomName, 'a room was prepared');
            prepared = r.json;
            assert.equal(dispatches.length, before + 1);
            const sent = JSON.parse(lastDispatch().metadata.jd_questions);
            assert.deepEqual(sent.map((q: Json) => q.question), QUESTIONS.map((q) => q.question));
            assert.deepEqual(sent.map((q: Json) => q.clarifyHint), QUESTIONS.map((q) => q.clarifyHint));
            assert.deepEqual(sent.map((q: Json) => q.id), ['q1', 'q2', 'q3']);
            assert.equal(lastDispatch().metadata.language, 'ar');
        });
        await test('/prepare freezes nothing, and records the set on the handoff', async () => {
            assert.equal(await frozenAt(c1), undefined);
            const row = (await VideoPrewarmSession.findOne({ candidateId: p1 }).lean()) as Json;
            assert.equal(row?.jdQuestionsSetKey, expectedKey);
        });
        await test('/start reuses that room: the session records the set, the campaign freezes it', async () => {
            const before = dispatches.length;
            const r = await call('/start', { candidateId: p1, campaignId: c1 });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.equal(r.json.sessionId, prepared.sessionId, 'reused, not rebuilt');
            assert.equal(dispatches.length, before, 'no second dispatch');
            const session = (await VideoInterviewSession.findOne({ sessionId: r.json.sessionId }).lean()) as Json;
            assert.equal(session?.jdQuestionsSnapshot?.setKey, expectedKey);
            assert.deepEqual(session.jdQuestionsSnapshot.questions.map((q: Json) => q.question), QUESTIONS.map((q) => q.question));
            assert.ok((await frozenAt(c1)) instanceof Date, 'frozen at the first real start');
        });

        // ── 2. the full /start path ─────────────────────────────────────────────
        const c2 = await campaign();
        await test('/start without /prepare sends the set, records it and freezes it', async () => {
            const p = await candidate(c2);
            const r = await call('/start', { candidateId: p, campaignId: c2 });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            const sent = JSON.parse(lastDispatch().metadata.jd_questions);
            assert.equal(sent.length, 3);
            const session = (await VideoInterviewSession.findOne({ sessionId: r.json.sessionId }).lean()) as Json;
            assert.equal(session?.jdQuestionsSnapshot?.setKey, expectedKey);
            assert.ok((await frozenAt(c2)) instanceof Date);
        });
        await test('a later interview never moves the freeze date', async () => {
            const first = await frozenAt(c2);
            await new Promise((r) => setTimeout(r, 20));
            const p = await candidate(c2);
            const r = await call('/start', { candidateId: p, campaignId: c2 });
            assert.equal(r.status, 200);
            assert.equal((await frozenAt(c2))?.getTime(), first?.getTime());
        });

        // ── 3. a room prepared before the set was ready ─────────────────────────
        await test('a room prepared while the set was still pending is rebuilt with it at /start', async () => {
            const c3 = await campaign({ jdInterviewQuestions: { status: 'pending', startedAt: new Date() } });
            const p = await candidate(c3);
            const r1 = await call('/prepare', { candidateId: p, campaignId: c3 });
            assert.equal(r1.status, 200);
            const prepRoom = r1.json.livekit.roomName;
            assert.equal(lastDispatch().metadata.jd_questions, undefined, 'nothing to send yet');
            await RecruitmentCampaign.updateOne({ campaignId: c3 }, { $set: { jdInterviewQuestions: readySet() } });
            const r2 = await call('/start', { candidateId: p, campaignId: c3 });
            assert.equal(r2.status, 200, JSON.stringify(r2.json));
            assert.notEqual(r2.json.sessionId, r1.json.sessionId, 'rebuilt, not reused');
            assert.ok(deleted.includes(prepRoom), 'the stale room was retired');
            assert.equal(JSON.parse(lastDispatch().metadata.jd_questions).length, 3);
            const session = (await VideoInterviewSession.findOne({ sessionId: r2.json.sessionId }).lean()) as Json;
            assert.equal(session?.jdQuestionsSnapshot?.setKey, expectedKey);
        });

        await test('after a restart (only the persisted handoff left) a room without the set is rebuilt too', async () => {
            // No /prepare in THIS process: the handoff row is all /start can find, as
            // after a restart or on a second instance.
            const c = await campaign();
            const p = await candidate(c);
            const staleRoom = `room-video-interview-${p}-stale`;
            rooms.add(staleRoom);
            await VideoPrewarmSession.create({
                candidateId: p,
                roomName: staleRoom,
                sessionId: `video-interview-${p}-stale`,
                campaignId: c,
                blueprintCompetencyCount: 0,
                jdQuestionsSetKey: '',
            });
            const r = await call('/start', { candidateId: p, campaignId: c });
            assert.equal(r.status, 200, JSON.stringify(r.json));
            assert.notEqual(r.json.sessionId, `video-interview-${p}-stale`, 'rebuilt, not reused');
            assert.ok(deleted.includes(staleRoom), 'the stale room was retired');
            assert.equal(JSON.parse(lastDispatch().metadata.jd_questions).length, 3);
        });
        await test('after a restart a room WITH the same set is reused', async () => {
            const c = await campaign();
            const p = await candidate(c);
            const room = `room-video-interview-${p}-kept`;
            rooms.add(room);
            await VideoPrewarmSession.create({
                candidateId: p,
                roomName: room,
                sessionId: `video-interview-${p}-kept`,
                campaignId: c,
                blueprintCompetencyCount: 0,
                jdQuestionsSetKey: expectedKey,
            });
            const before = dispatches.length;
            const r = await call('/start', { candidateId: p, campaignId: c });
            assert.equal(r.json.sessionId, `video-interview-${p}-kept`, 'reused');
            assert.equal(dispatches.length, before);
            const session = (await VideoInterviewSession.findOne({ sessionId: r.json.sessionId }).lean()) as Json;
            assert.equal(session?.jdQuestionsSnapshot?.setKey, expectedKey);
            assert.ok((await frozenAt(c)) instanceof Date);
        });

        // ── 4. never sent ───────────────────────────────────────────────────────
        await test('an incomplete set is never sent', async () => {
            const two = readySet();
            two.questions = two.questions.slice(0, 2);
            const c = await campaign({ jdInterviewQuestions: two });
            const r = await call('/start', { candidateId: await candidate(c), campaignId: c });
            assert.equal(r.status, 200);
            assert.equal(lastDispatch().metadata.jd_questions, undefined);
            assert.equal(await frozenAt(c), undefined);
        });
        await test('a set in another language than the interview is never sent', async () => {
            const c = await campaign({ interviewLanguage: 'en' });
            const r = await call('/start', { candidateId: await candidate(c), campaignId: c });
            assert.equal(r.status, 200);
            assert.equal(lastDispatch().metadata.jd_questions, undefined);
            const session = (await VideoInterviewSession.findOne({ sessionId: r.json.sessionId }).lean()) as Json;
            assert.equal(session?.jdQuestionsSnapshot, undefined);
        });
        await test('a set that is not ready is never sent — even one that carries three questions', async () => {
            for (const status of ['failed', 'pending']) {
                // The questions are present on purpose: only `ready` may be sent.
                const c = await campaign({ jdInterviewQuestions: readySet({ status, error: 'skipped_by_owner' }) });
                const r = await call('/start', { candidateId: await candidate(c), campaignId: c });
                assert.equal(r.status, 200);
                assert.equal(lastDispatch().metadata.jd_questions, undefined, status);
                assert.equal(await frozenAt(c), undefined, status);
            }
        });

        // ── 5. the switch off ───────────────────────────────────────────────────
        await test('switch off: nothing sent, stored or frozen — and reuse still works', async () => {
            delete process.env.JD_INTERVIEW_QUESTIONS_DELIVER;
            const c = await campaign();
            const p = await candidate(c);
            const r1 = await call('/prepare', { candidateId: p, campaignId: c });
            assert.equal(lastDispatch().metadata.jd_questions, undefined);
            const before = dispatches.length;
            const r2 = await call('/start', { candidateId: p, campaignId: c });
            assert.equal(r2.json.sessionId, r1.json.sessionId, 'the prepared room is reused as today');
            assert.equal(dispatches.length, before);
            const session = (await VideoInterviewSession.findOne({ sessionId: r2.json.sessionId }).lean()) as Json;
            assert.equal(session?.jdQuestionsSnapshot, undefined);
            assert.equal(await frozenAt(c), undefined);
            process.env.JD_INTERVIEW_QUESTIONS_DELIVER = 'true';
        });

        // ── 6. the set's identity ───────────────────────────────────────────────
        await test('the set key follows the exact text: an edit changes it', () => {
            const base = QUESTIONS.map((q, i) => ({ id: `q${i + 1}`, ...q }));
            assert.equal(delivery.jdQuestionsSetKey(base), delivery.jdQuestionsSetKey(base.map((q) => ({ ...q }))));
            const edited = base.map((q, i) => (i === 1 ? { ...q, question: `${q.question} ` + 'x' } : q));
            assert.notEqual(delivery.jdQuestionsSetKey(edited), delivery.jdQuestionsSetKey(base));
            const hint = base.map((q, i) => (i === 2 ? { ...q, clarifyHint: 'مثلاً شي ثاني' } : q));
            assert.notEqual(delivery.jdQuestionsSetKey(hint), delivery.jdQuestionsSetKey(base));
        });
    } finally {
        await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
        await new Promise<void>((r) => livekit.close(() => r()));
        await mongoose.disconnect();
        await mongo.stop();
    }
    console.log(`\n[jd-questions-delivery] ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
