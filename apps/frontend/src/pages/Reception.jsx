// ============================================
// File: pages/Reception.jsx
// Purpose: Voice Reception Agent - Frontend UI only
// ============================================
//
// Frontend responsibilities:
// 1) Capturing microphone (getUserMedia)
// 2) Sending audio chunks to WebSocket
// 3) Receiving audio chunks and playing them (MediaSource)
// 4) Start/Stop button for control
//
// All AI logic and STT/TTS in the Backend.

import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { API_BASE_URL } from '../config/apiBase.js';
import './reception-page.css';

const API_BASE = API_BASE_URL;
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const VOICE_WS_PATH = '/ws/voice-reception';
const CAPTURE_SAMPLE_RATE = 16000;

function int16BufferToBase64(arrayBuffer) {
    const pcm = new Int16Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < pcm.length; i++) {
        binary += String.fromCharCode(pcm[i] & 0xff, (pcm[i] >> 8) & 0xff);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/** 50ms صمت يُبنى محلياً لفتح قفل التشغيل داخل لمسة المستخدم دون ملف خارجي. */
function createSilentWavUrl() {
    const sampleRate = 8000;
    const samples = 400;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function startPlayback(audio) {
    let promise;
    try {
        promise = audio.play();
    } catch (_) {
        return;
    }
    promise?.catch?.(() => {});
}

/** يفصل مصدر الدور الحالي دون التخلّص من العنصر (الإذن مرتبط بالعنصر نفسه). */
function releaseAudioSource(audio) {
    try { audio.pause(); } catch (_) {}
    try {
        audio.removeAttribute('src');
        audio.load();
    } catch (_) {}
}

/** Fallback player for iOS/Safari without MediaSource: يجمّع مقاطع MP3 ويشغّلها كـ Blob عند اكتمال الرد */
function createBlobAudioPlayer(audio, onError, onPlaybackEnded) {
    const chunks = [];
    const listeners = [];
    const on = (type, fn) => {
        audio.addEventListener(type, fn);
        listeners.push([type, fn]);
    };
    let url = null;
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        onPlaybackEnded?.();
    };
    on('ended', finish);
    on('error', () => { onError?.('Audio playback failed'); finish(); });
    return {
        appendChunk: (chunk) => { chunks.push(chunk); },
        endStream: () => {
            if (chunks.length === 0) { finish(); return; }
            url = URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
            audio.src = url;
            startPlayback(audio);
        },
        destroy: () => {
            listeners.forEach(([type, fn]) => {
                try { audio.removeEventListener(type, fn); } catch (_) {}
            });
            releaseAudioSource(audio);
            if (url) { try { URL.revokeObjectURL(url); } catch (_) {} url = null; }
        },
        getAudioElement: () => audio,
    };
}

/** MediaSource streaming player يعمل على العنصر المشترك المفتوح بلمسة البداية. */
function createMediaSourcePlayer(audio, onError, onPlaybackEnded) {
    // iOS 17.1+ يوفر ManagedMediaSource بدل MediaSource؛ الأقدم لا يوفر أياً منهما
    const MSE = window.MediaSource || window.ManagedMediaSource;
    if (!MSE || (typeof MSE.isTypeSupported === 'function' && !MSE.isTypeSupported('audio/mpeg'))) {
        return createBlobAudioPlayer(audio, onError, onPlaybackEnded);
    }
    const mediaSource = new MSE();
    const url = URL.createObjectURL(mediaSource);
    const listeners = [];
    const on = (target, type, fn) => {
        target.addEventListener(type, fn);
        listeners.push([target, type, fn]);
    };

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        onPlaybackEnded?.();
    };
    on(audio, 'ended', finish);

    // ردود الاستقبال طويلة وتصل على شكل مقاطع TTS متتالية، فينفد المخزون في الفراغ
    // بين مقطع وآخر ويوقف المتصفح العنصر بصمت في منتصف الرد؛ نستأنف بدل التوقف.
    let resumeTries = 0;
    const resumeIfStalled = () => {
        if (finished || audio.ended || !audio.src) return;
        if (resumeTries >= 8) return;
        resumeTries += 1;
        startPlayback(audio);
    };
    on(audio, 'pause', resumeIfStalled);
    on(audio, 'stalled', resumeIfStalled);
    on(audio, 'waiting', resumeIfStalled);

    const chunkQueue = [];
    let isAppending = false;
    let sourceBuffer = null;
    let noMoreChunks = false;
    let hasStartedPlay = false;

    const tryEndStream = () => {
        if (noMoreChunks && chunkQueue.length === 0 && sourceBuffer && !sourceBuffer.updating) {
            try {
                if (mediaSource.readyState === 'open') mediaSource.endOfStream();
            } catch (_) {}
        }
    };

    const appendNext = () => {
        if (isAppending || !sourceBuffer || sourceBuffer.updating) return;
        if (chunkQueue.length === 0) {
            tryEndStream();
            return;
        }
        const chunk = chunkQueue.shift();
        try {
            isAppending = true;
            sourceBuffer.appendBuffer(chunk);
        } catch (err) {
            isAppending = false;
            onError?.(err?.message || 'Source buffer error');
        }
    };

    on(mediaSource, 'sourceopen', () => {
        if (sourceBuffer) return;
        try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
            sourceBuffer.mode = 'sequence';
            sourceBuffer.addEventListener('updateend', () => {
                isAppending = false;
                if (!hasStartedPlay) {
                    hasStartedPlay = true;
                    startPlayback(audio);
                }
                appendNext();
            });
            appendNext();
        } catch (err) {
            onError?.(err?.message || 'MediaSource error');
        }
    });

    audio.src = url;

    return {
        appendChunk: (chunk) => {
            resumeTries = 0;
            chunkQueue.push(chunk);
            appendNext();
        },
        endStream: () => {
            noMoreChunks = true;
            appendNext();
            tryEndStream();
        },
        destroy: () => {
            listeners.forEach(([target, type, fn]) => {
                try { target.removeEventListener(type, fn); } catch (_) {}
            });
            try {
                if (mediaSource.readyState === 'open') mediaSource.endOfStream();
            } catch (_) {}
            releaseAudioSource(audio);
            try {
                URL.revokeObjectURL(url);
            } catch (_) {}
        },
        getAudioElement: () => audio,
    };
}

/** كرة صوت زجاجية — موجات أفقية داخل القبة تشتدّ مع مستوى الصوت عند النشاط */
function VoiceOrb({ active, level = 0, accent }) {
    const uid = useId().replace(/:/g, '');
    const leveled = Math.max(0.08, Math.min(1, level || (active ? 0.35 : 0)));

    return (
        <div
            className={`reception-voice-orb${active ? ' reception-voice-orb--active' : ' reception-voice-orb--idle'}`}
            style={{
                '--orb-accent': accent,
                '--orb-level': String(leveled),
            }}
            aria-hidden
        >
            <div className="reception-voice-orb__rim" />
            <div className="reception-voice-orb__body">
                <div className="reception-voice-orb__glow" />
                <div className="reception-voice-orb__shine" />
                <div className="reception-voice-orb__waves">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <span
                            key={`${uid}-w-${i}`}
                            className="reception-voice-orb__wave"
                            style={{ animationDelay: `${i * 0.07}s` }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

const isArabicText = (t) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t || '');

const Reception = () => {
    const { currentLang, t } = useLanguage();

    /** Backend voice agent supports en | ar only (Kurdish UI → ar voice prompts). */
    const receptionApiLang = currentLang === 'en' ? 'en' : 'ar';

    const wsRef = useRef(null);
    const [connectionStatus, setConnectionStatus] = useState('idle');
    const [serverState, setServerState] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [lastError, setLastError] = useState(null);
    const [micActive, setMicActive] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [lastTranscript, setLastTranscript] = useState('');
    const [lastAgentReply, setLastAgentReply] = useState('');
    const [streamingAgentReply, setStreamingAgentReply] = useState('');
    const [userAudioLevel, setUserAudioLevel] = useState(0);
    const [agentAudioLevel, setAgentAudioLevel] = useState(0);

    const accumulatedTranscriptRef = useRef('');
    const mediaStreamRef = useRef(null);
    const captureContextRef = useRef(null);
    const analyserRef = useRef(null);
    const agentAnalyserRef = useRef(null);
    const workletNodeRef = useRef(null);
    const serverStateRef = useRef(serverState);
    serverStateRef.current = serverState;
    const audioSeqRef = useRef(0);
    const mediaSourcePlayerRef = useRef(null);
    /** آخر مشغّل أُنشئ، يبقى بعد LISTENING كي يُكمل الرد ثم تُزال مستمعاته. */
    const activePlayerRef = useRef(null);
    /** العنصر الوحيد الذي يعيد كل دور للإيجنت استخدامه، مع أثر فتح القفل. */
    const agentAudioElRef = useRef(null);
    const silentUnlockUrlRef = useRef(null);
    const agentAudioBoundRef = useRef(false);
    const audioChunkBufferRef = useRef([]);
    const lastChunkTimeRef = useRef(0);
    const playbackEndedSentRef = useRef(false);
    const playbackEndedFallbackRef = useRef(null);
    const agentAlignmentWordsRef = useRef([]);

    const ensureAgentAudioElement = useCallback(() => {
        const existing = agentAudioElRef.current;
        if (existing?.isConnected) return existing;
        const el = document.createElement('audio');
        el.autoplay = true;
        el.preload = 'auto';
        el.setAttribute('playsinline', '');
        // ManagedMediaSource على iPhone لا يُطلق sourceopen إلا بتعطيل التشغيل البعيد.
        if ('disableRemotePlayback' in el) el.disableRemotePlayback = true;
        // بلا display:none: بعض إصدارات iOS ترفض تشغيل وسائط مخفيّة.
        document.body.appendChild(el);
        agentAudioElRef.current = el;
        agentAudioBoundRef.current = false;
        return el;
    }, []);

    /**
     * iOS يمنح إذن التشغيل للعنصر الذي شُغِّل داخل لمسة المستخدم فقط، لذلك يُفتح
     * قفل عنصر واحد عند لمسة "ابدأ" ويُعاد استخدامه في كل أدوار الإيجنت؛ إنشاء
     * عنصر جديد لكل رد كان يجعل ما بعد الترحيب صامتاً مع بقاء الترانسكريبت.
     */
    const unlockAgentAudio = useCallback(() => {
        const el = ensureAgentAudioElement();
        if (silentUnlockUrlRef.current) {
            try { URL.revokeObjectURL(silentUnlockUrlRef.current); } catch (_) {}
        }
        silentUnlockUrlRef.current = createSilentWavUrl();
        el.src = silentUnlockUrlRef.current;
        startPlayback(el);
    }, [ensureAgentAudioElement]);

    /** createMediaElementSource يُقبل مرة واحدة لكل عنصر، فيُربط المحلّل مرة واحدة. */
    const bindAgentAnalyser = useCallback((audioEl) => {
        if (agentAudioBoundRef.current) return;
        agentAudioBoundRef.current = true;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            const agentCtx = new AC();
            agentCtx.resume?.().catch(() => {});
            // على الموبايل لا نمرّر العنصر عبر Web Audio إلا وسياقه يعمل؛ سياق
            // موقوف يحتجز الخرج ويُخرس الإيجنت.
            if (agentCtx.state === 'running') {
                const agentSrc = agentCtx.createMediaElementSource(audioEl);
                const agentAnalyser = agentCtx.createAnalyser();
                agentAnalyser.fftSize = 256;
                agentAnalyser.smoothingTimeConstant = 0.8;
                agentSrc.connect(agentAnalyser);
                agentAnalyser.connect(agentCtx.destination);
                agentAnalyserRef.current = { ctx: agentCtx, analyser: agentAnalyser };
            } else {
                agentCtx.close?.().catch(() => {});
            }
        } catch (_) {}
    }, []);

    /** Mic + MediaSource audio — عند إنهاء الجلسة أو قطع الـ WS (تفادي عناصر <audio> على body وحالات UI غريبة بعد الإغلاق). */
    const releaseSessionMedia = useCallback(() => {
        setIsListening(false);
        new Set([mediaSourcePlayerRef.current, activePlayerRef.current].filter(Boolean)).forEach((p) => {
            try { p.destroy(); } catch (_) {}
        });
        mediaSourcePlayerRef.current = null;
        activePlayerRef.current = null;
        audioChunkBufferRef.current = [];
        if (playbackEndedFallbackRef.current) {
            clearTimeout(playbackEndedFallbackRef.current);
            playbackEndedFallbackRef.current = null;
        }
        if (agentAudioElRef.current) {
            try { agentAudioElRef.current.remove(); } catch (_) {}
            agentAudioElRef.current = null;
        }
        agentAudioBoundRef.current = false;
        if (silentUnlockUrlRef.current) {
            try { URL.revokeObjectURL(silentUnlockUrlRef.current); } catch (_) {}
            silentUnlockUrlRef.current = null;
        }
        try {
            agentAnalyserRef.current?.ctx?.close?.();
        } catch (_) {}
        agentAnalyserRef.current = null;
    }, []);

    useEffect(() => {
        return () => {
            releaseSessionMedia();
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [releaseSessionMedia]);

    // Mic management
    useEffect(() => {
        if (!isListening) {
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((t) => t.stop());
                mediaStreamRef.current = null;
            }
            if (captureContextRef.current) {
                captureContextRef.current.close().catch(() => {});
                captureContextRef.current = null;
            }
            analyserRef.current = null;
            setMicActive(false);
            setUserAudioLevel(0);
            return;
        }

        let cancelled = false;
        navigator.mediaDevices
            // Do NOT force a hard `sampleRate`: many mics are locked to 44100/48000 Hz
            // and reject an exact 16 kHz request with NotReadableError ("Could not
            // start audio source"). The 16 kHz AudioContext below resamples the mic.
            .getUserMedia({
                audio: {
                    channelCount: { ideal: 1 },
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            })
            .then(async (stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                mediaStreamRef.current = stream;
                const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: CAPTURE_SAMPLE_RATE });
                captureContextRef.current = ctx;
                const src = ctx.createMediaStreamSource(stream);
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.8;
                src.connect(analyser);
                analyserRef.current = analyser;

                await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-processor.js`);
                if (cancelled) {
                    ctx.close().catch(() => {});
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                const workletNode = new AudioWorkletNode(ctx, 'pcm16-processor');
                workletNodeRef.current = workletNode;
                workletNode.port.onmessage = (e) => {
                    const ws = wsRef.current;
                    if (ws?.readyState !== WebSocket.OPEN) return;
                    if (serverStateRef.current !== 'LISTENING') return;
                    if (e.data?.type !== 'audio') return;
                    audioSeqRef.current += 1;
                    ws.send(JSON.stringify({
                        type: 'audio_chunk',
                        seq: audioSeqRef.current,
                        pcmBase64: int16BufferToBase64(e.data.data),
                    }));
                };
                src.connect(workletNode);
                workletNode.connect(ctx.destination);
                setMicActive(true);
            })
            .catch((err) => {
                if (!cancelled) setLastError(err?.message || 'Microphone access denied');
            });

        return () => {
            cancelled = true;
            if (workletNodeRef.current) {
                try {
                    workletNodeRef.current.port.close();
                } catch (_) {}
                try {
                    workletNodeRef.current.disconnect();
                } catch (_) {}
                workletNodeRef.current = null;
            }
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach((t) => t.stop());
                mediaStreamRef.current = null;
            }
            if (captureContextRef.current) {
                captureContextRef.current.close().catch(() => {});
                captureContextRef.current = null;
            }
            setMicActive(false);
        };
    }, [isListening]);

    // User audio level
    useEffect(() => {
        if (!isListening || !analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        let rafId;
        const update = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setUserAudioLevel(Math.min(1, avg / 80));
            rafId = requestAnimationFrame(update);
        };
        rafId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(rafId);
    }, [isListening]);

    // Agent audio level
    useEffect(() => {
        if (serverState !== 'SPEAKING' || !agentAnalyserRef.current?.analyser) return;
        const dataArray = new Uint8Array(agentAnalyserRef.current.analyser.frequencyBinCount);
        let rafId;
        const update = () => {
            const a = agentAnalyserRef.current?.analyser;
            if (!a) return;
            a.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((x, y) => x + y, 0) / dataArray.length;
            setAgentAudioLevel(Math.min(1, avg / 80));
            rafId = requestAnimationFrame(update);
        };
        rafId = requestAnimationFrame(update);
        return () => {
            cancelAnimationFrame(rafId);
            setAgentAudioLevel(0);
        };
    }, [serverState]);

    // Agent transcript sync with playback
    useEffect(() => {
        if (serverState !== 'SPEAKING') return;
        const id = setInterval(() => {
            const player = mediaSourcePlayerRef.current;
            const audio = player?.getAudioElement?.();
            const words = agentAlignmentWordsRef.current;
            if (!audio || !words.length) return;
            const t = audio.currentTime;
            let shown = '';
            for (let i = 0; i < words.length; i++) {
                if (t >= words[i].startSeconds) {
                    shown += (shown ? ' ' : '') + words[i].text;
                } else break;
            }
            if (shown) setStreamingAgentReply(shown);
        }, 80);
        return () => clearInterval(id);
    }, [serverState]);

    const connectReception = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        releaseSessionMedia();
        // داخل لمسة "ابدأ" تحديداً: اللحظة الوحيدة التي يمنح فيها iOS إذن التشغيل.
        unlockAgentAudio();
        setConnectionStatus('connecting');
        setLastError(null);
        const params = new URLSearchParams();
        params.set('language', receptionApiLang);
        const url = `${WS_BASE}${VOICE_WS_PATH}?${params}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnectionStatus('connected');
            setIsListening(true);
            ws.send(JSON.stringify({ type: 'start_listening' }));
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'ready' && msg.sessionId) setSessionId(msg.sessionId);
                if (msg.type === 'state' && msg.state) {
                    setServerState(msg.state);
                    if (msg.state === 'SPEAKING') {
                        agentAlignmentWordsRef.current = [];
                        setStreamingAgentReply('');
                    }
                    if (msg.state === 'LISTENING') {
                        accumulatedTranscriptRef.current = '';
                        setLastTranscript('');
                        mediaSourcePlayerRef.current = null;
                        audioChunkBufferRef.current = [];
                        lastChunkTimeRef.current = 0;
                        playbackEndedSentRef.current = true;
                        if (playbackEndedFallbackRef.current) {
                            clearTimeout(playbackEndedFallbackRef.current);
                            playbackEndedFallbackRef.current = null;
                        }
                    }
                }
                if (msg.type === 'tts_complete') {
                    playbackEndedSentRef.current = false;
                    if (playbackEndedFallbackRef.current) {
                        clearTimeout(playbackEndedFallbackRef.current);
                        playbackEndedFallbackRef.current = null;
                    }
                    const sendPlaybackEnded = () => {
                        if (playbackEndedSentRef.current) return;
                        playbackEndedSentRef.current = true;
                        if (playbackEndedFallbackRef.current) {
                            clearTimeout(playbackEndedFallbackRef.current);
                            playbackEndedFallbackRef.current = null;
                        }
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ type: 'playback_ended' }));
                        }
                    };
                    // ردود الاستقبال قد تتجاوز 12 ثانية؛ نمهل بقدر مهلة الخادم كي لا
                    // يبدأ الدور التالي فوق رد لا يزال يُسمع.
                    playbackEndedFallbackRef.current = setTimeout(sendPlaybackEnded, 30000);
                    if (mediaSourcePlayerRef.current) {
                        const SILENCE_MS = 250;
                        const check = () => {
                            if (Date.now() - lastChunkTimeRef.current >= SILENCE_MS) {
                                if (mediaSourcePlayerRef.current) mediaSourcePlayerRef.current.endStream();
                                return;
                            }
                            setTimeout(check, 50);
                        };
                        setTimeout(check, 50);
                    } else if (audioChunkBufferRef.current.length > 0) {
                        const chunks = audioChunkBufferRef.current;
                        audioChunkBufferRef.current = [];
                        const blob = new Blob(chunks, { type: 'audio/mpeg' });
                        const url = URL.createObjectURL(blob);
                        const fallbackAudio = ensureAgentAudioElement();
                        fallbackAudio.src = url;
                        fallbackAudio.onended = () => {
                            URL.revokeObjectURL(url);
                            sendPlaybackEnded();
                        };
                        startPlayback(fallbackAudio);
                    }
                }
                if (msg.type === 'error') setLastError(msg.message || 'Error');
                if (msg.type === 'transcript' && msg.text) {
                    setLastTranscript(msg.text);
                    if (msg.isFinal) accumulatedTranscriptRef.current = msg.text;
                }
                if (msg.type === 'agent_reply_alignment' && msg.words?.length) {
                    setLastAgentReply('');
                    agentAlignmentWordsRef.current = [...agentAlignmentWordsRef.current, ...msg.words];
                }
                if (msg.type === 'agent_reply' && msg.text) {
                    setLastAgentReply(msg.text);
                    setStreamingAgentReply('');
                    agentAlignmentWordsRef.current = [];
                }
                if (msg.type === 'audio_chunk' && msg.chunkBase64) {
                    lastChunkTimeRef.current = Date.now();
                    const buf = new Uint8Array(base64ToArrayBuffer(msg.chunkBase64));
                    if (!mediaSourcePlayerRef.current) {
                        const audioEl = ensureAgentAudioElement();
                        audioEl.onended = null;
                        // مستمعو الدور السابق ما زالوا على العنصر المشترك؛ تُزال قبل
                        // أن يستبدل المصدر الجديد مصدرَه (وليس عند LISTENING كي لا
                        // يُقطع رد لا يزال يُسمع).
                        if (activePlayerRef.current) {
                            try { activePlayerRef.current.destroy(); } catch (_) {}
                            activePlayerRef.current = null;
                        }
                        const player = createMediaSourcePlayer(
                            audioEl,
                            (err) => {
                                setLastError(err || 'Audio playback error');
                                mediaSourcePlayerRef.current = null;
                            },
                            () => {
                                if (playbackEndedSentRef.current) return;
                                playbackEndedSentRef.current = true;
                                if (playbackEndedFallbackRef.current) {
                                    clearTimeout(playbackEndedFallbackRef.current);
                                    playbackEndedFallbackRef.current = null;
                                }
                                if (wsRef.current?.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({ type: 'playback_ended' }));
                                }
                            }
                        );
                        mediaSourcePlayerRef.current = player;
                        activePlayerRef.current = player;
                        bindAgentAnalyser(audioEl);
                        if (player && audioChunkBufferRef.current.length > 0) {
                            audioChunkBufferRef.current.forEach((b) => player.appendChunk(b));
                            audioChunkBufferRef.current = [];
                        }
                    }
                    if (mediaSourcePlayerRef.current) {
                        mediaSourcePlayerRef.current.appendChunk(buf);
                    } else {
                        audioChunkBufferRef.current.push(buf);
                    }
                }
            } catch {
                setLastError('Invalid message');
            }
        };

        ws.onclose = () => {
            wsRef.current = null;
            releaseSessionMedia();
            setConnectionStatus('idle');
            setServerState(null);
            setSessionId(null);
        };

        ws.onerror = () => {
            setConnectionStatus('error');
            setLastError('WebSocket error');
            releaseSessionMedia();
        };
    };

    const disconnectReception = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop_listening' }));
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        releaseSessionMedia();
        setConnectionStatus('idle');
        setServerState(null);
        setSessionId(null);
        setLastError(null);
        setMicActive(false);
        setLastTranscript('');
        setLastAgentReply('');
        setStreamingAgentReply('');
        agentAlignmentWordsRef.current = [];
        accumulatedTranscriptRef.current = '';
    };

    const isConnected = connectionStatus === 'connected';
    const stateLabel =
        serverState === 'LISTENING'
            ? t('reception_listening')
            : serverState === 'SPEAKING'
              ? t('reception_speaking')
              : isConnected
                ? t('reception_ready')
                : '';

    const isRtl = currentLang !== 'en';

    const cardClass = [
        'reception-page__card',
        isConnected && 'reception-page__card--connected',
        serverState === 'LISTENING' && 'reception-page__card--listening',
        serverState === 'SPEAKING' && 'reception-page__card--speaking',
    ]
        .filter(Boolean)
        .join(' ');

    const badgeLive = serverState === 'LISTENING' || serverState === 'SPEAKING';

    return (
        <main className="reception-page" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="reception-page__ambient" aria-hidden>
                <span className="reception-page__orb reception-page__orb--a" />
                <span className="reception-page__orb reception-page__orb--b" />
            </div>
            <div className={cardClass}>
                <div className="reception-page__card-header">
                    <div className="reception-page__header-slot">
                        <Link
                            to="/"
                            className="reception-page__nav-btn reception-page__nav-btn--back"
                            aria-label={t('reception_back')}
                            title={t('reception_back')}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </Link>
                    </div>
                    <h1 className="reception-page__title">
                        {t('reception_title')}
                    </h1>
                    <div className="reception-page__header-slot reception-page__header-slot--end">
                        <Link
                            to="/"
                            className="reception-page__nav-btn"
                            aria-label={t('reception_close')}
                            title={t('reception_close')}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </Link>
                    </div>
                </div>
                <div className="reception-page__card-body">
                <p className="reception-page__desc">
                    {t('reception_desc')}
                </p>

                <div className="reception-page__wave-row">
                    <div className="reception-page__wave-col">
                        <div className="reception-page__wave-label">
                            {t('reception_you')}
                        </div>
                        <VoiceOrb
                            active={micActive && serverState === 'LISTENING'}
                            level={userAudioLevel}
                            accent="#22d3ee"
                        />
                    </div>
                    <div className="reception-page__wave-col">
                        <div className="reception-page__wave-label">
                            {t('reception_agent')}
                        </div>
                        <VoiceOrb active={serverState === 'SPEAKING'} level={agentAudioLevel} accent="#a78bfa" />
                    </div>
                </div>

                {stateLabel && (
                    <div
                        className={`reception-page__badge${badgeLive ? ' reception-page__badge--live' : ''}`}
                        role="status"
                        aria-live="polite"
                    >
                        {badgeLive ? <span className="reception-page__badge-dot" aria-hidden /> : null}
                        <span>{stateLabel}</span>
                    </div>
                )}

                {(lastTranscript || lastAgentReply || streamingAgentReply) && (
                    <div className="reception-page__transcript" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                        {lastTranscript && (
                            <div
                                style={{ marginBottom: 10, fontSize: 14 }}
                                dir={isArabicText(lastTranscript) ? 'rtl' : 'ltr'}
                            >
                                <span style={{ color: '#22d3ee', fontWeight: 600 }}>
                                    {t('reception_youLabel')}
                                </span>
                                <span style={{ color: '#e2e8f0' }}>{lastTranscript}</span>
                            </div>
                        )}
                        {(streamingAgentReply || lastAgentReply) && (
                            <div
                                style={{ fontSize: 14 }}
                                dir={isArabicText(streamingAgentReply || lastAgentReply) ? 'rtl' : 'ltr'}
                            >
                                <span style={{ color: '#a78bfa', fontWeight: 600 }}>
                                    {t('reception_agentLabel')}
                                </span>
                                <span style={{ color: '#e2e8f0' }}>
                                    {streamingAgentReply || lastAgentReply}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Error */}
                {lastError && <div className="reception-page__error">{lastError}</div>}

                <div className="reception-page__actions">
                    {!isConnected ? (
                        <button
                            type="button"
                            onClick={connectReception}
                            disabled={connectionStatus === 'connecting'}
                            className={`reception-page__btn reception-page__btn--primary${
                                !isConnected && connectionStatus !== 'connecting'
                                    ? ' reception-page__btn--idle-glow'
                                    : ''
                            }`}
                        >
                            {connectionStatus === 'connecting'
                                ? t('reception_connecting')
                                : t('reception_start')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={disconnectReception}
                            className="reception-page__btn reception-page__btn--danger"
                        >
                            {t('reception_end')}
                        </button>
                    )}
                </div>

                {sessionId && (
                    <div className="reception-page__session">
                        session: {sessionId.substring(0, 8)}...
                    </div>
                )}
                </div>
            </div>
        </main>
    );
};

export default Reception;
