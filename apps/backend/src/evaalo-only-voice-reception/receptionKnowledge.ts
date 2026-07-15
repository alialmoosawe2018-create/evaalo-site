import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedKnowledge: string | null = null;

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

export function loadReceptionKnowledge(): string {
    if (cachedKnowledge !== null) {
        return cachedKnowledge;
    }

    const filePath = getKnowledgePath();

    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`[reception] Knowledge file not found: ${filePath}`);
            cachedKnowledge = '';
            return cachedKnowledge;
        }

        let text = fs.readFileSync(filePath, 'utf8').trim();

        if (!text) {
            console.warn(`[reception] Knowledge file is empty: ${filePath}`);
            cachedKnowledge = '';
            return cachedKnowledge;
        }

        const maxChars = getKnowledgeMaxChars();

        if (text.length > maxChars) {
            text =
                text.slice(0, maxChars).trimEnd() +
                '\n\n[Knowledge truncated for reception agent.]';
        }

        cachedKnowledge = text;
        console.info(
            `[reception] Knowledge loaded: ${filePath} (${cachedKnowledge.length} chars)`
        );

        return cachedKnowledge;
    } catch (error) {
        console.warn('[reception] Failed to load knowledge file:', error);
        cachedKnowledge = '';
        return cachedKnowledge;
    }
}

function isEnglishLanguage(language?: string): boolean {
    const normalized = (language || '').toLowerCase().trim();
    return normalized === 'en' || normalized === 'english';
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
    const knowledge = loadReceptionKnowledge();

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
