// ============================================
// ملف: services/speechmaticsStreamingService.ts
// الوظيفة: Speechmatics Realtime Streaming API للـ STT (العربية)
// ============================================

import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { RealtimeClient } from "@speechmatics/real-time-client";
import { getVoiceVadSettings } from "../voice/voiceTimingEnv.js";

function getSpeechmaticsApiKey(): string | undefined {
  const raw = process.env.SPEECHMATICS_API_KEY;
  if (raw == null) return undefined;
  const key = raw.trim();
  return key.length > 0 ? key : undefined;
}

// Map لتخزين Speechmatics connections لكل session
const speechmaticsConnections = new Map<
  string,
  {
    client: RealtimeClient | null;
    isOpen: boolean;
    isReadyForAudio: boolean;
    isFlushingBuffer: boolean;
    buffer: Buffer[];
    onTranscript: (text: string, isFinal: boolean, confidence?: number) => void;
    onError: (error: Error) => void;
    onReady?: () => void;
  }
>();

async function flushBufferedAudio(sessionId: string): Promise<void> {
  const conn = speechmaticsConnections.get(sessionId);
  if (!conn || !conn.client || !conn.isOpen || !conn.isReadyForAudio) return;
  if (conn.isFlushingBuffer) return;

  conn.isFlushingBuffer = true;
  try {
    while (conn.buffer.length > 0) {
      const chunk = conn.buffer.shift();
      if (!chunk || chunk.length === 0) continue;
      conn.client.sendAudio(chunk);
    }
  } catch (error) {
    console.error("❌ Error flushing buffered Speechmatics audio:", error);
    conn.onError(error as Error);
  } finally {
    conn.isFlushingBuffer = false;
  }
}

/**
 * إنشاء Speechmatics Realtime connection لـ session (STT Streaming)
 * يستخدم ar_en: عربي+إنجليزي في نفس الجلسة (code-switching)
 */
export async function createSpeechmaticsConnection(
  sessionId: string,
  onTranscript: (text: string, isFinal: boolean, confidence?: number) => void,
  onError: (error: Error) => void,
  onReady?: () => void
): Promise<void> {
  const apiKey = getSpeechmaticsApiKey();
  if (!apiKey) {
    console.error("❌ SPEECHMATICS_API_KEY is not set or empty");
    onError(new Error("Speechmatics API key is not configured"));
    return;
  }

  closeSpeechmaticsConnection(sessionId);

  const client = new RealtimeClient();

  speechmaticsConnections.set(sessionId, {
    client,
    isOpen: false,
    isReadyForAudio: false,
    isFlushingBuffer: false,
    buffer: [],
    onTranscript,
    onError,
    onReady,
  });

  client.addEventListener("receiveMessage", ({ data }: { data: any }) => {
    try {
      if (data.message === "AddTranscript") {
        const transcript = data.metadata?.transcript || "";
        if (transcript.trim().length > 0) {
          const confidence = data.results?.[0]?.alternatives?.[0]?.confidence ?? 1;
          onTranscript(transcript.trim(), true, confidence);
        }
      } else if (data.message === "RecognitionStarted") {
        const conn = speechmaticsConnections.get(sessionId);
        if (!conn) return;
        if (!conn.isReadyForAudio) {
          conn.isReadyForAudio = true;
          flushBufferedAudio(sessionId).catch((e) =>
            console.error("❌ Error flushing buffered chunk after RecognitionStarted:", e)
          );
          if (conn.onReady) conn.onReady();
          console.log(`✅ Speechmatics ready for audio: ${sessionId.substring(0, 8)}...`);
        }
      } else if (data.message === "AddPartialTranscript") {
        const transcript = data.metadata?.transcript || "";
        if (transcript.trim().length > 0) {
          onTranscript(transcript.trim(), false, undefined);
        }
      } else if (data.message === "Error") {
        console.error("❌ Speechmatics error:", data);
        onError(new Error(data.message || "Speechmatics API error"));
      }
    } catch (parseError: any) {
      console.error("❌ Error parsing Speechmatics message:", parseError);
    }
  });

  try {
    const jwt = await createSpeechmaticsJWT({
      type: "rt",
      apiKey,
      ttl: 3600,
    });

    const lang = "ar_en";
    const IRAQI_VOCAB: Array<{ content: string; sounds_like?: string[] }> = [
      { content: "تحچيلي", sounds_like: ["تحكيلي", "تحجيلي"] },
      { content: "تحچيلنا", sounds_like: ["تحجيلنا", "تحكيلنا"] },
      { content: "شلونچ", sounds_like: ["شلونك", "شلونج"] },
    ];
    const vad = getVoiceVadSettings();
    await client.start(jwt, {
      transcription_config: {
        language: lang,
        operating_point: "enhanced",
        enable_partials: true,
        max_delay: vad.speechmaticsMaxDelaySec,
        additional_vocab: IRAQI_VOCAB,
        transcript_filtering_config: {
          remove_disfluencies: true,
        },
      },
      audio_format: {
        type: "raw",
        encoding: "pcm_s16le",
        sample_rate: 16000,
      },
    });

    const conn = speechmaticsConnections.get(sessionId);
    if (!conn) return;

    conn.isOpen = true;

    // Fallback: sometimes RecognitionStarted arrives late; avoid blocking forever.
    setTimeout(() => {
      const current = speechmaticsConnections.get(sessionId);
      if (!current || !current.isOpen || current.isReadyForAudio) return;
      current.isReadyForAudio = true;
      flushBufferedAudio(sessionId).catch((e) =>
        console.error("❌ Error flushing buffered chunk after readiness fallback:", e)
      );
      if (current.onReady) current.onReady();
      console.warn(`⚠️ Speechmatics readiness fallback used: ${sessionId.substring(0, 8)}...`);
    }, 1500);

    if (conn.onReady && conn.isReadyForAudio) {
      conn.onReady();
    }
    console.log(`✅ Speechmatics connected for session: ${sessionId.substring(0, 8)}... (ar_en bilingual)`);
  } catch (err: any) {
    console.error(`❌ Speechmatics connection error:`, err);
    speechmaticsConnections.delete(sessionId);
    onError(err);
  }
}

/**
 * إرسال audio chunk إلى Speechmatics
 */
export async function sendAudioToSpeechmatics(
  sessionId: string,
  audioChunk: Buffer
): Promise<void> {
  const conn = speechmaticsConnections.get(sessionId);

  if (!conn || !conn.client) return;

  if (!conn.isOpen || !conn.isReadyForAudio) {
    conn.buffer.push(audioChunk);
    // Keep memory bounded during connect/reconnect races.
    if (conn.buffer.length > 200) {
      conn.buffer.splice(0, conn.buffer.length - 200);
    }
    return;
  }

  try {
    if (audioChunk.length > 0) {
      conn.client.sendAudio(audioChunk);
    }
  } catch (error) {
    console.error("❌ Error sending audio to Speechmatics:", error);
    conn.onError(error as Error);
  }
}

/**
 * إغلاق Speechmatics connection
 * ✅ FIX: تجنب استدعاء stopRecognition عندما الاتصال ما زال في CONNECTING (race condition)
 */
export function closeSpeechmaticsConnection(sessionId: string): void {
  const conn = speechmaticsConnections.get(sessionId);

  if (!conn || !conn.client) return;

  // فقط استدعاء stopRecognition إذا الاتصال مفتوح فعلاً (يتجنب WebSocket is not open: readyState 0)
  if (conn.isOpen) {
    try {
      conn.client.stopRecognition({ noTimeout: true }).catch(() => {});
    } catch {
      // تجاهل - الاتصال قد يكون أغلق بالفعل
    }
  }

  conn.buffer = [];
  speechmaticsConnections.delete(sessionId);
  console.log(`🧹 Speechmatics connection closed for session: ${sessionId.substring(0, 8)}...`);
}

/**
 * التحقق من وجود Speechmatics connection
 */
export function hasSpeechmaticsConnection(sessionId: string): boolean {
  const conn = speechmaticsConnections.get(sessionId);
  return conn !== undefined && conn.isOpen === true && conn.client !== null;
}
