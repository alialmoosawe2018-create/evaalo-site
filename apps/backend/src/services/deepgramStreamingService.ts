// ============================================
// ملف: services/deepgramStreamingService.ts
// الوظيفة: Deepgram Realtime Streaming API للـ STT
// ============================================

import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { getVoiceVadSettings } from '../evaalo-only-voice/voiceTimingEnv.js';
// لا حاجة لـ FFmpeg - PCM16 يُرسل مباشرة من AudioWorklet

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

function getDeepgramApiKey(): string | undefined {
  const raw = process.env.DEEPGRAM_API_KEY;
  if (raw == null) return undefined;
  const key = raw.trim();
  return key.length > 0 ? key : undefined;
}

// Map لتخزين Deepgram WebSocket connections لكل session
const deepgramConnections = new Map<string, {
    ws: WebSocket | null;
    isOpen: boolean;
    buffer: Buffer[];
    onTranscript: (text: string, isFinal: boolean, confidence?: number) => void;
    onError: (error: Error) => void;
    onReady?: () => void;
}>();

/**
 * إنشاء Deepgram WebSocket connection لـ session (STT Streaming)
 * @param language - 'en' | 'ar' | 'multi' (عربي+إنجليزي تدفقي)
 */
export function createDeepgramConnection(
    sessionId: string,
    onTranscript: (text: string, isFinal: boolean, confidence?: number) => void,
    onError: (error: Error) => void,
    onReady?: () => void,
    language?: string
): void {
    const apiKey = getDeepgramApiKey();
    if (!apiKey) {
        console.error('❌ DEEPGRAM_API_KEY is not set or empty');
        onError(new Error('Deepgram API key is not configured'));
        return;
    }

    closeDeepgramConnection(sessionId);

    const lang = language === "ar" ? "ar" : language === "en" ? "en" : "multi";
    const vad = getVoiceVadSettings();
    const params = new URLSearchParams({
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        model: 'nova-2',
        language: lang,
        punctuate: 'true',
        interim_results: 'true',
        endpointing: String(Math.round(vad.deepgramEndpointingMs)),
        keep_alive: 'true',
        token: apiKey,
    });
    const wsUrl = `${DEEPGRAM_WS_URL}?${params.toString()}`;

    const ws = new WebSocket(wsUrl, {
        headers: {
            Authorization: `token ${apiKey}`,
        },
    });

    // تهيئة connection مع buffer فارغ
    deepgramConnections.set(sessionId, {
        ws: ws,
        isOpen: false,
        buffer: [],
        onTranscript,
        onError,
        onReady
    });

    // معالجة الرسائل من Deepgram
    ws.on('message', (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString());
            if (message.type === 'Results' && message.channel?.alternatives) {
                const transcript = message.channel.alternatives[0]?.transcript || '';
                const isFinal = message.is_final === true;
                const confidence = message.channel.alternatives[0]?.confidence ?? 0;
                if (transcript.trim().length > 0) {
                    onTranscript(transcript.trim(), isFinal, confidence);
                }
            } else if (message.type === 'Error') {
                console.error('❌ Deepgram error:', message);
                onError(new Error(message.message || 'Deepgram API error'));
            }
        } catch (parseError: any) {
            console.error('❌ Error parsing Deepgram message:', parseError);
            console.error('❌ Raw message:', data.toString().substring(0, 500));
        }
    });

    ws.on('open', () => {
        console.log(
            `✅ Deepgram WebSocket connected for session: ${sessionId.substring(0, 8)}... (endpointing=${vad.deepgramEndpointingMs}ms)`
        );
        
        const conn = deepgramConnections.get(sessionId);
        if (!conn) return;

        conn.isOpen = true;

        // 🔥 تفريغ الصوت المخزّن في buffer
        // Buffer يحتوي على PCM16 chunks من AudioWorklet - إرسال مباشرة
        if (conn.buffer.length > 0) {
            console.log(`📦 Flushing ${conn.buffer.length} buffered PCM16 chunks to Deepgram...`);
            // إرسال buffered chunks مباشرة (PCM16)
            for (const chunk of conn.buffer) {
                sendAudioToDeepgram(sessionId, chunk).catch((error) => {
                    console.error(`❌ Error flushing buffered chunk:`, error);
                });
            }
            conn.buffer = [];
            console.log(`✅ Buffered PCM16 chunks sent to Deepgram`);
        }

        // إرسال keep-alive message كل 30 ثانية لتجنب timeout
        const keepAliveInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && conn.isOpen) {
                try {
                    // إرسال keep-alive message (empty JSON object)
                    ws.send(JSON.stringify({ type: 'KeepAlive' }));
                } catch (error) {
                    console.warn('⚠️ Error sending keep-alive to Deepgram:', error);
                    clearInterval(keepAliveInterval);
                }
            } else {
                clearInterval(keepAliveInterval);
            }
        }, 30000); // كل 30 ثانية

        // حفظ interval ID للتنظيف لاحقاً
        (conn as any).keepAliveInterval = keepAliveInterval;

        // استدعاء onReady callback (لإرسال "connected" إلى Frontend)
        if (conn.onReady) {
            conn.onReady();
        }
    });

    ws.on('error', (error) => {
        console.error(`❌ Deepgram WebSocket error for session ${sessionId.substring(0, 8)}...:`, error);
        const conn = deepgramConnections.get(sessionId);
        if (conn && (conn as any).keepAliveInterval) {
            clearInterval((conn as any).keepAliveInterval);
        }
        onError(error);
        deepgramConnections.delete(sessionId);
    });

    ws.on('close', (code, reason) => {
        const reasonStr = reason.toString();
        console.log(`🔌 Deepgram WebSocket closed for session ${sessionId.substring(0, 8)}...:`, {
            code,
            reason: reasonStr
        });
        
        // إذا كان timeout error، نحاول إعادة الاتصال
        if (code === 1011 && reasonStr.includes('timeout')) {
            console.warn(`⚠️ Deepgram timeout detected. This may be due to:`);
            console.warn(`   1. Audio format mismatch (expected: linear16/PCM16, 16kHz)`);
            console.warn(`   2. Network issues`);
            console.warn(`   3. Deepgram API key issues`);
            console.warn(`   4. Audio chunks too small or too large`);
        }
        
        const conn = deepgramConnections.get(sessionId);
        if (conn && (conn as any).keepAliveInterval) {
            clearInterval((conn as any).keepAliveInterval);
        }
        deepgramConnections.delete(sessionId);
    });
}

/**
 * إرسال audio chunk إلى Deepgram
 * 
 * @param sessionId - Session ID
 * @param audioChunk - Audio chunk (Buffer) - PCM16 من AudioWorklet
 */
export async function sendAudioToDeepgram(sessionId: string, audioChunk: Buffer): Promise<void> {
    // ✅ FIX: نحن نستخدم Deepgram في Backend دائماً (حتى لو كان LiveKit موجود)
    // LiveKit للفيديو فقط (Avatar)، والصوت يُرسل إلى Backend → Deepgram
    
    const conn = deepgramConnections.get(sessionId);
    
    if (!conn || !conn.ws) {
        console.error(`❌ No Deepgram connection for session: ${sessionId.substring(0, 8)}...`);
        console.error(`   Available connections: ${Array.from(deepgramConnections.keys()).map(k => k.substring(0, 8)).join(', ')}`);
        return;
    }

    // ✅ FIX: Log حالة الاتصال
    if (!conn.isOpen) {
        console.log(`⏳ Deepgram not open yet - buffering chunk (${audioChunk.length} bytes)`);
        conn.buffer.push(audioChunk);
        if (conn.buffer.length === 1) {
            console.log(`⏳ Buffering audio chunks until Deepgram opens (session: ${sessionId.substring(0, 8)}...)`);
        }
        return;
    }
    
    if (conn.ws.readyState !== WebSocket.OPEN) {
        console.warn(`⚠️ Deepgram WebSocket not open - state: ${conn.ws.readyState} (buffering chunk)`);
        conn.buffer.push(audioChunk);
        return;
    }

    // Deepgram مفتوح - إرسال PCM16 مباشرة (لا حاجة لـ FFmpeg)
    try {
        const chunkDurationMs = (audioChunk.length / 2 / 16000) * 1000; // PCM16 = 2 bytes per sample
        
        // ✅ FIX: التحقق من أن WebSocket مفتوح فعلاً
        if (conn.ws.readyState !== WebSocket.OPEN) {
            console.error(`❌ Deepgram WebSocket not open! State: ${conn.ws.readyState} (1=OPEN, 0=CONNECTING, 2=CLOSING, 3=CLOSED)`);
            return;
        }
        
        // ✅ FIX: التحقق من حجم الـ chunk
        if (audioChunk.length === 0) {
            console.warn(`⚠️ Empty audio chunk - skipping`);
            return;
        }
        
        // ✅ FIX: Log أول 20 chunk دائماً، ثم كل 50 chunk
        if (!(conn as any).chunkCount) {
            (conn as any).chunkCount = 0;
        }
        (conn as any).chunkCount++;
        
        const shouldLog = (conn as any).chunkCount <= 20 || (conn as any).chunkCount % 50 === 0;
        
        if (shouldLog) {
            console.log(`📤 Sending PCM16 chunk #${(conn as any).chunkCount} to Deepgram: ${audioChunk.length} bytes (${chunkDurationMs.toFixed(1)}ms @ 16kHz) - WebSocket state: ${conn.ws.readyState === WebSocket.OPEN ? 'OPEN' : conn.ws.readyState}`);
        }
        
        // إرسال الصوت
        conn.ws.send(audioChunk, { binary: true });
        
        if (shouldLog) {
            console.log(`✅ PCM16 chunk #${(conn as any).chunkCount} sent successfully`);
        }
    } catch (error) {
        console.error(`❌ Error sending PCM16 to Deepgram:`, error);
        console.error(`   Chunk size: ${audioChunk.length} bytes`);
        console.error(`   WebSocket state: ${conn.ws.readyState}`);
        conn.onError(error as Error);
    }
}

/**
 * إغلاق Deepgram connection لـ session معين
 * 
 * @param sessionId - Session ID
 */
export function closeDeepgramConnection(sessionId: string): void {
    const conn = deepgramConnections.get(sessionId);
    
    if (!conn || !conn.ws) {
        return;
    }

    try {
        // إيقاف keep-alive interval
        if ((conn as any).keepAliveInterval) {
            clearInterval((conn as any).keepAliveInterval);
        }

        // لا حاجة لـ FFmpeg - PCM16 يُرسل مباشرة

        if (conn.isOpen && conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.close(1000, "Normal closure");
        } else if (conn.ws.readyState === WebSocket.CONNECTING || conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.close(1000, "Normal closure");
        }
    } catch (error) {
        console.error(`❌ Error closing Deepgram connection:`, error);
    }
    
    // تنظيف buffer
    conn.buffer = [];
    deepgramConnections.delete(sessionId);
    console.log(`🧹 Deepgram connection closed for session: ${sessionId.substring(0, 8)}...`);
}

/**
 * التحقق من وجود Deepgram connection لـ session معين
 * 
 * @param sessionId - Session ID
 */
export function hasDeepgramConnection(sessionId: string): boolean {
    const conn = deepgramConnections.get(sessionId);
    return conn !== undefined && conn.isOpen === true && conn.ws !== null && conn.ws.readyState === WebSocket.OPEN;
}

/**
 * الحصول على عدد الـ connections النشطة
 */
export function getActiveDeepgramConnectionsCount(): number {
    return deepgramConnections.size;
}

export default {
    createDeepgramConnection,
    sendAudioToDeepgram,
    closeDeepgramConnection,
    hasDeepgramConnection,
    getActiveDeepgramConnectionsCount,
};
