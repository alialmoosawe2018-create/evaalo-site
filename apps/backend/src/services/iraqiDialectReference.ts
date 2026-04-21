/**
 * مرجع اللهجة العراقية — للمقابلات المهنية
 *
 * المصادر الأكاديمية:
 * - Georgetown Dictionary of Iraqi Arabic (Maamouri 2013) — 17,500 مدخل
 * - Woodhead & Beene's Iraqi-Arabic-English Dictionary
 * - Wikipedia: Baghdadi Arabic (Mesopotamian, Gilit)
 * - Grokipedia: Baghdadi Arabic (phonology, morphology, lexicon)
 * - IQAD Dataset (53K عينة عراقية)
 * - EzioDevio/iraqi_dialect_llm (Hugging Face)
 *
 * التركيز: اللهجة البغدادية الجيلت (Muslim Baghdadi) — لغة بغداد الحضرية
 */

/** كلمات الاستفهام — من مصادر أكاديمية (Georgetown, Grokipedia) */
export const IRAQI_QUESTION_WORDS = {
  what: "شنو / أش / شو",
  how: "شلون",
  howAreYouM: "شلونك",
  howAreYouF: "شلونج",
  why: "ليش",
  where: "وين",
  who: "منو / مين",
  when: "يمته / امته",
  howMuch: "أشگد / چقد",
  whatsUp: "شكو ماكو",
  whatsNewsM: "شخبارك",
  whatsNewsF: "شخبارج",
} as const;

/** الصوتيات — من Wikipedia/Grokipedia: ق→گ (Gilit)، ج→چ */
export const IRAQI_PHONOLOGY = {
  qafToGaf: "ق→گ (قال→گال، قبل→گبل، وقت→وگت، قلب→گلب)",
  jimToCh: "ج→چ (جيد→چيد، جاي→چاي، شلونك→شلونج للأنثى)",
  note: "اللهجة الجيلت (بغداد المسلم) تستخدم /ɡ/ بدل /q/",
} as const;

/** مفردات — Georgetown Dictionary + EzioDevio model examples */
export const IRAQI_VOCABULARY = {
  ok: ["تمام", "زين", "كويس", "ماشي"],
  now: "هسة",
  hello: ["هلا", "أهلاً", "هاي"],
  letsGo: "يلا",
  but: "بَس",
  here: "هني",
  there: "هنيگ",
  this: ["هال", "هاي"],
  that: "ذاك",
  say: "گول / گلت / بگول",
  talkToMe: "تحچيلي",
  tellMe: "سولفلي",
  was: "چان / چنت",
  will: "راح",
  of: "مال",
  good: "زين / كويس",
  capable: "كفو",
  wellDone: "أحسنت",
  exactly: "بالضبط",
  aBit: "شوي",
  please: "لو سمحت",
  thankYou: "شكراً",
  canYou: "ممكن",
} as const;

/** قواعد نحوية — من Grokipedia (Morphology) */
export const IRAQI_GRAMMAR = {
  presentHabitual: "ب- (بگول، بتحب، بسألك، بكتب)",
  progressive: "دا- (دا أگول = I'm saying)",
  negation: "ما...ش (ما أعرفش، ما بتحبش) | مو (للمبتدأ: مو معلم)",
  possessive: "مال (مال الشغل، مال الشركة)",
} as const;

/** ترجمات أسئلة المقابلة — Pool → عراقي (مصادر أكاديمية) */
export const IRAQI_POOL_TRANSLATIONS: Record<string, string[]> = {
  pool1_warmup: [
    "ممكن تحچيلي شويه عن نفسك؟",
    "شنو أهم تجربة شغل أثرت بيك؟",
    "ليش تحب تنضم لنا؟",
    "شلون تطور أسلوبك بالشغل؟",
    "شنو نوع بيئة الشغل اللي تفضل؟",
  ],
  pool2_communication: [
    "ممكن تحچيلي عن مهارة اشتغلت عليها؟",
    "سولفلي عن تحدي واجهته بعملك السابق وشلون حليته.",
    "ممكن تحچيلي أكثر عن التحديات اللي واجتهتها بالعمل وشلون تعاملت وياها؟",
    "شنو يعني العمل الجماعي بالنسبة لك؟",
    "شلون تفضل تشتغل — لوحدك ولا مع فريق؟",
  ],
  pool3_softskills: [
    "شلون تفضل تشتغل مع الفريق؟",
    "شلون تتعامل وي ضغط العمل والوقت بعملك اليومي؟",
    "سولفلي عن مرة چان عندك خلاف مع زميل.",
    "شنو تسوي لو تختلف مع قرار مديرك؟",
  ],
  pool4_digital: [
    "شنو البرامج أو الأدوات اللي تستخدمها بالشغل؟",
    "شلون تتواصل مع فريقك عن بعد؟",
    "شنو تسوي لما الشغل يتراكم؟",
    "ممكن تحچيلي عن مهارة تعلمتها لوحدك بدون ما يطلبوك؟",
  ],
  pool5_problem: [
    "شنو تسوي لما التعليمات مو واضحة؟",
    "سولفلي عن مشكلة واجهتها بالشغل وشلون كدرت اتحلها.",
    "عندك ثلاث مهام urgent — شلون ترتبها؟",
    "شنو أول خطوة تسويها لما تكتشف غلط؟",
  ],
};

/** عبارات للتحويل من الفصحى → عراقي */
export const IRAQI_INTERVIEW_PHRASES: Record<string, string> = {
  "كيف حالك": "شلونك",
  "كيف حالك؟": "شلونك؟",
  "ما هي": "شنو",
  "ما هو": "شنو",
  "لماذا": "ليش",
  "أين": "وين",
  "متى": "يمته",
  "من": "منو",
  "جيد": "زين",
  "حسناً": "تمام",
  "مرحباً": "هلا / أهلاً",
  "الآن": "هسة",
  "هذا": "هال / هاي",
  "ذلك": "ذاك",
  "قال": "گال",
  "كان": "چان",
  "سأقول": "راح أگول",
};

/** كلمات يجب تجنبها (فصحى / مصري / خليجي / شامي) */
export const AVOID_IN_IRAQI = [
  "كيف",
  "ما هو",
  "لماذا",
  "أين",
  "كان",
  "جيد",
  "حسناً",
  "مرحباً",
  "من أجل",
  "دلوقت",
  "الحين",
  "ايش",
  "وش",
  "إيش",
];

/** بناء نص تعليمات اللهجة العراقية للـ LLM */
export function buildIraqiDialectPromptSection(): string {
  const poolExamples = Object.values(IRAQI_POOL_TRANSLATIONS)
    .flat()
    .slice(0, 12)
    .map((p) => `"${p}"`)
    .join(" | ");
  return `
When speaking Arabic: Use Iraqi Baghdadi (Gilit) ONLY. Sources: Georgetown Dictionary of Iraqi Arabic, Grokipedia, IQAD.
NOT فصحى, NOT مصري/خليجي/شامي.

IRAQI RULES (MANDATORY):
1. Question words: شنو/أش (what) | شلون (how) | شلونك/شلونج (how are you m/f) | ليش (why) | وين (where) | منو (who) | يمته (when)
2. Phonology: ق→گ (گال، گبل، وگت) | ج→چ (چيد، چاي، شلونج)
3. Verbs: ب- present (بگول، بتحب) | چان/چنت (was) | راح (will) | مال (of)
4. Words: تمام/زين (ok) | هسة (now) | هلا/أهلاً (hello) | يلا (let's) | هال/هاي (this) | ممكن (can you) | تحچيلي (talk to me) | سولفلي (tell me/narrate) | وي (with) | وياها (with it)

FORBIDDEN: كيف، ما هو، لماذا، أين، كان، جيد، حسناً، مرحباً، دلوقت، الحين، ايش، وش

Iraqi interview phrases (use when candidate speaks Arabic): ${poolExamples}

Few-shot: "أنا مهندس"→"زين، شنو شغلك الحالي؟" | "اشتغلت ٥ سنين"→"تمام، ليش تحب تنقل لهالوظيفة؟" | "ما فهمت"→"بَس، أقصد شنو بالضبط؟"
`;
}
