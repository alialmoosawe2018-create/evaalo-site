/**
 * Deterministic Interview Controller
 * بدل أن يعتمد على LLM ليقرر — المنطق الحتمي يحدد التدفق
 */

import type { InterviewPhase } from '../services/llmService.js';
import type { InterviewState } from './interviewState.js';
import { POOL_COUNT } from './interviewConfig.js';

export interface ControllerOutput {
  phase: InterviewPhase;
  isFirstPhase3Message: boolean;
  /** 1 = أول سؤال (tell me about yourself)، 2 = Microsoft Office، 3 = مهمّة الدور — undefined = لا إلزامي */
  mandatoryQuestionDue: 1 | 2 | 3 | undefined;
  suggestedPool?: number;
}

/** Phase 1: 0-8 (9 أسئلة) | Phase 2: 9-12 (4 أسئلة) | Phase 3: 13+ */
const PHASE1_MAX_USER_MSGS = 9;
const PHASE2_MAX_USER_MSGS = 13;

/**
 * الجلسة الإنجليزية: لا Phase 3 — اختبار الإنجليزية بلا معنى في مقابلة إنجليزية
 * بالكامل. أدوارها الأربعة تُوزَّع على Phase 1 (+3) ويبقى Phase 2 مفتوحاً حتى
 * انتهاء الوقت، فتبقى المدة الإجمالية كما هي.
 */
const PHASE1_MAX_USER_MSGS_EN = 12;

/**
 * يحسب مخرجات الـ Controller من الحالة الحالية
 * يُستدعى قبل إرسال الطلب للـ LLM
 */
export function getControllerOutput(
  userMessageCount: number,
  state?: InterviewState | null,
  sessionLanguage?: 'ar' | 'en',
  phase1TopicsExhausted?: boolean
): ControllerOutput {
  const englishSession = sessionLanguage === 'en';

  /**
   * الخروج المبكر من المرحلة الأولى حين تنفد محاورها.
   *
   * ⚠️ الحساب هو المشكلة: المرحلة الأولى تسعة أدوار، والإلزاميّات تحجز محورين
   * (الافتتاحي ⇒ warmup، وأوفيس ⇒ technical_skills_and_tools). فحين كانت المحاور
   * خمسة بقي ستّة أدوار حرّة لثلاثة محاور طازجة — ثلاثة أدوار بلا محورٍ جديد في
   * كلّ مقابلة. وحارس التنويع لا يملك بديلاً عندها فيُبقي البنك على ما استنتجه
   * من آخر إجابة، فيعود الموضوع نفسه. رُصد في جلسة الإنتاج 621efd4e، الدور 8.
   * وتوسيعُ المحاور إلى سبعة قلّص الفجوة ولم يُلغها، فهذا الخروج يبقى لازماً.
   *
   * فبدل إنفاق تلك الأدوار على مواضيع مطروقة، تُسلَّم إلى المرحلة الثانية —
   * ومحاورها ستّة مبنيّة من ملفّ المرشّح نفسه، وأربعة أدوار لا تكفيها أصلاً.
   *
   * شرطان يحكمانه:
   *   • ألّا يبقى سؤالٌ إلزاميّ غير مطروح. هي أرض المقارنة بين المرشّحين جميعاً،
   *     فلا يجوز أن يقفز الخروج المبكر فوق واحدٍ منها.
   *   • أن يمرّر المتصل العلَم أصلاً — وهو لا يمرّره إلّا حين يملك بيانات
   *     المرشّح، لأنّ المرحلة الثانية بلا ملفّ تهبط إلى أسئلة عامّة أضعف من
   *     بنوك المرحلة الأولى. فالجلسة العامّة بلا ملفّ تبقى على سلوكها.
   */
  const allMandatoriesAsked =
    (state?.firstMandatoryAsked ?? false) &&
    (state?.roleMandatoryAsked ?? false) &&
    (state?.secondMandatoryAsked ?? false);
  const leavePhase1Early = phase1TopicsExhausted === true && allMandatoriesAsked;

  const phase: InterviewPhase = englishSession
    ? userMessageCount < PHASE1_MAX_USER_MSGS_EN && !leavePhase1Early
      ? 1
      : 2
    : userMessageCount < PHASE1_MAX_USER_MSGS && !leavePhase1Early
      ? 1
      : userMessageCount < PHASE2_MAX_USER_MSGS
        ? 2
        : 3;

  const isFirstPhase3Message = phase === 3 && userMessageCount === PHASE2_MAX_USER_MSGS;

  // الأسئلة الإلزامية: 1 = أول سؤال (بداية)، 2 = Microsoft Office (لاحقاً)
  let mandatoryQuestionDue: 1 | 2 | 3 | undefined;
  if (phase === 1) {
    if (userMessageCount <= 1 && !(state?.firstMandatoryAsked ?? false)) {
      mandatoryQuestionDue = 1;
    } else if (userMessageCount >= 2 && !(state?.roleMandatoryAsked ?? false)) {
      /* سؤال الدور ثانياً وعند الرسالة 2 عمداً — أبكر من أوفيس.
       *
       * ⚠️ قياس 16 مقابلة حقيقية (2026-09-10): بُعد
       * `relevant_experience_role_fit` بوزن 20 نقطة كان يُقيَّم في 16/16 بينما
       * لا يُسأل عن الدور إلّا في 6/16 — أي أنّ 10 مرشّحين نالوا درجةً على
       * سؤالٍ لم يُطرح عليهم. وكان موضوع الدور يقع في المرحلة الثانية، ولم تكن
       * المقابلات القصيرة تبلغها: كل مقابلة من 5–10 أسئلة لم تُسأله ولا مرّة.
       * وأقصر مقابلة مقيسة كانت 5 أسئلة، فالموضع 2 يضمنه فيها جميعاً. */
      mandatoryQuestionDue = 3;
    } else if (userMessageCount >= 4 && !(state?.secondMandatoryAsked ?? false)) {
      mandatoryQuestionDue = 2;
    } else {
      mandatoryQuestionDue = undefined;
    }
  } else {
    mandatoryQuestionDue = undefined;
  }

  // round-robin على كل البنوك حسب عدد الرسائل — يقلل تكرار نفس الـ Pool
  const suggestedPool = ((userMessageCount % POOL_COUNT) + 1) as number;

  return {
    phase,
    isFirstPhase3Message,
    mandatoryQuestionDue,
    suggestedPool,
  };
}
