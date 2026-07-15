/**
 * خيارات شاشة «Campaign Ready» في NewInterviewSidebar.
 *
 * - التصميم المشترك (البطاقة، الإطار، التمرير، الأيقونة…) يبقى في NiCampaignOptionRow.jsx + design-styles.css.
 * - عناوين وصف كل صف (`title` / `description`) تُعرَض مترجمة في `NewInterviewSidebar`
 *   عبر مفاتيح `newCampaign_ready_*`؛ القيم هنا تبقى مرجعاً إنجليزياً وللنسخ الاحتياطي.
 * - لإضافة خيار: انسخ كامل كائن، غيّر `id` و`title` و`description` و`iconType`، ثم أضف فرعًا
 *   لـ `id` الجديد في `handleOptionClick` داخل NewInterviewSidebar.jsx.
 *
 * ألوان الثيم (`accent`, `accent2`) تُستهلَك عبر CSS variables (`--ni-c1`, `--ni-c2`)
 * — تطابق ثيم بطاقات Dashboard «Our Services» مع تمييز لكل صف.
 */
export const CAMPAIGN_OPTION_DEFAULT_ACCENT = {
    color: '#3B82F6',
    gradient: 'linear-gradient(135deg, #3B82F6 0%, #0EA5E9 50%, #06B6D4 100%)',
    accent: '#3B82F6',
    accent2: '#06B6D4',
};

/** @type {Array<{ id: string, iconType: string, title: string, description: string, color?: string, gradient?: string, accent?: string, accent2?: string }>} */
export const CAMPAIGN_READY_OPTIONS = [
    {
        id: 'start-process',
        iconType: 'rocket',
        title: 'Start Process',
        description: 'Begin a new interview process',
        color: '#3b82f6',
        gradient: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
        accent: '#3b82f6',
        accent2: '#8b5cf6',
    },
    {
        id: 'application-form',
        iconType: 'form',
        title: 'AI Screening',
        description: 'Application form and candidate submission',
        color: '#22c55e',
        gradient: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)',
        accent: '#22c55e',
        accent2: '#10b981',
    },
    {
        id: 'audio-interview',
        iconType: 'phone',
        title: 'Voice Interview',
        description: 'Voice interview with the candidate',
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
        accent: '#f59e0b',
        accent2: '#f97316',
    },
    {
        id: 'video-interview',
        iconType: 'video',
        title: 'Video Interview',
        description: 'Video interview with the candidate',
        color: '#ec4899',
        gradient: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
        accent: '#ec4899',
        accent2: '#f43f5e',
    },
];
