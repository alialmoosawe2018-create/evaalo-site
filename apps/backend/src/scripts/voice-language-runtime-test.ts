/**
 * The voice interview's language, proven by RUNNING the voice server — not by
 * reading its source.
 *
 * `voice-interview-language-test.ts` and `interview-language-contract-test.ts`
 * read the code and check that each consumer is handed the resolved language.
 * That is how the greeting regression of 2026-09-23 slipped through the first
 * time: the test checked an ORDER in the source, not what the greeting received.
 * This file removes the reading step. It opens real WebSocket sessions against
 * the real `handleVoiceWsConnection`, backed by a real (in-memory) MongoDB with
 * real campaigns, candidates and applications, and records what actually
 * crosses each boundary:
 *
 *   - what the greeting SAYS, and the voice it is spoken with (TTS language)
 *   - the language the speech recogniser is opened with
 *   - the language handed to the model on every turn, and the phase
 *   - the closing, the resume line, and the payload that leaves for n8n
 *
 * Only the four boundaries that cost money or leave the machine are replaced by
 * recorders: text-to-speech, speech-to-text, the n8n send, and (unless
 * REAL_LLM=1) the question-writing model. Everything between them — campaign
 * load, the resolver, the question engine, the phase controller, the link lock,
 * the resume window — is the production code.
 *
 * Run: npx tsx --experimental-test-module-mocks src/scripts/voice-language-runtime-test.ts
 *      REAL_LLM=1 … lets the model write the questions (network; a few cents).
 *      VERBOSE=1 … echoes the server log.
 */
import { mock } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { WebSocketServer, WebSocket } from 'ws';

const REAL_LLM = process.env.REAL_LLM === '1';
const VERBOSE = process.env.VERBOSE === '1';

/* ── environment: set BEFORE the server modules load (dotenv never overrides) ── */
Object.assign(process.env, {
    BILLING_ENFORCE: 'false',
    STAGE_CALLBACK_SECURITY_MODE: 'optional',
    VOICE_RECORDING_ENABLED: 'false',
    // as in production
    APPLICATION_OWNS_CAMPAIGN_STATE: 'true',
    // The limiter counts control messages per IP address, per MINUTE, across all
    // sessions. Every session here comes from 127.0.0.1 within seconds, so the
    // production value (60) starts dropping playback_ended mid-run — a harness
    // artefact: a real candidate sends about two per turn from their own address.
    VOICE_WS_RATE_LIMIT_PER_MIN: '100000',
    // turn timing shortened so a full interview runs in seconds; the logic is unchanged
    VOICE_TTS_USE_TIMESTAMPS: 'false',
    VOICE_TTS_TO_STT_DELAY_MS: '0',
    VOICE_POST_AUDIO_PADDING_MS: '0',
    VOICE_POST_PLAYBACK_RESUME_MS: '0',
    VOICE_LATE_TRANSCRIPT_IGNORE_MS: '0',
    VOICE_USER_STOPPED_MS: '400',
    VOICE_USER_STOPPED_PUNCT_MS: '300',
    VOICE_SPEECH_SILENCE_MS: '300',
    VOICE_INCOMPLETE_TAIL_EXTRA_MS: '0',
    VOICE_PLAYBACK_FALLBACK_MS: '3000',
    // no provider can be reached by accident, recorded or not
    ELEVENLABS_API_KEY: '',
    SPEECHMATICS_API_KEY: '',
    DEEPGRAM_API_KEY: '',
    N8N_WEBHOOK_URL: '',
});
if (!REAL_LLM) process.env.OPENAI_API_KEY = '';

/* ── the recorders ─────────────────────────────────────────────────────────── */
type TtsCall = { text: string; language: string | undefined };
type SttCall = { sid: string; language: string | undefined };
type LlmCall = { sessionLanguage: string | undefined; phase: number | undefined; selected?: string };
const rec = {
    tts: [] as TtsCall[],
    stt: [] as SttCall[],
    llm: [] as LlmCall[],
    n8n: [] as Array<Record<string, any>>,
    logs: [] as string[],
};
const sttCallbacks = new Map<string, (text: string, isFinal: boolean, confidence?: number) => void>();
function resetRecorders() {
    rec.tts.length = 0;
    rec.stt.length = 0;
    rec.llm.length = 0;
    rec.n8n.length = 0;
    rec.logs.length = 0;
}

for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
        rec.logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        if (VERBOSE) original(...args);
    };
}
const out = (s: string) => process.stdout.write(s + '\n');

/* `mock.module` exists from Node 22.3 (CI runs 22; it needs the flag in the Run
   line), but the repo's @types/node is 20.x and does not declare it. */
const mockModule = (mock as unknown as {
    module: (specifier: string, options: { namedExports?: object; defaultExport?: unknown }) => void;
}).module.bind(mock);

/** Replace some exports of a module, keep the rest real. */
async function mockKeepingRest(specifier: string, overrides: Record<string, unknown>) {
    const actual = (await import(specifier)) as Record<string, unknown>;
    const named: Record<string, unknown> = { ...actual };
    delete named.default;
    mockModule(specifier, {
        namedExports: { ...named, ...overrides },
        ...(actual.default !== undefined ? { defaultExport: actual.default } : {}),
    });
    return actual;
}

await mockKeepingRest('../services/ttsService.js', {
    textToSpeech: async (text: string, language?: string, onChunk?: (c: Buffer) => void) => {
        rec.tts.push({ text, language });
        onChunk?.(Buffer.from([0]));
        return Buffer.from([0]);
    },
    textToSpeechWithTimestamps: async (text: string, language: string | undefined, cb: (a: Buffer, al: unknown) => void) => {
        rec.tts.push({ text, language });
        cb(Buffer.from([0]), null);
    },
});
await mockKeepingRest('../services/sttRouterService.js', {
    createSTTRouterConnection: (
        sid: string,
        onTranscript: (text: string, isFinal: boolean, confidence?: number) => void,
        _onError: unknown,
        onReady?: () => void,
        language?: string
    ) => {
        rec.stt.push({ sid, language });
        sttCallbacks.set(sid, onTranscript);
        onReady?.();
    },
    sendAudioToSTTRouter: () => {},
    closeSTTRouterConnection: () => {},
});
await mockKeepingRest('../services/n8nService.js', {
    finalizeAndSendVoiceTranscriptToN8N: async (payload: Record<string, any>) => {
        rec.n8n.push(payload);
    },
});
let stubTurn = 0;
const actualLlm = (await import('../services/llmService.js')) as Record<string, any>;
await mockKeepingRest('../services/llmService.js', {
    getLLMResponse: async (text: string, opts: Record<string, any>) => {
        rec.llm.push({
            sessionLanguage: opts.sessionLanguage,
            phase: opts.currentPhase,
            selected: opts.selectedQuestion?.text,
        });
        if (REAL_LLM) return actualLlm.getLLMResponse(text, opts);
        stubTurn += 1;
        const english = opts.sessionLanguage === 'en' || opts.currentPhase === 3;
        return english
            ? `Thanks. Stub question ${stubTurn}: what did you handle on that project?`
            : `شكراً. سؤال تجريبي ${stubTurn}: شنو الشي اللي تعاملت وياه بهذا المشروع؟`;
    },
});

const { handleVoiceWsConnection } = await import('../evaalo-only-voice/voiceSessionCore.js');
const { INTERVIEW_LINK_ALREADY_USED } = await import('../services/interviewLinkAccess.js');
const Candidate = (await import('../models/Candidate.js')).default;
const CandidateApplication = (await import('../models/CandidateApplication.js')).default;
const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;

/* ── assertions ────────────────────────────────────────────────────────────── */
let failures = 0;
let passes = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
        passes += 1;
        out(`  ok   ${name}`);
    } else {
        failures += 1;
        out(`  FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── a client that behaves like useVoiceInterview ──────────────────────────── */
class VoiceClient {
    ws: WebSocket;
    msgs: Array<Record<string, any>> = [];
    closed = false;
    closeCode?: number;
    /** @param playbackMs how long "the audio plays" before the browser reports its end */
    constructor(url: string, playbackMs = 0) {
        this.ws = new WebSocket(url);
        this.ws.on('message', (data) => {
            let m: Record<string, any>;
            try {
                m = JSON.parse(String(data));
            } catch {
                return;
            }
            this.msgs.push(m);
            // the browser reports the end of every playback
            if (m.type === 'tts_complete') {
                const report = () => {
                    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'playback_ended' }));
                };
                if (playbackMs > 0) setTimeout(report, playbackMs);
                else report();
            }
        });
        this.ws.on('close', (code) => {
            this.closed = true;
            this.closeCode = code;
        });
    }
    opened() {
        return new Promise<void>((resolve, reject) => {
            this.ws.once('open', () => resolve());
            this.ws.once('error', reject);
        });
    }
    send(m: Record<string, unknown>) {
        this.ws.send(JSON.stringify(m));
    }
    async waitFor(pred: (m: Record<string, any>) => boolean, from: number, timeoutMs = 15000): Promise<number> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            for (let i = from; i < this.msgs.length; i++) if (pred(this.msgs[i])) return i;
            if (this.closed) return -1;
            await sleep(20);
        }
        return -1;
    }
    async waitClosed(timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (!this.closed && Date.now() < deadline) await sleep(20);
        return this.closed;
    }
}

let port = 0;
async function connect(query: Record<string, string | undefined>, playbackMs = 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, v);
    const c = new VoiceClient(`ws://127.0.0.1:${port}/ws/voice-interview?${qs}`, playbackMs);
    await c.opened();
    return c;
}

type RunResult = {
    greeting?: string;
    replies: string[];
    errors: Array<Record<string, any>>;
    client: VoiceClient;
    langLine?: string;
    /** Why the scripted conversation stopped before its last turn, if it did. */
    stall?: string;
};

/**
 * Start a session, answer `turns` questions, then end it the way `end` says.
 * Answers are injected through the recorded speech-to-text callback — exactly
 * where Speechmatics would deliver them.
 */
async function runSession(
    query: Record<string, string | undefined>,
    opts: {
        turns: number;
        answer: (turn: number) => string;
        end: 'none' | 'time' | 'client' | 'server';
        playbackMs?: number;
    }
): Promise<RunResult> {
    const client = await connect(query, opts.playbackMs ?? 0);
    client.send({ type: 'start_listening' });
    const result: RunResult = { replies: [], errors: [], client };
    const gi = await client.waitFor((m) => m.type === 'agent_reply' || m.type === 'error', 0);
    if (gi >= 0 && client.msgs[gi].type === 'agent_reply') result.greeting = client.msgs[gi].text;
    let cursor = gi + 1;
    for (let t = 1; t <= opts.turns && gi >= 0 && client.msgs[gi].type === 'agent_reply'; t++) {
        const li = await client.waitFor((m) => m.type === 'state' && m.state === 'LISTENING', cursor);
        if (li < 0) {
            // a server that ended the interview itself is the expected way out, not a stall
            if (!(client.closed && client.closeCode === 1000)) result.stall = `turn ${t}: never went back to LISTENING${client.closed ? ` (closed ${client.closeCode})` : ''}`;
            break;
        }
        await sleep(30);
        const sid = rec.stt[rec.stt.length - 1]?.sid;
        const inject = sid ? sttCallbacks.get(sid) : undefined;
        if (!inject) {
            result.stall = `turn ${t}: no recogniser to speak into`;
            break;
        }
        inject(opts.answer(t), true, 0.95);
        const ri = await client.waitFor((m) => m.type === 'agent_reply', li + 1, 20000);
        if (ri < 0) {
            result.stall = `turn ${t}: no reply to "${opts.answer(t).slice(0, 40)}…"${client.closed ? ` (closed ${client.closeCode})` : ''}`;
            break;
        }
        result.replies.push(client.msgs[ri].text);
        cursor = ri + 1;
        if (client.closed) break;
    }
    if (opts.end === 'time' && !client.closed) {
        await client.waitFor((m) => m.type === 'state' && m.state === 'LISTENING', cursor, 5000);
        client.send({ type: 'interview_time_ended' });
        const ci = await client.waitFor((m) => m.type === 'agent_reply', cursor + 1, 10000);
        if (ci >= 0) result.replies.push(client.msgs[ci].text);
        await client.waitClosed();
    } else if (opts.end === 'client' && !client.closed) {
        await client.waitFor((m) => m.type === 'state' && m.state === 'LISTENING', cursor, 5000);
        client.ws.close(1000, 'client left');
        await client.waitClosed();
    } else if (opts.end === 'server') {
        await client.waitClosed(30000);
    }
    if (opts.end !== 'none') {
        // the close path is async: wait for the transcript to "leave"
        const deadline = Date.now() + 5000;
        while (rec.n8n.length === 0 && Date.now() < deadline) await sleep(25);
    }
    result.errors = client.msgs.filter((m) => m.type === 'error');
    result.langLine = rec.logs.find((l) => l.startsWith('[LANG] '));
    return result;
}

/* ── fixtures ──────────────────────────────────────────────────────────────── */
const CAMPAIGNS = [
    // interview in English, REPORT in Arabic — the two must not be confused
    { campaignId: 'rt-en', interviewLanguage: 'en', criteria: { position: 'Sales Engineer', evaluationLanguage: 'ar' } },
    { campaignId: 'rt-ar', interviewLanguage: 'ar', criteria: { position: 'مهندس سلامة', evaluationLanguage: 'en' } },
    // created before the field existed: the report language is the only signal
    { campaignId: 'rt-legacy-en', criteria: { position: 'Accountant', evaluationLanguage: 'en' } },
    { campaignId: 'rt-legacy-ar', criteria: { position: 'محاسب', evaluationLanguage: 'ar' } },
    { campaignId: 'rt-legacy-oldkey', criteria: { position: 'Designer', language: 'en' } },
];
let seq = 0;
async function person(opts: { name: string; personCampaign?: string; applicationCampaign?: string; position?: string }) {
    seq += 1;
    const _id = new mongoose.Types.ObjectId();
    await Candidate.collection.insertOne({
        _id,
        full_name: opts.name,
        email: `rt${seq}@example.com`,
        phone: '07800000000',
        position_applied_for: opts.position ?? 'Engineer',
        ...(opts.personCampaign ? { campaignId: opts.personCampaign } : {}),
        createdAt: new Date(),
    });
    let applicationId: string | undefined;
    if (opts.applicationCampaign) {
        applicationId = `RT-APP-${seq}`;
        await CandidateApplication.collection.insertOne({
            candidateId: _id,
            applicationId,
            emailDenorm: `rt${seq}@example.com`,
            campaignId: opts.applicationCampaign,
            position_applied_for: opts.position ?? 'Engineer',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }
    return { candidateId: String(_id), applicationId };
}
const EN_ANSWERS = [
    'I worked for three years as a sales engineer handling industrial pumps and client visits in Basra.',
    'My main responsibility was preparing technical offers and following up with procurement teams weekly.',
    'I usually plan my week on Sunday and keep a shared sheet so my manager can see progress on every deal.',
    'When two clients needed me at once I agreed a time with each one and delivered both offers on schedule.',
    'I use Excel daily for pricing and our CRM system for tracking quotations and customer follow ups.',
    'I learned the new product line in two weeks by reading the manuals and shadowing a senior engineer.',
];
const AR_ANSWERS = [
    'اشتغلت ثلاث سنوات مهندس سلامة بشركة نفطية بالبصرة وكنت مسؤول عن التفتيش اليومي على المواقع.',
    'كنت أحضر تقارير الحوادث وأتابع تطبيق إجراءات السلامة ويا فرق المقاولين كل أسبوع بشكل منتظم.',
    'أرتب شغلي من بداية الأسبوع وأسوي جدول للتفتيشات حتى مديري يشوف التقدم أول بأول بدون تأخير.',
    'من صار عندي موقفين بنفس الوقت اتفقت ويا كل فريق على وقت وخلصت الاثنين بالموعد المحدد.',
    'أستخدم الإكسل يومياً للتقارير ونظام الشركة لتسجيل الملاحظات ومتابعة الإجراءات التصحيحية.',
    'تعلمت نظام التصاريح الجديد خلال أسبوعين من خلال القراءة ومرافقة مهندس أقدم مني بالموقع.',
];
const EN_TAIL = 'I also keep notes after every meeting so nothing is missed.';
const AR_TAIL = 'وأسجل ملاحظاتي بعد كل اجتماع حتى ما يفوتني شي.';
const englishAnswer = (t: number) => `${EN_ANSWERS[(t - 1) % EN_ANSWERS.length]} ${t > EN_ANSWERS.length ? EN_TAIL : ''}`.trim();
const arabicAnswer = (t: number) => `${AR_ANSWERS[(t - 1) % AR_ANSWERS.length]} ${t > AR_ANSWERS.length ? AR_TAIL : ''}`.trim();
// Phase 3 of an Arabic interview is the English test: answer it in English.
const arabicThenEnglish = (t: number) => (t <= 13 ? arabicAnswer(t) : englishAnswer(t));

/* ── the run ───────────────────────────────────────────────────────────────── */
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
await RecruitmentCampaign.collection.insertMany(CAMPAIGNS.map((c) => ({ ...c, createdAt: new Date() })));

const server = http.createServer();
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => handleVoiceWsConnection(ws as any, req));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
port = (server.address() as AddressInfo).port;
out(`voice server on :${port}, in-memory mongo, LLM=${REAL_LLM ? 'REAL' : 'recorded stub'}\n`);

type Expect = { lang: 'ar' | 'en'; source: string };
async function greetingScenario(
    title: string,
    query: Record<string, string | undefined>,
    expect: Expect,
    opts: { turns?: number } = {}
) {
    resetRecorders();
    out(`▶ ${title}`);
    const turns = opts.turns ?? 1;
    const r = await runSession(query, {
        turns,
        answer: expect.lang === 'en' ? englishAnswer : arabicAnswer,
        end: 'client',
    });
    check('the session resolved the expected language', r.langLine?.match(/resolved=(\w+)/)?.[1], expect.lang);
    check('…from the expected source', r.langLine?.match(/source=(\w+)/)?.[1], expect.source);
    check('the greeting was spoken', typeof r.greeting, 'string');
    check(`the greeting is in ${expect.lang === 'en' ? 'English' : 'Arabic'}`, hasArabic(r.greeting ?? ''), expect.lang === 'ar');
    check('the greeting voice (TTS) is the session language', rec.tts[0]?.language, expect.lang);
    check('the recogniser (STT) was opened in the session language', rec.stt.every((s) => s.language === expect.lang) && rec.stt.length > 0, true);
    if (turns > 0 && !query.voiceTest) {
        check(`the model got sessionLanguage=${expect.lang} on every turn`, rec.llm.length > 0 && rec.llm.every((c) => c.sessionLanguage === expect.lang), true);
    }
    check('every agent line was voiced in the session language', rec.tts.every((c) => c.language === expect.lang), true);
    check('no error reached the candidate', r.errors.length, 0);
    out(`     greeting: ${(r.greeting ?? '').slice(0, 90)}`);
    out(`     ${r.langLine ?? '(no [LANG] line)'}`);
    return r;
}

// 1. PUBLIC link (PublicScreeningCall → mode=public; the hook defaults language=ar)
{
    const p = await person({ name: 'John Carter', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    await greetingScenario('public link · English campaign · socket says language=ar',
        { candidateId: p.candidateId, language: 'ar', mode: 'public', position: 'Sales Engineer', campaignId: 'rt-en' },
        { lang: 'en', source: 'campaign' });
}
{
    const p = await person({ name: 'علي حسن', applicationCampaign: 'rt-ar', position: 'مهندس سلامة' });
    await greetingScenario('public link · Arabic campaign · an old link that says language=en',
        { candidateId: p.candidateId, language: 'en', mode: 'public', position: 'مهندس سلامة', campaignId: 'rt-ar' },
        { lang: 'ar', source: 'campaign' });
}
// 2. PRIVATE link (Interview.jsx → candidateId + campaignId + applicationId, no mode)
{
    const p = await person({ name: 'Sara Ahmed', applicationCampaign: 'rt-legacy-en', position: 'Accountant' });
    await greetingScenario('private link · campaign from before the field · report language en',
        { candidateId: p.candidateId, language: 'ar', campaignId: 'rt-legacy-en', applicationId: p.applicationId },
        { lang: 'en', source: 'legacy_evaluation_language' });
}
{
    const p = await person({ name: 'زينب كريم', applicationCampaign: 'rt-legacy-ar', position: 'محاسب' });
    await greetingScenario('THE 2026-09-23 BUG · private link carrying language=en · Arabic campaign',
        { candidateId: p.candidateId, language: 'en', campaignId: 'rt-legacy-ar', applicationId: p.applicationId },
        { lang: 'ar', source: 'legacy_evaluation_language' });
}
{
    const p = await person({ name: 'Mark Lee', applicationCampaign: 'rt-legacy-oldkey', position: 'Designer' });
    await greetingScenario('private link · oldest campaigns (criteria.language key)',
        { candidateId: p.candidateId, campaignId: 'rt-legacy-oldkey', applicationId: p.applicationId },
        { lang: 'en', source: 'legacy_evaluation_language' });
}
// 3. The link names no campaign — the APPLICATION decides, not the person
{
    const p = await person({ name: 'Omar Nabil', personCampaign: 'rt-ar', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    await greetingScenario('link without campaignId · person first applied to an Arabic job, this application is English',
        { candidateId: p.candidateId, applicationId: p.applicationId, language: 'ar' },
        { lang: 'en', source: 'campaign' });
}
{
    const p = await person({ name: 'نور علي' });
    await greetingScenario('no campaign anywhere ⇒ Arabic',
        { candidateId: p.candidateId, language: 'en' },
        { lang: 'ar', source: 'default' });
}
{
    const p = await person({ name: 'حيدر سالم' });
    await greetingScenario('a campaignId that does not exist ⇒ Arabic',
        { candidateId: p.candidateId, campaignId: 'rt-does-not-exist', language: 'en' },
        { lang: 'ar', source: 'default' });
}
{
    const p = await person({ name: 'Lana Aziz', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    await greetingScenario('a Kurdish link on an English campaign',
        { candidateId: p.candidateId, campaignId: 'rt-en', applicationId: p.applicationId, language: 'ku' },
        { lang: 'en', source: 'campaign' });
}
// 4. The voice-test tool has no campaign — its link is all it has
await greetingScenario('voice test tool · language=en', { voiceTest: '1', language: 'en' }, { lang: 'en', source: 'voice_test_link' }, { turns: 0 });
await greetingScenario('voice test tool · no language', { voiceTest: '1' }, { lang: 'ar', source: 'voice_test_link' }, { turns: 0 });

/* ── full interviews ───────────────────────────────────────────────────────── */
out('\n▶ a FULL English interview · public link · ended by the timer');
{
    resetRecorders();
    const p = await person({ name: 'John Carter', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    const r = await runSession(
        { candidateId: p.candidateId, language: 'ar', mode: 'public', position: 'Sales Engineer', campaignId: 'rt-en' },
        { turns: 16, answer: englishAnswer, end: 'time' }
    );
    const phases = [...new Set(rec.llm.map((c) => c.phase))];
    check('16 answers were taken', r.replies.length >= 16, true);
    check('the model was told English on every turn', rec.llm.every((c) => c.sessionLanguage === 'en'), true);
    check('an English interview never enters phase 3 (the English test)', phases.includes(3), false);
    check('it reached phase 2', phases.includes(2), true);
    check('every line the agent spoke was voiced in English', rec.tts.length > 0 && rec.tts.every((c) => c.language === 'en'), true);
    check('no Arabic line was spoken', rec.tts.some((c) => hasArabic(c.text)), false);
    check('the closing is English', hasArabic(r.replies[r.replies.length - 1] ?? 'ـ'), false);
    check('the server closed it', r.client.closeCode, 1000);
    check('no error reached the candidate', JSON.stringify(r.errors), '[]');
    check('no turn waited out a lost playback_ended', rec.logs.some((l) => l.includes('[PLAYBACK TIMEOUT]')), false);
    const payload = rec.n8n[0] ?? {};
    check('the transcript left for n8n', rec.n8n.length, 1);
    /* Passed through exactly as before. It is only the report's SECOND fallback:
       n8nService resolves the report language from the campaign's criteria first. */
    check('the n8n payload `language` is the socket value, passed through as before', payload.language, 'ar');
    check('…and so is the campaign it carries', payload.campaignId, 'rt-en');
    check('phaseReached = 2', payload.sessionEnd?.phaseReached, 2);
    check('not flagged as ended before the English phase', payload.sessionEnd?.earlyEnd, false);
    out(`     phases seen: ${phases.join(',')} · turns: ${rec.llm.length} · end cause: ${payload.sessionEnd?.cause}`);
}

out('\n▶ a FULL Arabic interview · public link that says language=en · ended by the server');
let arabicDone: { candidateId: string; applicationId?: string } | undefined;
{
    resetRecorders();
    const p = await person({ name: 'علي حسن', applicationCampaign: 'rt-ar', position: 'مهندس سلامة' });
    arabicDone = p;
    const r = await runSession(
        { candidateId: p.candidateId, language: 'en', mode: 'public', position: 'مهندس سلامة', campaignId: 'rt-ar' },
        { turns: 30, answer: arabicThenEnglish, end: 'server' }
    );
    const phases = [...new Set(rec.llm.map((c) => c.phase))];
    check('the model was told Arabic on every turn', rec.llm.length > 0 && rec.llm.every((c) => c.sessionLanguage === 'ar'), true);
    check('an Arabic interview reaches phase 3 (the English test)', rec.logs.some((l) => /\[PHASE\].*phase=3/.test(l)), true);
    check('the Arabic voice spoke every line, the English test included', rec.tts.length > 0 && rec.tts.every((c) => c.language === 'ar'), true);
    check('the server ended the interview itself', r.client.closeCode, 1000);
    check('no error reached the candidate', JSON.stringify(r.errors), '[]');
    check('no turn waited out a lost playback_ended', rec.logs.some((l) => l.includes('[PLAYBACK TIMEOUT]')), false);
    const payload = rec.n8n[0] ?? {};
    check('the transcript left for n8n', rec.n8n.length, 1);
    check('the n8n payload `language` is the socket value, passed through as before', payload.language, 'en');
    check('phaseReached = 3', payload.sessionEnd?.phaseReached, 3);
    check('completed by the server', payload.sessionEnd?.completedByServer, true);
    out(`     phases (model turns): ${phases.join(',')} · answers: ${r.replies.length} · end cause: ${payload.sessionEnd?.cause}`);
    if (r.stall) {
        out(`     STALLED — ${r.stall}; last server lines:`);
        rec.logs.slice(-14).forEach((l) => out(`       ${l.slice(0, 200)}`));
    }
}

out('\n▶ the same Arabic link, opened again after the interview finished');
{
    resetRecorders();
    const r = await runSession(
        { candidateId: arabicDone!.candidateId, language: 'en', mode: 'public', campaignId: 'rt-ar' },
        { turns: 0, answer: arabicAnswer, end: 'none' }
    );
    await r.client.waitClosed();
    check('refused as already used', r.errors[0]?.code, INTERVIEW_LINK_ALREADY_USED);
    check('closed with 4001', r.client.closeCode, 4001);
    check('no greeting was spoken', r.greeting, undefined);
}

out('\n▶ resume · English campaign · the candidate drops out after 5 answers and comes back');
{
    resetRecorders();
    const p = await person({ name: 'Maya Stone', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    const q = { candidateId: p.candidateId, campaignId: 'rt-en', applicationId: p.applicationId, language: 'ar' };
    await runSession(q, { turns: 5, answer: englishAnswer, end: 'client' });
    check('the session was parked for the grace window', rec.logs.some((l) => l.includes('[RESUME]') && l.includes('parked until')), true);
    resetRecorders();
    // Real playback time on the way back: the resume line's backup timer (3 s here)
    // fires while the first question after it is still playing (V17).
    const back = await runSession(q, { turns: 2, answer: (t) => englishAnswer(t + 5), end: 'client', playbackMs: 2000 });
    check('it reattached to the same interview', rec.logs.some((l) => l.includes('reattached within the grace window')), true);
    check('the resume line is English', back.greeting, 'Welcome back. Let us continue from where we stopped.');
    check('…in the English voice', rec.tts[0]?.language, 'en');
    check('the next turn still went to the model in English', rec.llm.length > 0 && rec.llm.every((c) => c.sessionLanguage === 'en'), true);
    check('V17: both questions after the resume line were answered', back.replies.length, 2);
    check('V17: no turn waited out a lost playback_ended after the resume line', rec.logs.some((l) => l.includes('[PLAYBACK TIMEOUT]')), false);
}

/* V17 — the greeting's backup timer must not erase a LATER turn's wait.
   It used to: the timer was never cleared, and its `done` deleted whatever wait
   was registered for the session. With the browser taking 2 s to play each line
   and the backup at 3 s, the first question is still playing when it fires; the
   browser's playback_ended for that question was then ignored and the server
   stayed in SPEAKING — throwing away the candidate's first words. */
out('\n▶ V17 · real playback time · the greeting backup timer fires while question 1 is playing');
{
    resetRecorders();
    const p = await person({ name: 'Rana Yousif', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    const r = await runSession(
        { candidateId: p.candidateId, campaignId: 'rt-en', applicationId: p.applicationId },
        { turns: 3, answer: () => 'Yes, I am ready to start.', end: 'client', playbackMs: 2000 }
    );
    check('all three questions were asked and answered', r.replies.length, 3);
    check('every playback_ended was honoured (greeting + 3 questions)', rec.logs.filter((l) => l.startsWith('[PLAYBACK_ENDED]')).length, 4);
    check('no turn waited out a lost playback_ended', rec.logs.some((l) => l.includes('[PLAYBACK TIMEOUT]')), false);
    if (r.stall) out(`     STALLED — ${r.stall}`);
}

out('\n▶ an English interview · the candidate answers in Arabic, then asks for Arabic');
{
    resetRecorders();
    const p = await person({ name: 'Ahmed Saleh', applicationCampaign: 'rt-en', position: 'Sales Engineer' });
    const answers = [
        'اشتغلت مهندس مبيعات ثلاث سنوات وكنت أتابع العملاء بالبصرة بشكل يومي.',
        'Can we continue in Arabic please?',
        'أكيد، كنت مسؤول عن تحضير العروض الفنية ومتابعة المشتريات كل أسبوع.',
    ];
    await runSession(
        { candidateId: p.candidateId, campaignId: 'rt-en', applicationId: p.applicationId, language: 'ar' },
        { turns: 3, answer: (t) => answers[t - 1], end: 'client' }
    );
    check('an Arabic answer alone does NOT change the language', rec.llm[0]?.sessionLanguage, 'en');
    check('an explicit request switches it', rec.logs.some((l) => l.includes('[LANG SWITCH]') && l.includes('en -> ar')), true);
    check('…the model is told Arabic from that turn', rec.llm[1]?.sessionLanguage, 'ar');
    check('…and the Arabic voice takes over', rec.tts[rec.tts.length - 1]?.language, 'ar');
}

/* ── teardown ──────────────────────────────────────────────────────────────── */
wss.close();
server.close();
await mongoose.disconnect();
await mongo.stop();
out(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
