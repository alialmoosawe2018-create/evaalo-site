/**
 * Interview State Manager
 * لا يوجد Memory State خارجي — النظام يعتمد على conversationHistory
 * هذا الملف يضيف Interview State Manager لتتبع الحالة بشكل صريح
 */

import type { InterviewPhase } from '../services/llmService.js';
import { computePhaseByCount } from './interviewController.js';

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
  /**
   * هل طُرح سؤال الدور الإلزامي (مهمّة يوميّة في الوظيفة المتقدَّم إليها)؟
   *
   * ⚠️ صار إلزاميّاً في ٢٠٢٦-٠٩-١٠ بعد قياس ١٦ مقابلة حقيقية: بُعد
   * `relevant_experience_role_fit` — ٢٠ نقطة — كان يُقيَّم في ١٦/١٦ بينما لا
   * يُسأل عن الدور إلّا في ٦/١٦. أي أنّ ١٠ مرشّحين نالوا درجةً على سؤالٍ لم
   * يُطرح عليهم، فالتُقطت من فتاتٍ في التعريف بالنفس — والفتات لا يبلغ «جيّد»
   * أبداً، ومن هنا: Intermediate ١٤، Good صفر، Excellent صفر.
   */
  roleMandatoryAsked: boolean;
  /** عدد أسئلة الإنجليزية المطروحة في Phase 3 */
  englishQuestionsAsked: number;
  /** هل تم إعلان اختبار الإنجليزية ("هسة راح أختبر لغتك الإنكليزية. جاهز؟")؟ */
  englishTestAnnounced: boolean;
  /** عدد تنبيهات التهرّب المستخدمة — «أعطني مثالاً محدداً» بعد إجابة تنفي التحدي */
  deflectionProbesUsed: number;
  /** المتابعة: 0=لا متابعة لهذا السؤال، 1=تمت المتابعة — حد أقصى متابعة واحدة لكل سؤال */
  followUpCount: 0 | 1;
  /** إجمالي المتابعات في المقابلة كلها — سقف صارم `FOLLOW_UP_MAX_PER_INTERVIEW` */
  totalFollowUps: number;
  /** رقم دور المرشح الذي طُرحت فيه آخر متابعة — يفرض فاصل `FOLLOW_UP_MIN_GAP_TURNS` */
  lastFollowUpTurn: number;
  /**
   * `evaluates` آخر سؤالٍ **طُرح فعلاً** — مصدر بذرة المتابعة.
   *
   * ⚠️ كانت البذرة تُشتقّ من `selectedQuestion` في دور المتابعة نفسه، وذاك سؤالٌ
   * جديد يُنتقى ثمّ **يُرمى** (poolUsed وtopicUsed يُجبران على undefined للمتابعة).
   * فالمتابعة كانت تُصاغ على نيّة سؤالٍ لم يُطرح، بينما السؤال الذي أجاب عنه
   * المرشّح لا يصل إليها إطلاقاً. مقيس: مرشّح أجاب عن العمل الجماعي فجاءت البذرة
   * من سؤال ضغط الوقت المرميّ، فسقطت إلى العامّة «انطيني مثال محدد».
   *
   * ولا يُحدَّث في دور المتابعة نفسه: المتابعة تعمّق الموضوع القائم، فيبقى هو
   * المرجع لو جاءت متابعةٌ ثانية لاحقاً.
   */
  lastQuestionEvaluates?: string[];
  /** Topic Memory: المواضيع التي تم طرحها — منع التكرار */
  askedTopics: string[];
  /**
   * مواضيع المرحلة الثانية المطروحة. منفصلة عن `askedTopics` عمداً: تلك مواضيع
   * pools المرحلة الأولى، وخلطُ فضاءَي أسماء في مصفوفة واحدة يجعل توفّر مواضيع
   * المرحلة الأولى يعتمد على ما جرى في الثانية.
   *
   * وسببُ وجودها أصلاً: كان اختيار موضوع المرحلة الثانية دالةً على العدّاد وحده،
   * `(userMessageCount + (changeRequested ? 1 : 0)) % KEYS.length` — فالقفزة عند
   * طلب التغيير **عابرة لا تُسجَّل**، فيُخدَم الموضوع الذي قُفز إليه مرّةً ثانيةً في
   * الدور التالي حين يتقدّم العدّاد إليه طبيعيّاً. أي أنّ كلّ «غيّر السؤال» في
   * المرحلة الثانية كان يضمن تكراراً بعده مباشرة (الجلسة c6660f6c: سؤال اللغات
   * مرّتين متتاليتين).
   */
  askedPhase2Topics: string[];
  /**
   * عدد أسئلة التعميق المطروحة بعد نفاد محاور المرحلة الثانية — يدوّر زاوية
   * التعميق فلا يتكرّر نصّها. منفصل عن `totalFollowUps` عمداً: ذاك سقفٌ يحمي
   * المحاور من أن تأكلها المتابعات، وهذا يبدأ بعد أن تنتهي المحاور.
   */
  phase2DeepDives: number;
}

/** سقف المتابعات للمقابلة الواحدة */
export const FOLLOW_UP_MAX_PER_INTERVIEW = 5;
/** أدنى فاصل بين متابعتين بالأدوار: 2 = سؤال عادي واحد بينهما (متابعة لكل سؤالين) */
export const FOLLOW_UP_MIN_GAP_TURNS = 2;
/** أقصى عدد أدوار متابعة لا تُحتسب في تقدّم المراحل */
/** قيمة أولية تضمن السماح بأول متابعة دون قيد الفاصل */
const NO_FOLLOW_UP_YET = -FOLLOW_UP_MIN_GAP_TURNS;

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
    roleMandatoryAsked: false,
    englishQuestionsAsked: 0,
    englishTestAnnounced: false,
    askedTopics: [],
    askedPhase2Topics: [],
    phase2DeepDives: 0,
    deflectionProbesUsed: 0,
    followUpCount: 0,
    totalFollowUps: 0,
    lastFollowUpTurn: NO_FOLLOW_UP_YET,
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
  options?: {
    mandatoryQuestion1Asked?: boolean;
    mandatoryQuestion2Asked?: boolean;
    mandatoryQuestion3Asked?: boolean;
    poolUsed?: number;
    topicUsed?: string;
    followUpCount?: 0 | 1;
    /** true عندما يكون رد هذا الدور متابعة — يرفع العدّاد الكلي ويثبّت الفاصل */
    followUpAsked?: boolean;
    /** true عندما تكون مرحلة الـ controller (العدّ الخام) = 3 هذا الدور */
    phase3Reached?: boolean;
    /** true عندما يكون رد هذا الدور هو إعلان اختبار الإنجليزية ("جاهز؟") */
    englishIntroEmitted?: boolean;
    /** true عندما يكون رد هذا الدور تنبيه تهرّب (طلب مثال محدد) */
    deflectionProbeUsed?: boolean;
    /** مفتاح موضوع المرحلة الثانية الذي طُرح في هذا الدور — يمنع إعادته */
    phase2TopicUsed?: string;
    /** صحيحٌ حين كان ردّ هذا الدور سؤال تعميق — يدوّر الزاوية في الدور التالي */
    deepDiveUsed?: boolean;
    /** `evaluates` السؤال المطروح هذا الدور — يُغذّي بذرة المتابعة في الدور التالي */
    evaluatesUsed?: string[];
    /**
     * لغة الجلسة — تدخل في حساب المرحلة. بدونها تُحسب المرحلة بعتبات العربية
     * وحدها، وتلك هي التي كانت تعلن «المرحلة الثالثة» في جلسة إنجليزية لا
     * مرحلة ثالثة فيها.
     */
    sessionLanguage?: 'ar' | 'en';
  }
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
  if (options?.mandatoryQuestion3Asked) {
    state.roleMandatoryAsked = true;
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
  if (options?.evaluatesUsed?.length) {
    state.lastQuestionEvaluates = [...options.evaluatesUsed];
  }
  if (options?.phase2TopicUsed) {
    const asked = state.askedPhase2Topics ?? [];
    if (!asked.includes(options.phase2TopicUsed)) {
      state.askedPhase2Topics = [...asked, options.phase2TopicUsed];
    }
  }
  if (options?.followUpCount !== undefined) {
    state.followUpCount = options.followUpCount;
  }
  if (options?.followUpAsked) {
    state.totalFollowUps = (state.totalFollowUps ?? 0) + 1;
    state.lastFollowUpTurn = newUserCount;
  }
  if (options?.deepDiveUsed) {
    state.phase2DeepDives = (state.phase2DeepDives ?? 0) + 1;
  }
  if (options?.deflectionProbeUsed) {
    state.deflectionProbesUsed = (state.deflectionProbesUsed ?? 0) + 1;
  }

  /**
   * المرحلة من `userMessageCount` الخام — بالعتبات نفسها التي يستعملها
   * `interviewController`، وهو الوحيد الذي يختار الأسئلة فعلاً.
   *
   * ⚠️ كان هنا «ائتمان متابعات» يخصم حتى ثلاثة أدوار قبل حساب المرحلة، ونيّتُه
   * أن تُطيل المرحلة الأولى فلا تأكل المتابعاتُ مواضيعها. وكان **معكوساً
   * بالكامل**: وحدة القرار تقرأ العدّاد الخام، فالنيّة لم تتحقّق يوماً؛ والمكان
   * الوحيد الذي استعمل القيمة المخصومة هو **التقرير**، فتضرّر وحده.
   *
   * والضرر مقيس: `phaseReached` يُملأ من هذه القيمة، و`endedBeforeEnglishPhase`
   * تقلب `earlyEnd` إلى صحيح حين تكون دون الثالثة. فمقابلةٌ فيها ثلاث متابعات
   * تبلغ اختبار الإنكليزية فعلاً وتُبلَّغ بأنّها وقفت عند الثانية — فيُخبَر
   * المقيّم أنّها «غير مكتملة» وهي مكتملة، ويُطرح رقمُها الصحيح.
   *
   * وحذفُ الائتمان لا يغيّر سؤالاً واحداً: `state.phase` تُقرأ في أربعة مواضع
   * كلّها تقارير (مقياسان و`phaseReached` مرّتين)، ولا شيء يختار منها.
   */
  /**
   * ⚠️ الصيغة مستوردة من `interviewController` ولم تعد تُكتب هنا. كانت نسخةً
   * ثانيةً بلا لغة، فأعلنت «المرحلة الثالثة» في كلّ جلسة إنجليزية — والمرحلة
   * الثالثة اختبارُ إنجليزية لا يُطرح في مقابلة إنجليزية أصلاً.
   *
   * ولا يدخل هنا «الخروج المبكر» من المرحلة الأولى: هو قرارُ اختيارٍ يعتمد على
   * تغطية المواضيع، وهذه القيمة لا تختار سؤالاً. أثرُه أنّ هذه القيمة قد تتأخّر
   * دوراً أو دورين في إعلان المرحلة الثانية، ولا تتغيّر به إجابةُ أيّ مستهلك.
   *
   * ⚠️ لكنّها **ليست تقريراً محضاً**، خلافاً لما يقوله التعليق أعلاه: `state.phase`
   * تُمرَّر في `evalContext.phase`، و`llmService` يصفّر بها `englishFluency` حين
   * `phase < 3`. وهي محايدة اليوم في الجلسة الإنجليزية — كانت تبلغ الثالثة
   * و`englishQuestionsAsked` صفرٌ فتصفّر بالفرع الثاني، وصارت تقف عند الثانية
   * فتصفّر بالأوّل: صفرٌ في الحالتين. لكنّ مَن يغيّر أحد الفرعين لاحقاً يغيّر درجةً،
   * لا سطراً في تقرير. (والتصفير نفسه في مقابلةٍ كلُّها إنجليزية عيبٌ قائم قبل هذا
   * التعديل ولم يُعالَج فيه.)
   */
  const phase: InterviewPhase = computePhaseByCount(newUserCount, options?.sessionLanguage);

  if (phase !== state.phase) {
    state.phase = phase;
    state.phaseStartTime = Date.now();
  }

  // محاسبة Phase 3 تُقاد بإشارات صريحة من المتصل (مرحلة الـ controller الخام)، لا
  // بالـ phase المحسوبة هنا بخصم رصيد المتابعات — اختلافهما كان يستهلك «الإعلان»
  // كعلَم داخلي دون طرحه فعلاً، فيقفز الوكيل إلى الإنجليزية بلا مقدّمة.
  if (options?.englishIntroEmitted) {
    state.englishTestAnnounced = true; // أُعلن فعلاً «جاهز؟» هذا الدور
  } else if (options?.phase3Reached && state.englishTestAnnounced) {
    state.englishQuestionsAsked += 1;
  }

  return state;
}
