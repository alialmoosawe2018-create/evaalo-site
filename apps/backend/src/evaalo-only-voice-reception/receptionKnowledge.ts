import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LANG_AR = '<!-- kb-lang:ar -->';
const LANG_EN = '<!-- kb-lang:en -->';

export type ReceptionKnowledgeLang = 'ar' | 'en' | 'all';

const cache = new Map<string, string>();

function getKnowledgePath(): string {
    const customPath = (process.env.RECEPTION_KNOWLEDGE_PATH || '').trim();

    if (customPath) {
        return path.resolve(customPath);
    }

    return path.resolve(__dirname, 'data', 'evaalo_hr_knowledge.md');
}

function getKnowledgeMaxChars(): number {
    const raw = (process.env.RECEPTION_KNOWLEDGE_MAX_CHARS || '12000').trim();
    const parsed = Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed)) {
        return 12000;
    }

    return Math.max(2000, Math.min(parsed, 25000));
}

function readKnowledgeFile(): string {
    const cached = cache.get('__raw__');
    if (cached !== undefined) {
        return cached;
    }

    const filePath = getKnowledgePath();

    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`[reception] Knowledge file not found: ${filePath}`);
            cache.set('__raw__', '');
            return '';
        }

        const text = fs.readFileSync(filePath, 'utf8').trim();
        if (!text) {
            console.warn(`[reception] Knowledge file is empty: ${filePath}`);
            cache.set('__raw__', '');
            return '';
        }

        cache.set('__raw__', text);
        return text;
    } catch (error) {
        console.warn('[reception] Failed to load knowledge file:', error);
        cache.set('__raw__', '');
        return '';
    }
}

function extractLangSection(raw: string, lang: 'ar' | 'en'): string {
    const marker = lang === 'ar' ? LANG_AR : LANG_EN;
    const other = lang === 'ar' ? LANG_EN : LANG_AR;
    const start = raw.indexOf(marker);

    if (start < 0) {
        return raw.trim();
    }

    let body = raw.slice(start + marker.length);
    const next = body.indexOf(other);
    if (next >= 0) {
        body = body.slice(0, next);
    }

    return body.trim();
}

function applyMaxChars(text: string, filePath: string): string {
    const maxChars = getKnowledgeMaxChars();
    if (text.length <= maxChars) {
        return text;
    }

    console.warn(
        `[reception] Knowledge truncated: ${filePath} (${text.length} > ${maxChars} chars)`
    );
    return text.slice(0, maxChars).trimEnd() + '\n\n[Knowledge truncated for reception agent.]';
}

export function resolveReceptionKnowledgeLang(language?: string): ReceptionKnowledgeLang {
    const normalized = (language || '').toLowerCase().trim();
    if (normalized === 'all' || normalized === 'both') return 'all';
    if (normalized === 'en' || normalized === 'english') return 'en';
    if (normalized === 'ar' || normalized === 'arabic' || normalized === 'ar-iq') return 'ar';
    return 'ar';
}

export function loadReceptionKnowledge(language?: string): string {
    const mode: ReceptionKnowledgeLang =
        language === undefined || language === ''
            ? 'all'
            : resolveReceptionKnowledgeLang(language);

    const cacheKey = `kb:${mode}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) {
        return hit;
    }

    const filePath = getKnowledgePath();
    const raw = readKnowledgeFile();
    if (!raw) {
        cache.set(cacheKey, '');
        return '';
    }

    let text: string;
    if (mode === 'all') {
        const ar = extractLangSection(raw, 'ar');
        const en = extractLangSection(raw, 'en');
        text =
            ar && en && ar !== en
                ? `${ar}\n\n---\n\n${en}`
                : ar || en || raw;
    } else {
        text = extractLangSection(raw, mode);
    }

    text = applyMaxChars(text, filePath);
    cache.set(cacheKey, text);
    console.info(`[reception] Knowledge loaded (${mode}): ${filePath} (${text.length} chars)`);
    return text;
}

function isEnglishLanguage(language?: string): boolean {
    return resolveReceptionKnowledgeLang(language) === 'en';
}

const KNOWLEDGE_USAGE_RULES_EN = `KNOWLEDGE USAGE RULES:
- Use this knowledge to answer visitor questions about Evaalo.
- Summarize naturally. Never read long sections aloud.
- For voice replies, keep answers to 2–4 short sentences.
- If the visitor asks for many details, give a brief summary, then offer to connect them with the team.
- Do not read the document verbatim.
- Do not invent pricing, plans, legal guarantees, named customers, or unsupported claims.
- Never use numbers, digits, numbered lists, bullet lists, or ordinal enumeration in replies. Explain only in flowing narrative prose.`;

const KNOWLEDGE_USAGE_RULES_AR = `قواعد استخدام المعرفة:
- استخدم هذه المعرفة للإجابة عن أسئلة الزوار حول ایڤالو.
- لخّص بشكل طبيعي، ولا تقرأ أقسامًا طويلة حرفيًا.
- للردود الصوتية، اجعل الإجابة من جملتين إلى أربع جمل قصيرة.
- إذا طلب الزائر تفاصيل كثيرة، قدّم ملخصًا موجزًا ثم اعرض ربطه بالفريق المختص.
- لا تقرأ المستند حرفيًا.
- لا تخترع أسعارًا أو خططًا أو ضمانات قانونية أو عملاء بأسماء أو ادعاءات غير مدعومة.
- لا تستخدم أرقامًا أو تعدادًا أو قوائم مرقّمة في الردود؛ اشرح فقط بأسلوب سردي متصل.`;

export function appendKnowledgeToSystemPrompt(basePrompt: string, language?: string): string {
    const knowledge = loadReceptionKnowledge(language || 'ar');

    if (!knowledge) {
        return basePrompt;
    }

    const english = isEnglishLanguage(language);
    const knowledgeHeader = english
        ? 'EVAALO HR KNOWLEDGE BASE'
        : 'قاعدة معرفة ایڤالو للموارد البشرية';
    const usageRules = english ? KNOWLEDGE_USAGE_RULES_EN : KNOWLEDGE_USAGE_RULES_AR;

    return `${basePrompt}

═══════════════════════════════════════════════════════════════
${knowledgeHeader}
═══════════════════════════════════════════════════════════════
${knowledge}

${usageRules}
`;
}
