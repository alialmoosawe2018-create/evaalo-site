/**
 * Interview State Manager
 * لا يوجد Memory State خارجي — النظام يعتمد على conversationHistory
 * هذا الملف يضيف Interview State Manager لتتبع الحالة بشكل صريح
 */

import type { InterviewPhase } from '../services/llmService.js';

export interface InterviewState {
  sessionId: string;
  /** المرحلة الحالية: 1=Pools، 2=Application، 3=English */
  phase: InterviewPhase;
  /** وقت بداية المرحلة الحالية (ms) */
  phaseStartTime: number;
  /** عدد رسائل المستخدم (تبادل كامل = user + assistant) */
  userMessageCount: number;
  /** Pools التي تم استخدامها في Phase 1 (1-5) */
  askedPools: number[];
  /** Pool الحالي المُختار */
  currentPool?: number;
  /** هل تم طرح السؤال الإلزامي الأول (tell me about yourself)؟ */
  firstMandatoryAsked: boolean;
  /** هل تم طرح السؤال الإلزامي الثاني (Microsoft Office)؟ */
  secondMandatoryAsked: boolean;
  /** عدد أسئلة الإنجليزية المطروحة في Phase 3 */
  englishQuestionsAsked: number;
  /** هل تم إعلان اختبار الإنجليزية ("هسة راح أختبر لغتك الإنكليزية. جاهز؟")؟ */
  englishTestAnnounced: boolean;
  /** المتابعة: 0=لا متابعة لهذا السؤال، 1=تمت المتابعة — حد أقصى متابعة واحدة لكل سؤال */
  followUpCount: 0 | 1;
  /** Topic Memory: المواضيع التي تم طرحها — منع التكرار */
  askedTopics: string[];
}

const stateStore = new Map<string, InterviewState>();

export function createInterviewState(sessionId: string): InterviewState {
  const now = Date.now();
  const state: InterviewState = {
    sessionId,
    phase: 1,
    phaseStartTime: now,
    userMessageCount: 0,
    askedPools: [],
    firstMandatoryAsked: false,
    secondMandatoryAsked: false,
    englishQuestionsAsked: 0,
    englishTestAnnounced: false,
    askedTopics: [],
    followUpCount: 0,
  };
  stateStore.set(sessionId, state);
  return state;
}

export function getInterviewState(sessionId: string): InterviewState | undefined {
  return stateStore.get(sessionId);
}

export function removeInterviewState(sessionId: string): void {
  stateStore.delete(sessionId);
}

export function updateInterviewState(
  sessionId: string,
  updates: Partial<Omit<InterviewState, 'sessionId'>>
): InterviewState | undefined {
  const state = stateStore.get(sessionId);
  if (!state) return undefined;
  Object.assign(state, updates);
  return state;
}

/** تحديث الحالة بعد إضافة رسالة مستخدم ورد مساعد */
export function onExchangeComplete(
  sessionId: string,
  _assistantReply: string,
  previousUserCount: number,
  options?: { mandatoryQuestion1Asked?: boolean; mandatoryQuestion2Asked?: boolean; poolUsed?: number; topicUsed?: string; followUpCount?: 0 | 1 }
): InterviewState | undefined {
  const state = stateStore.get(sessionId);
  if (!state) return undefined;

  const newUserCount = previousUserCount + 1;
  state.userMessageCount = newUserCount;

  if (options?.mandatoryQuestion1Asked) {
    state.firstMandatoryAsked = true;
  }
  if (options?.mandatoryQuestion2Asked) {
    state.secondMandatoryAsked = true;
  }
  if (options?.poolUsed != null && options.poolUsed > 0 && !state.askedPools.includes(options.poolUsed)) {
    state.askedPools.push(options.poolUsed);
  }
  if (options?.topicUsed) {
    const asked = state.askedTopics ?? [];
    if (!asked.includes(options.topicUsed)) {
      state.askedTopics = [...asked, options.topicUsed];
    }
  }
  if (options?.followUpCount !== undefined) {
    state.followUpCount = options.followUpCount;
  }

  // تحديد المرحلة من userMessageCount (منطق حتمي)
  const phase: InterviewPhase = newUserCount < 9 ? 1 : newUserCount < 13 ? 2 : 3;

  if (phase !== state.phase) {
    state.phase = phase;
    state.phaseStartTime = Date.now();
  }

  if (phase === 3) {
    if (!state.englishTestAnnounced) {
      state.englishTestAnnounced = true; // أول رد في Phase 3 = إعلان "جاهز؟"
    } else {
      state.englishQuestionsAsked += 1;
    }
  }

  return state;
}
