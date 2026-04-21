// ============================================
// ملف: services/sttService.ts
// الوظيفة: تحويل الصوت إلى نص (Speech-to-Text)
// ============================================

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { convertWebmToWav } from './audioConverterService.js';

// للحصول على مسار المجلد الحالي في ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// Configuration
// ============================================

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// ============================================
// Function: transcribeAudio
// ============================================

/**
 * تحويل audio chunk إلى نص
 * 
 * @param audioBuffer - Audio data (Buffer)
 * @param format - Audio format (mp3, wav, etc.)
 * @returns نص المستخدم (string)
 */
export async function transcribeAudio(
    audioBuffer: Buffer,
    format: 'mp3' | 'wav' | 'm4a' | 'webm' | 'ogg' | 'opus' = 'webm'
): Promise<string> {
    let tempFilePath: string | null = null;
    let finalFilePath: string | null = null;
    
    try {
        if (!process.env.OPENAI_API_KEY) {
            console.warn('⚠️ OPENAI_API_KEY is not set. Returning empty transcription.');
            return ''; // Fallback: إرجاع نص فارغ بدلاً من throw error
        }

        // التحقق من أن audioBuffer غير فارغ
        if (!audioBuffer || audioBuffer.length === 0) {
            console.warn('⚠️ Empty audio buffer received.');
            return '';
        }

        // إنشاء ملف مؤقت للصوت
        const tempDir = path.join(__dirname, '..', '..', 'uploads', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        let processedAudioBuffer = audioBuffer;
        let finalFormat = format;

        // إذا كان الصوت webm/opus، نحوله إلى wav (pcm16, 16kHz, mono)
        if (format === 'webm' || format === 'opus') {
            try {
                console.log('🔄 Converting webm/opus to wav (pcm16, 16kHz, mono)...');
                processedAudioBuffer = await convertWebmToWav(audioBuffer, format);
                finalFormat = 'wav';
                console.log('✅ Audio converted successfully');
            } catch (conversionError: any) {
                console.error('❌ Audio conversion failed:', conversionError);
                // Fallback: استخدام الصوت الأصلي (قد لا يعمل مع Whisper)
                console.warn('⚠️ Using original audio format (may not work with Whisper)');
            }
        }

        // حفظ الصوت المحول
        finalFilePath = path.join(tempDir, `audio-${Date.now()}.${finalFormat}`);
        fs.writeFileSync(finalFilePath, processedAudioBuffer);

        try {
            console.log('🎤 Sending audio to Whisper:', {
                fileSize: processedAudioBuffer.length,
                originalFormat: format,
                sendingFormat: finalFormat,
                tempFile: finalFilePath,
                bufferPreview: processedAudioBuffer.slice(0, 50).toString('hex')
            });
            
            // استدعاء OpenAI Whisper API مع timeout
            // بعد التحويل، الصوت الآن wav (pcm16, 16kHz, mono) - أفضل format لـ Whisper
            const transcription = await Promise.race([
                openai.audio.transcriptions.create({
                    file: fs.createReadStream(finalFilePath) as any,
                    model: 'whisper-1',
                    language: 'en', // يمكن تغييره إلى 'ar' للعربية
                    response_format: 'text',
                    // إضافة prompt لتحسين الدقة
                    prompt: 'This is a job interview conversation. The candidate is speaking.'
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('STT timeout after 15 seconds')), 15000)
                )
            ]) as any;

            const result = transcription.toString().trim();
            
            console.log('📝 Whisper transcription result:', {
                length: result.length,
                preview: result.substring(0, 100)
            });
            
            if (!result || result.length === 0) {
                console.warn('⚠️ Empty transcription result from Whisper.');
                return '';
            }

            return result;

        } catch (transcriptionError: any) {
            // Log error but don't break the flow
            console.error('❌ Whisper API error:', {
                message: transcriptionError.message,
                status: transcriptionError.response?.status,
                statusText: transcriptionError.response?.statusText,
                data: transcriptionError.response?.data,
                error: transcriptionError.error
            });
            
            // Fallback: إرجاع نص فارغ - سيتم التعامل معه في الـ route
            return '';
        } finally {
            // حذف الملف المؤقت
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (cleanupError) {
                    console.error('⚠️ Error cleaning up temp file:', cleanupError);
                }
            }
            if (finalFilePath && fs.existsSync(finalFilePath) && finalFilePath !== tempFilePath) {
                try {
                    fs.unlinkSync(finalFilePath);
                } catch (cleanupError) {
                    console.error('⚠️ Error cleaning up final temp file:', cleanupError);
                }
            }
        }

    } catch (error: any) {
        // Log error with context
        console.error('❌ STT Service Error:', {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n'),
            format: format,
            bufferSize: audioBuffer?.length || 0
        });
        
        // Fallback: إرجاع نص فارغ بدلاً من throw
        // سيتم التعامل معه في الـ route بإرجاع "Could you please repeat that?"
        return '';
    }
}

// ============================================
// Export
// ============================================

export default {
    transcribeAudio
};
