// ============================================
// File: hooks/useVoiceInterview.js
// Purpose: Shared voice-interview session logic (WebSocket + mic capture +
//          MediaSource playback + interview timer). UI-agnostic.
// ============================================
//
// Extracted from pages/Interview.jsx so multiple pages (candidate-specific
// /interview and public /screening-call) reuse the SAME session engine.
// Behavior must stay identical to the original Interview.jsx implementation.
//
// The hook owns: WebSocket connection, microphone capture, audio playback,
// transcript/agent-reply state, audio levels, and the countdown timer.
// It does NOT render any UI.

import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config/apiBase.js';

const API_BASE = API_BASE_URL;
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const VOICE_WS_PATH = '/ws/voice-interview';

const CAPTURE_SAMPLE_RATE = 16000;
const DEFAULT_INTERVIEW_DURATION_SECONDS = 12 * 60; // 12 minutes

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

/**
 * The single <audio> element that plays the agent for the whole session.
 *
 * iOS Safari grants playback permission per element, only from inside a user
 * gesture, and never re-grants it afterwards. A fresh element per agent turn
 * therefore plays the greeting (still close to the Start tap) and is muted for
 * every turn after it, while the transcript keeps arriving over the same
 * socket — the candidate hears silence and thinks the call dropped.
 */
function createAgentAudioElement() {
  const audio = document.createElement('audio');
  audio.setAttribute('playsinline', '');
  audio.preload = 'auto';
  // ManagedMediaSource is the only MSE flavour iPhone has, and it refuses to
  // fire `sourceopen` unless remote playback is disabled or an AirPlay source
  // alternative exists.
  if ('disableRemotePlayback' in audio) audio.disableRemotePlayback = true;
  // Deliberately not display:none — some iOS builds refuse to play hidden media.
  document.body.appendChild(audio);
  return audio;
}

/** 50ms of silence, built inline so unlocking needs no bundled asset. */
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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

/**
 * Starts the shared element and reports *why* it did not start.
 *
 * A rejected play() used to be swallowed, which is why a muted interview left
 * no trace anywhere: no log, no server signal, nothing shown to the candidate.
 */
function startPlayback(audio, onBlocked, onError) {
  let promise;
  try {
    promise = audio.play();
  } catch (e) {
    onBlocked?.(e);
    return;
  }
  if (!promise?.catch) return;
  promise.catch((err) => {
    // Routine when a new turn replaces the src mid-playback.
    if (err?.name === 'AbortError') return;
    if (err?.name === 'NotAllowedError') onBlocked?.(err);
    else onError?.(err?.message || 'Audio playback failed');
  });
}

/** Detaches a turn's source without discarding the (unlocked) element. */
function releaseAudioElement(audio) {
  try { audio.pause(); } catch (_) {}
  try {
    audio.removeAttribute('src');
    audio.load();
  } catch (_) {}
}

/** Fallback player for iOS without MediaSource: buffers MP3 and plays one Blob. */
function createBlobAudioPlayer(audio, { onError, onPlaybackEnded, onBlocked }) {
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
  on('error', () => {
    onError?.('Audio playback failed');
    finish();
  });
  return {
    appendChunk(buf) { chunks.push(buf); },
    endStream() {
      if (chunks.length === 0) { finish(); return; }
      url = URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
      audio.src = url;
      startPlayback(audio, onBlocked, onError);
    },
    retry() { startPlayback(audio, onBlocked, onError); },
    getAudioElement() { return audio; },
    destroy() {
      listeners.forEach(([type, fn]) => {
        try { audio.removeEventListener(type, fn); } catch (_) {}
      });
      releaseAudioElement(audio);
      if (url) { try { URL.revokeObjectURL(url); } catch (_) {} url = null; }
    },
  };
}

/** MediaSource streaming player — plays MP3 chunks without decodeAudioData. */
function createStreamingAudioPlayer(audio, handlers) {
  const { onError, onPlaybackEnded, onBlocked } = handlers;
  // iOS 17.1+ exposes ManagedMediaSource instead of MediaSource; older iOS has neither.
  const MSE = window.MediaSource || window.ManagedMediaSource;
  if (!MSE || (typeof MSE.isTypeSupported === 'function' && !MSE.isTypeSupported('audio/mpeg') && !MSE.isTypeSupported('audio/mp4'))) {
    return createBlobAudioPlayer(audio, handlers);
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
  on(audio, 'pause', () => {
    // An iOS interruption (incoming call, screen lock, app switch) pauses the
    // element silently; the interview would otherwise continue unheard.
    if (finished || audio.ended || !audio.src) return;
    onBlocked?.(new Error('paused'));
  });

  const chunkQueue = [];
  let isAppending = false;
  let sourceBuffer = null;
  let noMoreChunks = false;
  let hasStartedPlay = false;

  function tryEndStream() {
    if (noMoreChunks && chunkQueue.length === 0 && sourceBuffer && !sourceBuffer.updating) {
      try { mediaSource.endOfStream(); } catch (_) {}
    }
  }

  function appendNext() {
    if (isAppending || !sourceBuffer) return;
    if (chunkQueue.length === 0) {
      tryEndStream();
      return;
    }
    const chunk = chunkQueue.shift();
    if (!chunk || chunk.byteLength === 0) { appendNext(); return; }
    try {
      isAppending = true;
      sourceBuffer.appendBuffer(chunk);
    } catch (e) {
      onError?.(e?.message || 'appendBuffer failed');
      isAppending = false;
      appendNext();
    }
  }

  on(mediaSource, 'sourceopen', () => {
    if (sourceBuffer) return;
    try {
      if (MSE.isTypeSupported('audio/mpeg')) {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
      } else if (MSE.isTypeSupported('audio/mp4')) {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mp4');
      } else {
        onError?.('MP3/MP4 not supported in MediaSource');
        return;
      }
      sourceBuffer.mode = 'sequence';
      sourceBuffer.addEventListener('updateend', () => {
        isAppending = false;
        if (!hasStartedPlay) {
          hasStartedPlay = true;
          startPlayback(audio, onBlocked, onError);
        }
        appendNext();
      });
      appendNext();
    } catch (e) {
      onError?.(e?.message || 'addSourceBuffer failed');
    }
  });

  audio.src = url;

  return {
    appendChunk(buf) {
      if (noMoreChunks) return;
      chunkQueue.push(buf);
      appendNext();
    },
    endStream() {
      noMoreChunks = true;
      tryEndStream();
      appendNext();
    },
    retry() { startPlayback(audio, onBlocked, onError); },
    getAudioElement() { return audio; },
    destroy() {
      listeners.forEach(([target, type, fn]) => {
        try { target.removeEventListener(type, fn); } catch (_) {}
      });
      try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch (_) {}
      releaseAudioElement(audio);
      try { URL.revokeObjectURL(url); } catch (_) {}
    },
  };
}

/**
 * Voice interview session engine.
 *
 * @param {Object} options
 * @param {string|null} [options.candidateId] - MongoDB candidate id (injected into WS query).
 * @param {string} [options.language] - STT/greeting language (default 'ar').
 * @param {string} [options.mode] - Session mode flag (e.g. 'public'); forwarded to WS.
 * @param {string} [options.position] - Role/position; forwarded to WS when no candidate data.
 * @param {number} [options.durationSeconds] - Interview countdown length.
 * @returns Session state and connect/disconnect controls.
 */
export default function useVoiceInterview(options = {}) {
  const {
    candidateId = null,
    language = 'ar',
    mode = null,
    position = null,
    campaignId = null,
    applicationId = null,
    durationSeconds = DEFAULT_INTERVIEW_DURATION_SECONDS,
  } = options;

  const wsRef = useRef(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [serverState, setServerState] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [linkConsumed, setLinkConsumed] = useState(false);
  /** The server hung up because the interview finished — not a dropped call. */
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [streamingTranscript, setStreamingTranscript] = useState(''); // Real-time partial from Web Speech API
  const [lastAgentReply, setLastAgentReply] = useState('');
  const [streamingAgentReply, setStreamingAgentReply] = useState('');
  const [apiKeysReady, setApiKeysReady] = useState(null);
  const [userAudioLevel, setUserAudioLevel] = useState(0);
  // Kept for API compatibility: the agent waveform animates off serverState.
  const agentAudioLevel = 0;
  /** Playback was refused or interrupted — the candidate must tap to resume. */
  const [audioBlocked, setAudioBlocked] = useState(false);

  /** عداد وقت المقابلة: يبدأ من المدة وينزل إلى 00:00 */
  const [interviewTimeLeft, setInterviewTimeLeft] = useState(durationSeconds);
  const interviewTimerRef = useRef(null);
  const timeEndedSentRef = useRef(false);

  const speechRecognitionRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const serverStateRef = useRef(serverState);
  serverStateRef.current = serverState;

  const mediaStreamRef = useRef(null);
  const captureContextRef = useRef(null);
  const analyserRef = useRef(null);
  const workletNodeRef = useRef(null);
  const audioSeqRef = useRef(0);
  const mediaSourcePlayerRef = useRef(null);
  /** Last player created, kept past LISTENING so its listeners can be removed. */
  const activePlayerRef = useRef(null);
  /** The one element every agent turn reuses, plus its unlock artefacts. */
  const agentAudioElRef = useRef(null);
  const silentUnlockUrlRef = useRef(null);
  const audioChunkBufferRef = useRef([]);
  const lastChunkTimeRef = useRef(0);
  const playbackEndedSentRef = useRef(false);
  const playbackEndedFallbackRef = useRef(null);
  const agentAlignmentWordsRef = useRef([]);

  // Latest connection params for the WS URL (avoids stale closures).
  const paramsRef = useRef({ candidateId, language, mode, position, campaignId, applicationId });
  paramsRef.current = { candidateId, language, mode, position, campaignId, applicationId };

  const ensureAgentAudioElement = () => {
    if (!agentAudioElRef.current?.isConnected) {
      agentAudioElRef.current = createAgentAudioElement();
    }
    return agentAudioElRef.current;
  };

  /**
   * Must run synchronously inside a real user gesture. Playing a moment of
   * silence there is what buys the element permission to speak for the rest of
   * the interview on iOS.
   */
  const unlockAgentAudio = () => {
    const audio = ensureAgentAudioElement();
    if (silentUnlockUrlRef.current) {
      try { URL.revokeObjectURL(silentUnlockUrlRef.current); } catch (_) {}
    }
    silentUnlockUrlRef.current = createSilentWavUrl();
    audio.src = silentUnlockUrlRef.current;
    // A failed silent clip is only worth reporting when the browser refused it;
    // the greeting replacing the src mid-clip is normal and must stay quiet.
    startPlayback(audio, () => setAudioBlocked(true), () => {});
  };

  /** Retry from a user tap after playback was refused or interrupted. */
  const resumeAudio = () => {
    const audio = agentAudioElRef.current;
    if (!audio) return;
    setAudioBlocked(false);
    const player = mediaSourcePlayerRef.current;
    if (player?.retry) {
      player.retry();
    } else if (audio.src) {
      startPlayback(audio, () => setAudioBlocked(true), () => setAudioBlocked(true));
    } else {
      // Between turns there is nothing to replay, but the tap still re-grants
      // the element permission so the next agent turn is audible.
      unlockAgentAudio();
    }
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (activePlayerRef.current) {
        try { activePlayerRef.current.destroy(); } catch (_) {}
        activePlayerRef.current = null;
      }
      mediaSourcePlayerRef.current = null;
      if (agentAudioElRef.current) {
        try { agentAudioElRef.current.remove(); } catch (_) {}
        agentAudioElRef.current = null;
      }
      if (silentUnlockUrlRef.current) {
        try { URL.revokeObjectURL(silentUnlockUrlRef.current); } catch (_) {}
        silentUnlockUrlRef.current = null;
      }
    };
  }, []);

  // iOS silently pauses media on interruptions (call, screen lock, app switch)
  // and never resumes it, so recover as soon as the page is in front again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const audio = agentAudioElRef.current;
      if (!audio || !audio.src || audio.ended) return;
      if (serverStateRef.current !== 'SPEAKING') return;
      startPlayback(
        audio,
        () => setAudioBlocked(true),
        () => setAudioBlocked(true),
      );
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // عداد وقت المقابلة: يبدأ عند الاتصال وينزل كل ثانية
  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setInterviewTimeLeft(durationSeconds);
      if (interviewTimerRef.current) {
        clearInterval(interviewTimerRef.current);
        interviewTimerRef.current = null;
      }
      return;
    }
    setInterviewTimeLeft(durationSeconds);
    timeEndedSentRef.current = false;
    interviewTimerRef.current = setInterval(() => {
      setInterviewTimeLeft((prev) => {
        if (prev <= 1) {
          if (interviewTimerRef.current) {
            clearInterval(interviewTimerRef.current);
            interviewTimerRef.current = null;
          }
          if (!timeEndedSentRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            timeEndedSentRef.current = true;
            wsRef.current.send(JSON.stringify({ type: 'interview_time_ended' }));
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (interviewTimerRef.current) {
        clearInterval(interviewTimerRef.current);
        interviewTimerRef.current = null;
      }
    };
  }, [connectionStatus, durationSeconds]);

  // Manual mic management - opens only when isListening === true
  useEffect(() => {
    if (!isListening) {
      // Close mic when stopping
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

    // Open mic when isListening === true
    let cancelled = false;
    navigator.mediaDevices
      // NOTE: do NOT force a hard `sampleRate` here. Most mic hardware is locked
      // to 44100/48000 Hz, so demanding an exact rate makes many devices throw
      // NotReadableError "Could not start audio source" (works on some devices,
      // fails on others). The 16 kHz AudioContext below resamples the native mic
      // stream to CAPTURE_SAMPLE_RATE automatically, so STT still gets 16 kHz.
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
          // Send audio only when serverState === 'LISTENING'
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
        if (cancelled) return;
        const name = err?.name || '';
        let msg;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          msg = 'Microphone permission was denied. Allow the microphone and reload the page.';
        } else if (name === 'NotReadableError' || name === 'AbortError') {
          msg =
            'Could not start the microphone — it may be in use by another app or browser tab. Close it and reload.';
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          msg = 'No usable microphone was found on this device.';
        } else {
          msg = err?.message || 'Microphone access failed';
        }
        setLastError(msg);
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

  // تحديث مستوى صوت المستخدم من AnalyserNode
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

  // NOTE: the agent waveform animates off `serverState === 'SPEAKING'` and
  // ignores its `level` prop, so there is no AnalyserNode for the agent here on
  // purpose: routing the element through Web Audio only to measure an unused
  // level is what muted mobile playback whenever the context was suspended.

  // مزامنة ترانسكريبت الإيجنت مع التشغيل (كلمة عند نطقها)
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

  // تعطيل Web Speech API - الترانسكربت يأتي من الباك إند عبر WebSocket (Speechmatics/Deepgram)
  // تجنب خطأ [SpeechRecognition] network وتضارب المصادر
  useEffect(() => {
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (_) {}
      speechRecognitionRef.current = null;
    }
    if (serverState !== 'LISTENING') setStreamingTranscript('');
  }, [serverState]);

  const notifyPlaybackEnded = () => {
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

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    // First statement on purpose: this runs inside the Start tap, the only
    // moment iOS will hand out playback permission for the session.
    unlockAgentAudio();
    setConnectionStatus('connecting');
    setLastError(null);
    setAudioBlocked(false);
    setInterviewComplete(false);
    const { candidateId: cid, language: lang, mode: m, position: pos, campaignId: camp, applicationId: appId } =
      paramsRef.current;
    const params = new URLSearchParams();
    if (cid) params.set('candidateId', cid);
    params.set('language', lang || 'ar');
    if (m) params.set('mode', m);
    if (pos) params.set('position', pos);
    if (camp) params.set('campaignId', camp);
    if (appId) params.set('applicationId', appId);
    const url = `${WS_BASE}${VOICE_WS_PATH}${params.toString() ? `?${params}` : ''}`;
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
        if (msg.type === 'ready' && msg.sessionId) {
          setSessionId(msg.sessionId);
          // Don't start listening automatically - user starts manually
        }
        if (msg.type === 'config') setApiKeysReady({ hasOpenAI: msg.hasOpenAI, hasElevenLabs: msg.hasElevenLabs });
        if (msg.type === 'state' && msg.state) {
          setServerState(msg.state);
          if (msg.state === 'SPEAKING') {
            agentAlignmentWordsRef.current = [];
            setStreamingAgentReply('');
          }
          if (msg.state === 'LISTENING') {
            accumulatedTranscriptRef.current = '';
            setStreamingTranscript('');
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
          playbackEndedFallbackRef.current = setTimeout(notifyPlaybackEnded, 12000);
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
            const audioEl = ensureAgentAudioElement();
            const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
            audioEl.src = url;
            audioEl.onended = () => {
              URL.revokeObjectURL(url);
              notifyPlaybackEnded();
            };
            startPlayback(
              audioEl,
              () => setAudioBlocked(true),
              (err) => setLastError(err || 'Audio playback error'),
            );
          }
        }
        if (msg.type === 'error') {
          setLastError(msg.message || 'Error');
          if (msg.code === 'INTERVIEW_LINK_ALREADY_USED') {
            setLinkConsumed(true);
          }
        }
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
            // The previous turn's listeners still sit on the shared element;
            // drop them before the new source replaces it.
            if (activePlayerRef.current) {
              try { activePlayerRef.current.destroy(); } catch (_) {}
              activePlayerRef.current = null;
            }
            const player = createStreamingAudioPlayer(audioEl, {
              onError: (err) => setLastError(err || 'Audio playback error'),
              onPlaybackEnded: notifyPlaybackEnded,
              onBlocked: () => setAudioBlocked(true),
            });
            mediaSourcePlayerRef.current = player;
            activePlayerRef.current = player;
            if (audioChunkBufferRef.current.length > 0) {
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

    ws.onclose = (event) => {
      wsRef.current = null;
      setConnectionStatus('closed');
      setServerState(null);
      setSessionId(null);
      setApiKeysReady(null);
      if (event?.code === 4001) {
        setLinkConsumed(true);
      }
      // A normal close means the interview is over — show the completion screen.
      // 'interview_complete' is the explicit server signal, but the server may also
      // close normally without it (e.g. the time limit is reached) and the candidate
      // pressing End closes the socket too. Treat any normal (1000) close that
      // happened while the interview was actually running (serverState was set) as
      // complete, so the candidate always lands on a clear "submitted" screen instead
      // of a frozen call.
      if (
        event?.code === 1000 &&
        (event?.reason === 'interview_complete' || serverStateRef.current !== null)
      ) {
        setInterviewComplete(true);
      }
    };

    ws.onerror = () => {
      setConnectionStatus('error');
      setLastError('WebSocket error');
    };
  };

  const disconnect = () => {
    // Stop listening first
    setIsListening(false);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop_listening' }));
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (activePlayerRef.current) {
      try { activePlayerRef.current.destroy(); } catch (_) {}
      activePlayerRef.current = null;
    }
    mediaSourcePlayerRef.current = null;
    audioChunkBufferRef.current = [];
    setAudioBlocked(false);
    setConnectionStatus('idle');
    setServerState(null);
    setSessionId(null);
    setLastError(null);
    setMicActive(false);
    setIsListening(false);
    setLastTranscript('');
    setStreamingTranscript('');
    setLastAgentReply('');
    setStreamingAgentReply('');
    agentAlignmentWordsRef.current = [];
    accumulatedTranscriptRef.current = '';
  };

  return {
    connectionStatus,
    serverState,
    sessionId,
    lastError,
    linkConsumed,
    interviewComplete,
    micActive,
    isListening,
    lastTranscript,
    streamingTranscript,
    lastAgentReply,
    streamingAgentReply,
    apiKeysReady,
    userAudioLevel,
    agentAudioLevel,
    interviewTimeLeft,
    audioBlocked,
    resumeAudio,
    connect,
    disconnect,
  };
}
