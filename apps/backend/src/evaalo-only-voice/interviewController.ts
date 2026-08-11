/**
 * Deterministic Interview Controller
 * بدل أن يعتمد على LLM ليقرر — المنطق الحتمي يحدد التدفق
 */

import type { InterviewPhase } from '../services/llmService.js';
import type { InterviewState } from './interviewState.js';

export interface ControllerOutput {
  phase: InterviewPhase;
  isFirstPhase3Message: boolean;
  /** 1 = أول سؤال (tell me about yourself)، 2 = Microsoft Office — undefined = لا إلزامي */
  mandatoryQuestionDue: 1 | 2 | undefined;
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
  sessionLanguage?: 'ar' | 'en'
): ControllerOutput {
  const englishSession = sessionLanguage === 'en';

  const phase: InterviewPhase = englishSession
    ? userMessageCount < PHASE1_MAX_USER_MSGS_EN
      ? 1
      : 2
    : userMessageCount < PHASE1_MAX_USER_MSGS
      ? 1
      : userMessageCount < PHASE2_MAX_USER_MSGS
        ? 2
        : 3;

  const isFirstPhase3Message = phase === 3 && userMessageCount === PHASE2_MAX_USER_MSGS;

  // الأسئلة الإلزامية: 1 = أول سؤال (بداية)، 2 = Microsoft Office (لاحقاً)
  let mandatoryQuestionDue: 1 | 2 | undefined;
  if (phase === 1) {
    if (userMessageCount <= 1 && !(state?.firstMandatoryAsked ?? false)) {
      mandatoryQuestionDue = 1;
    } else if (userMessageCount >= 4 && !(state?.secondMandatoryAsked ?? false)) {
      mandatoryQuestionDue = 2;
    } else {
      mandatoryQuestionDue = undefined;
    }
  } else {
    mandatoryQuestionDue = undefined;
  }

  // round-robin 1-5 حسب عدد الرسائل — يقلل تكرار نفس الـ Pool
  const suggestedPool = ((userMessageCount % 5) + 1) as number;

  return {
    phase,
    isFirstPhase3Message,
    mandatoryQuestionDue,
    suggestedPool,
  };
}
