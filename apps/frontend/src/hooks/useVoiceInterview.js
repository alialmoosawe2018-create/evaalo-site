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
    appendChunk(buf) { chunks.push(buf); },
    endStream() {
      if (chunks.length === 0) { finish(); return; }
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      url = URL.createObjectURL(blob);
      audio.src = url;
      audio.play().catch(() => {});
    },
    getAudioElement() { return audio; },
    destroy: cleanup,
  };
}

/** MediaSource streaming player - supports MP3 chunks without decodeAudioData.
 *  onPlaybackEnded: called when audio playback actually ends (end-of-speech detection). */
function createMediaSourcePlayer(onError, onPlaybackEnded) {
  // iOS 17.1+ يوفر ManagedMediaSource بدل MediaSource؛ الأقدم لا يوفر أياً منهما
  const MSE = window.MediaSource || window.ManagedMediaSource;
  if (!MSE || (typeof MSE.isTypeSupported === 'function' && !MSE.isTypeSupported('audio/mpeg') && !MSE.isTypeSupported('audio/mp4'))) {
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

  mediaSource.addEventListener('sourceopen', () => {
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
          audio.play().catch(() => {});
        }
        appendNext();
      });
      appendNext();
    } catch (e) {
      onError?.(e?.message || 'addSourceBuffer failed');
    }
  });

  mediaSource.addEventListener('sourceended', () => {
    // Don't remove audio here — sourceended = transmission ended, playback may still be ongoing.
    // Removal only in audio.ended (when playback actually ends).
  });

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
    getAudioElement() {
      return audio;
    },
    destroy() {
      try {
        mediaSource.endOfStream();
      } catch (_) {}
      audio.remove();
      URL.revokeObjectURL(url);
    }
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
  const [micActive, setMicActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [streamingTranscript, setStreamingTranscript] = useState(''); // Real-time partial from Web Speech API
  const [lastAgentReply, setLastAgentReply] = useState('');
  const [streamingAgentReply, setStreamingAgentReply] = useState('');
  const [apiKeysReady, setApiKeysReady] = useState(null);
  const [userAudioLevel, setUserAudioLevel] = useState(0);
  const [agentAudioLevel, setAgentAudioLevel] = useState(0);

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
  const agentAnalyserRef = useRef(null);
  const workletNodeRef = useRef(null);
  const audioSeqRef = useRef(0);
  const mediaSourcePlayerRef = useRef(null);
  const audioChunkBufferRef = useRef([]);
  const lastChunkTimeRef = useRef(0);
  const playbackEndedSentRef = useRef(false);
  const playbackEndedFallbackRef = useRef(null);
  const agentAlignmentWordsRef = useRef([]);

  // Latest connection params for the WS URL (avoids stale closures).
  const paramsRef = useRef({ candidateId, language, mode, position, campaignId, applicationId });
  paramsRef.current = { candidateId, language, mode, position, campaignId, applicationId };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
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

  // تحديث مستوى صوت الإيجنت من AnalyserNode
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

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConnectionStatus('connecting');
    setLastError(null);
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

    ws.onclose = (event) => {
      wsRef.current = null;
      setConnectionStatus('closed');
      setServerState(null);
      setSessionId(null);
      setApiKeysReady(null);
      if (event?.code === 4001) {
        setLinkConsumed(true);
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
    if (mediaSourcePlayerRef.current) {
      mediaSourcePlayerRef.current.destroy();
      mediaSourcePlayerRef.current = null;
    }
    audioChunkBufferRef.current = [];
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
    connect,
    disconnect,
  };
}
