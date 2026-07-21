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

/** Fallback player for iOS/Safari without MediaSource: يجمّع مقاطع MP3 ويشغّلها كـ Blob عند اكتمال الرد */
function createBlobAudioPlayer(onError, onPlaybackEnded) {
    const chunks = [];
    const audio = document.createElement('audio');
    audio.setAttribute('playsinline', '');
    document.body.appendChild(audio);
    let url = null;
    let done = false;
    const cleanup = () => {
        try { audio.pause(); audio.remove(); } catch (_) {}
        if (url) { try { URL.revokeObjectURL(url); } catch (_) {} url = null; }
    };
    const finish = () => {
        if (done) return;
        done = true;
        onPlaybackEnded?.();
        cleanup();
    };
    audio.addEventListener('ended', finish);
    audio.addEventListener('error', () => { onError?.('Audio playback failed'); finish(); });
    return {
        appendChunk: (chunk) => { chunks.push(chunk); },
        endStream: () => {
            if (chunks.length === 0) { finish(); return; }
            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            url = URL.createObjectURL(blob);
            audio.src = url;
            audio.play().catch(() => {});
        },
        destroy: cleanup,
        getAudioElement: () => audio,
    };
}

/** MediaSource streaming player */
function createMediaSourcePlayer(onError, onPlaybackEnded) {
    // iOS 17.1+ يوفر ManagedMediaSource بدل MediaSource؛ الأقدم لا يوفر أياً منهما
    const MSE = window.MediaSource || window.ManagedMediaSource;
    if (!MSE || (typeof MSE.isTypeSupported === 'function' && !MSE.isTypeSupported('audio/mpeg'))) {
        return createBlobAudioPlayer(onError, onPlaybackEnded);
    }
    const mediaSource = new MSE();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    if ('disableRemotePlayback' in audio) audio.disableRemotePlayback = true;
    document.body.appendChild(audio);
    const url = URL.createObjectURL(mediaSource);
    audio.src = url;

    audio.addEventListener('ended', () => {
        onPlaybackEnded?.();
        audio.remove();
        URL.revokeObjectURL(url);
    });

    const chunkQueue = [];
    let isAppending = false;
    let sourceBuffer = null;
    let noMoreChunks = false;

    const appendNext = () => {
        if (isAppending || !sourceBuffer || chunkQueue.length === 0) return;
        if (sourceBuffer.updating) return;
        isAppending = true;
        const chunk = chunkQueue.shift();
        try {
            sourceBuffer.appendBuffer(chunk);
        } catch (err) {
            isAppending = false;
            onError?.(err?.message || 'Source buffer error');
        }
    };

    mediaSource.addEventListener('sourceopen', () => {
        try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
            sourceBuffer.addEventListener('updateend', () => {
                isAppending = false;
                appendNext();
                if (noMoreChunks && chunkQueue.length === 0 && !sourceBuffer.updating) {
                    try {
                        if (mediaSource.readyState === 'open') mediaSource.endOfStream();
                    } catch (_) {}
                }
            });
            appendNext();
        } catch (err) {
            onError?.(err?.message || 'MediaSource error');
        }
    });

    return {
        appendChunk: (chunk) => {
            chunkQueue.push(chunk);
            appendNext();
        },
        endStream: () => {
            noMoreChunks = true;
            if (chunkQueue.length === 0 && sourceBuffer && !sourceBuffer.updating) {
                try {
                    if (mediaSource.readyState === 'open') mediaSource.endOfStream();
                } catch (_) {}
            }
        },
        destroy: () => {
            try {
                audio.pause();
                audio.remove();
            } catch (_) {}
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
    const audioChunkBufferRef = useRef([]);
    const lastChunkTimeRef = useRef(0);
    const playbackEndedSentRef = useRef(false);
    const playbackEndedFallbackRef = useRef(null);
    const agentAlignmentWordsRef = useRef([]);

    /** Mic + MediaSource audio — عند إنهاء الجلسة أو قطع الـ WS (تفادي عناصر <audio> على body وحالات UI غريبة بعد الإغلاق). */
    const releaseSessionMedia = useCallback(() => {
        setIsListening(false);
        if (mediaSourcePlayerRef.current) {
            mediaSourcePlayerRef.current.destroy();
            mediaSourcePlayerRef.current = null;
        }
        audioChunkBufferRef.current = [];
        if (playbackEndedFallbackRef.current) {
            clearTimeout(playbackEndedFallbackRef.current);
            playbackEndedFallbackRef.current = null;
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
            .getUserMedia({ audio: { channelCount: 1, sampleRate: CAPTURE_SAMPLE_RATE } })
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
                    playbackEndedFallbackRef.current = setTimeout(sendPlaybackEnded, 12000);
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
                        const fallbackAudio = new Audio(url);
                        fallbackAudio.onended = () => {
                            URL.revokeObjectURL(url);
                            sendPlaybackEnded();
                        };
                        fallbackAudio.play().catch(() => {});
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
                        const player = createMediaSourcePlayer(
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
                        if (player?.getAudioElement) {
                            try {
                                const audioEl = player.getAudioElement();
                                const agentCtx = new (window.AudioContext || window.webkitAudioContext)();
                                const agentSrc = agentCtx.createMediaElementSource(audioEl);
                                const agentAnalyser = agentCtx.createAnalyser();
                                agentAnalyser.fftSize = 256;
                                agentAnalyser.smoothingTimeConstant = 0.8;
                                agentSrc.connect(agentAnalyser);
                                agentAnalyser.connect(agentCtx.destination);
                                agentAnalyserRef.current = { ctx: agentCtx, analyser: agentAnalyser };
                            } catch (_) {}
                        }
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
