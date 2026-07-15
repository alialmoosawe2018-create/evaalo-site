/**
 * Voice Reception Session — جوهر جلسة الإيجنت الصوتي للريسبشن
 *
 * مبسّط من voiceSessionCore.ts الخاص بالمقابلات:
 *  - بدون مراحل (Phase 1-3) ولا أسئلة pool ولا تقييم
 *  - بدون candidate model ولا n8n
 *  - بدون عداد وقت المقابلة
 *  - يستخدم STT/TTS routers المشتركة كمستهلك إضافي
 *
 * يبقى الإيجنت الأصلي (evaalo-only-voice/) سليماً تماماً.
 */

import type { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import { createRateLimiter } from './rateLimiter.js';
import { createSession, removeSession, touchSession, updateState } from './sessionStore.js';
import {
    stripEmojisAndSymbols,
    isNoiseTranscript,
    dedupeRepeats,
    normalizeForMerge,
    endsWithSemanticEnd,
} from './transcriptCleaner.js';
import { getVoiceResponseTiming, getVoiceVadSettings } from './voiceTimingEnv.js';
import {
    bumpSttPurgeToken,
    getSttPurgeToken,
    clearSttPurgeToken,
} from './sttPurgeToken.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import {
    createSTTRouterConnection,
    sendAudioToSTTRouter,
    closeSTTRouterConnection,
} from '../services/sttRouterService.js';
import { textToSpeech, textToSpeechWithTimestamps } from '../services/ttsService.js';
import { getReceptionReply, type ReceptionMessage } from './receptionLLM.js';
import { pickReceptionGreeting } from './receptionConfig.js';
import {
    logReceptionBillingAudit,
    resolveReceptionBillingPolicy,
} from './receptionBilling.js';

const maxConnections = Number(process.env.RECEPTION_WS_MAX_CONNECTIONS || '100');
const maxMessageBytes = Number(process.env.RECEPTION_WS_MESSAGE_MAX_BYTES || '65536');
const rateLimitPerMin = Number(process.env.RECEPTION_WS_RATE_LIMIT_PER_MIN || '60');
const limiter = createRateLimiter(rateLimitPerMin);

const conversationHistory = new Map<string, ReceptionMessage[]>();
const speechBuffers = new Map<string, { parts: string[]; timeout?: NodeJS.Timeout }>();
const lastSentBySession = new Map<string, { text: string; time: number }>();
const pendingPlaybackEnded = new Map<string, () => void>();
const DUPLICATE_GUARD_MS = 1200;
let activeConnections = 0;

function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function parseMessage(data: Buffer | ArrayBuffer | string): ClientMessage | null {
    try {
        const text = typeof data === 'string' ? data : Buffer.from(data as any).toString();
        return JSON.parse(text) as ClientMessage;
    } catch {
        return null;
    }
}

export function handleVoiceReceptionWsConnection(ws: WebSocket, req: IncomingMessage) {
    if (activeConnections >= maxConnections) {
        ws.close(1013, 'reception ws busy');
        return;
    }
    activeConnections += 1;

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const language = url.searchParams.get('language') || undefined;
    const sessionId = randomUUID();
    const sessionStartedAt = Date.now();

    console.log(
        `[RECEPTION SESSION START] ${sessionId.substring(0, 8)}... language: ${language || 'auto'}`
    );

    const voiceTiming = getVoiceResponseTiming();

    createSession(sessionId, undefined);
    conversationHistory.set(sessionId, []);

    let voiceState: 'IDLE' | 'LISTENING' | 'SPEAKING' = 'IDLE';
    let lastListeningStartedAt = 0;
    const LATE_TRANSCRIPT_IGNORE_MS = 800;
    let sttTokenAtCurrentListen = 0;
    let initialGreetingSent = false;

    const startListening = (preConnectOnly?: boolean) => {
        if (!preConnectOnly) {
            if (voiceState === 'LISTENING') return;
            const wasSpeaking = voiceState === 'SPEAKING';
            voiceState = 'LISTENING';
            if (wasSpeaking) lastListeningStartedAt = Date.now();
            updateState(sessionId, 'LISTENING');
            send(ws, { type: 'state', state: 'LISTENING' });
            const buffer = speechBuffers.get(sessionId);
            if (buffer?.timeout) clearTimeout(buffer.timeout);
            speechBuffers.delete(sessionId);
            sttTokenAtCurrentListen = bumpSttPurgeToken(sessionId);
        }
        createSTTRouterConnection(
            sessionId,
            (text, isFinal, confidence) => {
                if (getSttPurgeToken(sessionId) !== sttTokenAtCurrentListen) return;
                if (voiceState === 'SPEAKING') return;
                if (
                    lastListeningStartedAt > 0 &&
                    Date.now() - lastListeningStartedAt < LATE_TRANSCRIPT_IGNORE_MS
                )
                    return;
                const t = text.trim();
                if (t) {
                    handleTranscript(t, isFinal, confidence);
                    const buffer = speechBuffers.get(sessionId);
                    let displayText =
                        buffer && buffer.parts.length > 0
                            ? buffer.parts.join(' ').trim()
                            : t;
                    displayText = dedupeRepeats(displayText);
                    send(ws, { type: 'transcript', text: displayText, isFinal });
                }
            },
            (err) => send(ws, { type: 'error', message: err.message }),
            undefined,
            language
        );
    };

    const startSpeaking = () => {
        bumpSttPurgeToken(sessionId);
        voiceState = 'SPEAKING';
        const buffer = speechBuffers.get(sessionId);
        if (buffer?.timeout) clearTimeout(buffer.timeout);
        speechBuffers.delete(sessionId);
        // إعادة ضبط STT عند حدّ الدور — نفس منطق voiceSessionCore (المقابلة الصوتية)
        closeSTTRouterConnection(sessionId);
        startListening(true);
        updateState(sessionId, 'SPEAKING');
        send(ws, { type: 'state', state: 'SPEAKING' });
    };

    send(ws, { type: 'ready', sessionId });
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
    const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;
    const hasSpeechmatics = !!process.env.SPEECHMATICS_API_KEY;
    send(ws, { type: 'config', hasOpenAI, hasElevenLabs, hasDeepgram, hasSpeechmatics });
    send(ws, { type: 'state', state: 'IDLE' });

    const MIN_TRANSCRIPT_LENGTH = 2;
    const vad = getVoiceVadSettings();
    const USER_STOPPED_SPEAKING_MS = voiceTiming.userStoppedSpeakingMs;
    const USER_STOPPED_WITH_PUNCTUATION_MS = voiceTiming.userStoppedPunctuationMs;
    const MIN_CONFIDENCE = 0.6;

    const sendCompleteSentence = () => {
        const buffer = speechBuffers.get(sessionId);
        if (!buffer || buffer.parts.length === 0) return;
        let completeSentence = buffer.parts.join(' ').trim();
        completeSentence = dedupeRepeats(completeSentence);
        speechBuffers.delete(sessionId);
        const last = lastSentBySession.get(sessionId);
        const norm = normalizeForMerge(completeSentence);
        if (
            last &&
            Date.now() - last.time < DUPLICATE_GUARD_MS &&
            normalizeForMerge(last.text) === norm
        ) {
            console.log(`[RECEPTION SKIP] ${sessionId.substring(0, 8)}... duplicate`);
            return;
        }
        bumpSttPurgeToken(sessionId);
        lastSentBySession.set(sessionId, { text: completeSentence, time: Date.now() });
        runPipeline(completeSentence);
    };

    const handleTranscript = (transcript: string, isFinal: boolean, confidence?: number) => {
        const cleaned = stripEmojisAndSymbols(transcript.trim());
        // تبديل لغوي (ar_en): الكلمات الإنجليزية وسط جملة عربية قد تصل بثقة أقل.
        // لا نُسقط العبارات متعددة الكلمات بسبب الثقة (تحمل المحتوى الحقيقي)؛
        // نطبّق فلتر الثقة فقط على الكلمة المفردة (ضوضاء محتملة).
        const wordCount = cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0;
        if (
            confidence !== undefined &&
            confidence < MIN_CONFIDENCE &&
            wordCount <= 1
        )
            return;
        if (isFinal)
            console.log(
                `[RECEPTION STT FINAL] ${sessionId.substring(0, 8)}... "${cleaned.substring(0, 60)}${
                    cleaned.length > 60 ? '...' : ''
                }"`
            );
        if (!cleaned || cleaned.length < MIN_TRANSCRIPT_LENGTH) return;

        let buffer = speechBuffers.get(sessionId);
        if (!buffer) {
            buffer = { parts: [] };
            speechBuffers.set(sessionId, buffer);
        }
        const last = buffer.parts[buffer.parts.length - 1];
        const lastNorm = last !== undefined ? normalizeForMerge(last) : '';
        const cleanedNorm = normalizeForMerge(cleaned);
        const isExtensionOrCorrection =
            last !== undefined &&
            (cleaned === last ||
                cleaned.startsWith(last) ||
                last.startsWith(cleaned) ||
                (lastNorm.length > 0 &&
                    cleanedNorm.length > 0 &&
                    (cleanedNorm.startsWith(lastNorm) || lastNorm.startsWith(cleanedNorm))));
        if (isExtensionOrCorrection) {
            buffer.parts[buffer.parts.length - 1] = cleaned;
        } else {
            buffer.parts.push(cleaned);
        }
        if (buffer.timeout) clearTimeout(buffer.timeout);
        const completeSentence = buffer.parts.join(' ').trim();
        const silenceMs = endsWithSemanticEnd(completeSentence)
            ? USER_STOPPED_WITH_PUNCTUATION_MS
            : USER_STOPPED_SPEAKING_MS;
        buffer.timeout = setTimeout(() => sendCompleteSentence(), silenceMs);
    };

    const speakAgentReply = async (
        llmReply: string,
        options?: { resumeListening?: boolean }
    ) => {
        const resumeListening = options?.resumeListening ?? true;
        const hasArabicScript = (s: string) =>
            /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test((s || '').trim());
        /** صوت ElevenLabs يتبع نص الرد الفعلي (عربي/إنجليزي)، حتى مع ?language=en عندما يرد النموذج بالعربية. */
        const ttsLanguage: 'ar' | 'en' = hasArabicScript(llmReply) ? 'ar' : 'en';

        const alignmentToWords = (alignment: {
            characters: string[];
            character_start_times_seconds: number[];
            character_end_times_seconds: number[];
        }) => {
            const { characters, character_start_times_seconds } = alignment;
            if (!characters?.length || !character_start_times_seconds?.length) return [];
            const words: { text: string; startSeconds: number }[] = [];
            let word = '';
            let wordStart = 0;
            for (let i = 0; i < characters.length; i++) {
                const c = characters[i];
                const start = character_start_times_seconds[i] ?? 0;
                if (/\s/.test(c)) {
                    if (word) {
                        words.push({ text: word, startSeconds: wordStart });
                        word = '';
                    }
                } else {
                    if (!word) wordStart = start;
                    word += c;
                }
            }
            if (word) words.push({ text: word, startSeconds: wordStart });
            return words;
        };

        const splitIntoChunks = (text: string): string[] => {
            const trimmed = text.trim();
            if (!trimmed) return [];
            const parts = trimmed.split(/(?<=[.!?؟])\s+/);
            const chunks: string[] = [];
            let buf = '';
            for (const p of parts) {
                if (!p.trim()) continue;
                if (buf && (buf + ' ' + p).length > 120) {
                    chunks.push(buf.trim());
                    buf = p;
                } else {
                    buf = buf ? buf + ' ' + p : p;
                }
            }
            if (buf.trim()) chunks.push(buf.trim());
            return chunks.length > 0 ? chunks : [trimmed];
        };

        const ttsChunks = splitIntoChunks(llmReply);
        const ttsStartTime = Date.now();
        let chunkOffsetSeconds = 0;
        const sendChunk = (c: Buffer) =>
            send(ws, {
                type: 'audio_chunk',
                chunkBase64: c.toString('base64'),
                format: 'mp3',
            });

        const runTts = async () => {
            for (const chunk of ttsChunks) {
                if (!chunk.trim()) continue;
                if (!voiceTiming.useTtsTimestamps) {
                    await textToSpeech(chunk, ttsLanguage, sendChunk);
                    continue;
                }
                try {
                    let lastEndInChunk = 0;
                    await textToSpeechWithTimestamps(chunk, ttsLanguage, (audio, alignment) => {
                        sendChunk(audio);
                        if (alignment && ws.readyState === ws.OPEN) {
                            const words = alignmentToWords(alignment);
                            const withOffset = words.map((w) => ({
                                text: w.text,
                                startSeconds: chunkOffsetSeconds + w.startSeconds,
                            }));
                            send(ws, { type: 'agent_reply_alignment', words: withOffset });
                        }
                        const last =
                            alignment?.character_end_times_seconds?.[
                                alignment.character_end_times_seconds.length - 1
                            ];
                        if (typeof last === 'number') lastEndInChunk = last;
                    });
                    chunkOffsetSeconds += lastEndInChunk;
                } catch (tsErr: any) {
                    await textToSpeech(chunk, ttsLanguage, sendChunk);
                }
            }
        };

        try {
            await runTts();
        } catch (err: any) {
            console.log(
                `[RECEPTION TTS RETRY] ${sessionId.substring(0, 8)}... ${err.message}`
            );
            chunkOffsetSeconds = 0;
            for (const chunk of ttsChunks) {
                if (!chunk.trim()) continue;
                await textToSpeech(chunk, ttsLanguage, sendChunk);
            }
        }

        const ttsTime = Date.now() - ttsStartTime;
        console.log(
            `[RECEPTION TTS TIME] ${sessionId.substring(0, 8)}... ${ttsTime}ms (${ttsChunks.length} chunk(s))`
        );

        await new Promise((r) => setTimeout(r, voiceTiming.postAudioPaddingMs));
        if (ws.readyState !== ws.OPEN) return;
        send(ws, { type: 'agent_reply', text: llmReply });
        send(ws, { type: 'tts_complete' });
        const minDelay = new Promise<void>((r) => setTimeout(r, voiceTiming.ttsToSttDelayMs));
        const playbackEnded = new Promise<void>((resolve) => {
            const done = () => {
                if (t) clearTimeout(t);
                pendingPlaybackEnded.delete(sessionId);
                resolve();
            };
            pendingPlaybackEnded.set(sessionId, done);
            const t = setTimeout(done, voiceTiming.playbackEndedTimeoutMs);
        });
        await Promise.all([minDelay, playbackEnded]);
        if (ws.readyState !== ws.OPEN || !resumeListening) return;
        startListening();
    };

    const runPipeline = async (transcript: string) => {
        const cleaned = stripEmojisAndSymbols(transcript.trim());
        if (!cleaned || cleaned.length < MIN_TRANSCRIPT_LENGTH) return;
        if (isNoiseTranscript(cleaned)) return;

        const history = conversationHistory.get(sessionId) || [];
        console.log(`[RECEPTION TRANSCRIPT] ${sessionId.substring(0, 8)}... "${cleaned}"`);

        startSpeaking();
        send(ws, { type: 'transcript', text: cleaned, isFinal: true });

        try {
            const reply = await getReceptionReply(cleaned, history, language);
            history.push({ role: 'user', content: cleaned });
            history.push({ role: 'assistant', content: reply });
            conversationHistory.set(sessionId, history);
            await speakAgentReply(reply);
        } catch (err: any) {
            console.error(
                `[RECEPTION ERROR] ${sessionId.substring(0, 8)}... ${err?.message || err}`
            );
            startListening();
        }
    };

    ws.on('message', (data) => {
        const byteLength =
            typeof data === 'string'
                ? Buffer.byteLength(data)
                : Buffer.byteLength(Buffer.from(data as any));
        if (byteLength > maxMessageBytes) {
            ws.close(1009, 'message too big');
            return;
        }

        const msg = parseMessage(data as any);
        if (!msg) {
            send(ws, { type: 'error', message: 'invalid message' });
            return;
        }

        if (msg.type !== 'audio_chunk') {
            const ip = req.socket.remoteAddress || 'unknown';
            if (!limiter(ip)) {
                send(ws, { type: 'error', message: 'rate limit exceeded' });
                return;
            }
        }

        touchSession(sessionId);

        switch (msg.type) {
            case 'ping':
                send(ws, { type: 'pong' });
                break;
            case 'init':
                break;
            case 'control': {
                if (msg.action === 'stop') {
                    voiceState = 'IDLE';
                    closeSTTRouterConnection(sessionId);
                    updateState(sessionId, 'IDLE');
                    send(ws, { type: 'state', state: 'IDLE' });
                }
                if (msg.action === 'start') {
                    startListening();
                }
                break;
            }
            case 'start_listening': {
                if (initialGreetingSent) {
                    startListening();
                    break;
                }
                initialGreetingSent = true;
                (async () => {
                    try {
                        const greetingMsg = pickReceptionGreeting(language);
                        const history = conversationHistory.get(sessionId) || [];
                        history.push({ role: 'assistant', content: greetingMsg });
                        conversationHistory.set(sessionId, history);
                        startSpeaking();
                        startListening(true);
                        send(ws, { type: 'agent_reply', text: greetingMsg });
                        const sendChunk = (c: Buffer) =>
                            send(ws, {
                                type: 'audio_chunk',
                                chunkBase64: c.toString('base64'),
                                format: 'mp3',
                            });
                        const ttsLang = /[\u0600-\u06FF]/.test(greetingMsg)
                            ? ('ar' as const)
                            : ('en' as const);
                        await textToSpeech(greetingMsg, ttsLang, sendChunk);
                        send(ws, { type: 'tts_complete' });
                        const playbackEnded = new Promise<void>((resolve) => {
                            const done = () => {
                                pendingPlaybackEnded.delete(sessionId);
                                resolve();
                            };
                            pendingPlaybackEnded.set(sessionId, done);
                            setTimeout(done, voiceTiming.playbackFallbackMs);
                        });
                        await playbackEnded;
                        await new Promise((r) => setTimeout(r, voiceTiming.postPlaybackResumeMs));
                        if (ws.readyState === ws.OPEN) startListening();
                    } catch (err: any) {
                        console.warn(
                            `[RECEPTION GREETING] ${sessionId.substring(0, 8)}... ${err?.message || err}`
                        );
                        if (ws.readyState === ws.OPEN) startListening();
                    }
                })();
                break;
            }
            case 'playback_ended': {
                const done = pendingPlaybackEnded.get(sessionId);
                if (done) {
                    console.log(`[RECEPTION PLAYBACK_ENDED] ${sessionId.substring(0, 8)}...`);
                    done();
                }
                break;
            }
            case 'stop_listening':
                voiceState = 'IDLE';
                closeSTTRouterConnection(sessionId);
                updateState(sessionId, 'IDLE');
                send(ws, { type: 'state', state: 'IDLE' });
                break;
            case 'audio_chunk': {
                if (voiceState !== 'LISTENING') return;
                if (!msg.pcmBase64) return;
                if (
                    !process.env.OPENAI_API_KEY &&
                    !process.env.DEEPGRAM_API_KEY &&
                    !process.env.SPEECHMATICS_API_KEY
                )
                    return;
                try {
                    const buf = Buffer.from(msg.pcmBase64, 'base64');
                    const pcm16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
                    const rms = Math.sqrt(
                        pcm16.reduce((sum, sample) => sum + sample * sample, 0) / pcm16.length
                    );
                    if (rms < vad.pcmStreamingMinRms) return;
                    sendAudioToSTTRouter(sessionId, buf);
                } catch {
                    send(ws, { type: 'error', message: 'invalid audio chunk' });
                }
                break;
            }
            default:
                send(ws, { type: 'error', message: 'unsupported message type' });
        }
    });

    ws.on('close', () => {
        activeConnections = Math.max(0, activeConnections - 1);
        closeSTTRouterConnection(sessionId);
        clearSttPurgeToken(sessionId);
        lastSentBySession.delete(sessionId);
        const buffer = speechBuffers.get(sessionId);
        if (buffer?.timeout) clearTimeout(buffer.timeout);
        speechBuffers.delete(sessionId);
        conversationHistory.delete(sessionId);
        removeSession(sessionId);

        const billingDecision = resolveReceptionBillingPolicy({
            sessionSource: 'ws',
        });
        const durationSeconds = Math.ceil(Math.max(0, Date.now() - sessionStartedAt) / 1000);
        logReceptionBillingAudit(sessionId, billingDecision, { durationSeconds, language });

        console.log(`[RECEPTION SESSION END] ${sessionId.substring(0, 8)}...`);
    });
}
