// ============================================
// ملف: utils/languageDetection.ts
// الوظيفة: اكتشاف اللغة من النص
// ============================================

/**
 * اكتشاف اللغة من النص
 * @param text - النص المراد اكتشاف لغته
 * @returns 'ar' للعربية أو 'en' للإنجليزية
 */
export function detectLanguage(text: string): 'ar' | 'en' {
    if (!text || !text.trim()) {
        return 'en'; // Default to English
    }

    // Check for Arabic characters (Arabic Unicode range)
    const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    
    // Count Arabic characters
    const arabicChars = (text.match(arabicPattern) || []).length;
    const totalChars = text.match(/[a-zA-Z\u0600-\u06FF]/g)?.length || 0;
    
    // If more than 30% of characters are Arabic, consider it Arabic
    if (totalChars > 0 && (arabicChars / totalChars) > 0.3) {
        return 'ar';
    }
    
    return 'en';
}
