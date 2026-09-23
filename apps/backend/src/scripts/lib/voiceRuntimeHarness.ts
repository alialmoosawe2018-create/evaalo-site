/**
 * Runs the REAL voice interview server — `handleVoiceWsConnection` — over real
 * WebSockets, on an in-memory MongoDB, so a test can watch what actually
 * crosses each boundary instead of reading the source.
 *
 * Only the four boundaries that cost money or leave the machine are replaced by
 * recorders: text-to-speech, speech-to-text, the n8n send, and (unless
 * `realLlm`) the question-writing model. Everything between them — campaign
 * load, language, question engine, phases, link lock, resume window — is the
 * production code.
 *
 * ⚠️ Call `setupVoiceRuntime()` BEFORE importing any application module: a mock
 * only reaches modules imported after it. And run under
 * `tsx --experimental-test-module-mocks`.
 *
 * Shared by `voice-language-runtime-test.ts` and `interview-link-reopen-runtime-test.ts`.
 */
import { mock } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { WebSocketServer, WebSocket } from 'ws';

export type TtsCall = { text: string; language: string | undefined };
export type SttCall = { sid: string; language: string | undefined };
export type LlmCall = { sessionLanguage: string | undefined; phase: number | undefined; selected?: string };

export type RunResult = {
    greeting?: string;
    replies: string[];
    errors: Array<Record<string, any>>;
    client: VoiceClient;
    langLine?: string;
    /** Why the scripted conversation stopped before its last turn, if it did. */
    stall?: string;
};

export type RunOptions = {
    turns: number;
    answer: (turn: number) => string;
    end: 'none' | 'time' | 'client' | 'server';
    /** how long "the audio plays" before the browser reports its end */
    playbackMs?: number;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const out = (s: string) => process.stdout.write(s + '\n');

/** A small pass/fail counter with the output format every runtime test uses. */
export function createChecker() {
    let failures = 0;
    let passes = 0;
    const check = (name: string, actual: unknown, expected: unknown) => {
        if (actual === expected) {
            passes += 1;
            out(`  ok   ${name}`);
        } else {
            failures += 1;
            out(`  FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    };
    return { check, summary: () => ({ passes, failures }) };
}

/* ── a client that behaves like useVoiceInterview ──────────────────────────── */
export class VoiceClient {
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

/** An application module, by its path under `src/` — the same URL tsx resolves `../x.js` to. */
const appModule = (rel: string) => new URL(`../../${rel}`, import.meta.url).href;

export async function setupVoiceRuntime(opts: { realLlm?: boolean; verbose?: boolean } = {}) {
    const realLlm = opts.realLlm ?? process.env.REAL_LLM === '1';
    const verbose = opts.verbose ?? process.env.VERBOSE === '1';

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
    if (!realLlm) process.env.OPENAI_API_KEY = '';

    /* ── the recorders ─────────────────────────────────────────────────────── */
    const rec = {
        tts: [] as TtsCall[],
        stt: [] as SttCall[],
        llm: [] as LlmCall[],
        n8n: [] as Array<Record<string, any>>,
        logs: [] as string[],
    };
    const sttCallbacks = new Map<string, (text: string, isFinal: boolean, confidence?: number) => void>();
    const resetRecorders = () => {
        rec.tts.length = 0;
        rec.stt.length = 0;
        rec.llm.length = 0;
        rec.n8n.length = 0;
        rec.logs.length = 0;
    };

    for (const level of ['log', 'warn', 'error'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            rec.logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
            if (verbose) original(...args);
        };
    }

    /* `mock.module` exists from Node 22.3 (CI runs 22; it needs the flag in the Run
       line), but the repo's @types/node is 20.x and does not declare it. */
    const mockModule = (mock as unknown as {
        module: (specifier: string, options: { namedExports?: object; defaultExport?: unknown }) => void;
    }).module.bind(mock);

    /** Replace some exports of a module, keep the rest real. */
    const mockKeepingRest = async (rel: string, overrides: Record<string, unknown>) => {
        const specifier = appModule(rel);
        const actual = (await import(specifier)) as Record<string, unknown>;
        const named: Record<string, unknown> = { ...actual };
        delete named.default;
        mockModule(specifier, {
            namedExports: { ...named, ...overrides },
            ...(actual.default !== undefined ? { defaultExport: actual.default } : {}),
        });
        return actual;
    };

    await mockKeepingRest('services/ttsService.ts', {
        textToSpeech: async (text: string, language?: string, onChunk?: (c: Buffer) => void) => {
            rec.tts.push({ text, language });
            onChunk?.(Buffer.from([0]));
            return Buffer.from([0]);
        },
        textToSpeechWithTimestamps: async (
            text: string,
            language: string | undefined,
            cb: (a: Buffer, al: unknown) => void
        ) => {
            rec.tts.push({ text, language });
            cb(Buffer.from([0]), null);
        },
    });
    await mockKeepingRest('services/sttRouterService.ts', {
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
    await mockKeepingRest('services/n8nService.ts', {
        finalizeAndSendVoiceTranscriptToN8N: async (payload: Record<string, any>) => {
            rec.n8n.push(payload);
        },
    });
    let stubTurn = 0;
    const actualLlm = (await import(appModule('services/llmService.ts'))) as Record<string, any>;
    await mockKeepingRest('services/llmService.ts', {
        getLLMResponse: async (text: string, llmOpts: Record<string, any>) => {
            rec.llm.push({
                sessionLanguage: llmOpts.sessionLanguage,
                phase: llmOpts.currentPhase,
                selected: llmOpts.selectedQuestion?.text,
            });
            if (realLlm) return actualLlm.getLLMResponse(text, llmOpts);
            stubTurn += 1;
            const english = llmOpts.sessionLanguage === 'en' || llmOpts.currentPhase === 3;
            return english
                ? `Thanks. Stub question ${stubTurn}: what did you handle on that project?`
                : `شكراً. سؤال تجريبي ${stubTurn}: شنو الشي اللي تعاملت وياه بهذا المشروع؟`;
        },
    });

    const { handleVoiceWsConnection } = await import(appModule('evaalo-only-voice/voiceSessionCore.ts'));

    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => handleVoiceWsConnection(ws as any, req));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    const connect = async (query: Record<string, string | undefined>, playbackMs = 0) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, v);
        const c = new VoiceClient(`ws://127.0.0.1:${port}/ws/voice-interview?${qs}`, playbackMs);
        await c.opened();
        return c;
    };

    /**
     * Start a session, answer `turns` questions, then end it the way `end` says.
     * Answers are injected through the recorded speech-to-text callback — exactly
     * where Speechmatics would deliver them.
     */
    const runSession = async (query: Record<string, string | undefined>, run: RunOptions): Promise<RunResult> => {
        const client = await connect(query, run.playbackMs ?? 0);
        client.send({ type: 'start_listening' });
        const result: RunResult = { replies: [], errors: [], client };
        const gi = await client.waitFor((m) => m.type === 'agent_reply' || m.type === 'error', 0);
        if (gi >= 0 && client.msgs[gi].type === 'agent_reply') result.greeting = client.msgs[gi].text;
        let cursor = gi + 1;
        for (let t = 1; t <= run.turns && gi >= 0 && client.msgs[gi].type === 'agent_reply'; t++) {
            const li = await client.waitFor((m) => m.type === 'state' && m.state === 'LISTENING', cursor);
            if (li < 0) {
                // a server that ended the interview itself is the expected way out, not a stall
                if (!(client.closed && client.closeCode === 1000)) {
                    result.stall = `turn ${t}: never went back to LISTENING${client.closed ? ` (closed ${client.closeCode})` : ''}`;
                }
                break;
            }
            await sleep(30);
            const sid = rec.stt[rec.stt.length - 1]?.sid;
            const inject = sid ? sttCallbacks.get(sid) : undefined;
            if (!inject) {
                result.stall = `turn ${t}: no recogniser to speak into`;
                break;
            }
            inject(run.answer(t), true, 0.95);
            const ri = await client.waitFor((m) => m.type === 'agent_reply', li + 1, 20000);
            if (ri < 0) {
                result.stall = `turn ${t}: no reply to "${run.answer(t).slice(0, 40)}…"${client.closed ? ` (closed ${client.closeCode})` : ''}`;
                break;
            }
            result.replies.push(client.msgs[ri].text);
            cursor = ri + 1;
            if (client.closed) break;
        }
        if (run.end === 'time' && !client.closed) {
            await client.waitFor((m) => m.type === 'state' && m.state === 'LISTENING', cursor, 5000);
            client.send({ type: 'interview_time_ended' });
            const ci = await client.waitFor((m) => m.type === 'agent_reply', cursor + 1, 10000);
            if (ci >= 0) result.replies.push(client.msgs[ci].text);
            await client.waitClosed();
        } else if (run.end === 'client' && !client.closed) {
            await client.waitFor((m) => m.type === 'state' && m.state === 'LISTENING', cursor, 5000);
            client.ws.close(1000, 'client left');
            await client.waitClosed();
        } else if (run.end === 'server') {
            await client.waitClosed(30000);
        }
        if (run.end !== 'none') {
            // the close path is async: wait for the transcript to "leave"
            const deadline = Date.now() + 5000;
            while (rec.n8n.length === 0 && Date.now() < deadline) await sleep(25);
        }
        result.errors = client.msgs.filter((m) => m.type === 'error');
        result.langLine = rec.logs.find((l) => l.startsWith('[LANG] '));
        return result;
    };

    const stop = async () => {
        wss.close();
        server.close();
        await mongoose.disconnect();
        await mongo.stop();
    };

    return { rec, resetRecorders, connect, runSession, stop, port, realLlm };
}
