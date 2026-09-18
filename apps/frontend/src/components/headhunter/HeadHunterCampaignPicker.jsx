import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { resolveTitleFromMeta } from '../../utils/screeningCampaigns.js';
import { localizeCatalogLabel } from '../../utils/localizeCatalogLabel.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';

/**
 * يختار حملة التوظيف التي ستُنشأ تحتها روابط مقابلة الهيد هانتر.
 *
 * 🔴 لماذا هذا المكوّن موجود أصلاً. رابط المشاركة كان يخرج بلا `campaignId`،
 * فيملأ المرشّح الاستمارة كاملة ثمّ يُرفض بـ
 * `Validation error: Path 'organizationId' is required` — لأنّ الخادم يشتقّ
 * المؤسّسة من الحملة ولا شيء غيرها. وربطُ المشاركة بحملة حقيقية يُدخل مرشّح
 * الهيد هانتر في سلسلة Evaalo نفسها: مخطّطة ← بوّابة جاهزية ← كفاءات مثبَّتة ←
 * المرحلة الثالثة.
 *
 * ⚠️ القائمة تأتي من `/api/recruitment-campaigns/shareable`، وهي **مُحدَّدة
 * بمؤسّسة الجلسة في الخادم** عبر `orgScopedQuery`. ترشيحُ المتصفّح راحةٌ للعرض
 * لا حدٌّ أمني؛ والخادم يُعيد التحقّق من الملكية عند توليد السياق مهما أرسلت
 * الواجهة.
 *
 * ⚠️ والعنوان يُترجَم للعرض فقط. الرابط يحمل القيمة المخزَّنة الخام — انظر
 * `utils/publicVideoScreeningUrl.js`.
 */
export default function HeadHunterCampaignPicker({ onPick, onClose, t }) {
    const { currentLang } = useLanguage();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    /*
     * النقطة في الخادم بلا ذاكرة مؤقّتة عن قصد، لكنّ ذلك وحده لا يكفي: هذا
     * المكوّن كان يجلب عند التركيب فقط. والمستخدم ينشئ الوظيفة في تبويبة أخرى
     * ثمّ يعود إلى هذه — والقائمة أمامه لم تُجلب من جديد. فكان سيرى غياب
     * وظيفته ويظنّها مشكلة تخزين مؤقّت وهي ليست كذلك.
     */
    const load = useCallback(async () => {
        setRefreshing(true);
        setError('');
        try {
            const data = await apiClient.get('/api/recruitment-campaigns/shareable');
            if (data?.success && Array.isArray(data.campaigns)) {
                setRows(
                    data.campaigns.map((c) => ({
                        campaignId: c.campaignId,
                        // نفس الدالّة التي تسمّي الحملة في كل شاشة أخرى،
                        // فلا تُستحدث مرآة ثالثة لعنوان الوظيفة.
                        title: resolveTitleFromMeta(c),
                        createdAt: c.createdAt,
                    }))
                );
            } else {
                setRows([]);
                setError(t('aiHeadHunterCampaignPickerError'));
            }
        } catch {
            setRows([]);
            setError(t('aiHeadHunterCampaignPickerError'));
        } finally {
            setRefreshing(false);
        }
    }, [t]);

    useEffect(() => {
        load();
    }, [load]);

    const filtered = useMemo(() => {
        if (!rows) return [];
        const q = query.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => {
            const shown = localizeCatalogLabel(r.title, currentLang) || r.title || '';
            return shown.toLowerCase().includes(q) || (r.title || '').toLowerCase().includes(q);
        });
    }, [rows, query, currentLang]);

    return (
        <div className="headhunter-campaign-picker">
            <div className="headhunter-campaign-picker__head">
                <h3>{t('aiHeadHunterCampaignPickerTitle')}</h3>
                <p>{t('aiHeadHunterCampaignPickerHint')}</p>
            </div>

            {rows === null ? (
                <p className="headhunter-campaign-picker__state">{t('aiHeadHunterCampaignPickerLoading')}</p>
            ) : rows.length === 0 ? (
                <p className="headhunter-campaign-picker__state">
                    {error || t('aiHeadHunterCampaignPickerEmpty')}
                </p>
            ) : (
                <>
                    <input
                        type="search"
                        className="headhunter-campaign-picker__search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('aiHeadHunterCampaignPickerSearch')}
                        aria-label={t('aiHeadHunterCampaignPickerSearch')}
                    />
                    <ul className="headhunter-campaign-history-list headhunter-campaign-picker__list">
                        {filtered.map((r) => (
                            <li key={r.campaignId}>
                                <button
                                    type="button"
                                    className="headhunter-campaign-history-row"
                                    onClick={() => onPick(r)}
                                >
                                    <span className="headhunter-campaign-history-row__title">
                                        {localizeCatalogLabel(r.title, currentLang) ||
                                            r.title ||
                                            t('aiHeadHunterCampaignPickerUntitled')}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            <div className="headhunter-campaign-picker__foot">
                <button
                    type="button"
                    className="btn btn-tertiary"
                    onClick={load}
                    disabled={refreshing}
                >
                    {refreshing
                        ? t('aiHeadHunterCampaignPickerLoading')
                        : t('aiHeadHunterCampaignPickerRefresh')}
                </button>
                {/*
                  * ⚠️ الوجهة `/dashboard?open=newCampaign` — رابطٌ عميق قائم يفتح
                  * NewInterviewSidebar (Dashboard.jsx:215). و**ليست `/?open=…`**:
                  * المسار `/` هو صفحة `Home` التسويقية، لا اللوحة — أُثبت حيّاً
                  * على الإنتاج، فهبط الزرّ على صفحة «Get Started Free». وليست
                  * `/video-interview`: ذلك المسار يُحوَّل إلى `/video-evaluation`
                  * الذي يعرض **قائمة تقييمات سابقة** ولا يحوي شريط الإنشاء
                  * إطلاقاً — زرٌّ يقول «أنشئ» ويأخذك حيث لا إنشاء.
                  *
                  * وتبويبة جديدة عن قصد: التنقّل الكامل يُفقد نتائج البحث الحيّ
                  * (لا تُحفظ إلا في سجلّ البحث) ويُفقد اختيار المستخدم هنا. فبدل
                  * إصلاح رحلة العودة، لا نغادر أصلاً.
                  *
                  * ولا تُنشأ حملة من داخل هذا المكوّن: حملةٌ باسم وظيفة فقط
                  * تعني معايير شبه فارغة، و`ensureBlueprintForCampaign` ينطلق
                  * عليها فوراً فيُنتج مخطّطة ضعيفة.
                  */}
                <a
                    className="btn btn-secondary"
                    href="/dashboard?open=newCampaign"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {t('aiHeadHunterCampaignPickerCreate')}
                </a>
                <button type="button" className="btn btn-tertiary" onClick={onClose}>
                    {t('aiHeadHunterCampaignPickerCancel')}
                </button>
            </div>
        </div>
    );
}
