/**
 * مخزن صوت الجلسة الواحدة — يعبر الرجوع ولا يُمحى.
 *
 * السياق: كلّ اتصالٍ يجمع مقاطع صوته ويرفعها عند إغلاقه تحت مفتاحٍ باسم **الجلسة**
 * (`voice-recordings/<org>/<candidate>/<sessionId>.mp3`). كان هذا كافياً ما دامت
 * الجلسة تُغلق مرّةً واحدة. مع نافذة الرجوع (e833bac) صارت الجلسة **نفسها** تُغلق
 * مرّتين، فكتب الإغلاقُ الثاني فوق ملف الأوّل بمقاطع اتصاله وحده.
 *
 * ⚠️ مقيس في الإنتاج (4929f056، ٢٠٢٦-٠٩-١٢): الإغلاق الأوّل 08:08:55 رفع ١٣
 * تبادلاً؛ الإغلاق الثاني 08:10:22 كتب فوقه 460 KB ≈ ٥٨ ثانية هي ما بعد الرجوع
 * فقط. النصف الأوّل ضاع من R2 نهائياً (لا نسخ إصدارات).
 *
 * ولماذا كائنٌ لا دوالّ متفرّقة: المحاولة الأولى للإصلاح كانت **حرفاً ميّتاً** —
 * الحملُ كان يُجرى في الجزء غير المتزامن من معالج الإغلاق بعد أن أفرغ الرفعُ
 * المصفوفةَ في الجزء المتزامن، فكان يجد صفراً دائماً، ولا اختبارَ وحدةٍ يكشفه.
 * فصار كلّ شيءٍ هنا: البدءُ يحمل ما تُرك (لا يستطيع المتصل أن ينساه)، والإغلاقُ
 * يختم لقطةً لا تتغيّر بعدها، وما بعد الختم من مقاطعَ مرفوض. الترتيب محفوظ
 * بالبناء لا بالاتفاق.
 */
import type { RecordingSegment } from '../services/voiceRecordingService.js';

export type CarriedRecording = {
  segments: RecordingSegment[];
  /** مجموع البايتات — يُحمل معه كي يبقى السقف سقفاً للجلسة لا للاتصال. */
  bytes: number;
};

/** ما تركه اتصالٌ مركون، بمفتاح معرّف الجلسة. */
const carried = new Map<string, CarriedRecording>();

/** نسخةٌ سطحية للمقاطع: الاتصال التالي يعيد تعيين `buffer` على آخر مقطع. */
function copySegments(segments: RecordingSegment[]): RecordingSegment[] {
  return segments.map((s) => ({ ...s }));
}

export type VoiceRecordingBuffer = {
  /** يضيف مقطعاً. مرفوضٌ بعد الإغلاق، وبعد بلوغ السقف، وحين يكون التسجيل معطّلاً. */
  append(speaker: 'user' | 'agent', format: 'pcm' | 'mp3', chunk: Buffer): void;
  /**
   * يختم التجميع ويعيد لقطةً ثابتة: يفرغ المصفوفة الحيّة فلا يصل إليها شيءٌ بعد
   * ذلك. يُستدعى في الجزء المتزامن من معالج الإغلاق. تكراره يعيد اللقطة نفسها.
   */
  close(): CarriedRecording;
  /** اللقطة المختومة (فارغةٌ قبل الإغلاق). */
  snapshot(): CarriedRecording;
  /** يركن اللقطة لتبدأ بها الجلسةُ نفسها إذا عاد المرشّح. */
  park(): void;
  /** هل بدأ هذا الاتصال بمقاطع اتصالٍ سابق؟ — للسجلّ فقط. */
  readonly carriedSegmentCount: number;
  readonly carriedBytes: number;
};

export function createVoiceRecordingBuffer(input: {
  sessionId: string;
  enabled: boolean;
  maxBytes: number;
  /** جلسةٌ مستأنَفة: تبدأ بما تركه الاتصال السابق. */
  resumed: boolean;
}): VoiceRecordingBuffer {
  // البدء يحمل ما تُرك من نفسه — لا يستطيع المتصل أن ينسى هذه الخطوة.
  const inherited = input.resumed ? carried.get(input.sessionId) : undefined;
  if (inherited) carried.delete(input.sessionId);

  const live: RecordingSegment[] = inherited ? copySegments(inherited.segments) : [];
  let bytes = inherited?.bytes ?? 0;
  let sealed: CarriedRecording | null = null;

  return {
    carriedSegmentCount: inherited?.segments.length ?? 0,
    carriedBytes: inherited?.bytes ?? 0,

    append(speaker, format, chunk) {
      // بعد الختم لا يُقبل صوت. اللقطةُ محميّةٌ بالبناء أصلاً (تملك مصفوفتها)، وهذا
      // الشرط دفاعٌ ثانٍ: يوقف العمل بلا فائدة على اتصالٍ ميّت، ويمنع أيّ ختمٍ
      // لاحق — مثل `park` الذي يختم إن لم يُختم — من أن يبتلع ذيل جملةٍ مقطوعة.
      if (!input.enabled || sealed || !chunk || chunk.length === 0) return;
      if (bytes + chunk.length > input.maxBytes) return;
      bytes += chunk.length;
      const last = live[live.length - 1];
      if (last && last.speaker === speaker) {
        last.buffer = Buffer.concat([last.buffer, chunk]);
      } else {
        live.push({ speaker, format, buffer: Buffer.from(chunk) });
      }
    },

    close() {
      if (!sealed) sealed = { segments: live.splice(0), bytes };
      return sealed;
    },

    snapshot() {
      return sealed ?? { segments: [], bytes: 0 };
    },

    park() {
      // يختم إن لم يكن قد خُتم: الركن يقع في الجزء غير المتزامن من معالج الإغلاق،
      // فلا يُترك صحّتُه معلّقةً على أن يكون الختمُ قد سبقه في مكانٍ آخر.
      if (!sealed) sealed = { segments: live.splice(0), bytes };
      if (sealed.segments.length === 0) return;
      carried.set(input.sessionId, { segments: copySegments(sealed.segments), bytes: sealed.bytes });
    },
  };
}

/**
 * يُسقط ما تركته جلسةٌ — حين تُنسى (انتهاء النافذة، أو إنهاء الخادم، أو استبدال
 * الركن). بمعرّف الجلسة لا بالكائن: من يُنسي الجلسةَ قد لا يملك مخزنها.
 */
export function dropCarriedRecording(sessionId: string): boolean {
  return carried.delete(sessionId);
}

/** للفحص والاختبار. */
export function peekCarriedRecording(sessionId: string): CarriedRecording | undefined {
  return carried.get(sessionId);
}

export function carriedRecordingCount(): number {
  return carried.size;
}
