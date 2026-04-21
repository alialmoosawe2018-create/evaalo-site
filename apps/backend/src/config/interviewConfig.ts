/**
 * Interview Config — مصدر واحد للأسئلة والمراحل
 * يُستخدم من: llmService (prompts)، questionEngine (اختيار الأسئلة)
 */

/** الأسئلة الإلزامية — 1: أول سؤال (بداية)، 2: Microsoft Office (لاحقاً) */
export const MANDATORY_QUESTIONS: Record<1 | 2, { en: string; iq: string }> = {
  1: {
    en: 'Can you tell me a bit about yourself in your own words?',
    iq: 'ممكن تحچيلي شوي عن نفسك؟',
  },
  2: {
    en: 'What is your level of proficiency in Microsoft Office applications, and which program do you prefer the most? Why?',
    iq: 'شنو مستواك ببرامج مايكروسوفت أوفيس، وأي برنامج تفضل أكثر؟ وليش؟',
  },
};

/** سؤال واحد — إنجليزي + عراقي */
export type BilingualQuestion = { en: string; iq: string };

/** Phase 1 Pools — كل pool له L1, L2, L3 (أسئلة متعددة، نختار واحد) */
export const POOL_QUESTIONS: Record<number, { L1: BilingualQuestion[]; L2: BilingualQuestion[]; L3: BilingualQuestion[] }> = {
  1: {
    L1: [
      { en: 'Can you tell me a bit about yourself in your own words?', iq: 'ممكن تحچيلي شوي عن نفسك؟' },
      { en: 'How would you briefly describe your professional background?', iq: 'ممكن تصفلي باختصار خلفيتك المهنية؟' },
      { en: 'Tell me briefly about your most recent experience.', iq: 'حكيلي شوي عن آخر تجربة شغل عندك.' },
    ],
    L2: [
      { en: 'What is the most important work experience that influenced your career so far?', iq: 'شنو أهم تجربة شغل أثرت بمسيرتك المهنية؟' },
      { en: 'Why are you interested in joining us?', iq: 'ليش تحب تنضم لنا؟' },
      { en: 'What specifically attracted you to this role?', iq: 'شنو بالضبط جذبك لهذه الوظيفة؟' },
    ],
    L3: [
      { en: 'How has your work style evolved over the past few years?', iq: 'شلون تطور أسلوبك بالشغل خلال السنوات الأخيرة؟' },
      { en: 'What is the most important lesson you learned early in your career?', iq: 'شنو أهم درس تعلمته ببداية مسيرتك؟' },
      { en: 'What type of work environment brings out your best performance?', iq: 'أي نوع بيئة شغل تطلع أحسن أداء منك؟' },
      { en: 'What would make you stay with us for a long time?', iq: 'شنو يخليك تبقى معنا لفترة طويلة؟' },
    ],
  },
  2: {
    L1: [
      { en: 'Tell me about a skill or task you worked on recently.', iq: 'حچيلي عن مهارة أو مهمة اشتغلت عليها مؤخراً.' },
      { en: 'How would you explain your work to someone without a technical background?', iq: 'شلون تشرح شغلك لشخص ما عنده خلفية تقنية؟' },
    ],
    L2: [
      { en: 'Tell me about a challenge you faced at work and how you communicated with others to resolve it.', iq: 'سولفلي عن تحدي واجهته بالشغل وشلون تواصلت مع غيرك لحله.' },
      { en: 'What does teamwork mean to you, and when do you prefer working independently?', iq: 'شنو يعني العمل الجماعي بالنسبة لك؟ ومتى تفضل تشتغل لحالك؟' },
      { en: 'Do you prefer working independently or as part of a team? Why?', iq: 'تفضل تشتغل لحالك ولا مع فريق؟ ليش؟' },
    ],
    L3: [
      { en: 'Describe a situation where miscommunication occurred. How did you handle it?', iq: 'صفلي موقف صار فيه سوء فهم. شلون تعاملت وياه؟' },
      { en: 'How do you adjust your communication style depending on who you\'re speaking with?', iq: 'شلون تعدل أسلوب تواصلك حسب الشخص اللي تحكي وياه؟' },
    ],
  },
  3: {
    L1: [
      { en: 'How do you prefer working within a team?', iq: 'شلون تفضل تشتغل مع الفريق؟' },
      { en: 'How do you handle time pressure?', iq: 'شلون تتعامل وي ضغط الوقت؟' },
    ],
    L2: [
      { en: 'How do you handle conflict within a team?', iq: 'شلون تتعامل مع الخلافات داخل الفريق؟' },
      { en: 'Describe a situation where you had to persuade others.', iq: 'صفلي موقف لازم تقنع فيه غيرك.' },
      { en: 'Tell me about a time you had to deal with a difficult person.', iq: 'سولفلي عن مرة لازم تتعامل وي شخص صعب.' },
    ],
    L3: [
      { en: 'How do you respond if you disagree with a decision made by your manager or colleague?', iq: 'شلون ترد لو ما توافق على قرار من مديرك أو زميلك؟' },
      { en: 'What type of behavior is unacceptable to you in a work environment?', iq: 'أي نوع سلوك ما تقبله ببيئة الشغل؟' },
      { en: 'How do you measure your personal success?', iq: 'شلون تقيس نجاحك الشخصي؟' },
    ],
  },
  4: {
    L1: [
      { en: 'What tools or software do you regularly use in your daily life or previous work?', iq: 'شنو البرامج أو الأدوات اللي تستخدمها بالشغل أو بحياتك اليومية؟' },
      { en: 'What skill have you learned in the last six months?', iq: 'شنو مهارة تعلمتها خلال آخر ستة أشهر؟' },
    ],
    L2: [
      { en: 'How do you communicate with your team remotely?', iq: 'شلون تتواصل مع فريقك عن بعد؟' },
      { en: 'What do you do when tasks or materials start piling up?', iq: 'شنو تسوي لما الشغل يتراكم؟' },
    ],
    L3: [
      { en: 'If you were required to learn a new skill within 48 hours, what would your plan be?', iq: 'لو طلبوا منك تتعلم مهارة جديدة خلال 48 ساعة، شنو راح يكون خطتك؟' },
      { en: 'Describe a situation where you improved workflow using a digital tool.', iq: 'صفلي موقف حسّنت فيه سير العمل بأداة رقمية.' },
      { en: 'How do you choose the right tool for a specific task?', iq: 'شلون تختار الأداة المناسبة لمهمة معينة؟' },
      { en: 'Tell us about something you learned on your own without being asked.', iq: 'حكيلي عن شي تعلمته لحالك بدون ما يطلبوا منك.' },
    ],
  },
  5: {
    L1: [
      { en: 'What do you do when instructions are unclear?', iq: 'شنو تسوي لما التعليمات مو واضحة؟' },
      { en: 'When work accumulates, how do you begin?', iq: 'لما الشغل يتراكم، شلون تبدأ؟' },
    ],
    L2: [
      { en: 'Describe a problem you faced in your previous job and how you handled it.', iq: 'سولفلي عن مشكلة واجهتها بعملك السابق وشلون حليتها.' },
      { en: 'Imagine you are assigned a task with unclear instructions. How would you start?', iq: 'تخيل انه كلفوك بمهمة بتعليمات مو واضحة. شلون راح تبدأ؟' },
      { en: 'You have three urgent tasks — how do you prioritize them?', iq: 'عندك ثلاث مهام عاجلة — شلون ترتبها؟' },
      { en: 'What is the first step you take when a mistake occurs?', iq: 'شنو أول خطوة تسويها لما يصير غلط؟' },
    ],
    L3: [
      { en: 'Tell me about a task you initially didn\'t know how to complete. What was the first decision you made?', iq: 'حكيلي عن مهمة ما كنت تعرف شلون تكملها. شنو كان أول قرار اتخذته؟' },
      { en: 'When you face a complex problem, what general steps do you follow?', iq: 'لما تواجه مشكلة معقدة، شنو الخطوات العامة اللي تتبعها؟' },
      { en: 'How do you handle a mistake when you discover it too late?', iq: 'شلون تتعامل مع غلط لما تكتشفه متأخر؟' },
      { en: 'What is something you wish you were better at right now, and why do you think you haven\'t reached that level yet?', iq: 'شنو شي تتمنى تكون أحسن فيه هسة، وليش تحس ما وصلت لهالمستوى؟' },
    ],
  },
};

/** Phase 1 — وصف كل Pool (للـ LLM prompt) */
export const POOL_METADATA: Record<number, { name: string; goal: string }> = {
  1: { name: 'Warm-up & Rapport', goal: 'Ice-breaking, storytelling, motivation' },
  2: { name: 'Communication & English', goal: 'Fluency, storytelling, clarity' },
  3: { name: 'Soft Skills & Collaboration', goal: 'Values, interpersonal behavior' },
  4: { name: 'Digital & Workplace Skills', goal: 'Digital readiness, self-learning' },
  5: { name: 'Problem-Solving & Thinking', goal: 'Practical thinking, prioritization' },
};

/** Phase 1 Topics — Engine يوجّه فقط، لا يفرض السؤال */
export const PHASE1_TOPICS: Record<number, string> = {
  1: 'warmup_and_self_introduction',
  2: 'communication_and_clarity',
  3: 'teamwork_and_collaboration',
  4: 'digital_skills_and_tools',
  5: 'time_management_and_problem_solving',
};

/** Phase 2 — مواضيع ديناميكية حسب بيانات المرشح الفعلية */
export const PHASE2_TOPIC_KEYS = ['skill', 'certification', 'education', 'company'] as const;

/** Phase 3 — أسئلة إنجليزية */
export const PHASE3_QUESTIONS = [
  'Tell me about a project you\'re proud of.',
  'How do you handle stress at work?',
  'What are your career goals?',
  'Describe a time you had to meet a tight deadline.',
  'How do you prioritize your tasks?',
];

/** أمثلة عراقية للـ LLM — مستخرجة من الترجمات الفعلية */
export const IRAQI_DIALECT_EXAMPLES = Object.values(POOL_QUESTIONS).flatMap((p) =>
  [...p.L1, ...p.L2, ...p.L3].map((q) => q.iq)
).join(' | ');

/**
 * الإيجنت الصوتي المستقل (WebSocket `/ws/voice-interview` + `Interview.jsx`)
 * — تعديل السلوك من هنا أو عبر المتغيرات البيئية.
 *
 * Topic memory: يتتبع `askedTopics` في `interviewState` ويقلل إعادة طرح نفس المحور (Phase 1).
 */
export const VOICE_STANDALONE_AGENT = {
  /** عناوين للواجهة/التوثيق (مثل: Topic memory / منع تكرار الأسئلة) */
  topicMemory: {
    titleEn: 'Topic memory',
    titleAr: 'ذاكرة المواضيع',
    subtitleAr: 'منع تكرار الأسئلة',
  },
} as const;

/** تشغيل ذاكرة المواضيع — الافتراضي true. عطّل: `VOICE_TOPIC_MEMORY_ENABLED=false` */
export function isVoiceTopicMemoryEnabled(): boolean {
  const v = typeof process !== 'undefined' ? process.env?.VOICE_TOPIC_MEMORY_ENABLED : undefined;
  if (v === 'false' || v === '0' || v === 'off') return false;
  return true;
}
