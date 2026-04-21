// ============================================
// ملف: services/openaiSTTService.ts
// الوظيفة: OpenAI Whisper API للـ STT (بدلاً من Deepgram)
// ============================================

import axios from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';

function getOpenAIKey() { return process.env.OPENAI_API_KEY; }
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

// Map لتخزين audio buffers لكل session
const audioBuffers = new Map<string, {
    buffers: Buffer[];
    onTranscript: (text: string, isFinal: boolean) => void;
    onError: (error: Error) => void;
    lastProcessTime: number;
    processingInterval?: NodeJS.Timeout;
    consecutiveErrors: number; // ✅ PRODUCTION FIX: Circuit Breaker - عدد الأخطاء المتتالية
    isStopped: boolean; // ✅ PRODUCTION FIX: Circuit Breaker - حالة التوقف
}>();

const PROCESSING_INTERVAL = 2000; // معالجة كل 2 ثانية
const MIN_AUDIO_LENGTH_MS = 600; // الحد الأدنى: 0.6 ثانية - يسمح بالتقاط الكلام
const MAX_AUDIO_LENGTH_MS = 10000; // ✅ PRODUCTION FIX: الحد الأقصى: 10 ثواني (منع buffer لا نهائي)
const MAX_CONSECUTIVE_ERRORS = 3; // ✅ PRODUCTION FIX: Circuit Breaker - 3 أخطاء متتالية = إيقاف STT

/**
 * إنشاء OpenAI STT connection لـ session معين
 * 
 * @param sessionId - Session ID
 * @param onTranscript - Callback عند استقبال transcript
 * @param onError - Callback عند حدوث خطأ
 * @param onReady - Callback عند جاهزية STT (اختياري)
 */
export function createOpenAIConnection(
    sessionId: string,
    onTranscript: (text: string, isFinal: boolean) => void,
    onError: (error: Error) => void,
    onReady?: () => void
): void {
    const key = getOpenAIKey();
    if (!key) {
        console.error('❌ OPENAI_API_KEY is not set');
        onError(new Error('OpenAI API key is not configured'));
        return;
    }

    // إغلاق connection قديم إذا كان موجوداً
    closeOpenAIConnection(sessionId);

    console.log(`🔌 Setting up OpenAI Whisper STT for session: ${sessionId.substring(0, 8)}...`);

    // تهيئة audio buffer
    audioBuffers.set(sessionId, {
        buffers: [],
        onTranscript,
        onError,
        lastProcessTime: Date.now(),
        consecutiveErrors: 0, // ✅ PRODUCTION FIX: Circuit Breaker
        isStopped: false, // ✅ PRODUCTION FIX: Circuit Breaker
    });

    // معالجة الصوت بشكل دوري
    const conn = audioBuffers.get(sessionId);
    if (conn) {
        conn.processingInterval = setInterval(async () => {
            await processAudioBuffer(sessionId);
        }, PROCESSING_INTERVAL);
    }

    // استدعاء onReady callback
    if (onReady) {
        onReady();
    }

    console.log(`✅ OpenAI Whisper STT ready for session: ${sessionId.substring(0, 8)}...`);
}

/**
 * إرسال audio chunk إلى OpenAI Whisper
 * 
 * @param sessionId - Session ID
 * @param audioChunk - Audio chunk (Buffer) - PCM16 من Frontend
 */
const warnedSessions = new Set<string>();

export async function sendAudioToOpenAI(sessionId: string, audioChunk: Buffer): Promise<void> {
    const conn = audioBuffers.get(sessionId);
    
    if (!conn) {
        if (!warnedSessions.has(sessionId)) {
            warnedSessions.add(sessionId);
            console.warn(`⚠️ No OpenAI STT connection for session: ${sessionId.substring(0, 8)}... (suppressing further warnings for this session)`);
        }
        return;
    }

    // ✅ PRODUCTION FIX: Circuit Breaker - لا نستقبل audio إذا كان STT متوقف
    if (conn.isStopped) {
        console.warn(`⚠️ PRODUCTION FIX: STT stopped for session ${sessionId.substring(0, 8)}... - rejecting audio chunk`);
        return; // لا نضيف audio إلى buffer إذا كان STT متوقف
    }

    // إضافة chunk إلى buffer
    conn.buffers.push(audioChunk);
    
    // ✅ PRODUCTION FIX: منع buffer لا نهائي - إسقاط أقدم chunks إذا تجاوز الحد الأقصى
    const totalBytes = conn.buffers.reduce((sum, buf) => sum + buf.length, 0);
    const durationMs = (totalBytes / 2 / 16000) * 1000; // PCM16 = 2 bytes per sample
    
    if (durationMs > MAX_AUDIO_LENGTH_MS) {
        console.warn(`⚠️ PRODUCTION FIX: Audio buffer exceeded ${MAX_AUDIO_LENGTH_MS}ms (${durationMs.toFixed(1)}ms) - dropping oldest chunks`);
        // إسقاط أقدم 50% من chunks
        const chunksToKeep = Math.floor(conn.buffers.length / 2);
        conn.buffers = conn.buffers.slice(-chunksToKeep);
        console.warn(`   Kept ${conn.buffers.length} chunks, dropped ${chunksToKeep} oldest chunks`);
    }
    
    // ✅ FIX: Log أول 10 chunks دائماً، ثم كل 50 chunk
    if (conn.buffers.length <= 10 || conn.buffers.length % 50 === 0) {
        console.log(`📥✅ Buffered audio chunk #${conn.buffers.length} for OpenAI: ${audioChunk.length} bytes (total: ${totalBytes} bytes, ${durationMs.toFixed(1)}ms)`);
    }
}

/**
 * معالجة audio buffer وإرساله إلى OpenAI Whisper
 */
async function processAudioBuffer(sessionId: string): Promise<void> {
    const conn = audioBuffers.get(sessionId);
    
    if (!conn || conn.buffers.length === 0) {
        return;
    }

    // ✅ PRODUCTION FIX: Circuit Breaker - لا نعالج إذا كان STT متوقف
    if (conn.isStopped) {
        console.warn(`⚠️ PRODUCTION FIX: STT stopped for session ${sessionId.substring(0, 8)}... - clearing buffer`);
        conn.buffers = []; // مسح buffer
        return;
    }

    // حساب مدة الصوت
    const totalBytes = conn.buffers.reduce((sum, buf) => sum + buf.length, 0);
    const durationMs = (totalBytes / 2 / 16000) * 1000; // PCM16 = 2 bytes per sample

    // ✅ PRODUCTION FIX: منع buffer لا نهائي - إسقاط إذا تجاوز الحد الأقصى
    if (durationMs > MAX_AUDIO_LENGTH_MS) {
        console.warn(`⚠️ PRODUCTION FIX: Audio buffer exceeded ${MAX_AUDIO_LENGTH_MS}ms (${durationMs.toFixed(1)}ms) - dropping buffer`);
        conn.buffers = []; // مسح buffer بالكامل
        return;
    }

    // إذا كان الصوت أقل من الحد الأدنى، ننتظر
    if (durationMs < MIN_AUDIO_LENGTH_MS) {
        return;
    }

    // إذا مر أقل من 2 ثانية منذ آخر معالجة، ننتظر
    const timeSinceLastProcess = Date.now() - conn.lastProcessTime;
    if (timeSinceLastProcess < PROCESSING_INTERVAL) {
        return;
    }

    // دمج جميع buffers ثم مسح البفر فوراً — لا تعيد استخدام أي جزء من الصوت السابق (منع تداخل المقاطع)
    const audioData = Buffer.concat(conn.buffers);
    conn.buffers = []; // امسح البفر بالكامل قبل الإرسال — لا تداخل
    conn.lastProcessTime = Date.now();

    console.log(`🔄 Processing audio buffer for OpenAI: ${audioData.length} bytes (${durationMs.toFixed(1)}ms)`);
    console.log(`   Sending to OpenAI Whisper API...`);

    try {
        // تحويل PCM16 إلى WAV format (OpenAI يتوقع WAV أو MP3)
        const wavBuffer = convertPCM16ToWAV(audioData, 16000, 1);
        console.log(`   Converted to WAV: ${wavBuffer.length} bytes`);
        
        // إنشاء FormData
        const formData = new FormData();
        formData.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav'
        });
        formData.append('model', 'whisper-1');
        // ✅ PRODUCTION FIX: حذف language parameter - 'auto' غير صالح (ISO-639-1 format required)
        // إذا حذفنا language parameter، OpenAI Whisper سيكتشف اللغة تلقائياً
        // formData.append('language', 'auto'); // ❌ خطأ: 'auto' غير صالح
        // formData.append('language', 'en'); // ✅ يمكن تحديد 'en' أو 'ar' حسب الحاجة
        formData.append('response_format', 'json');

        console.log(`   Sending request to OpenAI Whisper API...`);
        // ✅ PRODUCTION GATE 3: Backpressure - معالجة 400/429 بشكل صحيح
        let response;
        try {
            response = await axios.post(OPENAI_API_URL, formData, {
                headers: {
                    'Authorization': `Bearer ${getOpenAIKey()}`,
                    ...formData.getHeaders()
                },
                timeout: 30000 // 30 seconds
            });
            console.log(`   ✅ Received response from OpenAI Whisper API`);
        } catch (axiosError: any) {
            // ✅ PRODUCTION FIX: Circuit Breaker - 400 error = خطأ قاتل (invalid config)
            if (axiosError.response?.status === 400) {
                const errorData = axiosError.response?.data;
                const errorMessage = errorData?.error?.message || JSON.stringify(errorData);
                
                console.error(`❌ PRODUCTION FIX: Invalid Whisper config (400) - stopping STT:`, errorMessage);
                
                // ✅ PRODUCTION FIX: Circuit Breaker - إيقاف STT عند 400 error
                if (conn) {
                    conn.consecutiveErrors++;
                    if (conn.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        conn.isStopped = true;
                        console.error(`🛑 PRODUCTION FIX: Circuit Breaker triggered - STT stopped for session ${sessionId.substring(0, 8)}... after ${conn.consecutiveErrors} consecutive 400 errors`);
                        conn.buffers = []; // مسح buffer
                        if (conn.processingInterval) {
                            clearInterval(conn.processingInterval);
                            conn.processingInterval = undefined;
                        }
                        conn.onError(new Error(`STT stopped due to invalid config: ${errorMessage}`));
                    } else {
                        console.warn(`⚠️ PRODUCTION FIX: 400 error #${conn.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} - will stop after ${MAX_CONSECUTIVE_ERRORS} errors`);
                        conn.buffers = []; // مسح buffer (لا نعيده - خطأ في config)
                    }
                }
                return; // لا نتابع STT عند 400 error
            }
            
            // 429 = rate limit — البفر مُمسوح بالفعل، لا نعيد استخدام audio (منع تداخل المقاطع)
            if (axiosError.response?.status === 429) {
                console.warn(`⚠️ Backpressure (429) from OpenAI - rate limit. Buffer already cleared, no reuse.`, axiosError.response?.data);
                if (conn) conn.consecutiveErrors = 0;
                return;
            }
            
            // للـ errors الأخرى، نرمي error
            throw axiosError;
        }

        const transcript = response.data.text || '';
        // بعد إرسال الـ buffer إلى Whisper: البفر مُمسوح ولا يُعاد استخدام أي جزء من الصوت السابق

        // ✅ PRODUCTION FIX: Circuit Breaker - إعادة تعيين counter عند نجاح
        if (conn) {
            conn.consecutiveErrors = 0; // نجاح = إعادة تعيين counter
        }
        
        if (transcript.trim().length > 0) {
            console.log(`📝 OpenAI Whisper transcript: "${transcript}"`);
            console.log(`   Transcript length: ${transcript.length} characters`);
            conn.onTranscript(transcript, true); // دائماً final (OpenAI لا يدعم interim results)
        } else {
            console.log(`⚠️ OpenAI Whisper returned empty transcript`);
            console.log(`   Response data:`, JSON.stringify(response.data).substring(0, 200));
        }
    } catch (error: any) {
        // ✅ PRODUCTION FIX: Circuit Breaker - 400 error = خطأ قاتل (invalid config)
        if (error.response?.status === 400) {
            const errorData = error.response?.data;
            const errorMessage = errorData?.error?.message || JSON.stringify(errorData);
            
            console.error(`❌ PRODUCTION FIX: Invalid Whisper config (400) - stopping STT:`, errorMessage);
            
            // ✅ PRODUCTION FIX: Circuit Breaker - إيقاف STT عند 400 error
            if (conn) {
                conn.consecutiveErrors++;
                if (conn.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    conn.isStopped = true;
                    console.error(`🛑 PRODUCTION FIX: Circuit Breaker triggered - STT stopped for session ${sessionId.substring(0, 8)}... after ${conn.consecutiveErrors} consecutive 400 errors`);
                    conn.buffers = []; // مسح buffer
                    if (conn.processingInterval) {
                        clearInterval(conn.processingInterval);
                        conn.processingInterval = undefined;
                    }
                    conn.onError(new Error(`STT stopped due to invalid config: ${errorMessage}`));
                } else {
                    console.warn(`⚠️ PRODUCTION FIX: 400 error #${conn.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} - will stop after ${MAX_CONSECUTIVE_ERRORS} errors`);
                    conn.buffers = []; // مسح buffer (لا نعيده - خطأ في config)
                }
            }
            return; // لا نتابع STT عند 400 error
        }
        
        // 429 = rate limit — البفر مُمسوح بالفعل، لا نعيد استخدام audio (منع تداخل المقاطع)
        if (error.response?.status === 429) {
            console.warn(`⚠️ Backpressure (429) from OpenAI - rate limit. Buffer already cleared, no reuse.`, error.response?.data);
            if (conn) conn.consecutiveErrors = 0;
            return;
        }
        
        console.error(`❌ Error processing audio with OpenAI Whisper:`, error.message);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, error.response.data);
        }
        conn.onError(error);
    }
}

/**
 * تحويل PCM16 إلى WAV format
 */
function convertPCM16ToWAV(pcmData: Buffer, sampleRate: number, channels: number): Buffer {
    const dataLength = pcmData.length;
    const fileSize = 36 + dataLength;
    
    const wavHeader = Buffer.alloc(44);
    
    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(fileSize - 8, 4);
    wavHeader.write('WAVE', 8);
    
    // fmt chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // fmt chunk size
    wavHeader.writeUInt16LE(1, 20); // audio format (PCM)
    wavHeader.writeUInt16LE(channels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
    wavHeader.writeUInt16LE(channels * 2, 32); // block align
    wavHeader.writeUInt16LE(16, 34); // bits per sample
    
    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataLength, 40);
    
    return Buffer.concat([wavHeader, pcmData]);
}

/**
 * إغلاق OpenAI STT connection لـ session معين
 * 
 * @param sessionId - Session ID
 */
export function closeOpenAIConnection(sessionId: string): void {
    const conn = audioBuffers.get(sessionId);
    
    if (!conn) {
        return;
    }

    try {
        // إيقاف processing interval
        if (conn.processingInterval) {
            clearInterval(conn.processingInterval);
        }

        // معالجة أي audio متبقي
        if (conn.buffers.length > 0) {
            processAudioBuffer(sessionId).catch((error) => {
                console.error(`❌ Error processing final audio buffer:`, error);
            });
        }
    } catch (error) {
        console.error(`❌ Error closing OpenAI STT connection:`, error);
    }
    
    audioBuffers.delete(sessionId);
    warnedSessions.delete(sessionId);
    console.log(`🧹 OpenAI STT connection closed for session: ${sessionId.substring(0, 8)}...`);
}

/**
 * التحقق من وجود OpenAI STT connection لـ session معين
 * 
 * @param sessionId - Session ID
 */
export function hasOpenAIConnection(sessionId: string): boolean {
    return audioBuffers.has(sessionId);
}

/**
 * الحصول على عدد الـ connections النشطة
 */
export function getActiveOpenAIConnectionsCount(): number {
    return audioBuffers.size;
}

export default {
    createOpenAIConnection,
    sendAudioToOpenAI,
    closeOpenAIConnection,
    hasOpenAIConnection,
    getActiveOpenAIConnectionsCount,
};
