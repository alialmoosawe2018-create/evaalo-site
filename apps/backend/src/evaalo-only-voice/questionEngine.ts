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
  PHASE3_MAX_QUESTIONS,
  PHASE3_TRANSLATION_QUESTION,
  isVoiceTopicMemoryEnabled,
  type InterviewEvaluationIntent,
} from './interviewConfig.js';
import {
  normalizeCandidateGender,
  applyIraqiGenderPhrasing,
  IRAQI_ACKNOWLEDGMENT_PHRASES,
  type CandidateGender,
} from '../services/iraqiDialectReference.js';

export type { SelectedQuestion };

/** ملف تعريف المرشح — Phase 2 ديناميكي حسب البيانات الفعلية */
interface CandidateProfileForEngine {
  skills?: string[];
  certifications?: string;
  highest_education_level?: string;
  current_company?: string;
  position_applied_for?: string;
  experience?: string;
  languages?: string[];
  gender?: string;
}

function iraqiModalCan(gender: CandidateGender): string {
  return gender === 'female' ? 'تگدرين' : 'تگدر';
}

function iraqiSpeakVerb(gender: CandidateGender): string {
  return gender === 'female' ? 'تحچين' : 'تحچي';
}

function buildLanguageTopicPromptAr(profile?: CandidateProfileForEngine | null): string {
  const gender = normalizeCandidateGender(profile?.gender);
  const modal = iraqiModalCan(gender);
  const speak = iraqiSpeakVerb(gender);
  const levelWord = gender === 'female' ? 'مستواج' : 'مستواك';
  const langs = languageNamesOnly(profile?.languages);
  if (langs.length) {
    const names = langs.slice(0, 3).join('، ');
    return `اسأل المرشح: شنو اللغات الي ${modal} ${speak}ها؟ وشكد ${levelWord} بكل لغة؟ اللغات من الاستمارة: ${names}. لا تذكر مستوى أي لغة من الاستمارة — اسأله عن المستوى بنفسك. استخدم ${modal} تحچيلي وليس تقوليلي.`;
  }
  return `اسأل المرشح: شنو اللغات الي ${modal} ${speak}ها وشكد ${levelWord} بكل لغة؟ استخدم ${modal} تحچيلي وليس تقوليلي.`;
}

/** كشف طلب تغيير السؤال — اغير، غير، نغير، تغير، غيّر */
export function isChangeQuestionRequest(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  return /(نغير|نبدل|بدل|تغير|غيّر|اغير|غير|سؤال\s+ثاني|غير\s+السؤال|بدل\s+السؤال|ممكن\s+(نغير|اغير|غير|تبدل)|خل\s+(نغير|نبدل)(\s+السؤال)?|next question|another question|change (the )?question|skip)/i.test(
    t
  );
}

/** أدنى عدد كلمات في إجابة المرشح ليُعتد بها كموقف قابل للمتابعة */
const CHALLENGE_MIN_WORDS = 10;

/** إجابة بهذا الطول مفصّلة بما يكفي لتستحق تعمّقاً ولو خلت من كلمة «تحدي» */
const SUBSTANTIVE_MIN_WORDS = 25;

function wordCount(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

/**
 * إجابة مسترسلة تستحق سؤالاً أعمق بذاتها.
 *
 * كشف الكلمات المفتاحية وحده كان يربط العمق بمفردات المرشح لا بجودة إجابته:
 * من يصف تجربته بتفصيل دون أن ينطق «تحدي» أو «مشكلة» كان لا يُسأل أبداً.
 * الطول هنا كافٍ وحده لأن سقف المتابعات والفاصل بينها يمنعان الإفراط.
 */
export function isSubstantiveAnswer(transcript: string): boolean {
  const t = transcript.trim();
  return t.length > 0 && wordCount(t) >= SUBSTANTIVE_MIN_WORDS;
}

/** STAR Probing: كشف ذكر المرشح لتحدي أو موقف صعب */
export function isChallengeMention(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  if (!t) return false;
  // إجابة قصيرة لا تحمل موقفاً يستحق التعمّق — تمنع المتابعة على عبارات عابرة.
  if (wordCount(t) < CHALLENGE_MIN_WORDS) return false;
  // الكلمات العامة (صار/قدرت/كدرت/hard/difficult) مستبعدة: تَرِد في كلام عادي ولا تدل على تحدٍّ.
  return /(تحدي|تحديات|موقف|مواقف|مشكلة|مشاكل|صعوبة|مو\s+سهل|ضغط|واجهت|واجهنا|مريت|challenge|situation|problem|issue|difficulty|faced|struggled|pressure)/i.test(
    t
  );
}

/** كشف طلب توضيح — المرشح لم يفهم السؤال */
export function isClarificationRequest(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  return /(ما\s+فهمت|مو\s+واضح(?:لي)?|شنو\s+تقصد|شنو\s+المقصود|وضح(?:لي|\s+لي)?|ممكن\s+توضح(?:لي)?|اشرح(?:لي)?|ممكن\s+تشرح|عيد\s+السؤال|ممكن\s+تعيد(?:\s+السؤال)?|clarify|explain|what do you mean|can you explain|repeat)/i.test(
    t
  );
}

/**
 * إجابة متهرّبة تنفي وجود تحدٍّ/مشكلة أو تُقلّل الأمر لتتجنّب المثال. يُستخدم لطرح
 * تنبيه لطيف واحد يطلب مثالاً محدداً — بدل تبديل الموضوع فوراً كما كان يحدث في
 * جلسة b4e9e4b7 حين قال المرشح «ما واجهت تحديات» مرتين فانتقل الوكيل دون تعمّق.
 *
 * يعتمد على عبارات النفي/التقليل لا على الطول وحده، فلا يُطلق على إجابة قصيرة صحيحة
 * مثل «AI». نفي التحدي الصريح يُرصد مهما طالت الإجابة (قد ينفي ثم يفيض بالعموميات)؛
 * أما التقليل العام («عادي»/«كله زين») فيُرصد في الإجابات القصيرة فقط.
 */
export function isEvasiveNonAnswer(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  if (!t) return false;
  const deniesChallenge =
    /(?:^|\s)(?:ما|ماكو|لا)\s+\S*\s*(?:تحدي|تحديات|مشكلة|مشاكل|صعوبة|صعوبات)/i.test(t) ||
    /(?:^|\s)(?:ما|ماكو)\s+(?:واجهت|واجهنا|صادفت|مريت)/i.test(t) ||
    /\bno\b[^.]{0,40}\b(?:challenges?|problems?|issues?|difficult\w*)\b/i.test(t) ||
    /\b(?:didn'?t|did not|haven'?t|have not)\b[^.]{0,40}\b(?:challenges?|problems?|issues?|difficult\w*)\b/i.test(t);
  if (deniesChallenge) return true;
  if (wordCount(t) <= 6) {
    return /^\s*(?:عادي|كله\s*(?:زين|تمام|عادي)|لا\s*شي|ماكو\s*شي|ما\s*اذكر(?:\s*شي)?)/i.test(t) ||
      /^\s*(?:nothing(?:\s+much|\s+really)?|all good|no problems?)/i.test(t);
  }
  return false;
}

/** النية الأساسية لرسالة المرشح ضمن تدفق المقابلة */
export type TurnIntent = 'change_question' | 'clarification' | 'challenge' | 'normal';

/**
 * كشف نية الرسالة بترتيب أولوية واضح:
 * تغيير السؤال > توضيح > يستحق تعمّقاً > عادي
 *
 * «challenge» تعني هنا «تستحق متابعة»، سواء ذكر المرشح موقفاً صريحاً أو أفاض
 * في إجابته. ما بعدها في التدفق واحد في الحالتين: سؤال أعمق في الموضوع نفسه.
 */
export function detectIntent(transcript: string): TurnIntent {
  if (isChangeQuestionRequest(transcript)) return 'change_question';
  if (isClarificationRequest(transcript)) return 'clarification';
  if (isChallengeMention(transcript) || isSubstantiveAnswer(transcript)) return 'challenge';
  return 'normal';
}

/** طلب التحدث بالإنجليزي قبل Phase 3 — عبارات واضحة (ليس «أي نص يحوي english») */
export function isWantsEnglishBeforePhase3(transcript: string): boolean {
  const t = transcript.trim();
  if (t.length < 4) return false;
  const en =
    /(can we|could we|let[']?s|let us|may we).{0,40}\b(speak|talk|use|do|continue|switch).{0,20}\benglish\b/i.test(
      t
    ) || /(can we|could we).{0,45}\bin english\b|in english\s+please|english\s+only|switch\s+to\s+english/i.test(t);
  const en2 = /\b(speak|talk)\s+(in\s+)?english\b|let[']?s.{0,20}english/i.test(t);
  const en3 = /حچی\s+انگلیزی|كلام\s+انجلش/i.test(t);
  const ar =
    /(نحجي|نحكي|نتحدث|نكمل|نحچي|نحکي|نحتاج|تتكلم|تتكلمن|حجي|حچي|نغير|ممكن|اريد|أريد|بدي|حاب|نريد|يلا)(.{0,40})(إنكل|إنكليز|انكل|انكليز|الإنكل|الانكل|انگلیز|انجلش|انجلزي|إنگلیز|إنجل)/i.test(
      t
    ) ||
    /(إنكل|إنكليز|انكل|انكليز|انگلیز|انجلش|انجلزي|الإنكل|الانكل)(.{0,30})(نحجي|نحكي|نحچي|ممكن|نحتاج|فقط|نستعمل|نستخدم|للمقاب|للحديث|تكلم|نحتاج)/i.test(
      t
    );
  const ckb = /(بە|ب)ێکمان\s+وەرگرێ|وەرزش.*ئینگل/i.test(t) || /حچی\s+(ئینگلیزی|ب ئینگلیزی)/i.test(t);
  /* عراقي: "نقدر نحكي بالانكليزي"، "ممكن نتكلم انجليزي" */
  const arIraqi =
    /(نقدر|نكدر|ممكن|اريد|أريد|بدي).{0,45}(نحكي|نحجي|نحچي|نتحدث|نتكلم|نحکي).{0,40}(انجل|إنجل|انكل|إنكل|الانجل|الإنكل|انجلیز|إنجليز|بالانجل|بالإنجل|english)/i.test(
      t
    ) ||
    /(نحكي|نحجي|نحچي|نتكلم).{0,30}(انجل|إنجل|انكل|بالانجل|بالإنجل|انجلیز|إنجليز|english)/i.test(t) ||
    /(بلغة|بـلغة|اللغة).{0,20}(انجل|إنجل|الانكل|english)/i.test(t);
  return en || en2 || en3 || ar || ckb || arIraqi;
}

/**
 * طلب صريح بالتحول إلى العربية — يكسر قفل اللغة في الجلسة الإنجليزية.
 * مقصور على عبارات واضحة: مجرد نطق المرشح كلمة عربية ليس طلب تحويل.
 */
export function isWantsArabicSwitch(transcript: string): boolean {
  const t = transcript.trim();
  if (t.length < 4) return false;
  const en =
    /(can we|could we|may we|let[']?s|let us|please|i want|i'?d like|switch|change).{0,40}\b(speak|talk|use|do|continue|switch|change)?.{0,20}\b(arabic|in arabic)\b/i.test(
      t
    ) || /\barabic\s+(please|only)\b|\bswitch\s+to\s+arabic\b|\bin\s+arabic\s+please\b/i.test(t);
  const ar =
    /(نحجي|نحكي|نتحدث|نكمل|نحچي|نحکي|نتكلم|تتكلم|نغير|ممكن|اريد|أريد|بدي|حاب|نريد|يلا|خلي).{0,40}(بالعرب|عربي|العربية|بالعربي)/i.test(
      t
    ) ||
    /(بالعرب|عربي|العربية).{0,30}(نحجي|نحكي|نحچي|نتكلم|ممكن|أفضل|افضل|رجاء|لو سمحت|فقط)/i.test(t) ||
    /(بلغة|اللغة).{0,15}(العرب|عرب)/i.test(t);
  const ckb = /(بە|ب)?\s*عەرەب(ی|ي)|قسە.{0,15}عەرەب/i.test(t);
  return en || ar || ckb;
}

/**
 * كشف سؤال المرشح عن هوية/طبيعة المساعد (من أنت؟ مين أنت؟ who are you؟)
 * نصوص قصيرة نسبياً لتقليل التعارض مع إجابات طويلة بالصدفة
 */
export function isAskingAgentIdentity(transcript: string): boolean {
  const t = transcript.trim();
  if (t.length < 2) return false;
  if (t.length > 140 && !/^(ممكن|الحين|وأنا|وأن|وأ|بس)\s*.{0,30}(من|مين|who)/i.test(t)) {
    return false;
  }
  const en =
    /\bwho are you\b/i.test(t) ||
    /\bwhat are you\b/i.test(t) ||
    /\b(what'?\s*s|what is) your name\b/i.test(t) ||
    /\bare you (an? |the )?(ai|a bot|a robot|artificial|virtual|a real (person|human))\b/i.test(t) ||
    /^introduce yourself\b/i.test(t) ||
    /\bwhich (model|llm) are you\b/i.test(t) ||
    /\b(is this|are you) (a |an |)(chatgpt|ai|openai|bot)\b/i.test(t);
  // ⚠️ الحدود عربية: `(?!\p{L})` لا `\b`. في جافاسكربت `\b` مُعرَّفة عبر
  // `\w` = `[A-Za-z0-9_]`، والحرف العربي ليس منها — فـ `/…أنتن\b/` لا تُطابق إلا
  // إذا تلا الكلمةَ حرفٌ لاتيني أو رقم. كانت هذه السطور كلّها ميتة، فلم يُكتشف
  // سؤال الهوية بالعربية إطلاقاً («مين أنت؟» → false بينما «who are you?» → true)،
  // وكان النموذج يرتجل الجواب بدل الردّ الثابت. لا تُعِد `\b` إلى هنا.
  const ar =
    /(من|مين|منو|شلون|شو)\s+(أنت|انته|انتا|انتم|أنتم|انت|انته|أنتن)(?!\p{L})/iu.test(t) ||
    /^أنت\s+مين(?!\p{L})|^(انت|انته|انته)\s+مين(?!\p{L})|^(مين|شنو) أ(ن|)ت(م|ن|)(?!\p{L})/iu.test(t) ||
    /(ممكن|اريد|أريد|بدي|بعد|خلينا)\s+تعرف(ني|ينا|وني|يني|ينا)/i.test(t) ||
    /(عرف(ني|ينا|وني|يني|نا|يني|ينا)|ممكن (ت|)عرف(ني|ينا|وني|يني|ينا)|(ت|)خبر(ني|ينا|يني|ينا))\s+عن\s+نفس(ك|چك|چي|ي)(?!\p{L})/iu.test(
      t
    ) ||
    /(ت|)(ح|)چي\s+ل(ي|نا)\s+عن\s+نفس(ك|چك|ك)(?!\p{L})|تكلم(يني|ينا|ي)?\s+عن\s+نفس(ك|چك|ك)(?!\p{L})/iu.test(
      t
    ) ||
    /(شنو|شو)\s+طبيعت(ك|چك|ك|ج)(?!\p{L})|وين (أنت|انته) من\??/iu.test(t);
  const ckb = /(تۆ|توی) (کێیت|کێی|کێ)\s*\??/i.test(t) || /تۆ كێیت|كێيت ئەویت/i.test(t);
  return en || ar || ckb;
}

/**
 * سؤال المرشح عن النتيجة / التقييم المباشر / رأي المساعد — سياسة HR (رد ثابت + إعادة السؤال)
 * null = ليس سؤالاً سياسيّاً من هذا النوع
 */
export type InterviewPolicyIntent = 'ask_result' | 'ask_evaluation' | 'ask_opinion';

/** كلمة النتيجة بأشكالها — وحدها لا تكفي، انظر الشرط أدناه. */
const RESULT_WORD_AR = /(?:(?:ال)?نتيج(?:ة|ه|ۀ)|ناتج|(?:ال)?جواب|(?:ال)?رد)(?!\p{L})/iu;
/** إشارة أن الجملة سؤال لا خبر: علامة استفهام أو أداة استفهام عراقية/فصيحة. */
const QUESTION_SIGNAL_AR = /[؟?]|(?<!\p{L})(?:شنو|شو|شكد|شگد|متى|امتى|شوكت|وين|هل|ليش|منو|مين)(?!\p{L})/iu;

export function classifyInterviewPolicyIntent(transcript: string): InterviewPolicyIntent | null {
  const t = transcript.trim();
  if (t.length < 3 || t.length > 200) return null;
  const tl = t.toLowerCase();
  // ⚠️ الحدود عربية: `(?!\p{L})` لا `\b` — انظر التعليق في isAskingAgentIdentity.
  // كانت هذه الحرّاس ميتة، و«قيمني» و«شنو رأيك بيّا؟» تمرّان بلا اكتشاف، فيُجيب
  // الوكيل بتقييم فعليّ للمرشّح في وجهه — وهو ما وُضعت السياسة لمنعه.
  const opinAr =
    /(رأيك|رأیك|رأی)\s+ب(يا|ي|يَه|يَه|يه|نفس(ي|ي|يَه|ك)|مستواي|أداءي|مستوى|أدائي|شلون(ي|ي|چي)|وين(ي|ي|چي)|شلون(ني|ی)|شلون(چي|شي))(?!\p{L})/iu.test(
      t
    ) || /(شنو|شو)\s+رأي(ك|چك)\s*ب(يا|ي|يه|نفس(ي|ي|ك|چي))(?!\p{L})/iu.test(t);
  const opinEn =
    /\bwhat('?s| is) your (opinion|take) (on|of) me\b/i.test(tl) ||
    /\bdo you (think|feel) (i('m| am)|I)\b/i.test(tl) ||
    /\bhow (do you see|do you view) me\b/i.test(tl);
  if (opinAr || opinEn) return 'ask_opinion';

  const evalAr =
    /(قيم(يني|ينا|وني|يني|ينا|ني)|تقيم(يني|يني|ني)|تقي(يد|يم)(ني|ي|ك)|تقي(يد|يم)\s*اجاب(ات|ي|يَه)|شلون\s*(تقيم|تقي(يد|يم))(ني|يني|ينا)|شنو\s*(تقيم(ي|ي|ك)|تقي(يد|يم)(ي|ك)))(?!\p{L})/iu.test(
      t
    ) ||
    /(تقيم(ي|ي|ك)|تقي(يد|يم)(ي|ك)|نقاط(ي|ي|ك)|درج(ات|ي)ي|شون\s*كنت\s*ب(المعايير|تقيي(م|م)))(?!\p{L})/iu.test(
      t
    );
  const evalEn =
    /\b(rate|grade|score)\s*me\b/i.test(tl) ||
    /\b(how|what).{0,25}\b(grade|rate|score|evaluate)\b/i.test(tl) ||
    /\b(what(’|'s| is) my|give me a) (grade|score|rating)\b/i.test(tl) ||
    /\bhow (did|do) I do\b/i.test(tl) ||
    /\bhow would you (rate|evaluate)\b/i.test(tl);
  if (evalAr || evalEn) return 'ask_evaluation';

  const resAr =
    // ⚠️ ذكرُ «نتيجة» ليس سؤالاً عنها. كان النمط يقبل الكلمة وحدها (وكذلك «قبول»
    // و«ناتج») فأطلق الحارسَ على إجابة عادية: في جلسة d9eb5536 قال المرشح «وطلعنا
    // بنتيجه» وهو يصف عملاً جماعياً، فردّ الوكيل «ما عندي صلاحية أعرض النتيجة…
    // شكراً لوقتك وأتمنى لك حظاً موفقاً» — ودّعه في منتصف المقابلة، مرتين.
    //
    // لم يظهر هذا قبلاً لأن النمط كان ميتاً أصلاً (‏`\b` بجوار العربية)؛ إحياؤه
    // كشف تراخيه. فنشترط الآن إشارة سؤال صريحة مع الكلمة: علامة استفهام أو أداة.
    (RESULT_WORD_AR.test(t) && QUESTION_SIGNAL_AR.test(t)) ||
      /(متى|وين|شوكت) (ياكلن|نعلم|نحصل|ناخذ|تطلع|تنزل|ينعلن|يعلن|يوصل) (على )?(ال)?(نتيج|جواب|رد)/iu.test(t) ||
      /(هل )?(انقبل|راح (أ|ا)نقبل|تعرف(ني|يني) (بشكل|ناجح|منقبل|مرفوض|مقبول))/iu.test(t);
  const resEn =
    /\b(when|how) (do|will) (i|we) (get|receive|know) (the )?(result|outcome|score|feedback)\b/i.test(
      tl
    ) ||
    /\b(did|have) (i|we) (passed?|get in)\b/i.test(tl) ||
    /\b(what(’|'s| is) the (outcome|result|decision|verdict)|when will (i|we) (hear|know))\b/i.test(
      tl
    ) ||
    /\b(my (score|result|outcome|grade|feedback))\b/i.test(tl) ||
    /\b(will (i|we) (pass|get (the )?job))\b/i.test(tl);
  if (resAr || resEn) return 'ask_result';

  return null;
}

/**
 * Hybrid Intelligence: Engine يتحقق من اقتراح الـ LLM — هل هو سؤال صالح؟
 *
 * `recentQuestions` هي أسئلة الوكيل الأخيرة. تُمرَّر فقط عند توليد سؤال جديد،
 * ولا تُمرَّر للمتابعة أو طلب الإعادة لأن الاثنين يعودان لنفس الموضوع بقصد.
 */
export function validateLLMQuestion(reply: string, recentQuestions?: string[]): boolean {
  const t = reply.trim();
  if (!t || t.length < 10) return false;
  const wordCount = t.split(/\s+/).length;
  if (wordCount > 80) return false;
  const isQuestion = /[?؟]/.test(t) || /\b(شنو|شو|شلون|مين|متى|وين|ليش|how|what|why|when|where|which|who)\b/i.test(t);
  if (!isQuestion) return false;
  for (const prev of recentQuestions ?? []) {
    if (prev && isRepeatedQuestion(t, prev)) return false;
  }
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
  warmup_and_self_introduction: [
    'نفسك', 'عرف نفسك', 'تعريف', 'تعرف', 'حالك', 'background',
    'about yourself', 'introduce', 'introduction', 'experience',
    'خبرة', 'من أنت', 'مين أنت', 'سيرة ذاتية', 'cv', 'resume',
    'تكلم عن نفسك', 'احكي عن نفسك',
  ],

  communication_and_clarity: [
    'تواصل', 'communication', 'explain', 'توضيح', 'وضوح', 'clarity',
    'miscommunication', 'شرح', 'كيف تشرح', 'تفهم الآخرين',
    'communication skills', 'تفاهم', 'نقل فكرة', 'إيصال فكرة',
    'how do you explain', 'شرح فكرة',
  ],

  teamwork_and_collaboration: [
    'فريق', 'team', 'تعاون', 'collaboration', 'زميل', 'colleague',
    'conflict', 'خلاف', 'حل الخلاف', 'work with others', 'teamwork',
    'group', 'working together', 'مشروع جماعي', 'عمل جماعي',
    'حل مشاكل الفريق', 'التعامل مع الفريق',
  ],

  digital_skills_and_tools: [
    'برامج', 'software', 'tools', 'أدوات', 'رقمي', 'digital',
    'تعلم', 'learn', 'excel', 'أنظمة', 'نظام', 'computer',
    'technology', 'tech', 'مهارات تقنية', 'حاسوب', 'applications',
    'platforms', 'systems', 'crm', 'erp',
  ],

  time_management_and_problem_solving: [
    'وقت', 'time', 'ضغط', 'pressure', 'مشكلة', 'problem',
    'حل', 'problem solving', 'أولوية', 'prioritize', 'deadline',
    'مهام', 'tasks', 'تنظيم الوقت', 'time management',
    'under pressure', 'stress', 'busy', 'urgent',
    'حل مشكلة', 'اتخاذ قرار', 'decision making',
  ],
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

/** استنتاج موضوع من إجابة المرشح (لتحسين اختيار الـ pool في Phase 1) */
function inferTopicFromAnswer(answer: string): string | undefined {
  const a = answer.toLowerCase().trim();
  if (!a) return undefined;
  let bestTopic: string | undefined;
  let bestScore = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.filter((kw) => a.includes(kw.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }
  return bestTopic;
}

const TOPIC_TO_POOL: Record<string, number> = Object.fromEntries(
  Object.entries(PHASE1_TOPICS).map(([pool, topic]) => [topic, Number(pool)])
);

function normalizeForSimilarity(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeForSimilarity(text)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

function detectQuestionIntent(text: string): string | null {
  const t = normalizeForSimilarity(text);
  if (!t) return null;
  if (/(about yourself|introduce|خلفيتك|عن نفسك|تعرف نفسك|سيرتك)/i.test(t)) return 'intro';
  if (/(motiv|جذبك|قدمت|join|role|وظيفة|شركة)/i.test(t)) return 'motivation';
  if (/(team|teamwork|فريق|تعاون|collaboration)/i.test(t)) return 'teamwork';
  if (/(problem|challenge|تحدي|مشكلة|decision|قرار|ضغط)/i.test(t)) return 'problem-solving';
  if (/(tools|software|digital|برامج|أدوات|مهارة|learn|تعلم)/i.test(t)) return 'digital-learning';
  return null;
}

/**
 * كلمات صياغة السؤال — مشتركة بين كل أسئلة الوكيل تقريباً، فلا تدل على تشابه.
 * إبقاؤها كان يجعل «تگدر تحچيلي شنو مستواك…» و«تگدر تحچيلي شنو خبرتك…» متشابهين.
 */
const QUESTION_FRAMING_WORDS = new Set([
  'شنو', 'شو', 'شلون', 'وشلون', 'شكد', 'وشكد', 'كيف', 'وكيف', 'ليش', 'وين', 'متى', 'مين', 'ماذا', 'هل',
  'تگدر', 'تكدر', 'تقدر', 'ممكن', 'تحچيلي', 'تحجيلي', 'حچيلي', 'حجيلي', 'احچيلي', 'احجيلي',
  'اللي', 'الي', 'كان', 'كانت', 'يعني', 'بكل', 'منهن', 'منها', 'خلال', 'عندك', 'عندج', 'وياك',
  'هاي', 'هذا', 'هذه', 'ذلك', 'عن', 'من', 'في', 'على', 'حتى', 'بين',
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'tell', 'about', 'your', 'you',
  'can', 'could', 'would', 'the', 'and', 'for', 'with', 'that', 'this', 'any', 'some',
  'please', 'describe', 'share', 'give', 'more',
]);

const ACKNOWLEDGMENT_OPENER = new RegExp(
  `^(?:${IRAQI_ACKNOWLEDGMENT_PHRASES.join('|')}|great|alright|thanks|understood|good|okay|ok)[،,\\s]+`,
  'iu'
);

/**
 * السؤال الفعلي = آخر جملة بعد تجريد عبارة التأكيد. ما قبلها تأكيد أو جملة يضخّها
 * النظام (مثل تنبيه مرحلة الإنجليزية)، ووجودها كان يميّع أي مقياس تشابه.
 */
function questionCore(text: string): string {
  const sentences = text
    .split(/[.!?؟]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const core = sentences[sentences.length - 1] ?? text;
  return core.replace(ACKNOWLEDGMENT_OPENER, '').trim();
}

function contentTokens(text: string): Set<string> {
  return new Set(tokenize(questionCore(text)).filter((w) => !QUESTION_FRAMING_WORDS.has(w)));
}

/**
 * هل السؤال الجديد إعادة لسؤال سابق؟ يقارن الكلمات المضمونية فقط.
 * مساران: تطابق عالٍ بين سؤالين متقاربي الطول، أو احتواء سؤال قصير داخل صياغة أطول
 * (الحالة التي تحدث عندما يُعاد السؤال مع مقدمة أو تأكيد إضافي).
 */
function isRepeatedQuestion(a: string, b: string): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  if (overlap < 2) return false;
  if (overlap / Math.max(ta.size, tb.size) >= 0.55) return true;
  return overlap / Math.min(ta.size, tb.size) >= 0.75;
}

function isSemanticallySimilarQuestion(a: string, b: string): boolean {
  const intentA = detectQuestionIntent(a);
  const intentB = detectQuestionIntent(b);
  if (intentA && intentB && intentA === intentB) return true;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter((w) => setB.has(w)).length;
  const ratio = overlap / Math.max(ta.length, tb.length);
  return ratio >= 0.55;
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

type FollowUpPair = { ar: string; en: string };

/**
 * متابعة عامة — عدّة صيغ قصيرة (جملة واحدة) تُدوّر كي لا تتكرّر حرفياً حين لا يطابق أي
 * intent. كانت صيغة واحدة فقط ("شنو صار بالضبط؟ وصفلي الموقف") فتكرّرت كثيراً.
 */
export const FOLLOW_UP_GENERIC: FollowUpPair[] = [
  // «اعطني» فصحى — الموديل ينطق البذرة شبه حرفياً، فكانت تُسمع خارج اللهجة
  { ar: 'انطيني مثال محدد صار وياك.', en: 'Give me one specific example.' },
  { ar: 'شنو كانت النتيجة بالضبط؟', en: 'What was the exact outcome?' },
  { ar: 'شنو أصعب جزء بهالموضوع؟', en: 'What was the hardest part of that?' },
];

/**
 * متابعة أعمق حسب نوع السؤال (evaluates). كل intent عدّة صيغ قصيرة بجملة واحدة تُدوّر
 * بحسب رقم المتابعة، فلا يتكرّر السؤال حرفياً ولا يكون مركّباً/غامضاً.
 */
export const FOLLOW_UP_BY_INTENT: Record<string, FollowUpPair[]> = {
  problem_solving: [
    { ar: 'ليش اخترت هالحل بالذات؟', en: 'Why did you choose that solution?' },
    { ar: 'شنو كانت النتيجة بعد ما طبّقته؟', en: 'What was the result after you applied it?' },
    { ar: 'لو ترجع للموقف، شنو تغيّر؟', en: 'If you went back, what would you change?' },
  ],
  communication: [
    { ar: 'شلون كان رد فعل الطرف الثاني؟', en: 'How did the other person react?' },
    { ar: 'شلون تأكدت إن فكرتك وصلت صح؟', en: 'How did you confirm your point landed?' },
  ],
  decision_making: [
    { ar: 'شنو الخيارات الثانية اللي فكّرت بيها؟', en: 'What other options did you weigh?' },
    { ar: 'على شنو اعتمدت بهالقرار؟', en: 'What did you base that decision on?' },
  ],
  teamwork: [
    { ar: 'شنو كان دورك إنت بالضبط بالفريق؟', en: 'What was your exact role on the team?' },
    { ar: 'شلون تعاملت وية عضو مو متعاون؟', en: 'How did you handle an uncooperative teammate?' },
  ],
  ownership: [
    { ar: 'شنو الشي اللي تحمّلت مسؤوليته لحدك؟', en: 'What did you own end to end?' },
    { ar: 'شنو طلع من الشي اللي تحمّلته؟', en: 'What came out of what you owned?' },
  ],
  learning: [
    { ar: 'وين طبّقت اللي تعلمته بعدين؟', en: 'Where did you apply what you learned?' },
    { ar: 'شنو أول شي غيّرته بطريقة شغلك بعدها؟', en: 'What did you change in how you work after?' },
  ],
  clarity: [
    { ar: 'تنطيني مثال محدد يوضّح هالنقطة؟', en: 'Can you give a concrete example of that?' },
    { ar: 'شنو صار بالضبط بهالموقف؟', en: 'What exactly happened there?' },
  ],
  motivation: [
    { ar: 'شنو اللي خلاك تختار هالمجال بالذات؟', en: 'What drew you to this field specifically?' },
    { ar: 'شنو أكثر شي يشدّك بهالشغل؟', en: 'What pulls you most about this work?' },
  ],
  role_fit: [
    { ar: 'شلون خبرتك تخدم هالدور بالضبط؟', en: 'How does your experience fit this role exactly?' },
    { ar: 'شنو أقرب مهمة سويتها تشبه شغل هالوظيفة؟', en: 'What task of yours most resembles this job?' },
  ],
  adaptability: [
    { ar: 'شلون تصرّفت لمّا تغيّرت الخطة فجأة؟', en: 'How did you react when the plan changed suddenly?' },
    { ar: 'شنو أصعب تغيير مريت بيه وشلون تأقلمت؟', en: 'What was the hardest change and how did you adapt?' },
  ],
  conflict: [
    { ar: 'شلون حليت خلاف صار بينك وبين زميل؟', en: 'How did you resolve a conflict with a colleague?' },
    { ar: 'شنو موقف اختلفت بيه وية مديرك وشلون تعاملت؟', en: 'When did you disagree with your manager, and how?' },
  ],
};

/** يطابق مفاتيح evaluates في interviewConfig مع مفاتيح المتابعة */
const FOLLOW_UP_INTENT_ALIASES: Record<string, string> = {
  learning_agility: 'learning',
  collaboration: 'teamwork',
  result: 'ownership',
  impact: 'ownership',
  initiative: 'ownership',
  adaptation: 'adaptability',
};

/**
 * يرجع زوج (عربي/إنجليزي) للمتابعة مع تدوير عبر rotation (عادةً عدد المتابعات
 * المستخدمة): إزاحة في قائمة evaluates كي لا يفوز نفس الـ intent دائماً، واختيار صيغة
 * مختلفة داخل الـ intent — فلا يتكرّر السؤال. عند غياب المطابقة تُستخدم العامة المدوّرة.
 */
export function getFollowUpPromptPair(
  selectedQuestion: { evaluates?: string[] } | null | undefined,
  rotation = 0
): FollowUpPair {
  const rot = Math.max(0, Math.floor(rotation));
  const list = selectedQuestion?.evaluates;
  if (list?.length) {
    for (let i = 0; i < list.length; i++) {
      const raw = list[(i + rot) % list.length];
      const key = FOLLOW_UP_INTENT_ALIASES[raw] ?? raw;
      const variants = FOLLOW_UP_BY_INTENT[key];
      if (variants?.length) return variants[rot % variants.length];
    }
  }
  return FOLLOW_UP_GENERIC[rot % FOLLOW_UP_GENERIC.length];
}

/**
 * Phase 2 — بناء توجيه السؤال حسب الموضوع.
 * كل مفتاح مستقل (قابل للاختبار) ويُرجع نصاً مع قيمة البروفايل أو بدونها.
 * إضافة topic جديد = إضافة معالج واحد فقط في `PHASE2_TOPIC_PROMPTS`.
 */
type Phase2TopicKey = (typeof PHASE2_TOPIC_KEYS)[number];

type Phase2PromptResult = { ar: string; en: string };

type Phase2TopicHandler = (profile?: CandidateProfileForEngine | null) => Phase2PromptResult;

const DEFAULT_POOL_EVALUATES: Record<number, InterviewEvaluationIntent[]> = {
  1: ['communication', 'clarity', 'motivation', 'role_fit'],
  2: ['communication', 'clarity', 'collaboration'],
  3: ['teamwork', 'collaboration', 'communication'],
  4: ['digital_skills', 'tooling', 'learning_agility'],
  5: ['problem_solving', 'time_management', 'ownership'],
};

const PHASE2_TOPIC_EVALUATES: Record<Phase2TopicKey, InterviewEvaluationIntent[]> = {
  skill: ['digital_skills', 'tooling', 'clarity'],
  certification: ['learning_agility', 'digital_skills', 'clarity'],
  education: ['learning_agility', 'role_fit', 'clarity'],
  company: ['problem_solving', 'ownership', 'collaboration'],
  language: ['communication', 'clarity'],
};

const PHASE3_EVALUATES: InterviewEvaluationIntent[] = ['english_fluency', 'communication', 'clarity'];

const PHASE3_DYNAMIC_TRANSLATION_SENTENCES = [
  'Good communication is the key to a successful team.',
  'Time management helps us meet deadlines and reduce stress.',
  'Problem solving starts with understanding the root cause.',
  'Teamwork creates better results than working in isolation.',
  'Clear goals help people stay focused and productive.',
] as const;

function hashString(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/**
 * خطة المرحلة الثالثة: أسئلة دوّارة من البنك حسب الجلسة، ثم سؤال الترجمة **دائماً**
 * في النهاية. قبل ذلك كان سؤال الترجمة عنصراً في البنك، فلا يصل إلا في ~45% من
 * الجلسات حسب نقطة بداية التدوير.
 */
export function buildPhase3QuestionPlan(sessionId?: string): string[] {
  const bank = PHASE3_QUESTIONS;
  const max = Math.min(PHASE3_MAX_QUESTIONS, bank.length);
  const rotating: string[] = [];
  if (bank.length <= max) {
    rotating.push(...bank.slice(0, max));
  } else {
    const start = hashString(sessionId ?? 'phase3') % bank.length;
    for (let i = 0; i < bank.length && rotating.length < max; i++) {
      rotating.push(bank[(start + i) % bank.length]);
    }
  }
  return [...rotating, PHASE3_TRANSLATION_QUESTION];
}

/** هل هذا هو سؤال الترجمة؟ (النص يتغيّر بتغيّر الجملة، لا تُقارَن الحروف حرفياً) */
export function isPhase3TranslationQuestion(text: string): boolean {
  return /^Could you translate this sentence for me:/i.test(text.trim());
}

function resolveDynamicPhase3Question(text: string, baseIdx: number, sessionId?: string): string {
  if (!isPhase3TranslationQuestion(text)) return text;
  const sentenceIdx =
    (hashString(`${sessionId ?? 'phase3'}|translate`) + baseIdx) % PHASE3_DYNAMIC_TRANSLATION_SENTENCES.length;
  const sentence = PHASE3_DYNAMIC_TRANSLATION_SENTENCES[sentenceIdx];
  return `Could you translate this sentence for me: '${sentence}'?`;
}

/** يزيل مستوى الإتقان من قيمة مخزّنة مثل "English (Fluent)" → "English". */
export function stripLanguageProficiency(raw: string): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  const parenMatch = trimmed.match(/^(.+?)\s*\([^)]*\)\s*$/);
  if (parenMatch) return parenMatch[1].trim();
  return trimmed;
}

/** أسماء اللغات فقط — بدون مستويات من الاستمارة (للسؤال عن المستوى في المقابلة). */
export function languageNamesOnly(languages?: (string | null | undefined)[] | null): string[] {
  if (!languages?.length) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of languages) {
    const name = stripLanguageProficiency(String(raw ?? ''));
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

const PHASE2_TOPIC_PROMPTS: Record<Phase2TopicKey, Phase2TopicHandler> = {
  skill: (profile) => {
    const skill = profile?.skills?.[0]?.trim();
    if (skill) {
      return {
        ar: `اسأل المرشح كيف يستخدم مهارة "${skill}" في عمله.`,
        en: `Ask the candidate how they use their skill "${skill}" in their work.`,
      };
    }
    return {
      ar: 'اسأل المرشح كيف يستخدم مهاراته في عمله.',
      en: 'Ask the candidate how they use their skills in their work.',
    };
  },
  certification: (profile) => {
    const raw = profile?.certifications?.trim();
    const cert = raw ? (raw.split(/[,،]/)[0]?.trim() || raw) : undefined;
    const position = profile?.position_applied_for?.trim();
    if (cert) {
      return {
        ar: `اسأل المرشح عن شهادته "${cert}" وكيف تفيده في عمله.`,
        en: `Ask the candidate about their certification "${cert}" and how it helps them.`,
      };
    }
    return {
      ar: position
        ? `اسأل المرشح عن خبرته في مجال "${position}"،وكم سنة اشتغل بهذا المجال، وما هي الشركات االي اشتغل بيها سابقا اذا چان مشتغل .`
        : 'اسأل المرشح عن خبرته في المجال، وكم سنة اشتغل بهذا المجال، وما هي الشركات التي عمل بها إن وجدت.',
      en: position
        ? `Ask the candidate about their experience in the "${position}" field, how many years they worked in this field, and which companies they worked at, if any.`
        : 'Ask the candidate about their experience in the field, how many years they worked in this field, and which companies they worked at, if any.',
    };
  },
  education: (profile) => {
    const edu = profile?.highest_education_level?.trim();
    if (edu) {
      return {
        ar: `اسأل المرشح شنو اللي استفاده خلال سنوات الدراسة (${edu})، وشلون كانت تجربته بشكل عام، وهل أثرت بمسار حياته وصقلت مهاراته.`,
        en: `Ask the candidate what they gained during their years of study (${edu}), how their overall experience was, and whether it influenced their life path and sharpened their skills.`,
      };
    }
    return {
      ar: 'اسأل المرشح شنو اللي استفاده خلال سنوات الدراسة، وشلون چانت تجربته بشكل عام، وهل أثرت بمسار حياته وصقلت مهاراته.',
      en: 'Ask the candidate what they gained during their years of study, how their overall experience was, and whether it influenced their life path and sharpened their skills.',
    };
  },
  company: (profile) => {
    const company = profile?.current_company?.trim();
    if (company) {
      return {
        ar: `اسأل المرشح عن التحديات التي واجهها في شركته الحالية "${company}".`,
        en: `Ask the candidate about challenges they faced at their current company "${company}".`,
      };
    }
    return {
      ar: 'اسأل المرشح عن تجربته السابقة: شنو كانت التحديات، وشنو النقاط الإيجابية اللي عاشها بهذي التجربة؟',
      en: 'Ask the candidate about their previous experience: what challenges they faced and what positive points they experienced in that role.',
    };
  },
  language: (profile) => {
    return {
      ar: buildLanguageTopicPromptAr(profile),
      en: (() => {
        const langs = languageNamesOnly(profile?.languages);
        if (langs.length) {
          const names = langs.slice(0, 3).join(', ');
          return `Ask the candidate which languages they can speak and their level in each language. Application lists these languages (names only): ${names}. Do NOT state proficiency levels from the application — ask the candidate to describe their level.`;
        }
        return 'Ask the candidate which languages they can speak and their proficiency level in each language.';
      })(),
    };
  },
};

const PHASE2_GENERIC_FALLBACK: Phase2PromptResult = {
  ar: 'اسأل المرشح عن أبرز خبراته المهنية وما يميّزها.',
  en: 'Ask the candidate about the most relevant experience they have and what makes it stand out.',
};

export function buildPhase2TopicPrompt(
  topicKey: string,
  ar: boolean,
  profile?: CandidateProfileForEngine | null
): string {
  const handler = (PHASE2_TOPIC_PROMPTS as Record<string, Phase2TopicHandler | undefined>)[topicKey];
  const out = handler ? handler(profile) : PHASE2_GENERIC_FALLBACK;
  return ar ? out.ar : out.en;
}

/** للتحقق: fallback سؤال عند فشل الـ LLM — من الـ topic */
const TOPIC_FALLBACK_QUESTIONS: Record<string, string> = {
  warmup_and_self_introduction: 'ممكن تحجيلنا عن نفسك شويه شنو الاشياء التي تحب نعرفها عنك؟',
  communication_and_clarity: 'شنو يعني التواصل الفعال بالنسبة لك؟',
  teamwork_and_collaboration: 'شلون تفضل تشتغل لوحدك او  مع فريق؟',
  digital_skills_and_tools: 'شنو البرامج اللي تستخدمها بلعمل؟',
  // «وي» ليست كلمة — الصواب «وية». وهذا نصّ احتياطي يُنطق كما هو، فكان المرشح
  // يسمعه ناقصاً وبلا علامة استفهام (جلسة a8a8d6fd، آخر سؤال في المقابلة).
  time_management_and_problem_solving: 'شلون تتعامل وية ضغط العمل بشغلك؟',
};

export function getFallbackForTopic(topic: string, genderRaw?: string | null): string {
  const base = TOPIC_FALLBACK_QUESTIONS[topic] ?? 'ممكن تحچيلي أكثر عن هالموضوع؟';
  return applyIraqiGenderPhrasing(base, normalizeCandidateGender(genderRaw));
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
  candidateProfile?: CandidateProfileForEngine | null,
  candidateLastAnswer?: string,
  recentAssistantQuestions?: string[]
): SelectedQuestion | null {
  const { phase, mandatoryQuestionDue, suggestedPool } = controller;

  if (phase === 1) {
    if (mandatoryQuestionDue) {
      const useArabic = candidateLastLanguage === 'ar';
      const q = MANDATORY_QUESTIONS[mandatoryQuestionDue];
      return {
        text: useArabic ? q.iq : q.en,
        pool: 0, // mandatory
        // نسجّل موضوع السؤال الإلزامي في ذاكرة المواضيع كي لا يتكرّر لاحقاً: الأول
        // «عرّف نفسك» = warmup، والثاني «Microsoft Office» يغطّي «الأدوات الرقمية».
        topic:
          mandatoryQuestionDue === 1
            ? 'warmup_and_self_introduction'
            : 'digital_skills_and_tools',
        evaluates: q.evaluates,
        preferArabic: useArabic,
      };
    }

    // Topic scoring: اختيار pool أقرب لآخر إجابة المرشح (إلا عند change request)
    const inferredTopic = !changeRequested && candidateLastAnswer ? inferTopicFromAnswer(candidateLastAnswer) : undefined;
    const inferredPool = inferredTopic ? TOPIC_TO_POOL[inferredTopic] : undefined;

    // حارس التنوّع: ذاكرة المواضيع مصدر الحقيقة لِما غُطّي. كان الاستدلال يعيد نفس
    // الـ pool (خصوصاً «الأدوات») لأن المرشح يكرّر ذكر الأدوات، وكانت أسئلة الـ pool
    // لا تُسجَّل في askedTopics أصلاً — فيتكرّر الموضوع.
    const askedTopicsSet = isVoiceTopicMemoryEnabled()
      ? new Set(state?.askedTopics ?? [])
      : new Set<string>();
    const topicAsked = (p: number) => askedTopicsSet.has(PHASE1_TOPICS[p]);
    const DIGITAL_POOL = TOPIC_TO_POOL['digital_skills_and_tools'];
    // سؤال Microsoft Office الإلزامي (الثاني) يغطّي «الأدوات»، فنحجز pool الأدوات له
    // ولا نطرحه بالاستدلال قبله — طرحهما معاً كان يكرّر موضوع الأدوات.
    const digitalReserved = !state?.secondMandatoryAsked;

    // عند طلب التغيير: نستخدم pool مختلف عن الأخير دائماً
    const lastPool = state?.askedPools?.length ? state.askedPools[state.askedPools.length - 1] : 0;
    const inferredUsable =
      inferredPool &&
      !topicAsked(inferredPool) &&
      !(inferredPool === DIGITAL_POOL && digitalReserved)
        ? inferredPool
        : undefined;
    let pool = changeRequested && lastPool > 0
      ? ((lastPool % 5) + 1) as number
      : (inferredUsable ?? suggestedPool ?? 1);
    if (changeRequested && lastPool === 0) {
      // إذا ماكو pool سابق (mandatory/topic-choice)، لا نرجع لنفس منطق الـwarmup
      pool = ((pool % 5) + 1) as number;
    }
    if (changeRequested && pool === 1 && (state?.userMessageCount ?? 0) > 0) {
      pool = 2;
    }
    // إن كان موضوع الـ pool المختار مطروحاً بالفعل (أو محجوزاً للإلزامي)، ننتقل لأول
    // pool موضوعه غير مطروح — يمنع تكرار نفس الموضوع دون كسر مسار طلب التغيير.
    if (!changeRequested && (topicAsked(pool) || (pool === DIGITAL_POOL && digitalReserved))) {
      for (let step = 1; step <= 5; step += 1) {
        const cand = (((pool - 1 + step) % 5) + 1);
        if (!topicAsked(cand) && !(cand === DIGITAL_POOL && digitalReserved)) {
          pool = cand;
          break;
        }
      }
    }
    const poolData = POOL_QUESTIONS[pool];
    if (!poolData) return null;

    const askedCount = state?.askedPools?.length ?? 0;
    const level: 1 | 2 | 3 = askedCount < 3 ? 1 : askedCount < 6 ? 2 : 3;
    const levelKey = `L${level}` as 'L1' | 'L2' | 'L3';
    const useArabic = candidateLastLanguage === 'ar';
    const questions = poolData[levelKey];
    const recent = (recentAssistantQuestions ?? []).slice(-2);
    const filtered = questions.filter((q) => {
      const qt = useArabic ? q.iq : q.en;
      if (changeRequested && detectQuestionIntent(qt) === 'intro') return false;
      if (!recent.length) return true;
      return !recent.some((r) => isSemanticallySimilarQuestion(qt, r));
    });
    const source = filtered.length > 0 ? filtered : questions;
    const baseIdx = state?.userMessageCount ?? 0;
    const idx = (baseIdx + (changeRequested ? 1 : 0)) % source.length;
    const q = source[idx];
    const text = useArabic ? q.iq : q.en;

    return {
      text,
      pool,
      // نسجّل موضوع الـ pool في ذاكرة المواضيع (لم يكن يُسجَّل إلا في وضع topic-choice)
      // كي لا يُعاد الموضوع نفسه عبر الاستدلال أو الـ round-robin لاحقاً.
      topic: PHASE1_TOPICS[pool],
      level,
      evaluates: q.evaluates ?? DEFAULT_POOL_EVALUATES[pool],
      preferArabic: useArabic,
    };
  }

  if (phase === 2) {
    const baseIdx = state?.userMessageCount ?? 0;
    const topicIdx = (baseIdx + (changeRequested ? 1 : 0)) % PHASE2_TOPIC_KEYS.length;
    const topicKey = PHASE2_TOPIC_KEYS[topicIdx];
    const ar = candidateLastLanguage === 'ar';
    const text = buildPhase2TopicPrompt(topicKey, ar, candidateProfile);
    return {
      text,
      evaluates: PHASE2_TOPIC_EVALUATES[topicKey],
      preferArabic: ar,
    };
  }

  if (phase === 3) {
    // إعلان اختبار الإنجليزية يُطرح أول مرة ندخل فيها Phase 3 ويبقى ثابتاً حتى
    // يُطرح فعلاً (englishTestAnnounced). لا يعتمد على تطابق عدّ الرسائل الهشّ
    // (isFirstPhase3Message) ولا يُلغى بطلب تغيير السؤال — لا يمكن «تخطّي» إعلان.
    // هذا يمنع القفز المباشر إلى الإنجليزية بلا مقدّمة «جاهز؟».
    if (!state?.englishTestAnnounced) {
      return {
        text: 'هسة راح أختبر لغتك الإنكليزية. جاهز؟',
        preferArabic: true,
        isFixed: true, // لا LLM — رسالة ثابتة مباشرة لـ TTS
        isEnglishIntro: true,
      };
    }
    const baseIdx = state?.englishQuestionsAsked ?? 0;
    const phase3Plan = buildPhase3QuestionPlan(state?.sessionId);
    const idx = baseIdx + (changeRequested ? 1 : 0);
    if (idx >= phase3Plan.length) {
      return {
        text: 'Thank you for your time. The interview has now ended, and our HR team will review your answers and contact you with the next steps.',
        evaluates: PHASE3_EVALUATES,
        preferArabic: false,
        isFixed: true,
        isInterviewEnd: true,
      };
    }
    const plannedQuestion = phase3Plan[idx];
    const phase3Question = resolveDynamicPhase3Question(plannedQuestion, baseIdx, state?.sessionId);
    return {
      text: phase3Question,
      evaluates: PHASE3_EVALUATES,
      preferArabic: false, // Phase 3 always English
      // سؤال الترجمة يُرسل حرفياً: إعادة الصياغة تُذيب الجملة المطلوب ترجمتها فيضيع الاختبار
      isFixed: isPhase3TranslationQuestion(plannedQuestion),
    };
  }

  return null;
}
