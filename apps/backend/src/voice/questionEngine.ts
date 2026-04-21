/**
 * Question Engine — logic outside LLM
 * النظام يختار السؤال، LLM يعيد صياغته فقط
 * الأسئلة والمراحل من interviewConfig (مصدر واحد)
 */

import type { InterviewPhase, SelectedQuestion } from '../services/llmService.js';
import type { InterviewState } from './interviewState.js';
import type { ControllerOutput } from './interviewController.js';
import {
  MANDATORY_QUESTIONS,
  POOL_QUESTIONS,
  PHASE1_TOPICS,
  PHASE2_TOPIC_KEYS,
  PHASE3_QUESTIONS,
  isVoiceTopicMemoryEnabled,
} from '../config/interviewConfig.js';

export type { SelectedQuestion };

/** كشف طلب تغيير السؤال — اغير، غير، نغير، تغير، غيّر */
export function isChangeQuestionRequest(transcript: string): boolean {
  const t = transcript.trim();
  return /(نغير|تغير|غيّر|اغير|غير|سؤال ثاني|ممكن نغير|ممكن اغير|ممكن غير|بعد نغير|another question|change the question)/i.test(t);
}

/** STAR Probing: كشف ذكر المرشح لتحدي أو موقف صعب */
export function isChallengeMention(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  return /(تحدي|تحديات|موقف|مواقف|مشكلة|مشاكل|صعبة|صعب|واجهت|واجه|قدرت|كدرت|challenge|situation|problem|faced|difficult|struggle)/i.test(t);
}

/** كشف طلب توضيح — المرشح لم يفهم السؤال */
export function isClarificationRequest(transcript: string): boolean {
  const t = transcript.trim();
  return /(ممكن توضحي|ممكن توضح|ممكن توضحلي|شنو تقصد|شو تقصد|ما فهمت|ما فهمتني|وضّح لي|وضح لي|وضحي لي|اشرح|ممكن تشرحي|ممكن تشرح|explain|clarify|what do you mean|can you explain)/i.test(t);
}

/** Hybrid Intelligence: Engine يتحقق من اقتراح الـ LLM — هل هو سؤال صالح؟ */
export function validateLLMQuestion(reply: string, questionPool?: string[]): boolean {
  const t = reply.trim();
  if (!t || t.length < 10) return false;
  const wordCount = t.split(/\s+/).length;
  if (wordCount > 80) return false;
  const isQuestion = /[?؟]/.test(t) || /\b(شنو|شو|شلون|مين|متى|وين|ليش|how|what|why|when|where|which|who)\b/i.test(t);
  if (!isQuestion) return false;
  return true;
}

/** Adaptive Follow-up: استخراج مواضيع من إجابة المرشح (أدوات، مهارات، تجارب) */
export function extractTopicsFromAnswer(transcript: string): string[] {
  const t = transcript.trim().toLowerCase();
  const topics: string[] = [];
  const tools = ['excel', 'word', 'powerpoint', 'outlook', 'office', 'teams', 'zoom', 'slack', 'مايكروسوفت', 'إكسل', 'اكسل', 'وورد', 'بوربوينت'];
  const skills = ['تواصل', 'فريق', 'قيادة', 'إدارة', 'communication', 'teamwork', 'leadership', 'management'];
  const experiences = ['مشروع', 'جامعة', 'شغل', 'عمل', 'project', 'university', 'work', 'job', 'تحدي', 'challenge'];
  for (const w of tools) {
    if (t.includes(w)) topics.push(w);
  }
  for (const w of skills) {
    if (t.includes(w)) topics.push(w);
  }
  for (const w of experiences) {
    if (t.includes(w)) topics.push(w);
  }
  return [...new Set(topics)];
}

/** مواضيع Phase 1 مع كلمات مفتاحية — لاستنتاج الموضوع من سؤال الـ LLM */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  warmup_and_self_introduction: ['نفسك', 'حالك', 'background', 'experience', 'about yourself', 'تعريف', 'تعرف'],
  communication_and_clarity: ['تواصل', 'توضيح', 'communication', 'explain', 'وضوح', 'miscommunication'],
  teamwork_and_collaboration: ['فريق', 'team', 'تعاون', 'collaboration', 'خلاف', 'conflict', 'زميل', 'colleague'],
  digital_skills_and_tools: ['برامج', 'أدوات', 'software', 'tools', 'رقمي', 'digital', 'تعلم', 'learn'],
  time_management_and_problem_solving: ['وقت', 'ضغط', 'time', 'pressure', 'مشكلة', 'problem', 'أولوية', 'prioritize'],
};

/** استنتاج الموضوع من سؤال الـ LLM — لإضافته لـ askedTopics */
export function inferTopicFromQuestion(question: string): string | undefined {
  const q = question.toLowerCase().trim();
  let bestTopic: string | undefined;
  let bestScore = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.filter((kw) => q.includes(kw.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }
  return bestTopic;
}

/** مواضيع متاحة — LLM يختار الأنسب (بدل round-robin) */
export function getAvailableTopicsForPhase1(state: InterviewState | undefined): string[] {
  const all = Object.values(PHASE1_TOPICS).filter(Boolean) as string[];
  if (!isVoiceTopicMemoryEnabled()) {
    return all;
  }
  const askedTopics = state?.askedTopics ?? [];
  return all.filter((t) => !askedTopics.includes(t));
}

/** المتابعة: حد أقصى 2 لكل سؤال رئيسي — Follow-up 1 ثم Follow-up 2 (اختياري) ثم السؤال التالي */
export const FOLLOW_UP_PROMPTS: Record<1 | 2, { ar: string; en: string }> = {
  1: { ar: 'شنو صار بالضبط؟ وصفلي الموقف.', en: 'What exactly happened? Describe the situation.' },
  2: { ar: 'شو سويت؟ شنو الإجراء اللي اتخذته؟', en: 'What did you do? What action did you take?' },
};

/** للتحقق: fallback سؤال عند فشل الـ LLM — من الـ topic */
const TOPIC_FALLBACK_QUESTIONS: Record<string, string> = {
  warmup_and_self_introduction: 'ممكن تحچيلي شويه عن نفسك؟',
  communication_and_clarity: 'شنو يعني التواصل الفعال بالنسبة لك؟',
  teamwork_and_collaboration: 'شلون تفضل تشتغل مع الفريق؟',
  digital_skills_and_tools: 'شنو البرامج اللي تستخدمها بالشغل؟',
  time_management_and_problem_solving: 'شلون تتعامل وي ضغط الوقت؟',
};

export function getFallbackForTopic(topic: string): string {
  return TOPIC_FALLBACK_QUESTIONS[topic] ?? 'ممكن تحچيلي أكثر عن هالموضوع؟';
}

/** ملف تعريف المرشح — Phase 2 ديناميكي حسب البيانات الفعلية */
interface CandidateProfileForEngine {
  skills?: string[];
  certifications?: string;
  highest_education_level?: string;
  current_company?: string;
  experience?: string;
}

/**
 * يختار السؤال التالي بشكل حتمي
 * Question Engine → selected question → LLM rephrase
 */
export function selectNextQuestion(
  controller: ControllerOutput,
  state: InterviewState | undefined,
  candidateLastLanguage?: 'ar' | 'en',
  changeRequested?: boolean,
  candidateProfile?: CandidateProfileForEngine | null
): SelectedQuestion | null {
  const { phase, mandatoryQuestionDue, suggestedPool } = controller;

  if (phase === 1) {
    if (mandatoryQuestionDue) {
      const useArabic = candidateLastLanguage === 'ar';
      const q = MANDATORY_QUESTIONS[mandatoryQuestionDue];
      return {
        text: useArabic ? q.iq : q.en,
        pool: 0, // mandatory
        preferArabic: useArabic,
      };
    }

    // عند طلب التغيير: نستخدم pool مختلف عن الأخير دائماً
    const lastPool = state?.askedPools?.length ? state.askedPools[state.askedPools.length - 1] : 0;
    const pool = changeRequested && lastPool > 0
      ? ((lastPool % 5) + 1) as number
      : (suggestedPool ?? 1);
    const poolData = POOL_QUESTIONS[pool];
    if (!poolData) return null;

    const askedCount = state?.askedPools?.length ?? 0;
    const level: 1 | 2 | 3 = askedCount < 3 ? 1 : askedCount < 6 ? 2 : 3;
    const levelKey = `L${level}` as 'L1' | 'L2' | 'L3';
    const questions = poolData[levelKey];
    const baseIdx = state?.userMessageCount ?? 0;
    const idx = (baseIdx + (changeRequested ? 1 : 0)) % questions.length;
    const q = questions[idx];
    const useArabic = candidateLastLanguage === 'ar';
    const text = useArabic ? q.iq : q.en;

    return {
      text,
      pool,
      level,
      preferArabic: useArabic,
    };
  }

  if (phase === 2) {
    const baseIdx = state?.userMessageCount ?? 0;
    const topicIdx = (baseIdx + (changeRequested ? 1 : 0)) % PHASE2_TOPIC_KEYS.length;
    const topicKey = PHASE2_TOPIC_KEYS[topicIdx];
    const ar = candidateLastLanguage === 'ar';
    let text: string;
    if (topicKey === 'skill' && candidateProfile?.skills?.length) {
      const skill = candidateProfile.skills[0];
      text = ar ? `اسأل المرشح كيف يستخدم مهارة "${skill}" في عمله.` : `Ask the candidate how they use their skill "${skill}" in their work.`;
    } else if (topicKey === 'certification' && candidateProfile?.certifications) {
      const cert = candidateProfile.certifications.split(/[,،]/)[0]?.trim() || candidateProfile.certifications;
      text = ar ? `اسأل المرشح عن شهادته "${cert}" وكيف تفيده في عمله.` : `Ask the candidate about their certification "${cert}" and how it helps them.`;
    } else if (topicKey === 'education' && candidateProfile?.highest_education_level) {
      const edu = candidateProfile.highest_education_level;
      text = ar ? `اسأل المرشح كيف أعدته دراسته (${edu}) لهذه الوظيفة.` : `Ask the candidate how their education (${edu}) prepared them for this role.`;
    } else if (topicKey === 'company' && candidateProfile?.current_company) {
      const company = candidateProfile.current_company;
      text = ar ? `اسأل المرشح عن التحديات التي واجهها في شركته الحالية "${company}".` : `Ask the candidate about challenges they faced at their current company "${company}".`;
    } else {
      text = ar
        ? (topicKey === 'skill' ? 'اسأل المرشح كيف يستخدم مهاراته في عمله.' : topicKey === 'certification' ? 'اسأل المرشح عن شهاداته وكيف تفيده.' : topicKey === 'education' ? 'اسأل المرشح كيف أعدته دراسته لهذه الوظيفة.' : 'اسأل المرشح عن التحديات التي واجهها في عمله السابق.')
        : (topicKey === 'skill' ? 'Ask the candidate how they use their skills in their work.' : topicKey === 'certification' ? 'Ask the candidate about their certifications and how they help.' : topicKey === 'education' ? 'Ask the candidate how their education prepared them for this role.' : 'Ask the candidate about challenges they faced in their previous work.');
    }
    return {
      text,
      preferArabic: candidateLastLanguage === 'ar',
    };
  }

  if (phase === 3) {
    if (controller.isFirstPhase3Message && !changeRequested) {
      return {
        text: 'هسة راح أختبر لغتك الإنكليزية. جاهز؟',
        preferArabic: true,
        isFixed: true, // لا LLM — رسالة ثابتة مباشرة لـ TTS
      };
    }
    const baseIdx = state?.englishQuestionsAsked ?? 0;
    const idx = (baseIdx + (changeRequested && !controller.isFirstPhase3Message ? 1 : 0)) % PHASE3_QUESTIONS.length;
    return {
      text: PHASE3_QUESTIONS[idx],
      preferArabic: false, // Phase 3 always English
    };
  }

  return null;
}
