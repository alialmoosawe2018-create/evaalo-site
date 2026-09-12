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
import { isApplicationOwnsCampaignStateEnabled } from '../config/applicationOwnership.js';

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

/** ما يُخزَّن على الطلب (أو الشخص) تحت `voiceRecording`. */
export type StoredVoiceRecording = {
  key?: string;
  sessionId?: string;
  durationSec?: number;
  sizeBytes?: number;
} | null | undefined;

/**
 * هل يحلّ التسجيلُ الجديد محلّ المخزون؟ — **التسجيل يتبع التقييم.**
 *
 * التقييم يتبع آخر نصٍّ **قابلٍ للتقييم** يصل (`mergeEval` يستبدل)، فالمؤشّر يتبع
 * القاعدة نفسها بلا استثناء:
 *
 *   - الجلسة قابلة للتقييم (`evidence.ok`) ⇒ نعم، بلا شرط. هي التي سيُحتسب
 *     تقييمها، فصوتُها هو الصوت الذي يجب أن يسمعه المُوظِّف.
 *   - غير قابلةٍ للتقييم ⇒ لا تنتزع مؤشّراً من جلسةٍ أخرى؛ تكتب فقط إن لم يكن
 *     هناك مؤشّر، أو كان لها هي (الإغلاق الثاني لجلسةٍ مستأنَفة يحمل المحادثة
 *     كاملةً حتى لحظته فيستبدل ملفَّه الأقصر).
 *
 * ⚠️ مقيس في الإنتاج (٢٠٢٦-٠٩-١٢): تبويبٌ ثانٍ فُتح قبل إغلاق المقابلة الحقيقية،
 * صفر إجابات، أُغلق بعدها بثلاث ثوانٍ — فاستبدل تسجيلَ 4929f056 بثماني ثوانٍ من
 * التحيّة (93cee148، 63 KB، 08:10:26). كان المؤشّر «آخر كاتبٍ يفوز».
 *
 * ولماذا لا «الجلسة التي قفلت الرابط»: كان ذلك بابَ النسخة الأولى، وقفلُ الرابط
 * **أوّلُ كاتبٍ يفوز**. فتبويبان مفتوحان معاً وكلاهما يجيب: الأوّل يملك القفل
 * فيحتفظ بالصوت، والثاني يصل نصُّه لاحقاً فيملك التقييم — فيسمع المُوظِّف مقابلةً
 * ويقرأ تقييمَ أخرى. وعلى مسار التراجع (الحملة تُملَك بالشخص) كان ختمُ الشخص
 * يبقى لأوّل جلسةٍ قفلت رابطه فتُرفض تسجيلاتُ كلّ حملةٍ تالية.
 */
export function shouldReplaceVoiceRecording(
  existing: StoredVoiceRecording,
  incoming: { sessionId: string; scorable: boolean }
): boolean {
  if (incoming.scorable) return true;
  if (!existing?.sessionId) return true;
  return existing.sessionId === incoming.sessionId;
}

/**
 * الشرط نفسه كمرشّح Mongo، يُلحق بشرط `_id` فتكون الكتابة ذرّية بلا قراءةٍ سابقة:
 * قراءةٌ ثمّ كتابة كانت ستترك ثغرةً بين إغلاقين متقاربين. الجلسة القابلة للتقييم
 * تكتب بلا شرط (مرشّحٌ فارغ).
 */
export function voiceRecordingReplaceGuard(incoming: {
  sessionId: string;
  scorable: boolean;
}): Record<string, unknown> {
  if (incoming.scorable) return {};
  return {
    $or: [
      { 'voiceRecording.sessionId': { $exists: false } },
      { 'voiceRecording.sessionId': incoming.sessionId },
    ],
  };
}

/**
 * هل يُكتب المؤشّر على **الشخص** بعد محاولة الكتابة على الطلب؟
 *
 * ثلاث حالات لا اثنتان — وهذا بالضبط ما أخطأتُ فيه:
 *
 *   - لا طلبَ أصلاً ⇒ نعم. المسار القديم: الشخص هو الحامل الوحيد.
 *   - طلبٌ موجود والكتابةُ **رُفضت بالحارس** ⇒ **لا**. الحارس حكم: هذه الجلسة لا
 *     تملك المؤشّر. والنزول إلى الشخص بعده يُبطل حكمه من الباب الخلفي.
 *   - طلبٌ موجود والكتابةُ **رمت خطأً** (شبكة، مهلة) ⇒ نعم، بديلٌ حقيقي: لا صفَّ
 *     يشير إلى الملفّ المرفوع، فيُكتب الشخص كما كان قبل ملكية الطلب.
 *   - وحين تكون ملكيةُ الحملة بالشخص (العلم مطفأ) ⇒ نعم دائماً، كما كان.
 *
 * ⚠️ مقيس في الإنتاج (٢٠٢٦-٠٩-١٢، المرشّح 6aa59318): الجلسة `9a5d0592` كتبت على
 * الطلب، ثمّ رُفضت `bad91a5a` عليه بحقّ — **فنزلت إلى الشخص** وسكنته. فصار الصفّان
 * يشيران إلى جلستين مختلفتين، وهو ما لا يجوز أن يحدث أصلاً: الحارس حكم بأنّ هذه
 * الجلسة لا تملك المؤشّر، فكتابتُها على صفٍّ غيرِ مقيَّدٍ بحملةٍ تُبطل حكمه.
 *
 * وتصحيحٌ لتقديرٍ أوّليّ خاطئ منّي: قارئ `GET /:id/voice-recording` يبدأ بصفّ
 * الشخص، **لكنّ اللوحة تُمرّر معرّف الطلب** (`mapAppsToStageRows` تضع
 * `_id: app._id`)، فلا يجد الشخصَ بذلك المعرّف ويقع على الطلب. أي أنّ المُوظِّف
 * على مسار الطلبات يسمع تسجيل الطلب، ولم يُسمَع صفُّ الشخص المُظلِّل. من يقرؤه:
 * المسار القديم (صفوف الأشخاص حين لا طلبات)، ومسار التراجع، وأيّ قارئ لاحق.
 *
 * وسببُ الخطأ أنّني جمعت «هل نجحت الكتابة؟» و«هل يوجد طلب؟» في علمٍ واحد وأنا
 * أُصلح عيباً آخر (رفعُ العلم قبل نجاح الكتابة كان يُسقط البديل عند خطأٍ عابر).
 */
export function shouldWritePersonRow(input: {
  appResolved: boolean;
  appWriteThrew: boolean;
  /** للاختبار؛ الافتراضي قراءةُ العلم الحقيقي. */
  ownershipEnabled?: boolean;
}): boolean {
  const ownership = input.ownershipEnabled ?? isApplicationOwnsCampaignStateEnabled();
  if (!ownership) return true;
  if (!input.appResolved) return true;
  return input.appWriteThrew;
}

/**
 * تسلسل المهامّ لكلّ مفتاح: مهمّةٌ لا تبدأ قبل أن تنتهي سابقتُها على المفتاح نفسه،
 * ومفاتيح مختلفة لا تنتظر بعضها. فشلُ سابقةٍ لا يمنع اللاحقة.
 *
 * السبب: الجلسة المستأنَفة تُغلق مرّتين وترفع تحت المفتاح نفسه؛ لو تقارب الإغلاقان
 * لثوانٍ لسبق رفعُ الثاني (الأكمل) رفعَ الأوّل فكتب الأوّلُ فوقه.
 */
const serialized = new Map<string, Promise<void>>();

export function runSerialized(key: string, task: () => Promise<void>): Promise<void> {
  const prev = serialized.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  serialized.set(key, run);
  // التنظيف بمعالجَي نجاحٍ وفشل معاً: `finally` وحدها تُنتج فرعاً مرفوضاً بلا
  // معالج حين تفشل المهمّة، فيقتل Node العمليةَ (unhandled rejection) ولو كان
  // المتصل قد عالج `run` نفسه.
  const release = () => {
    if (serialized.get(key) === run) serialized.delete(key);
  };
  void run.then(release, release);
  return run;
}

/** للفحص والاختبار. */
export function serializedKeyCount(): number {
  return serialized.size;
}

export type VoiceRecordingScope = {
  applicationId?: string;
  campaignId?: string;
  /**
   * هل هذه الجلسة قابلة للتقييم (`evidence.ok`)؟ يقرّر مَن يملك المؤشّر — انظر
   * `shouldReplaceVoiceRecording`. الملفّ يُرفع في الحالتين تحت مفتاح جلسته.
   */
  scorable?: boolean;
};

/**
 * دمج مقاطع المحادثة إلى MP3 ورفعها إلى R2 ثم حفظ المفتاح على الطلب (أو الشخص).
 * تعمل بعد إغلاق الجلسة (لا تحجب الاتصال). الأخطاء تُسجَّل فقط.
 *
 * تُنفَّذ متسلسلةً لكلّ جلسة (انظر `runSerialized`)، ويُحسم المؤشّر بـ
 * `voiceRecordingReplaceGuard` مُلحَقاً بالكتابة نفسها لا بقراءةٍ قبلها.
 */
export function finalizeVoiceRecording(
  sessionId: string,
  candidateId: string | undefined,
  segments: RecordingSegment[],
  scope?: VoiceRecordingScope
): Promise<void> {
  if (!candidateId || segments.length === 0) return Promise.resolve();
  return runSerialized(`voice-recording:${sessionId}`, () =>
    finalizeVoiceRecordingNow(sessionId, candidateId, segments, scope)
  );
}

async function finalizeVoiceRecordingNow(
  sessionId: string,
  candidateId: string,
  segments: RecordingSegment[],
  scope?: VoiceRecordingScope
): Promise<void> {
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
    // The recording belongs to one interview, so it belongs to that interview's
    // application. Resolve first: the person is written only when there is no
    // application to hold it, otherwise the newest recording overwrites the
    // person's copy and every campaign appears to share one.
    //
    // The pointer moves only under `voiceRecordingReplaceGuard` (see
    // `shouldReplaceVoiceRecording`): the file is uploaded regardless, so a
    // recording that loses the pointer still exists under its own key.
    const incoming = { sessionId, scorable: scope?.scorable === true };
    const guard = voiceRecordingReplaceGuard(incoming);
    let appResolved = false;
    let appWriteThrew = false;
    // الصفوف التي قبلت المؤشّر فعلاً — تُسجَّل عند نجاح كلّ كتابة، لا تُستنتج بعدها.
    // (استنتاجها من `appResolved && !appWriteThrew` كان يكذب على مسار التراجع: هناك
    // تُجرى الكتابتان، فقد يقبلها الشخصُ بعد أن يرفضها الطلب، ويُطبع «على الطلب».)
    const wroteTo: string[] = [];
    try {
      const { findApplicationForCallback } = await import('./candidateApplicationService.js');
      const app = await findApplicationForCallback({
        applicationId: scope?.applicationId,
        candidateId,
        campaignId: scope?.campaignId,
      });
      if (app) {
        appResolved = true;
        const updated = await CandidateApplication.findOneAndUpdate(
          { _id: app._id, ...guard },
          { $set: { voiceRecording } },
          { new: true }
        );
        if (updated) wroteTo.push('application');
      }
    } catch (appErr: any) {
      appWriteThrew = true;
      console.warn(`[VOICE RECORDING] ${short}... application pointer write failed: ${appErr?.message || appErr}`);
    }
    if (shouldWritePersonRow({ appResolved, appWriteThrew })) {
      const updated = await Candidate.findOneAndUpdate(
        { _id: candidateId, ...guard },
        { $set: { voiceRecording } },
        { new: true }
      );
      if (updated) wroteTo.push('person');
    }
    console.log(
      `[VOICE RECORDING] ${short}... uploaded ${(result.sizeBytes / 1024).toFixed(0)}KB → ${key}` +
        (wroteTo.length > 0
          ? ` (pointer → this session on the ${wroteTo.join(' + ')})`
          : ' (pointer unchanged — session not scorable, the file stays under its own key)')
    );
  } catch (err: any) {
    console.warn(`[VOICE RECORDING] ${short}... failed: ${err?.message || err}`);
  }
}
