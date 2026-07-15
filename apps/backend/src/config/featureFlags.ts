// ============================================
// ملف: config/featureFlags.ts
// الوظيفة: أعلام الميزات (feature flags) القابلة للتحكم عبر ENV.
// ============================================
//
// أتمتة LinkedIn (بحث/رسائل عبر مزوّد طرف ثالث أو n8n) محكومة بعلم واحد
// حتى يمكن إطفاؤها فوراً دون نشر كود. WhatsApp لا يخضع لهذا العلم.

function envFlag(name: string, defaultValue = false): boolean {
    const raw = (process.env[name] || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** أتمتة LinkedIn (إرسال رسائل / بحث آلي). افتراضياً معطّلة لأسباب ToS/مخاطرة. */
export function isLinkedInAutomationEnabled(): boolean {
    return envFlag('LINKEDIN_AUTOMATION_ENABLED', false);
}

/** صورة مجمّعة للأعلام تُرجَع للواجهة (لإظهار/إخفاء أزرار الأتمتة). */
export function getPublicFeatureFlags(): { linkedinAutomationEnabled: boolean } {
    return {
        linkedinAutomationEnabled: isLinkedInAutomationEnabled(),
    };
}
