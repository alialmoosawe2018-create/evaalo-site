/**
 * Progressive step labels shown by <AiWorkingIndicator> while an async AI job
 * runs (Claude-style "working" checklist). These are cosmetic — the real
 * completion is signalled by the parent unmounting the indicator, so the last
 * step reads as an open-ended "finalizing" line.
 */
const STEPS = {
    cvComparison: {
        en: [
            'Reading the CV files',
            'Extracting experience & skills',
            'Matching against the role',
            'Ranking the candidates',
            'Preparing the report',
        ],
        ar: [
            'قراءة ملفات السير الذاتية',
            'استخراج الخبرات والمهارات',
            'المطابقة مع متطلبات الوظيفة',
            'ترتيب المرشحين',
            'إعداد التقرير',
        ],
        ku: [
            'خوێندنەوەی فایلەکانی CV',
            'دەرهێنانی ئەزموون و لێهاتووییەکان',
            'هاوتاکردن لەگەڵ پۆست',
            'ڕیزکردنی کاندیدەکان',
            'ئامادەکردنی ڕاپۆرت',
        ],
    },
    headHunter: {
        en: [
            'Analyzing the search criteria',
            'Scanning the candidate pool',
            'Semantic matching',
            'Ranking the results',
            'Compiling the matches',
        ],
        ar: [
            'تحليل معايير البحث',
            'مسح قاعدة المرشحين',
            'المطابقة الدلالية',
            'ترتيب النتائج',
            'تجميع المطابقات',
        ],
        ku: [
            'شیکردنەوەی مەرجەکانی گەڕان',
            'پشکنینی کۆمەڵەی کاندیدەکان',
            'هاوتاکردنی واتایی',
            'ڕیزکردنی ئەنجامەکان',
            'کۆکردنەوەی هاوتاکان',
        ],
    },
};

/** Returns the localized step list for a job kind; falls back to Arabic, then English. */
export function getAiWorkingSteps(kind, lang) {
    const group = STEPS[kind] || {};
    return group[lang] || group.ar || group.en || [];
}
