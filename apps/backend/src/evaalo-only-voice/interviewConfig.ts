/**
 * Interview Config — مصدر واحد للأسئلة والمراحل
 * يُستخدم من: llmService (prompts)، questionEngine (اختيار الأسئلة)
 */

/** الأسئلة الإلزامية — 1: أول سؤال (بداية)، 2: Microsoft Office (لاحقاً) */
export type InterviewEvaluationIntent =
  | 'communication'
  | 'clarity'
  | 'motivation'
  | 'role_fit'
  | 'confidence'
  | 'experience'
  | 'self_awareness'
  | 'work_style'
  | 'reflection'
  | 'research'
  | 'career_alignment'
  | 'commitment'
  | 'values'
  | 'growth'
  | 'learning'
  | 'practical_experience'
  | 'conflict_resolution'
  | 'emotional_intelligence'
  | 'stress_management'
  | 'prioritization'
  | 'structured_thinking'
  | 'decision_making'
  | 'integrity'
  | 'judgment'
  | 'patience'
  | 'accountability'
  | 'discipline'
  | 'professionalism'
  | 'goal_orientation'
  | 'organization'
  | 'respect'
  | 'maturity'
  | 'initiative'
  | 'application'
  | 'self_learning'
  | 'industry_awareness'
  | 'remote_work'
  | 'learning_strategy'
  | 'adaptability'
  | 'innovation'
  | 'technical_judgment'
  | 'digital_skills'
  | 'tooling'
  | 'teamwork'
  | 'collaboration'
  | 'time_management'
  | 'problem_solving'
  | 'ownership'
  | 'learning_agility'
  | 'english_fluency';

export const MANDATORY_QUESTIONS: Record<1 | 2, { en: string; iq: string; evaluates?: InterviewEvaluationIntent[] }> = {
  1: {
    en: 'Can you tell me a bit about yourself in your own words?',
    iq: 'ممكن تحچيلي شوية عن نفسك؟',
    evaluates: ['communication', 'clarity'],
  },
  2: {
    en: 'What is your level of proficiency in Microsoft Office applications, and which program do you prefer the most? Why?',
    iq: 'شنو مستواك ببرامج مايكروسوفت أوفيس، وأي برنامج تفضل أكثر؟ وليش؟',
    evaluates: ['digital_skills', 'tooling', 'clarity'],
  },
};

/** سؤال واحد — إنجليزي + عراقي */
export type BilingualQuestion = { en: string; iq: string; evaluates?: InterviewEvaluationIntent[] };

/** Phase 1 Pools — كل pool له L1, L2, L3 (أسئلة متعددة، نختار واحد) */
export const POOL_QUESTIONS: Record<number, { L1: BilingualQuestion[]; L2: BilingualQuestion[]; L3: BilingualQuestion[] }> = {
  1: {
    L1: [
      {
        en: 'Can you briefly introduce yourself and your background?',
        iq: 'ممكن تحچيلنا شويه عن نفسك؟',
        evaluates: ['communication', 'confidence'],
      },
      {
        en: 'How would you briefly describe your professional background?',
        iq: 'ممكن توضحلي باختصار خلفيتك المهنية؟',
        evaluates: ['clarity', 'communication'],
      },
      {
        en: 'Tell me briefly about your most recent experience.',
        iq: 'احچيلي شويه عن آخر تجربة عمل مريت بيها.',
        evaluates: ['communication', 'experience'],
      },
    ],
    L2: [
      {
        en: 'What motivated you to apply for this role, and what stood out to you about our company?',
        iq: 'شنو الشي اللي خلاك تقدم على هالوظيفة؟ وشنو اللي جذبك بشركتنا؟',
        evaluates: ['motivation', 'clarity'],
      },
      {
        en: 'What kind of work environment allows you to be most productive?',
        iq: 'بأي نوع من بيئات العمل تحس نفسك تبدع وتنطي أفضل أداء؟',
        evaluates: ['self_awareness', 'work_style'],
      },
      {
        en: 'What is the most important work experience that influenced your career so far?',
        iq: 'شنو أهم تجربة عمل أثرت بمسيرتك المهنية؟',
        evaluates: ['reflection', 'experience'],
      },
      {
        en: 'What specifically about our company or this role attracted you?',
        iq: 'شنو بالضبط الشي اللي جذبك لشركتنا أو لهالوظيفة؟',
        evaluates: ['motivation', 'research'],
      },
      {
        en: 'How does this role align with your next career step?',
        iq: 'شلون تشوف هالوظيفة متوافقة ويا خطوتك المهنية الجاية؟',
        evaluates: ['career_alignment'],
      },
    ],
    L3: [
      {
        en: 'If you received a better offer tomorrow, what factors would make you stay with us?',
        iq: 'إذا جاك عرض أفضل بالمستقبل، شنو الأشياء اللي تخليك تبقى ويانه؟',
        evaluates: ['commitment', 'values'],
      },
      {
        en: 'How has your work style evolved over the past few years?',
        iq: 'شلون تطور أسلوبك بالعمل خلال السنوات الأخيرة؟',
        evaluates: ['growth', 'self_awareness'],
      },
      {
        en: 'What is the most important lesson you learned early in your career?',
        iq: 'شنو أهم درس تعلمته في بداية مسيرتك المهنية؟',
        evaluates: ['learning'],
      },
      {
        en: 'What would make you stay with us for a long time?',
        iq: 'شنو يخليك تبقى ويانه لفترة طويلة؟',
        evaluates: ['commitment'],
      },
    ],
  },
  2: {
    L1: [
      {
        en: 'Tell me about a skill or task you worked on recently.',
        iq: 'احچيلي عن مهارة أو مهمة او برنامج اشتغلت عليها مؤخرًا.',
        evaluates: ['communication', 'practical_experience'],
      },
      {
        en: 'How would you explain your work to someone without a technical background?',
        iq: 'شلون تشرح شغلك لشخص ما عنده خلفية تقنية؟',
        evaluates: ['communication', 'clarity'],
      },
    ],
    L2: [
      {
        en: 'Tell me about a time you had a misunderstanding with a teammate. How did you resolve it?',
        iq: 'احچيلي عن موقف صار بيه سوء فهم ويا زميل، شلون حليته؟',
        evaluates: ['communication', 'conflict_resolution'],
      },
      {
        en: 'Describe a situation where you had to work with someone whose personality was very different from yours.',
        iq: 'وصفلي موقف اضطريت تشتغل بيه ويا شخص شخصيته تختلف عنك تماماً، شلون تعاملت وياه؟',
        evaluates: ['emotional_intelligence', 'collaboration'],
      },
      {
        en: 'Tell me about a challenge you faced at work and how you communicated with others to resolve it.',
        iq: 'سولفلي عن تحدي واجهته بالعمل وشلون گدرت تحله.',
        evaluates: ['communication', 'problem_solving'],
      },
    ],
    L3: [
      {
        en: 'Describe a situation where poor communication caused a problem. What would you do differently now?',
        iq: 'هم مريت بموقف صار بيه سوء تفاهم وسبب مشكلة، وشنو راح تسوي بشكل مختلف هسه؟',
        evaluates: ['self_awareness', 'learning'],
      },
    ],
  },
  3: {
    L1: [
      {
        en: 'How do you usually approach solving a problem?',
        iq: 'ممكن توضح شنو خطواتك؟ شلون عادة تتعامل ويا حل المشاكل؟',
        evaluates: ['problem_solving'],
      },
      {
        en: 'How do you handle time pressure?',
        iq: 'شلون تتعامل ويا ضغط الوقت؟ شنو الخطوات او الطريقة الي تتبعها؟',
        evaluates: ['stress_management', 'prioritization'],
      },
    ],
    L2: [
      {
        en: 'Tell me about a problem you faced at work and the steps you took to solve it.',
        iq: 'احچيلي عن مشكلة واجهتها بالشغل وشنو الخطوات اللي اتبعتها حتى تحلها؟',
        evaluates: ['problem_solving', 'structured_thinking'],
      },
      {
        en: 'If you noticed a colleague making a mistake that no one else saw, what would you do?',
        iq: 'لو شفت زميلك مسوي غلط محد منتبه عليه غيرك، شنو راح تسوي؟',
        evaluates: ['decision_making', 'integrity', 'judgment'],
      },
      {
        en: 'How do you handle conflict within a team?',
        iq: 'شلون تتعامل ويا الخلافات داخل الفريق؟',
        evaluates: ['conflict_resolution', 'emotional_intelligence'],
      },
      {
        en: 'Tell me about a time you had to deal with a difficult person.',
        iq: 'سولفلي عن مرة اضطريت تتعامل ويا شخص صعب.',
        evaluates: ['emotional_intelligence', 'patience'],
      },
    ],
    L3: [
      {
        en: 'Describe a situation where you made the wrong decision. What happened and what did you learn?',
        iq: 'احچيلي عن موقف اتخذت بيه قرار غلط، شنو صار وشنو تعلمت؟',
        evaluates: ['decision_making', 'accountability', 'learning'],
      },
      {
        en: 'Tell me about a time you had to handle a task you didn\'t enjoy. How did you stay motivated?',
        iq: 'احچيلي عن مرة اضطريت تسوي شغلة ما چنت تحبها، شلون حافظت على حماسك وكملتها؟',
        evaluates: ['discipline', 'professionalism'],
      },
      {
        en: 'How do you respond if you disagree with a decision made by your manager or colleague?',
        iq: 'شلون تتصرف إذا ما وافقت على قرار من مديرك أو زميلك؟',
        evaluates: ['professionalism', 'communication'],
      },
      {
        en: 'How do you measure your personal success?',
        iq: 'شلون تقيس نجاحك الشخصي؟',
        evaluates: ['self_awareness', 'goal_orientation'],
      },
    ],
  },
  4: {
    L1: [
      {
        en: 'How do you organize your daily tasks?',
        iq: 'شلون تنظم مهامك وواجباتك اليومية؟',
        evaluates: ['organization'],
      },
    ],
    L2: [
      {
        en: 'Tell me about a time you had multiple tasks with tight deadlines. How did you manage?',
        iq: 'هم صار فد يوم وانطلب منك تنجز عدة مهام بوقت ضيق، شلون تعاملت ويه الموضوع؟',
        evaluates: ['time_management', 'prioritization'],
      },
      {
        en: 'What do you do when tasks or materials start piling up?',
        iq: 'شنو تسوي لما الشغل يتراكم؟',
        evaluates: ['organization', 'stress_management'],
      },
    ],
    L3: [
      {
        en: 'Describe a time you made a mistake at work. How did you handle it?',
        iq: 'هم فد يوم ارتكبت غلط بالعمل، شصار؟ شلون تعاملت وياه؟',
        evaluates: ['ownership', 'integrity'],
      },
      {
        en: 'Have you ever disagreed with a company policy or decision? How did you handle it?',
        iq: 'هم صار فد يوم خلال العمل سياسة أو قرار معين بالشركة ما جنت موافق عليه، شلون تعاملت ويا الموضوع؟',
        evaluates: ['professionalism', 'respect', 'maturity'],
      },
      {
        en: 'What type of behavior is unacceptable to you in a work environment?',
        iq: 'شنو السلوك الي ما تتقبله ببيئة العمل؟ وليش؟',
        evaluates: ['values', 'professionalism'],
      },
    ],
  },
  5: {
    L1: [
      {
        en: 'What tools or software do you use regularly?',
        iq: 'شنو الأدوات أو البرامج اللي تستخدمها بشكل يومي؟',
        evaluates: ['digital_skills'],
      },
      {
        en: 'What skill have you learned in the last six months?',
        iq: 'شنو آخر مهارة تعلمتها خلال آخر ستة أشهر؟ وشلون استخدمتها؟',
        evaluates: ['learning', 'initiative'],
      },
    ],
    L2: [
      {
        en: 'Tell me about a skill you learned recently and how you applied it.',
        iq: 'احچيلي عن مهارة تعلمتها مؤخرًا وشلون استخدمتها؟',
        evaluates: ['learning', 'initiative'],
      },
      {
        en: 'How do you keep your technical skills up to date with the rapid changes in technology?',
        iq: 'شلون تطور مهاراتك التقنية وتواكب التطور السريع بالتكنولوجيا والذكاء الاصطناعي؟',
        evaluates: ['self_learning', 'industry_awareness'],
      },
      {
        en: 'How do you communicate with your team remotely?',
        iq: 'شلون تتواصل مع فريقك عن بعد؟',
        evaluates: ['communication', 'remote_work'],
      },
    ],
    L3: [
      {
        en: 'If you had to learn a completely new skill in 48 hours, what would your plan be?',
        iq: 'لو طلبوا منك تتعلم مهارة جديدة خلال 48 ساعة، شنو خطتك؟',
        evaluates: ['learning_strategy', 'adaptability'],
      },
      {
        en: 'Describe a situation where you improved workflow using a digital tool.',
        iq: 'وصفلي موقف حسّنت بيه سير العمل باستخدام أداة رقمية.',
        evaluates: ['innovation', 'digital_skills'],
      },
      {
        en: 'How do you choose the right tool for a specific task?',
        iq: 'شلون تختار الأداة المناسبة لمهمة معينة؟',
        evaluates: ['decision_making', 'technical_judgment'],
      },
      {
        en: 'Tell us about something you learned on your own without being asked.',
        iq: 'احچيلي عن شي تعلمته لوحدك بدون ما ينطلب منك.',
        evaluates: ['initiative', 'self_learning'],
      },
    ],
  },
};

/** Phase 1 — وصف كل Pool (للـ LLM prompt) */
export const POOL_METADATA: Record<number, { name: string; goal: string }> = {
  1: { name: 'Warm-up & Rapport', goal: 'Ice-breaking, storytelling, motivation' },
  2: { name: 'Communication & English', goal: 'Fluency, storytelling, clarity' },
  3: { name: 'Soft Skills & Collaboration', goal: 'Values, interpersonal behavior' },
  4: { name: 'Work Behavior & Ownership', goal: 'Ownership, professionalism, organization' },
  5: { name: 'Digital & Learning Skills', goal: 'Digital readiness, self-learning, adaptability' },
};

/** Phase 1 Topics — Engine يوجّه فقط، لا يفرض السؤال */
export const PHASE1_TOPICS: Record<number, string> = {
  1: 'warmup_and_self_introduction',
  2: 'communication_and_clarity',
  3: 'teamwork_and_collaboration',
  4: 'time_management_and_problem_solving',
  5: 'digital_skills_and_tools',
};

/** Phase 2 — مواضيع ديناميكية حسب بيانات المرشح الفعلية */
export const PHASE2_TOPIC_KEYS = ['skill', 'certification', 'education', 'company', 'language'] as const;

/** Phase 3 — أسئلة إنجليزية */
export const PHASE3_MAX_QUESTIONS = 5;

export const PHASE3_QUESTIONS = [
  'Can you tell us a little bit about yourself in English?',
  'What do you enjoy doing in your free time, and how does it help you recharge?',
  'Describe your favorite workspace. What makes it comfortable for you?',
  'Tell me about a project you\'re proud of.',
  'How do you handle stress at work?',
  'What are your career goals?',
  'Describe a time you had to meet a tight deadline.',
  'How do you prioritize your tasks?',
  'Tell me about a small win or achievement you had last week.',
  'Could you translate this sentence for me: \'Good communication is the key to a successful team\'?',
  'Where do you see yourself in five years?',
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
