// ============================================
// ملف: services/voiceRecordingService.ts
// الوظيفة: دمج مقاطع المقابلة الصوتية (صوت المرشح PCM16 + صوت الوكيل MP3)
//          إلى ملف MP3 واحد بترتيب زمني (المحادثة الكاملة).
//
// المقاطع غير متداخلة زمنياً (المرشح يتكلم أثناء الاستماع، والوكيل أثناء النطق)،
// لذا نستخدم دمجاً تسلسلياً (concat) عبر ffmpeg بدل المزج المتزامن.
// ============================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Candidate from '../models/Candidate.js';
import CandidateApplication from '../models/CandidateApplication.js';
import { uploadBuffer, isR2Configured } from './r2Service.js';

export interface RecordingSegment {
  /** المتحدّث في هذا المقطع. */
  speaker: 'user' | 'agent';
  /** صيغة بيانات المقطع: pcm = صوت المرشح الخام (s16le 16k mono)، mp3 = صوت الوكيل. */
  format: 'pcm' | 'mp3';
  /** بايتات الصوت المتراكمة لهذا المقطع. */
  buffer: Buffer;
}

const PCM_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 44100;

/** نتيجة دمج المحادثة: الملف + بياناته الوصفية (للتخزين والتقارير لاحقاً). */
export interface ConversationRecordingResult {
  buffer: Buffer;
  sizeBytes: number;
  /** مدة التسجيل بالثواني (best-effort عبر ffprobe؛ undefined عند تعذّرها). */
  durationSec?: number;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/** قياس مدة ملف صوتي بالثواني عبر ffprobe (best-effort؛ يعيد undefined عند الفشل). */
function probeDurationSec(filePath: string): Promise<number | undefined> {
  return new Promise<number | undefined>((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ];
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.on('error', () => resolve(undefined));
    proc.on('close', () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? Math.round(n) : undefined);
    });
  });
}

/**
 * دمج مقاطع المحادثة إلى MP3 واحد.
 * @returns نتيجة فيها buffer + sizeBytes + durationSec، أو null إذا لا توجد مقاطع صالحة.
 */
export async function buildConversationMp3(
  segments: RecordingSegment[]
): Promise<ConversationRecordingResult | null> {
  const valid = segments.filter((s) => s.buffer && s.buffer.length > 0);
  if (valid.length === 0) return null;

  const workDir = path.join(os.tmpdir(), `voice-rec-${randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const inputPaths: string[] = [];
  const outputPath = path.join(workDir, 'conversation.mp3');

  try {
    // كتابة كل مقطع إلى ملف مؤقت.
    valid.forEach((seg, i) => {
      const ext = seg.format === 'pcm' ? 'pcm' : 'mp3';
      const p = path.join(workDir, `seg-${i}.${ext}`);
      fs.writeFileSync(p, seg.buffer);
      inputPaths.push(p);
    });

    // بناء وسائط ffmpeg: مدخلات + filter_complex بدمج تسلسلي بعد توحيد المعدل/القنوات.
    const args: string[] = [];
    valid.forEach((seg, i) => {
      if (seg.format === 'pcm') {
        args.push('-f', 's16le', '-ar', String(PCM_SAMPLE_RATE), '-ac', '1');
      }
      args.push('-i', inputPaths[i]);
    });

    let filter = '';
    valid.forEach((_, i) => {
      filter += `[${i}:a]aresample=${OUTPUT_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono[a${i}];`;
    });
    valid.forEach((_, i) => {
      filter += `[a${i}]`;
    });
    filter += `concat=n=${valid.length}:v=0:a=1[out]`;

    args.push(
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-b:a', '64k',
      '-ar', String(OUTPUT_SAMPLE_RATE),
      '-ac', '1',
      '-y', outputPath
    );

    await runFfmpeg(args);
    const buffer = fs.readFileSync(outputPath);
    const durationSec = await probeDurationSec(outputPath);
    return { buffer, sizeBytes: buffer.length, durationSec };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* تجاهل أخطاء التنظيف */
    }
  }
}

/** هل تسجيل المقابلة الصوتية مفعّل لهذه الجلسة؟ */
export function isVoiceRecordingEnabled(candidateId?: string): boolean {
  return (
    process.env.VOICE_RECORDING_ENABLED !== 'false' &&
    isR2Configured() &&
    !!candidateId &&
    /^[a-fA-F0-9]{24}$/.test(candidateId)
  );
}

/**
 * دمج مقاطع المحادثة إلى MP3 ورفعها إلى R2 ثم حفظ المفتاح على المرشح.
 * تعمل بعد إغلاق الجلسة (لا تحجب الاتصال). الأخطاء تُسجَّل فقط.
 */
export async function finalizeVoiceRecording(
  sessionId: string,
  candidateId: string | undefined,
  segments: RecordingSegment[],
  scope?: { applicationId?: string; campaignId?: string }
): Promise<void> {
  if (!candidateId || segments.length === 0) return;
  const short = sessionId.substring(0, 8);
  try {
    const result = await buildConversationMp3(segments);
    if (!result || result.buffer.length === 0) {
      console.warn(`[VOICE RECORDING] ${short}... empty output, skipped`);
      return;
    }
    let orgId = 'org_unknown';
    try {
      const c = await Candidate.findById(candidateId).select('organizationId').lean();
      if ((c as any)?.organizationId) orgId = String((c as any).organizationId);
    } catch {
      /* تجاهل: نستخدم org_unknown */
    }
    const key = `voice-recordings/${orgId}/${candidateId}/${sessionId}.mp3`;
    await uploadBuffer(key, result.buffer, 'audio/mpeg');
    const voiceRecording = {
      key,
      mime: 'audio/mpeg',
      durationSec: result.durationSec,
      sizeBytes: result.sizeBytes,
      sessionId,
      createdAt: new Date(),
    };
    await Candidate.findByIdAndUpdate(candidateId, { $set: { voiceRecording } });
    try {
      const { findApplicationForCallback } = await import('./candidateApplicationService.js');
      const app = await findApplicationForCallback({
        applicationId: scope?.applicationId,
        candidateId,
        campaignId: scope?.campaignId,
      });
      if (app) {
        await CandidateApplication.findByIdAndUpdate(app._id, { $set: { voiceRecording } });
      }
    } catch {
      /* dual-write best-effort */
    }
    console.log(`[VOICE RECORDING] ${short}... uploaded ${(result.sizeBytes / 1024).toFixed(0)}KB → ${key}`);
  } catch (err: any) {
    console.warn(`[VOICE RECORDING] ${short}... failed: ${err?.message || err}`);
  }
}
