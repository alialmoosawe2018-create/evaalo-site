// ============================================
// scripts/jd-interview-questions-test.ts
// Part one of the video interview — questions from the job description (phase A:
// generation, preview, storage; nothing reaches the agent yet).
//
// What it proves, through the real router on an in-memory database with the OpenAI
// SDK pointed at a local fake server:
//  - three questions or none: a set with one bad question is retried once, and is
//    never stored or offered as two;
//  - the checks follow the interview language (Arabic: Iraqi, situational «راح»;
//    English: "would", no Arabic letters);
//  - the preview set is checked AGAIN on create (an edit is free text) and stored as
//    is; a bad edit creates no job;
//  - «continue without» is never generated behind the recruiter's back;
//  - the background fallback claims through the database: two claims → one model
//    call; a stale `pending` is reclaimed, a fresh one is not; `ready`/`failed` are
//    never regenerated;
//  - none of it becomes a scored Stage 1 criterion, and the voice interview code
//    never reads it.
// Run: npm run test:jd-interview-questions — no external database, no network, no AI.
// ============================================

process.env.BILLING_ENFORCE = 'false';
process.env.RBAC_ENFORCEMENT = 'off';
process.env.ENFORCE_AUTH = 'off';
process.env.VIDEO_INTERVIEW_USE_BLUEPRINT = 'false';
process.env.OPENAI_API_KEY = 'sk-test-jd-interview-questions';
delete process.env.JD_INTERVIEW_QUESTIONS_LANGUAGES;
delete process.env.JD_INTERVIEW_QUESTIONS_MODEL;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

type Json = Record<string, any>;
let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    replies.length = 0;
    sent.length = 0;
    try {
        await fn();
        console.log('  ✓', name);
        pass += 1;
    } catch (err) {
        console.error('  ✗', name, '\n     ', (err as Error).message);
        fail += 1;
    }
}

// ── Fake model ──────────────────────────────────────────────────────────────
type Reply = { content: string; finish_reason?: string; delayMs?: number };
const replies: Reply[] = [];
const sent: Json[] = [];
const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        sent.push(JSON.parse(body || '{}'));
        const r = replies.shift() || { content: '{}' };
        setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    id: 'chatcmpl-fake',
                    object: 'chat.completion',
                    created: 0,
                    model: 'fake',
                    choices: [{ index: 0, message: { role: 'assistant', content: r.content }, finish_reason: r.finish_reason || 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                })
            );
        }, r.delayMs || 0);
    });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;

// ── fixtures (synthetic) ──────────────────────────────────────────────────────
const GOOD_AR = [
    {
        question: 'صرف الرواتب، إذا اكتشفت قبل يوم الصرف إن ساعات الإضافي لقسم كامل محسوبة غلط، شلون راح تتصرف؟',
        clarifyHint: 'مثلاً جهاز البصمة سجّل الإضافي مرتين لنفس الموظفين',
        duty: 'صرف الرواتب',
    },
    {
        question: 'مراجعة الحضور، إذا لگيت إجازات مسجلة بدون موافقة المدير، شنو أول شي راح تتأكد منه؟',
        clarifyHint: 'مثلاً موظف عنده ثلاث أيام إجازة بالنظام وما أكو ورقة موقعة',
        duty: 'مراجعة الحضور',
    },
    {
        question: 'استفسارات الموظفين، إذا موظف اعترض على خصم براتبه، شنو راح تگله أول؟',
        clarifyHint: 'مثلاً خصم سلفة الموظف ما يتذكرها',
        duty: 'استفسارات الموظفين',
    },
];
const GOOD_EN = [
    {
        question: 'Payroll processing, if you found the overtime of a whole department was miscalculated the day before payday, how would you handle it?',
        clarifyHint: 'For example the time clock recorded every overtime hour twice',
        duty: 'Payroll processing',
    },
    {
        question: 'Attendance review, if leave was recorded without a manager approval, what would you check first?',
        clarifyHint: 'For example three days of leave in the system and no signed form',
        duty: 'Attendance review',
    },
    {
        question: 'Employee questions, if someone disputed a deduction from their salary, what would you tell them?',
        clarifyHint: 'For example a loan repayment they do not remember',
        duty: 'Employee questions',
    },
];
const modelSet = (qs: Json[]): string =>
    JSON.stringify({ questions: qs.map((q) => ({ duty: q.duty, question: q.question, clarify_hint: q.clarifyHint })), skipped: [] });
const withQ = (i: number, question: string): Json[] => GOOD_AR.map((q, k) => (k === i ? { ...q, question } : q));
const DESCRIPTION = 'Payroll Specialist. Duties: prepare monthly payroll, review attendance, overtime and deductions, answer employee questions about salaries.';

async function main(): Promise<void> {
    const svc = await import('../services/jdInterviewQuestions.js');
    const { checkJdQuestion: check, checkJdQuestionSet: checkSet } = svc;

    // ── 1. checks: Arabic ─────────────────────────────────────────────────────
    await test('the synthetic Arabic set passes every check', () => {
        const r = checkSet(GOOD_AR, 'ar', ['Payroll Specialist']);
        assert.ok(r.ok, JSON.stringify(r));
    });
    const AR_BAD: Array<[string, string, string]> = [
        ['two asks', 'صرف الرواتب، إذا صار خطأ، شلون راح تتصرف وشنو راح تسوي؟', 'two_asks'],
        ['past tense, not situational', 'صرف الرواتب، إذا صار خطأ بالإضافي، شنو سويت؟', 'not_situational'],
        ['yes/no', 'صرف الرواتب، هل راح تراجع الإضافي؟', 'yes_no'],
        ['Levantine', 'صرف الرواتب، إذا صار خطأ، كيف راح تتصرف؟', 'not_iraqi_levantine'],
        ['MSA / non-Iraqi', 'صرف الرواتب، إذا صار خطأ، شنو راح تسوي علشان تصلحه؟', 'not_iraqi_msa'],
        ['«لما» takes it as given', 'لما صار خطأ بالرواتب، شنو راح تسوي؟', 'lamma'],
        ['two question marks', 'صرف الرواتب، إذا صار خطأ، شنو راح تسوي؟ وليش؟', 'question_marks'],
        ['text after the question', 'صرف الرواتب، إذا صار خطأ، شنو راح تسوي؟ احچيلي.', 'text_after_question'],
        ['a link', 'قدّم على https://lnkd.in/x، إذا صار خطأ شنو راح تسوي؟', 'contact_or_link'],
        ['a personal trait', 'إذا متزوج، شلون راح توازن بين الشغل والبيت؟', 'personal_trait'],
        ['a CV fact', 'إذا عندك شهادة NEBOSH، شلون راح تستفاد منها؟', 'cv_fact'],
        ['glued Latin', 'التنسيق ويا المالية وHR، إذا اختلفت الأرقام، شنو راح تسوي؟', 'glued_latin'],
        ['Kurdish letters', 'ئەگەر هەڵە هەبوو، شنو راح تسوي؟', 'kurdish_letters'],
        ['graphic', 'السلامة، إذا صار حادث قطع يد عامل بالماكنة، شلون راح تتصرف؟', 'graphic'],
        ['graphic: a whole Arabic word', 'السلامة، إذا شفت دم على الأرض، شلون راح تتصرف؟', 'graphic'],
        ['the job title', 'شغل Payroll Specialist، إذا صار خطأ، شنو راح تسوي؟', 'names_company_or_title'],
    ];
    for (const [name, q, code] of AR_BAD) {
        await test(`Arabic check catches: ${name}`, () => {
            const codes = check({ question: q, clarifyHint: 'مثلاً خطأ بالأرقام' }, 'ar', ['Payroll Specialist']);
            assert.ok(codes.includes(code), `${code} not in ${JSON.stringify(codes)}`);
        });
    }
    await test('graphic: a word that merely ends in «دم» is not flagged («قدم شكوى»، «تصادم»)', () => {
        for (const q of [
            'العلاقات، إذا موظف قدم شكوى ضد مشرفه، شلون راح تتعامل؟',
            'المخزن، إذا صار تصادم لوادر وطلعت شغلات مكسورة، شلون راح تبدي التحقيق؟',
        ]) {
            const codes = check({ question: q, clarifyHint: 'مثلاً شكوى مكتوبة' }, 'ar');
            assert.ok(!codes.includes('graphic'), `${q}: ${JSON.stringify(codes)}`);
        }
    });
    await test('the hint: no question mark and Iraqi words only', () => {
        assert.ok(check({ ...GOOD_AR[0], clarifyHint: 'مثلاً شلون تتأكد؟' }, 'ar').includes('hint_question_mark'));
        assert.ok(check({ ...GOOD_AR[0], clarifyHint: 'مثلاً كيف تحسب الساعات' }, 'ar').includes('hint_not_iraqi'));
    });
    await test('a set is three or nothing; same opener, same ending and duplicates fail', () => {
        assert.deepEqual(checkSet(GOOD_AR.slice(0, 2), 'ar').setProblems, ['count']);
        const sameOpen = GOOD_AR.map((q) => ({ ...q, question: q.question.replace(/^[^،]+/, 'الرواتب') }));
        assert.ok(checkSet(sameOpen, 'ar').setProblems.includes('same_opener'));
        const sameEnd = [
            { ...GOOD_AR[0], question: 'صرف الرواتب، إذا صار خطأ بالإضافي، شنو راح تسوي؟' },
            { ...GOOD_AR[1], question: 'مراجعة الحضور، إذا لگيت إجازة بلا موافقة، شنو راح تسوي؟' },
            { ...GOOD_AR[2], question: 'الاستفسارات، إذا اعترض موظف على خصم، شنو راح تسوي؟' },
        ];
        assert.ok(checkSet(sameEnd, 'ar').setProblems.includes('same_ending'));
        assert.ok(checkSet([GOOD_AR[0], GOOD_AR[0], GOOD_AR[1]], 'ar').setProblems.includes('duplicate'));
    });

    // ── 2. checks: English ────────────────────────────────────────────────────
    await test('the synthetic English set passes, and the Arabic rules do not apply to it', () => {
        const r = checkSet(GOOD_EN, 'en');
        assert.ok(r.ok, JSON.stringify(r));
    });
    const EN_BAD: Array<[string, string, string]> = [
        ['a yes/no question', 'Payroll, if overtime was wrong, would you escalate it?', 'yes_no'],
        ['two asks', 'Payroll, if overtime was wrong, how would you fix it and what would you tell the manager?', 'two_asks'],
        ['not situational', 'Payroll, when overtime was wrong, how did you fix it?', 'not_situational'],
        ['Arabic in an English interview', 'Payroll, if الإضافي was wrong, how would you fix it?', 'arabic_in_english'],
        ['an Arabic question mark', 'Payroll, if overtime was wrong, how would you fix it؟', 'arabic_in_english'],
    ];
    for (const [name, q, code] of EN_BAD) {
        await test(`English check catches: ${name}`, () => {
            const codes = check({ question: q, clarifyHint: 'For example a double-counted hour' }, 'en');
            assert.ok(codes.includes(code), `${code} not in ${JSON.stringify(codes)}`);
        });
    }

    // ── 3. generation ─────────────────────────────────────────────────────────
    await test('a good first answer: one call, gpt-5-mini, strict JSON schema, the description as data', async () => {
        replies.push({ content: modelSet(GOOD_AR) });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'ar' });
        assert.ok(r.ok, JSON.stringify(r));
        assert.equal(r.attempts, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].model, 'gpt-5-mini');
        assert.equal(sent[0].max_completion_tokens, 8000);
        assert.equal(sent[0].response_format?.type, 'json_schema');
        assert.equal(sent[0].response_format?.json_schema?.strict, true);
        assert.ok(String(sent[0].messages[0].content).includes('IRAQI'));
        assert.ok(String(sent[0].messages[1].content).startsWith('<job_description>'));
        assert.deepEqual(r.questions.map((q) => q.question), GOOD_AR.map((q) => q.question));
        assert.deepEqual(r.questions.map((q) => q.id), ['q1', 'q2', 'q3']);
    });
    await test('one bad question → the whole set is asked again, never kept as two', async () => {
        replies.push({ content: modelSet(withQ(1, 'مراجعة الحضور، إذا صار غياب، شلون راح تتصرف وشنو راح تسوي؟')) });
        replies.push({ content: modelSet(GOOD_AR) });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'ar' });
        assert.ok(r.ok);
        assert.equal(r.attempts, 2);
        assert.equal(r.questions.length, 3);
    });
    await test('bad twice → failed with no questions at all', async () => {
        const twoGood = modelSet(withQ(2, 'استفسارات، إذا اعترض موظف، كيف راح تتصرف؟'));
        replies.push({ content: twoGood }, { content: twoGood });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'ar' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'checks_failed');
        assert.equal(r.attempts, 2);
        assert.equal(r.questions.length, 0);
        assert.equal(sent.length, 2);
    });
    await test('an answer cut off at the token limit (measured: 1 in 20) is retried', async () => {
        replies.push({ content: '', finish_reason: 'length' }, { content: modelSet(GOOD_AR) });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'ar' });
        assert.ok(r.ok);
        assert.equal(r.attempts, 2);
    });
    await test('cut off twice → failed (cut_off)', async () => {
        replies.push({ content: '', finish_reason: 'length' }, { content: '', finish_reason: 'length' });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'ar' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'cut_off');
    });
    await test('unparseable JSON is retried', async () => {
        replies.push({ content: 'not json' }, { content: modelSet(GOOD_AR) });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'ar' });
        assert.ok(r.ok);
        assert.equal(r.attempts, 2);
    });
    await test('an English interview gets the English prompt and the English checks', async () => {
        replies.push({ content: modelSet(GOOD_EN) });
        const r = await svc.generateJdInterviewQuestions({ jobDescription: DESCRIPTION, language: 'en' });
        assert.ok(r.ok, JSON.stringify(r));
        assert.ok(String(sent[0].messages[0].content).includes('plain spoken English'));
        assert.ok(!String(sent[0].messages[0].content).includes('IRAQI'));
    });

    // ── 4. routes and storage ─────────────────────────────────────────────────
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const express = (await import('express')).default;
    const routes = (await import('../routes/recruitmentCampaigns.js')).default;
    const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/recruitment-campaigns', routes);
    let server: Server | null = null;
    try {
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/recruitment-campaigns`;
        const call = async (method: string, url: string, body?: Json): Promise<{ status: number; json: Json }> => {
            const res = await fetch(`${base}${url}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            return { status: res.status, json: (await res.json()) as Json };
        };
        const job = (extra: Json = {}): Json => ({
            position: 'Payroll Specialist',
            experienceYears: '3-5',
            skills: 'Payroll; Excel',
            interviewType: 'video',
            interviewLanguage: 'ar',
            language: 'ar',
            jobDescription: DESCRIPTION,
            ...extra,
        });
        const saved = async (campaignId: string): Promise<Json> =>
            (await RecruitmentCampaign.findOne({ campaignId }).lean()) as Json;
        const waitFor = async (fn: () => Promise<boolean>, ms = 5000): Promise<void> => {
            const until = Date.now() + ms;
            while (Date.now() < until) {
                if (await fn()) return;
                await new Promise((r) => setTimeout(r, 50));
            }
            throw new Error('timed out');
        };
        const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

        // Flag off.
        delete process.env.JD_INTERVIEW_QUESTIONS;
        await test('flag off: config says disabled, preview is 404, create ignores the fields, no model call', async () => {
            assert.deepEqual((await call('GET', '/jd-interview-questions/config')).json, { success: true, enabled: false, languages: [] });
            assert.equal((await call('POST', '/jd-interview-questions/preview', { text: DESCRIPTION })).status, 404);
            const { status, json } = await call('POST', '', job({ jdInterviewQuestions: GOOD_AR, jdInterviewQuestionsSource: 'preview' }));
            assert.equal(status, 201);
            await settle();
            const c = await saved(json.campaignId);
            assert.equal(c.jdInterviewQuestions, undefined);
            assert.equal(sent.length, 0);
        });
        await test('flag off: the new keys never become scored Stage 1 criteria', async () => {
            const { json } = await call('POST', '', job({ jdInterviewQuestions: GOOD_AR, jdInterviewQuestionsSource: 'edited', jdInterviewQuestionsSkip: false }));
            const c = await saved(json.campaignId);
            for (const k of ['jdInterviewQuestions', 'jdInterviewQuestionsSource', 'jdInterviewQuestionsSkip']) {
                assert.ok(!(k in (c.criteria || {})), `${k} leaked into criteria`);
            }
            assert.ok(!JSON.stringify(c.evaluationRubric || {}).includes('jdInterviewQuestions'), 'leaked into the rubric');
        });

        // Flag on.
        process.env.JD_INTERVIEW_QUESTIONS = 'true';
        await test('config: enabled, Arabic only by default (English is unmeasured)', async () => {
            assert.deepEqual((await call('GET', '/jd-interview-questions/config')).json, { success: true, enabled: true, languages: ['ar'] });
        });
        await test('preview: three questions, nothing stored', async () => {
            const before = await RecruitmentCampaign.countDocuments({});
            replies.push({ content: modelSet(GOOD_AR) });
            const { status, json } = await call('POST', '/jd-interview-questions/preview', { text: DESCRIPTION, interviewLanguage: 'ar', position: 'Payroll Specialist' });
            assert.equal(status, 200, JSON.stringify(json));
            assert.equal(json.questions.length, 3);
            assert.equal(await RecruitmentCampaign.countDocuments({}), before);
        });
        await test('preview: an empty description, an English interview and a failed set', async () => {
            assert.equal((await call('POST', '/jd-interview-questions/preview', { text: '  ' })).status, 400);
            assert.equal((await call('POST', '/jd-interview-questions/preview', { text: DESCRIPTION, interviewLanguage: 'en' })).json.error, 'LANGUAGE_NOT_ENABLED');
            const bad = modelSet(withQ(0, 'صرف الرواتب، إذا صار خطأ، شنو سويت؟'));
            replies.push({ content: bad }, { content: bad });
            const r = await call('POST', '/jd-interview-questions/preview', { text: DESCRIPTION, interviewLanguage: 'ar' });
            assert.equal(r.status, 422);
            assert.equal(r.json.error, 'GENERATION_FAILED');
            assert.ok(!('questions' in r.json));
        });
        await test('create with the preview set: stored ready, the same words, no model call', async () => {
            const { status, json } = await call('POST', '', job({ jdInterviewQuestions: GOOD_AR, jdInterviewQuestionsSource: 'preview' }));
            assert.equal(status, 201, JSON.stringify(json));
            await settle();
            const q = (await saved(json.campaignId)).jdInterviewQuestions;
            assert.equal(q.status, 'ready');
            assert.equal(q.source, 'preview');
            assert.equal(q.language, 'ar');
            assert.ok(q.jdHash && q.promptVersion && q.generatedAt);
            assert.deepEqual(q.questions.map((x: Json) => x.question), GOOD_AR.map((x) => x.question));
            assert.equal(sent.length, 0, 'the stored set must not be regenerated');
        });
        await test('create with a valid edit: stored as edited', async () => {
            const edited = withQ(2, 'استفسارات الموظفين، إذا موظف اعترض على خصم سلفة، شنو راح تراجع أول؟');
            const { json } = await call('POST', '', job({ jdInterviewQuestions: edited, jdInterviewQuestionsSource: 'edited' }));
            const q = (await saved(json.campaignId)).jdInterviewQuestions;
            assert.equal(q.source, 'edited');
            assert.equal(q.questions[2].question, edited[2].question);
        });
        await test('create with a bad edit: refused with the question and the reason, and NO job is created', async () => {
            const before = await RecruitmentCampaign.countDocuments({});
            const bad = withQ(1, 'مراجعة الحضور، إذا صار غياب، شلون راح تتصرف وشنو راح تسوي؟');
            const { status, json } = await call('POST', '', job({ jdInterviewQuestions: bad, jdInterviewQuestionsSource: 'edited' }));
            assert.equal(status, 400);
            assert.equal(json.error, 'JD_QUESTIONS_INVALID');
            assert.deepEqual(json.problems, [{ index: 1, codes: ['two_asks'] }]);
            assert.equal(await RecruitmentCampaign.countDocuments({}), before);
        });
        await test('create with two questions is refused (three or none)', async () => {
            const { status, json } = await call('POST', '', job({ jdInterviewQuestions: GOOD_AR.slice(0, 2) }));
            assert.equal(status, 400);
            assert.ok(json.setProblems.includes('count'));
        });
        await test('questions without the description they came from are refused', async () => {
            const { status, json } = await call('POST', '', job({ jobDescription: '', jdInterviewQuestions: GOOD_AR }));
            assert.equal(status, 400);
            assert.equal(json.error, 'JD_QUESTIONS_WITHOUT_DESCRIPTION');
        });
        await test('«continue without»: remembered as skipped and never generated later', async () => {
            const { json } = await call('POST', '', job({ jdInterviewQuestionsSkip: true }));
            await settle();
            const q = (await saved(json.campaignId)).jdInterviewQuestions;
            assert.equal(q.status, 'failed');
            assert.equal(q.error, 'skipped_by_owner');
            assert.equal(sent.length, 0);
            assert.equal(await svc.ensureUncached(json.campaignId), 'busy_or_done');
            assert.equal(sent.length, 0);
        });
        await test('fallback: a job created with a description and no preview is generated in the background', async () => {
            replies.push({ content: modelSet(GOOD_AR) });
            const { json } = await call('POST', '', job());
            await waitFor(async () => (await saved(json.campaignId)).jdInterviewQuestions?.status === 'ready');
            const q = (await saved(json.campaignId)).jdInterviewQuestions;
            assert.equal(q.source, 'background');
            assert.equal(q.questions.length, 3);
            assert.equal(sent.length, 1);
        });
        await test('fallback: an English interview is not generated (language not enabled)', async () => {
            const { json } = await call('POST', '', job({ interviewLanguage: 'en', language: 'en' }));
            await settle();
            assert.equal((await saved(json.campaignId)).jdInterviewQuestions, undefined);
            assert.equal(sent.length, 0);
        });

        // Database claim.
        const bare = async (extra: Json = {}): Promise<string> => {
            const campaignId = `jdq-${Math.random().toString(16).slice(2)}`;
            await RecruitmentCampaign.create({ campaignId, criteria: { position: 'Payroll Specialist' }, interviewLanguage: 'ar', jobDescription: DESCRIPTION, ...extra });
            return campaignId;
        };
        await test('two claims at once (no in-memory shortcut) → one model call', async () => {
            const id = await bare();
            replies.push({ content: modelSet(GOOD_AR), delayMs: 200 }, { content: modelSet(GOOD_AR) });
            const results = await Promise.all([svc.ensureUncached(id), svc.ensureUncached(id)]);
            assert.deepEqual(results.sort(), ['busy_or_done', 'ready']);
            assert.equal(sent.length, 1);
        });
        await test('a stale pending claim (a process died mid-generation) is taken again', async () => {
            const id = await bare({ jdInterviewQuestions: { status: 'pending', startedAt: new Date(Date.now() - 20 * 60 * 1000) } });
            replies.push({ content: modelSet(GOOD_AR) });
            assert.equal(await svc.ensureUncached(id), 'ready');
        });
        await test('a fresh pending claim is left alone', async () => {
            const id = await bare({ jdInterviewQuestions: { status: 'pending', startedAt: new Date() } });
            assert.equal(await svc.ensureUncached(id), 'busy_or_done');
            assert.equal(sent.length, 0);
        });
        await test('ready and failed sets are never regenerated', async () => {
            const ready = await bare({ jdInterviewQuestions: { status: 'ready', questions: GOOD_AR.map((q, i) => ({ id: `q${i + 1}`, ...q })) } });
            const failed = await bare({ jdInterviewQuestions: { status: 'failed', error: 'checks_failed' } });
            assert.equal(await svc.ensureUncached(ready), 'busy_or_done');
            assert.equal(await svc.ensureUncached(failed), 'busy_or_done');
            assert.equal(sent.length, 0);
        });
        await test('a failed background generation stores failed, with no questions', async () => {
            const id = await bare();
            const bad = modelSet(withQ(0, 'صرف الرواتب، إذا صار خطأ، شنو سويت؟'));
            replies.push({ content: bad }, { content: bad });
            assert.equal(await svc.ensureUncached(id), 'failed');
            const q = (await saved(id)).jdInterviewQuestions;
            assert.equal(q.status, 'failed');
            assert.equal(q.error, 'checks_failed');
            assert.ok(!q.questions || q.questions.length === 0);
        });

        // Voice never reads it.
        await test('the voice interview code never mentions the questions (video only)', () => {
            const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
            const files: string[] = [];
            const walk = (d: string): void => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const p = path.join(d, e.name);
                    if (e.isDirectory()) walk(p);
                    else if (/\.(ts|js)$/.test(e.name)) files.push(p);
                }
            };
            walk(path.join(src, 'evaalo-only-voice'));
            for (const f of fs.readdirSync(path.join(src, 'routes'))) if (/^voiceInterview/i.test(f)) files.push(path.join(src, 'routes', f));
            assert.ok(files.length > 3, 'no voice files found to scan');
            const hits = files.filter((f) => /jdInterviewQuestions|jd_questions|jdQuestions/.test(fs.readFileSync(f, 'utf8')));
            assert.deepEqual(hits, []);
        });

        // Rate limit last: it spends this organization's hour.
        await test('preview: 20 per organization per hour, then 429', async () => {
            let limited = 0;
            for (let i = 0; i < 25; i += 1) {
                replies.push({ content: modelSet(GOOD_AR) });
                const { status } = await call('POST', '/jd-interview-questions/preview', { text: DESCRIPTION, interviewLanguage: 'ar' });
                if (status === 429) limited += 1;
            }
            assert.ok(limited >= 5, `limited ${limited}`);
        });
    } finally {
        server?.close();
        fake.close();
        await mongoose.disconnect();
        await mongo.stop();
    }
    console.log(`\n[jd-interview-questions] ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((err) => {
    console.error('[jd-interview-questions] crashed:', err);
    process.exit(1);
});
