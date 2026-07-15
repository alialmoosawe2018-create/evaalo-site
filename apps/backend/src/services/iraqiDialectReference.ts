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
  what: "شنو",
  how: "شلون",
  howAreYouM: "شلونك",
  howAreYouF: "شلونج",
  why: "ليش",
  where: "وين",
  who: "منو",
  when: "يمته / شوكت",
  howMuch: "أشگد",
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
  ok: ["تمام", "زين", "طيب", "ماشي"],
  now: "هسة",
  hello: ["هلو", "أهلاً", "مرحبا"],
  letsGo: "يلا",
  but: "بَس",
  here: "هنا",
  there: "هناك",
  this: ["هال", "هاي"],
  that: "ذاك",
  say: "گول / گلت / بگول",
  talkToMe: "تحچيلي",
  tellMe: "سولفلي",
  was: "چان / چنت",
  will: "راح",
  of: "مال",
  good: "زين / حلو",
  capable: "ممتاز",
  wellDone: ["أحسنت", "عاشت ايدك"],
  exactly: "بالضبط",
  aBit: "شويه",
  please: "لو سمحت",
  thankYou: "شكراً",
  canYou: "ممكن",
} as const;

/** عبارات تأكيد قصيرة قبل السؤال التالي — ليست تحية */
export const IRAQI_ACKNOWLEDGMENT_PHRASES = [
  "ممتاز",
  "طيب",
  "عاشت ايدك",
  "زين",
  "تمام",
  "حلو",
  "جيد",
] as const;

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
    "شنو تحب تحچيلي شويه عن نفسك؟",
    "ممكن تحجيلنا عن نفسك شويه شنو الاشياء التي تحب نعرفها عنك؟",
    "شنو أهم تجربة عمل أثرت على مسيرتك المهنية؟",
    "شنو بالضبط الشي اللي جذبك لشركتنا أو لهالوظيفة؟",
    "شلون تطور أسلوبك بالشغل؟",
    "شنو نوع بيئة العمل الي تحب تشتغل بيها؟",
  ],
  pool2_communication: [
    "ممكن تحچيلي عن مهارة اشتغلت عليها؟",
    "سولفلي عن تحدي واجهته بعملك السابق وشلون حليته.",
    "ممكن تحچيلي أكثر عن التحديات اللي واجتهتها بالعمل وشلون تعاملت وياها؟",
    "شنو يعني العمل الجماعي بالنسبة لك؟",
    "شلون تفضل تشتغل — لوحدك ولا مع فريق؟",
  ],
  pool3_softskills: [
    "شلون تحب تنجز المهام بشكل فردي او جماعي؟",
    "شلون تتعامل وي ضغط العمل والوقت بعملك اليومي؟",
    "سولفلي عن مرة چان عندك خلاف مع زميل.",
    "شنو تسوي لو تختلف مع قرار مديرك؟",
  ],
  pool4_digital: [
    "شنو البرامج أو الأدوات اللي تستخدمها بالشغل؟",
    "شلون تتواصل مع فريقك عن بعد؟",
    "شنو تسوي لما الشغل يتراكم؟",
    "ممكن تحچيلي عن مهارة تعلمتها لوحدك بدون ما ينطلب منك؟",
  ],
  pool5_problem: [
    "شنو تسوي لما التعليمات مو واضحة؟",
    "سولفلي عن مشكلة واجهتها بالشغل وشلون كدرت اتحلها.",
    "عندك ثلاث مهام urgent — شلون ترتبها؟",
    "شنو الخطوات اللي تتبعها لما تكتشف غلط متأخر؟ تگدر تنطيني مثال؟",
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
  "هذا": "هاذه / هاي",
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

export type CandidateGender = "male" | "female" | "unknown";

/** يُطبَّق على قيم gender من Candidate (lowercase) أو نصوص عربية/اختصارات */
export function normalizeCandidateGender(raw?: string | null): CandidateGender {
  const v = (raw || "").trim().toLowerCase();
  if (!v) return "unknown";
  if (v === "female" || v === "f" || v === "أنثى" || v === "انثى" || v === "انثي") return "female";
  if (v === "male" || v === "m" || v === "ذكر") return "male";
  return "unknown";
}

/** قواعد مطابقة الجنس عند مخاطبة المرشح بالعربي العراقي */
export function buildGenderAgreementSection(gender: CandidateGender): string {
  if (gender === "unknown") return "";
  if (gender === "female") {
    return `
CANDIDATE GENDER — FEMALE (MANDATORY whenever your Arabic addresses her directly):
- Modal CAN (f): تگدرين — NEVER تكدر/تقدر (ق), NEVER masculine تگدر alone when addressing her
- Tell me / talk to me: ALWAYS تحچيلي — FORBIDDEN: تقوليلي، تقوليني، تقولي لي، تگوليلي
- Example RIGHT: "تگدرين تحچيلي عن…؟" | WRONG: "تكدر تقوليلي" or "تگدر تحچيلي"
- Second-person verbs (f): واجهتِ، تعاملتِ، كدرتِ/گدرتِ، مريتِ، اشتغلتِ، تعلمتِ، چنتِ — NOT masculine واجهت، تعاملت، كدرت
- Possessive YOUR (f): خبرتج، شغلج، مسيرتج — NOT خبرتك، شغلك
- Greeting/check-in: شلونج — NOT شلونك
- Languages (f): تگدرين تحچين… — NOT تگدر تحچيها
- Preposition with challenge/situation (f noun): وياها — FORBIDDEN: ويها
- WRONG: "شنو التحديات اللي واجهتها وكيف تعاملت ويها؟"
- RIGHT: "شنو التحديات اللي واجهتِ وكيف تعاملتِ وياها؟"
- Pool/dialect examples below may use masculine defaults — ALWAYS rewrite to feminine when rephrasing or generating Arabic.`;
  }
  return `
CANDIDATE GENDER — MALE (MANDATORY whenever your Arabic addresses him directly):
- Modal CAN (m): تگدر — NEVER تكدر/تقدر (ق), NEVER تگدرين
- Tell me / talk to me: ALWAYS تحچيلي — FORBIDDEN: تقوليلي، تقوليني، تقولي لي، تگوليلي
- Example RIGHT: "تگدر تحچيلي عن…؟" | WRONG: "تكدر تقوليلي"
- Second-person verbs (m): واجهت، تعاملت، كدرت، مريت، اشتغلت — NOT feminine واجهتِ، تعاملتِ
- Possessive YOUR (m): خبرتك، شغلك — NOT خبرتج
- Greeting: شلونك — NOT شلونج
- Do not use feminine address forms.`;
}

/**
 * تصحيح حتمي لصيغ المخاطبة العراقية حسب جنس المرشح (بعد توليد LLM أو نص ثابت).
 */
export function applyIraqiGenderPhrasing(text: string, gender: CandidateGender = "unknown"): string {
  if (!text || !/[\u0600-\u06FF]/.test(text)) return text;

  let s = text;

  // ممنوع: تقوليلي / تقوليني / تقولي لي → تحچيلي
  s = s.replace(/تقولي\s*لي/giu, "تحچيلي");
  s = s.replace(/تقوليلي/giu, "تحچيلي");
  s = s.replace(/تقوليني/giu, "تحچيلي");
  s = s.replace(/تگوليلي/giu, "تحچيلي");
  s = s.replace(/تگوليني/giu, "تحچيلي");
  s = s.replace(/تحچي\s+لي/giu, "تحچيلي");

  // ق→گ في «تكدر/تقدر» + مطابقة الجنس
  if (gender === "female") {
    s = s.replace(/\b(?:تكدر|تقدر|تگدر|گدر)\b/giu, "تگدرين");
    s = s.replace(/\b(?:تكدرين|تقدرين|تگدر|گدرين)\b/giu, "تگدرين");
    s = s.replace(/\bتحچيها\b/giu, "تحچين");
    s = s.replace(/\bتحچيه\b/giu, "تحچين");
  } else {
    const modalM = gender === "male" ? "تگدر" : "تگدر";
    s = s.replace(/\b(?:تكدر|تقدر|تكدرين|تقدرين|تگدرين|گدرين)\b/giu, modalM);
    s = s.replace(/\bگدر\b/giu, modalM);
  }

  return s.replace(/\s{2,}/g, " ").trim();
}

/** بناء نص تعليمات اللهجة العراقية للـ LLM */
export function buildIraqiDialectPromptSection(gender: CandidateGender = "unknown"): string {
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
4. Words: تمام/زين/طيب (ok) | هسة (now) | هلا/أهلاً (hello) | يلا (let's) | هال/هاي (this) | ممكن (can you) | تحچيلي (talk to me) | سولفلي (tell me/narrate) | وي (with) | وياها (with it)
5. Phrasing: do NOT use "شنو تحچيلي…" (ungrammatical). Use "شنو تحب تحچيلي… عن نفسك/عن هالموضوع" or "ممكن تحجيلنا عن نفسك شويه شنو الاشياء التي تحب نعرفها عنك؟" for self-intro / follow-ups
6. FORBIDDEN: تقوليلي، تقوليني، تقولي لي — ALWAYS تحچيلي. FORBIDDEN: تكدر/تقدر (ق) — use تگدر (m) or تگدرين (f)

ACKNOWLEDGMENT before the next question (NOT a greeting):
- After the candidate answers, use ONE short phrase from: ${IRAQI_ACKNOWLEDGMENT_PHRASES.join("، ")} — then comma — then the question.
- Vary the phrase each turn; do NOT open every reply with "زين" or the same word twice in a row.
- FORBIDDEN as acknowledgment: شلونك، شلونج، شلون، هلا، مرحبا — "شلونك/شلونج" means "how are you?" (greeting only at interview start), NOT "good answer".
- WRONG: "زين، شلونك؟ شنو الأساليب…" | RIGHT: "ممتاز، شنو الأساليب…" or "طيب، شلون تنظم…" (شلون = how, without ك/ج suffix)

FORBIDDEN: كيف، ما هو، لماذا، أين، كان، جيد، حسناً، مرحباً، دلوقت، الحين، ايش، وش

PROFESSIONAL REGISTER (HR interview): Polite and neutral. NEVER intimate or pet names: not حبيبي، عزيزي، حياتي، يا عيني، يا بعدي، or similar. Sound like a formal interviewer, not a friend or social chat.

Iraqi interview phrases (use when candidate speaks Arabic): ${poolExamples}

Few-shot: "أنا مهندس"→"ممتاز، شنو شغلك الحالي؟" | "اشتغلت ٥ سنين"→"طيب، ليش تحب تنقل لهالوظيفة؟" | "ما فهمت"→"تمام، أقصد شنو بالضبط؟"
${buildGenderAgreementSection(gender)}
`;
}
