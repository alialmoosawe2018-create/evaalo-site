// ============================================
// ملف: services/audioConverterService.ts
// الوظيفة: تحويل audio من webm/opus إلى wav (pcm16, 16kHz, mono)
// ============================================

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * تحويل audio من webm/opus إلى wav (pcm16, 16kHz, mono)
 * 
 * @param inputBuffer - Audio buffer (webm/opus)
 * @param inputFormat - Input format (webm, opus, etc.)
 * @returns Promise<Buffer> - WAV buffer (pcm16, 16kHz, mono)
 */
export async function convertWebmToWav(
    inputBuffer: Buffer,
    inputFormat: string = 'webm'
): Promise<Buffer> {
    const tempDir = path.join(__dirname, '..', '..', 'uploads', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = Date.now();
    const inputFilePath = path.join(tempDir, `input-${timestamp}.${inputFormat}`);
    const outputFilePath = path.join(tempDir, `output-${timestamp}.wav`);

    try {
        // كتابة input buffer إلى ملف مؤقت
        fs.writeFileSync(inputFilePath, inputBuffer);
        console.log('📝 Input file written:', inputFilePath);

        // تحويل باستخدام ffmpeg
        // الأمر المكافئ: ffmpeg -i input.webm -ar 16000 -ac 1 -f wav output.wav
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputFilePath)
                .audioCodec('pcm_s16le')  // PCM 16-bit little-endian
                .audioFrequency(16000)    // -ar 16000: 16kHz sample rate
                .audioChannels(1)         // -ac 1: Mono
                .format('wav')            // -f wav: WAV format
                .output(outputFilePath)
                .on('start', (commandLine) => {
                    console.log('🔄 FFmpeg command:', commandLine);
                })
                .on('end', () => {
                    console.log('✅ Audio conversion completed:', {
                        input: inputFilePath,
                        output: outputFilePath,
                        format: 'wav (PCM16, 16kHz, mono)'
                    });
                    resolve();
                })
                .on('error', (error) => {
                    console.error('❌ FFmpeg conversion error:', error);
                    reject(error);
                })
                .on('progress', (progress) => {
                    // يمكن إضافة logging هنا إذا لزم الأمر
                })
                .run();
        });

        // قراءة output file
        const wavBuffer = fs.readFileSync(outputFilePath);
        console.log('📦 Converted WAV size:', wavBuffer.length, 'bytes');

        // تنظيف الملفات المؤقتة
        try {
            if (fs.existsSync(inputFilePath)) {
                fs.unlinkSync(inputFilePath);
            }
            if (fs.existsSync(outputFilePath)) {
                fs.unlinkSync(outputFilePath);
            }
        } catch (cleanupError) {
            console.warn('⚠️ Error cleaning up temp files:', cleanupError);
        }

        return wavBuffer;

    } catch (error: any) {
        // تنظيف الملفات المؤقتة في حالة الخطأ
        try {
            if (fs.existsSync(inputFilePath)) {
                fs.unlinkSync(inputFilePath);
            }
            if (fs.existsSync(outputFilePath)) {
                fs.unlinkSync(outputFilePath);
            }
        } catch (cleanupError) {
            console.warn('⚠️ Error cleaning up temp files after error:', cleanupError);
        }

        console.error('❌ Audio conversion failed:', error);
        throw error;
    }
}

/**
 * التحقق من أن ffmpeg متوفر
 */
export function checkFFmpegAvailable(): boolean {
    try {
        // محاولة تشغيل ffmpeg -version
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch (error) {
        console.warn('⚠️ FFmpeg is not available. Audio conversion will fail.');
        return false;
    }
}

/**
 * Fallback: محاولة استخدام alternative method إذا لم يكن ffmpeg متوفر
 * (هذا قد لا يعمل بشكل جيد، لكنه أفضل من لا شيء)
 */
export async function convertWebmToWavFallback(
    inputBuffer: Buffer
): Promise<Buffer> {
    // Fallback بسيط: إرجاع buffer كما هو مع warning
    // في الواقع، هذا لن يعمل - نحتاج ffmpeg
    console.warn('⚠️ FFmpeg not available. Cannot convert audio. Please install ffmpeg.');
    throw new Error('FFmpeg is required for audio conversion. Please install ffmpeg.');
}

/**
 * تحويل webm إلى opus raw (للـ Deepgram)
 * 
 * @param inputBuffer - Audio buffer (webm container)
 * @returns Promise<Buffer> - Opus raw buffer
 */
export async function convertWebmToOpus(
    inputBuffer: Buffer
): Promise<Buffer> {
    const tempDir = path.join(__dirname, '..', '..', 'uploads', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = Date.now();
    const inputFilePath = path.join(tempDir, `input-${timestamp}.webm`);
    const outputFilePath = path.join(tempDir, `output-${timestamp}.opus`);

    try {
        // كتابة input buffer إلى ملف مؤقت
        fs.writeFileSync(inputFilePath, inputBuffer);

        // تحويل باستخدام ffmpeg إلى opus raw
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputFilePath)
                .audioCodec('libopus')      // Opus codec
                .audioFrequency(48000)      // 48kHz sample rate (Deepgram requirement)
                .audioChannels(1)          // Mono
                .format('opus')             // Opus format
                .output(outputFilePath)
                .on('end', () => {
                    resolve();
                })
                .on('error', (error) => {
                    console.error('❌ FFmpeg opus conversion error:', error);
                    reject(error);
                })
                .run();
        });

        // قراءة output file
        const opusBuffer = fs.readFileSync(outputFilePath);

        // تنظيف الملفات المؤقتة
        try {
            if (fs.existsSync(inputFilePath)) {
                fs.unlinkSync(inputFilePath);
            }
            if (fs.existsSync(outputFilePath)) {
                fs.unlinkSync(outputFilePath);
            }
        } catch (cleanupError) {
            console.warn('⚠️ Error cleaning up temp files:', cleanupError);
        }

        return opusBuffer;

    } catch (error: any) {
        // تنظيف الملفات المؤقتة
        try {
            if (fs.existsSync(inputFilePath)) {
                fs.unlinkSync(inputFilePath);
            }
            if (fs.existsSync(outputFilePath)) {
                fs.unlinkSync(outputFilePath);
            }
        } catch (cleanupError) {
            console.warn('⚠️ Error cleaning up temp files after error:', cleanupError);
        }

        console.error('❌ Opus conversion failed:', error);
        throw error;
    }
}

/**
 * إنشاء FFmpeg streaming pipeline لتحويل webm → opus في real-time
 * يستخدم stdin/stdout للـ streaming بدون files
 * 
 * @returns {ChildProcess} - FFmpeg process
 */
export function createWebmToOpusStream(): ChildProcess {
    // FFmpeg command: stdin (webm chunks) → stdout (opus raw)
    // -f webm = input format (webm container)
    // -i pipe:0 = read from stdin
    // -f opus = output opus format
    // -acodec libopus = use opus codec
    // -ar 48000 = 48kHz sample rate (Deepgram requirement)
    // -ac 1 = mono
    // -b:a 48k = 48kbps bitrate
    // -fflags +genpts = generate PTS for streaming
    // -flags low_delay = low delay mode for real-time
    // pipe:1 = write to stdout
    // إعادة encoding opus من webm (ليس copy) - هذا يعمل مع chunks غير مكتملة
    // -f webm = input format: webm container
    // -i pipe:0 = read from stdin
    // -f opus = output opus format (raw opus, not Ogg)
    // -acodec libopus = re-encode opus (يعمل مع chunks غير مكتملة)
    // -ar 48000 = 48kHz sample rate (Deepgram requirement)
    // -ac 1 = mono
    // -b:a 48k = 48kbps bitrate
    // -fflags +genpts = generate PTS for streaming
    // -flags low_delay = low delay mode
    // pipe:1 = write to stdout
    const ffmpegProcess = spawn('ffmpeg', [
        '-f', 'webm',             // Input format: webm container
        '-i', 'pipe:0',           // Input from stdin
        '-f', 'opus',            // Output opus format (raw opus)
        '-acodec', 'libopus',     // Re-encode opus (يعمل مع chunks غير مكتملة)
        '-ar', '48000',           // 48kHz sample rate
        '-ac', '1',               // Mono
        '-b:a', '48k',            // 48kbps bitrate
        '-fflags', '+genpts',     // Generate PTS for streaming
        '-flags', 'low_delay',    // Low delay mode
        '-avoid_negative_ts', 'make_zero', // Handle negative timestamps
        'pipe:1'                  // Output to stdout
    ], {
        stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    // Log errors (but ignore common info messages)
    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const errorStr = data.toString();
        // Ignore common FFmpeg info messages and warnings
        const ignorePatterns = [
            'frame=',
            'bitrate=',
            'ffmpeg version',
            'configuration:',
            'libav',
            'Input #0',
            'Metadata:',
            'encoder',
            'Duration:',
            'Stream #',
            'Stream mapping:',
            'Output #0',
            'default',
            'Lavf',
            'Lavc',
            'fltp',
            'flt'
        ];
        const shouldIgnore = ignorePatterns.some(pattern => errorStr.includes(pattern));
        if (!shouldIgnore && errorStr.trim().length > 0) {
            // Only log actual errors, not info messages
            if (errorStr.includes('Error') || errorStr.includes('error') || errorStr.includes('failed')) {
                console.error('❌ FFmpeg error:', errorStr.substring(0, 500));
            } else if (errorStr.includes('prematurely') || errorStr.includes('parsing')) {
                // These are warnings for incomplete chunks - expected in streaming
                // Only log if it's a real problem
                if (Math.random() < 0.1) { // Log only 10% of these warnings
                    console.warn('⚠️ FFmpeg streaming warning (expected):', errorStr.substring(0, 200));
                }
            }
        }
    });

    ffmpegProcess.on('error', (error) => {
        console.error('❌ FFmpeg process error:', error);
    });

    return ffmpegProcess;
}

export default {
    convertWebmToWav,
    convertWebmToOpus,
    checkFFmpegAvailable,
    createWebmToOpusStream,
};

