/**
 * Transcript Cleaner — STT output processing
 * معمارية النظام: STT → Transcript cleaner → Interview State Engine → ...
 */

/** إزالة الإيموجي والرموز من الـ transcript (STT أحياناً يرجعها) */
export function stripEmojisAndSymbols(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** كشف الضوضاء أو العبارات غير المفيدة */
export function isNoiseTranscript(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (/\b(click|beep)\b/.test(s)) return true;
  const exactNoise = ['you', 'ok', 'yes', 'no', 'hi', 'bye', 'mbc', 'thank you', 'thanks'];
  if (exactNoise.includes(s)) return true;
  const videoAdPhrases = [
    'share this video', 'share with your friends', 'social media', 'subscribe', 'like and share',
    'share the video', 'like comment subscribe', 'hit the bell', 'notification bell',
    'mbc 뉴스', 'mbc news', '이덕영', 'thank you for watching', 'thanks for watching',
    'thank you so much for watching', 'ご視聴ありがとうございました',
    'اشترك', 'اشتركوا', 'اشترك في القناة', 'لايك للفيديو',
  ];
  if (videoAdPhrases.some((p) => s.includes(p))) return true;
  return false;
}

/** إزالة تكرار الكلمات المتجاورة (عربي أو أجنبي) */
export function dedupeRepeats(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return text;
  const norm = (s: string) => s.replace(/[.,!?؟]/g, '').toLowerCase();
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wNorm = norm(w);
    const last = result[result.length - 1];
    const lastNorm = last ? norm(last) : '';
    if (wNorm && wNorm === lastNorm) continue;
    if (i < words.length - 1 && result.length >= 2) {
      const prev1 = result[result.length - 1];
      const prev2 = result[result.length - 2];
      const prevPairNorm = `${norm(prev2)} ${norm(prev1)}`.trim();
      const curPairNorm = `${wNorm} ${norm(words[i + 1])}`.trim();
      if (prevPairNorm && prevPairNorm === curPairNorm) {
        i++;
        continue;
      }
    }
    result.push(w);
  }
  return result.join(' ');
}

/** تطبيع للنص للمقارنة (تقليل تكرار مثل "Hello. Can" + "Hello? Can you hear me") */
export function normalizeForMerge(text: string): string {
  return text.replace(/[.?!,?]/g, '').toLowerCase().trim();
}

/** semantic end detection: نهاية جملة عند علامة ترقيم */
export function endsWithSemanticEnd(text: string): boolean {
  return /[.!?؟]\s*$/.test(text.trim());
}
