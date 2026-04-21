// ============================================
// ملف: services/ttsService.ts
// الوظيفة: ElevenLabs TTS Service للصوت
// ============================================

import axios from 'axios';
import { detectLanguage } from '../utils/languageDetection';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// Voice IDs for different languages
const ARABIC_VOICE_ID = 'pSfhiOqmR5ZWBE5pZErH';
const ENGLISH_VOICE_ID = 'eR40ATw9ArzDf9h3v7t7';

// Model for TTS
const TTS_MODEL = 'eleven_turbo_v2_5';

function getElevenLabsKey(): string | undefined {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) {
        console.warn('⚠️ ELEVENLABS_API_KEY is not set - TTS service will not work');
    }
    return key;
}

/**
 * تحويل النص إلى صوت باستخدام ElevenLabs (Streaming)
 * 
 * @param text - النص المراد تحويله
 * @param language - اللغة ('ar' أو 'en') - إذا لم تُحدد، سيتم اكتشافها تلقائياً
 * @param onChunk - Callback function للـ streaming chunks
 * @returns Promise<Buffer> - Audio buffer (MP3) - للتوافق مع الكود القديم
 */
export async function textToSpeech(
    text: string,
    language?: 'ar' | 'en',
    onChunk?: (chunk: Buffer) => void
): Promise<Buffer> {
    const ELEVENLABS_API_KEY = getElevenLabsKey();
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key is not configured');
    }

    if (!text || text.trim().length === 0) {
        throw new Error('Text is empty');
    }

    // اكتشاف اللغة إذا لم تُحدد
    if (!language) {
        language = detectLanguage(text) === 'ar' ? 'ar' : 'en';
    }

    const voiceId = language === 'ar' ? ARABIC_VOICE_ID : ENGLISH_VOICE_ID;

    try {
        // ✅ FIX: استخدام streaming إذا كان onChunk موجود
        if (onChunk) {
            const response = await axios.post(
                `${ELEVENLABS_API_URL}/${voiceId}/stream`,
                {
                    text: text,
                    model_id: TTS_MODEL,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.0,
                        use_speaker_boost: true
                    }
                },
                {
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': ELEVENLABS_API_KEY
                    },
                    responseType: 'stream',
                    timeout: 30000
                }
            );

            const chunks: Buffer[] = [];
            
            return new Promise<Buffer>((resolve, reject) => {
                response.data.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    onChunk(chunk); // إرسال chunk فوراً
                });
                
                response.data.on('end', () => {
                    const audioBuffer = Buffer.concat(chunks);
                    resolve(audioBuffer);
                });
                
                response.data.on('error', (error: Error) => {
                    reject(error);
                });
            });
        } else {
            // Non-streaming (للتوافق مع الكود القديم)
            const response = await axios.post(
                `${ELEVENLABS_API_URL}/${voiceId}`,
                {
                    text: text,
                    model_id: TTS_MODEL,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.0,
                        use_speaker_boost: true
                    }
                },
                {
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': ELEVENLABS_API_KEY
                    },
                    responseType: 'arraybuffer',
                    timeout: 30000
                }
            );

            const audioBuffer = Buffer.from(response.data);
            return audioBuffer;
        }
    } catch (error: any) {
        // 2) Timeouts: Retry مرة واحدة
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout') || error.response?.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return textToSpeech(text, language, onChunk);
        }
        
        throw error;
    }
}

/**
 * تحويل النص إلى صوت مع timestamps (لمزامنة النص مع التشغيل)
 * يستخدم stream/with-timestamps من ElevenLabs
 */
export async function textToSpeechWithTimestamps(
    text: string,
    language: 'ar' | 'en' | undefined,
    onChunk: (audio: Buffer, alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }) => void
): Promise<Buffer> {
    const ELEVENLABS_API_KEY = getElevenLabsKey();
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key is not configured');
    }

    if (!text || text.trim().length === 0) {
        throw new Error('Text is empty');
    }

    if (!language) {
        language = detectLanguage(text) === 'ar' ? 'ar' : 'en';
    }

    const voiceId = language === 'ar' ? ARABIC_VOICE_ID : ENGLISH_VOICE_ID;

    const response = await axios.post(
        `${ELEVENLABS_API_URL}/${voiceId}/stream/with-timestamps?output_format=mp3_22050_32`,
        {
            text: text,
            model_id: TTS_MODEL,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true
            }
        },
        {
            headers: {
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'xi-api-key': ELEVENLABS_API_KEY
            },
            responseType: 'stream',
            timeout: 30000
        }
    );

    const chunks: Buffer[] = [];
    let buffer = '';

    return new Promise<Buffer>((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.audio_base64) {
                        const audioBuf = Buffer.from(obj.audio_base64, 'base64');
                        chunks.push(audioBuf);
                        onChunk(audioBuf, obj.alignment);
                    }
                } catch (_) {}
            }
        });

        response.data.on('end', () => {
            if (buffer.trim()) {
                try {
                    const obj = JSON.parse(buffer.trim());
                    if (obj.audio_base64) {
                        const audioBuf = Buffer.from(obj.audio_base64, 'base64');
                        chunks.push(audioBuf);
                        onChunk(audioBuf, obj.alignment);
                    }
                } catch (_) {}
            }
            resolve(Buffer.concat(chunks));
        });

        response.data.on('error', (err: Error) => reject(err));
    });
}

/**
 * تحويل النص إلى صوت وإرجاعه كـ base64
 */
export async function textToSpeechBase64(
    text: string,
    language?: 'ar' | 'en'
): Promise<string> {
    const audioBuffer = await textToSpeech(text, language);
    return audioBuffer.toString('base64');
}

/**
 * تحويل النص إلى صوت وتمريره مباشرة إلى WebSocket (forward فقط - لا تجميع ولا معالجة)
 * 
 * هذه الخدمة مستقلة تماماً عن STT و LLM - فقط forward للـ chunks
 * 
 * @param text - النص المراد تحويله
 * @param ws - WebSocket لإرسال الـ chunks مباشرة
 * @param language - اللغة ('ar' أو 'en') - افتراضي: 'en'
 * @returns Promise<void> - لا ينتظر اكتمال الصوت، فقط يبدأ البث
 */
export async function streamTextToSpeech(
    text: string,
    ws: any, // WebSocket type
    language: 'ar' | 'en' = 'en'
): Promise<void> {
    const ELEVENLABS_API_KEY = getElevenLabsKey();
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key is not configured');
    }

    if (!text || text.trim().length === 0) {
        return; // نص فارغ - لا شيء للبث
    }

    // Voice IDs
    const ARABIC_VOICE_ID = 'pSfhiOqmR5ZWBE5pZErH';
    const ENGLISH_VOICE_ID = 'eR40ATw9ArzDf9h3v7t7';
    const voiceId = language === 'ar' ? ARABIC_VOICE_ID : ENGLISH_VOICE_ID;
    const TTS_MODEL = 'eleven_turbo_v2_5';

    try {
        const response = await axios.post(
            `${ELEVENLABS_API_URL}/${voiceId}/stream`,
            {
                text: text,
                model_id: TTS_MODEL,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true
                }
            },
            {
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': ELEVENLABS_API_KEY
                },
                responseType: 'stream',
                timeout: 30000
            }
        );

        // Forward كل chunk مباشرة إلى WebSocket - لا تجميع، لا معالجة، لا انتظار
        // إرسال مباشر للـ chunk كـ binary (ws.send(chunk))
        response.data.on('data', (chunk: Buffer) => {
            // التحقق من حالة WebSocket
            const isOpen = ws.readyState === ws.OPEN || ws.readyState === 1;
            if (!isOpen) {
                return; // WebSocket مغلق - لا نرسل
            }

            try {
                // إرسال chunk كـ JSON message (نفس تنسيق النظام)
                const message = JSON.stringify({
                    type: 'audio_chunk',
                    chunkBase64: chunk.toString('base64'),
                    format: 'mp3'
                });
                ws.send(message);
            } catch (err) {
                console.warn('⚠️ Failed to send TTS chunk to WebSocket:', err);
            }
        });

        // Promise للانتظار حتى انتهاء البث
        return new Promise<void>((resolve, reject) => {
            response.data.on('end', () => {
                resolve();
            });

            response.data.on('error', (error: Error) => {
                console.error(`[TTS ERROR] ${error.message}`);
                reject(error);
            });
        });
    } catch (error: any) {
        console.error(`[TTS ERROR] ${error.message || error}`);
        throw error;
    }
}
