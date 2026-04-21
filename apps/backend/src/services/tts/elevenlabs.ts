// ============================================
// ملف: services/tts/elevenlabs.ts
// الوظيفة: ElevenLabs Text-to-Speech (WAV format للـ Beyond Presence)
// ============================================

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

/**
 * تحويل النص إلى صوت باستخدام ElevenLabs (WAV format)
 * 
 * @param text - النص المراد تحويله إلى صوت
 * @param options - خيارات إضافية (voiceId, modelId)
 * @returns Promise<Buffer> - WAV audio buffer
 */
export async function textToSpeechElevenLabs(
    text: string,
    options: { voiceId?: string; modelId?: string } = {}
): Promise<Buffer> {
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ELEVENLABS_API_KEY is not set');
    }

    if (!text || text.trim().length === 0) {
        throw new Error('Text is empty');
    }

    const voiceId = options.voiceId || ELEVENLABS_VOICE_ID;
    const modelId = options.modelId || 'eleven_flash_v2_5';

    console.log(`🎤 Converting text to speech (ElevenLabs): "${text.substring(0, 50)}..." (voiceId: ${voiceId})`);

    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text: text,
                model_id: modelId,
                voice_settings: {
                    stability: 0.4,
                    similarity_boost: 0.8,
                },
            },
            {
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                    "Accept": "audio/wav", // WAV format للـ Beyond Presence
                },
                responseType: 'arraybuffer', // استقبال binary data
                timeout: 30000, // 30 seconds timeout
            }
        );

        const audioBuffer = Buffer.from(response.data);
        
        console.log(`✅ ElevenLabs TTS successful: ${audioBuffer.length} bytes (WAV)`);
        return audioBuffer;

    } catch (error: any) {
        const errorMessage = error.response?.data 
            ? Buffer.from(error.response.data).toString() 
            : error.message;
        console.error(`❌ ElevenLabs TTS error: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
        throw new Error(`ElevenLabs TTS failed: ${error.response?.status || 'Unknown'} - ${errorMessage}`);
    }
}

export default {
    textToSpeechElevenLabs,
};
