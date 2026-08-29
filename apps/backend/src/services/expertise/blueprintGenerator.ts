// ============================================
// ملف: services/expertise/blueprintGenerator.ts
// الوظيفة: توليد JobExpertiseProfile + InterviewBlueprint بالذكاء لأي وظيفة.
//   - يستنتج المجال/التخصص عبر domainTaxonomy.
//   - يستخدم حزمة عميقة (domainPacks) إن وُجدت مع التخصيص، وإلا يولّد من الوصف/المعايير.
//   - لا يسقط لأسئلة عامة؛ عند فشل LLM يرجع لمحتوى الحزمة/التصنيف الخام (fail-soft).
// ============================================

import OpenAI from 'openai';
import {
    inferDomain,
    inferSpecialization,
    getTaxonomyLightTerminology,
    type DomainTaxonomyEntry,
} from './domainTaxonomy.js';
import {
    matchDomainPack,
    matchDomainPackByRoleKeyWithConfidence,
    matchDomainPackWithConfidence,
    getPackVersion,
    shouldUseDeepPackMatch,
    type DomainPack,
    type ExperienceTrackSpec,
    type InterviewPath,
    type PackCompetency,
    type PackMatchConfidence,
    type PackMatchResult,
} from './domainPacks.js';
import {
    buildOverlayPromptBlock,
    deriveInterviewLevel,
    resolveJobRoleFromCriteria,
    type RoleResolution,
} from '../../shared/jobCatalog/index.js';
import { buildRoleL1Profile, wordCount } from './roleL1Hints.js';

let _openai: OpenAI | null | undefined = undefined;

function getOpenAIClient(): OpenAI | null {
    if (_openai === undefined) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            console.warn('⚠️ OPENAI_API_KEY is not set — blueprint generation falls back to packs/taxonomy');
            _openai = null;
        } else {
            _openai = new OpenAI({ apiKey: key });
        }
    }
    return _openai;
}

/** كفاءة بصيغة الـBlueprint (تطابق IBlueprintCompetency). */
export interface GeneratedCompetency {
    competencyKey: string;
    title: string;
    priority: 'critical' | 'high' | 'medium';
    questionObjective: string;
    expectedEvidence: string[];
    redFlags: string[];
    scoreRubric: Record<string, string>;
    followUpRules: string[];
}

/**
 * مستوى عمق المعرفة المستخدمة فعلياً في المقابلة (مستقل عن generationSource):
 *  - deep_pack: طُوبقت حزمة عميقة (يبقى deep_pack حتى لو فشل LLM واستُخدمت الحزمة الخام).
 *  - taxonomy_generated: لا حزمة، لكن بُني Blueprint بنجاح عبر التصنيف + LLM.
 *  - fallback: لا حزمة + فشل LLM/بيانات ضعيفة → توليد خام من التصنيف.
 * ملاحظة: الرجوع الكامل لبنك JSON القديم لا Profile/Blueprint له، فلا يحمل knowledgeDepth إطلاقاً.
 */
export type KnowledgeDepth = 'deep_pack' | 'taxonomy_generated' | 'fallback';

/** مخرجات التوليد الكاملة (Profile + Blueprint) لحملة. */
export interface GeneratedExpertise {
    // حقول الProfile
    roleSummary: string;
    jobTitle: string;
    domain: string;
    specialization: string;
    seniority: string;
    environment: string;
    expertisePrompt: string;
    domainGuidance: string;
    domainPackKey?: string;
    /** مصطلحات المجال المختارة (مقصوصة) — من الحزمة العميقة إن وُجدت. */
    terminology?: string[];
    requiredSkills: string[];
    toolsAndSystems: string[];
    responsibilities: string[];
    mustAssess: string[];
    expectedEvidence: string[];
    redFlags: string[];
    qualityRisk: string[];
    // حقول الBlueprint
    language: string;
    anchorQuestions: string[];
    competencies: GeneratedCompetency[];
    // مصدر التوليد + عمق المعرفة
    generationSource: 'llm' | 'pack_fallback' | 'taxonomy_fallback' | 'taxonomy_generated';
    knowledgeDepth: KnowledgeDepth;
    /** محتوى semver — يميّز نسخة المحتوى عن حقل version الرقمي في Mongo. */
    blueprintContentVersion: string;
    packVersion?: string | null;
    generatedAt: string;
    packMatchConfidence?: PackMatchConfidence;
    /** Evaalo Job Catalog — how the title was resolved at generation time. */
    roleKey?: string | null;
    careerLevel?: string;
    managementTrack?: string;
    labelKey?: string;
    roleResolution?: {
        roleKey: string | null;
        careerLevel: string;
        managementTrack: string;
        matchSource: string;
        confidence: number;
        labelKey?: string;
    };
    /** من الحزمة العميقة — يُمرَّر للوكيل (Wave 1A+). */
    experienceTracks?: ExperienceTrackSpec[];
    interviewPaths?: InterviewPath[];
}

/** أقصى عدد مصطلحات مجال نمررها للوكيل (تجنّب إغراق التعليمات). */
const MAX_TERMINOLOGY = 18;

/** يقصّ قائمة المصطلحات إلى عدد مناسب للوكيل (10-20). */
function trimTerminology(terms?: string[]): string[] {
    if (!Array.isArray(terms)) return [];
    return terms.map((t) => String(t || '').trim()).filter(Boolean).slice(0, MAX_TERMINOLOGY);
}

const ROLE_CONTEXT_SKIP_KEYS = new Set([
    'interviewtype', 'templatetype', 'templatename', 'step', 'timestamp',
    'aicomparetop', 'aicomparetopemails', 'jobpostingid', 'jobid', 'job_id',
]);

/** يستخرج عنوان الوظيفة من المعايير (position/job). */
function extractJobTitle(criteria?: Record<string, any>): string {
    if (!criteria || typeof criteria !== 'object') return '';
    const candidates = [criteria.position, criteria.job, criteria.jobTitle, criteria.title];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
}

/** يبني نصاً موحّداً من المعايير + الإعلان للاستنتاج والتوليد. */
function buildCriteriaText(criteria?: Record<string, any>, jobAdvertisement?: string): string {
    const lines: string[] = [];
    if (criteria && typeof criteria === 'object') {
        for (const [rawKey, rawVal] of Object.entries(criteria)) {
            if (rawVal == null) continue;
            const key = String(rawKey).trim();
            if (!key || ROLE_CONTEXT_SKIP_KEYS.has(key.toLowerCase())) continue;
            let val = '';
            if (Array.isArray(rawVal)) val = rawVal.map((v) => String(v).trim()).filter(Boolean).join(', ');
            else val = String(rawVal).trim();
            if (!val) continue;
            lines.push(`- ${key}: ${val}`);
        }
    }
    const ad = (jobAdvertisement || '').trim();
    if (ad) lines.push(`\nJob advertisement:\n${ad.length > 1500 ? ad.slice(0, 1500) + '…' : ad}`);
    return lines.join('\n');
}

/** يكتشف لغة المقابلة المفضّلة (ar افتراضياً للمنتج). */
function detectLanguage(criteriaText: string): string {
    return /[\u0600-\u06FF]/.test(criteriaText) ? 'ar' : 'ar';
}

/** تعليمات صياغة anchorQuestions بالعربي — محادثة مهنية، لا ترجمة حرفية من الإنجليزية. */
const ARABIC_ANCHOR_STYLE_RULES = `
Arabic anchorQuestions style (mandatory when output language is Arabic):
- Write as a live Iraqi professional interviewer would SPEAK — warm, direct, one short sentence per question.
- Use MSA-leaning Iraqi light: "شنو"، "شلون"، "وين"، "ليش"، "هسه"، "كلش" — sparingly, not in every question.
- NEVER use translation calques from English interview templates, e.g. avoid: "صف لي"، "أخبرني عن وقت"، "حدثني عن تجربة"، "امشِني خلال"، "ما الذي تفعله عندما".
- Prefer natural openers: "شنو أهم…؟"، "شلون تتعامل وية…؟"، "اذكرلي مثال…"، "كيف سويت…؟"، "شنو استخدمت من بيانات…؟".
- Keep technical/domain terms in English or standard Arabic HR terms when natural (budget، forecast، KPI، Excel).
- Each anchor = exactly ONE spoken question with exactly ONE question mark (~12–22 words).
- FORBIDDEN in a single anchor: chaining with "وشلون… وكيف… وما الذي…" or multiple "؟".
- FORBIDDEN awkward calques: "شنو هي وظيفة صعبة"، "صف وظيفة"، "حدثني عن تجربة" — use natural Iraqi: "اذكرلي دور…"، "شلون…؟"، "شنو…؟".
- Each anchor MUST name at least one concrete domain element (field, tool, KPI, method, or equipment) specific to the role.`;

function arabicAnchorStyleSuffix(language: string): string {
    return language === 'ar' ? ARABIC_ANCHOR_STYLE_RULES : '';
}

/** يضمن سؤالاً واحداً بعلامة استفهام واحدة لكل anchor. */
function sanitizeAnchorQuestions(anchors: string[], max = 3): string[] {
    return anchors.slice(0, max).map((raw) => {
        const t = String(raw || '').trim();
        if (!t) return '';
        const idx = t.search(/[؟?]/);
        if (idx >= 0) return t.slice(0, idx + 1).trim();
        return t.endsWith('؟') || t.endsWith('?') ? t : `${t}؟`;
    }).filter(Boolean);
}

function humanizeCompetencyKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

/** anchors مخصّصة حسب التخصص عند غياب حزمة عميقة. */
function buildTaxonomyAnchors(
    jobTitle: string,
    specialization: string,
    taxonomy: DomainTaxonomyEntry,
    language: string
): string[] {
    const titleRef = jobTitle || specialization || taxonomy.label;
    const terms = getTaxonomyLightTerminology(taxonomy);
    const termA = terms[0] || 'الأدوات';
    const termB = terms[1] || 'البيانات';
    const probe = `${specialization} ${jobTitle}`.toLowerCase();

    if (language !== 'ar') {
        return [
            `What was the hardest challenge in your role as ${titleRef}, and how did you resolve it?`,
            `Describe a real example where you used ${termA} — what was the outcome?`,
            `How do you make an important decision using ${termB} or clear criteria?`,
        ];
    }
    if (/survey|مساح|quantity survey|gnss|total station/i.test(probe)) {
        return [
            `اذكرلي مشروع مسح أو رفع طبوغرافي سويته — شنو استخدمت من ${termA} وشلون ضبطت الدقة؟`,
            `شلون تتعامل وية أخطاء الإحداثيات أو فروقات الموقع — شنو الخطوات اللي تسويها؟`,
            `شنو أهم معايير الجودة أو التسليم اللي تلتزم بيها بملفات ${termB}؟`,
        ];
    }
    if (/petroleum|نفط|reservoir|مكمن|drilling|حفر|production engineer|well testing/i.test(probe)) {
        return [
            `اذكرلي بئر أو حقل اشتغلت عليه — شنو كان التحدي الفني وشلون قست النتائج؟`,
            `شلون تقرأ بيانات ${termA} أو ${termB} عشان تتخذ قرار بالموقع؟`,
            `شنو إجراءات السلامة أو التصاريح اللي تتأكد منها قبل أي عمل حرج؟`,
        ];
    }
    return [
        `شنو أصعب تحدي واجهته في دور ${titleRef}، وشلون حليته وشنو كانت النتيجة؟`,
        `اذكرلي مثال حقيقي من شغلك — شنو استخدمت من ${termA} وشنو طلع بالنهاية؟`,
        `شلون تتخذ قرار مهم بالشغل وشنو البيانات أو المعايير اللي تعتمد عليها؟`,
    ];
}

function taxonomyCompetencyToGenerated(
    key: string,
    jobTitle: string,
    specialization: string,
    language: string
): GeneratedCompetency {
    const title = humanizeCompetencyKey(key);
    const roleRef = jobTitle || specialization || (language === 'ar' ? 'هذا الدور' : 'this role');
    const questionObjective = language === 'ar'
        ? `قياس ${title} لدى المرشح في دور ${roleRef} بأمثلة حقيقية ونتائج قابلة للقياس.`
        : `Assess ${title} for ${roleRef} with concrete examples and measurable outcomes.`;
    return {
        competencyKey: key,
        title,
        priority: 'high',
        questionObjective,
        expectedEvidence: language === 'ar'
            ? ['مثال حقيقي محدد', 'خطوات/بيانات استخدمها', 'النتيجة التي تحققت']
            : ['Specific real example', 'Steps/data used', 'Measurable outcome'],
        redFlags: language === 'ar'
            ? ['إجابة عامة بلا أمثلة', 'لا يربط بنتائج']
            : ['Generic answer without examples', 'No link to outcomes'],
        scoreRubric: genericRubric(),
        followUpRules: language === 'ar'
            ? ['اطلب مثالاً محدداً بأرقام/خطوات إن بقي عاماً.']
            : ['Ask for a specific example with numbers/steps if the answer stays generic.'],
    };
}

/**
 * الطبقة 2: نسخة مختصرة من معرفة المجال تُمرَّر للوكيل (domain_guidance).
 * من الحزمة العميقة إن وُجدت، وإلا ملخّص من التصنيف الخفيف.
 */
export function buildDomainGuidance(
    pack: DomainPack | undefined,
    taxonomy: DomainTaxonomyEntry,
    specialization: string
): string {
    if (pack) {
        const terms = trimTerminology(pack.terminology);
        return terms.length
            ? `${pack.domainGuidance} Key terminology to use naturally when relevant: ${terms.join(', ')}.`
            : pack.domainGuidance;
    }
    const specs = taxonomy.commonSpecializations.slice(0, 8).join(', ');
    const comps = taxonomy.expectedCompetencies.join(', ');
    const terms = getTaxonomyLightTerminology(taxonomy);
    const termsLine = terms.length
        ? ` Key domain terms to use naturally when relevant: ${terms.join(', ')}.`
        : '';
    return [
        `Domain: ${taxonomy.label}${specialization ? ` — ${specialization}` : ''}.`,
        `Common specializations: ${specs || 'varied'}.`,
        `Probe role-specific competencies such as: ${comps}.`,
        'Ask for concrete examples, the data/steps the candidate used, the action taken, and the result.',
        'A weak answer stays generic with no specifics; a strong answer shows real, measurable experience.',
    ].join(' ') + termsLine;
}

/**
 * الطبقة 3: Prompt الخبرة الخاص بالوظيفة — يُبنى من حقول الProfile (قالب موثوق، بلا LLM إضافي).
 * يحدد كيف "يفكر" الوكيل كخبير في هذه الوظيفة، وما الإجابة القوية/الضعيفة — دون كتابة كل الأسئلة.
 */
export function generateExpertisePrompt(profile: {
    jobTitle: string;
    domain: string;
    specialization: string;
    seniority: string;
    roleSummary: string;
    requiredSkills: string[];
    toolsAndSystems: string[];
    responsibilities: string[];
    mustAssess: string[];
    expectedEvidence: string[];
    redFlags: string[];
    terminology?: string[];
}): string {
    const titleLine = profile.jobTitle
        ? `You are conducting a professional interview for the role: ${profile.jobTitle}${profile.seniority ? ` (${profile.seniority})` : ''}.`
        : 'You are conducting a professional, role-specific interview.';
    const specLine = profile.specialization
        ? `Specialization: ${profile.specialization}.`
        : '';
    const parts: string[] = [titleLine, specLine];
    if (profile.roleSummary) parts.push(`Role summary: ${profile.roleSummary}`);
    if (profile.requiredSkills.length)
        parts.push(`Focus areas / required skills: ${profile.requiredSkills.join(', ')}.`);
    if (profile.toolsAndSystems.length)
        parts.push(`Tools/systems to probe when relevant: ${profile.toolsAndSystems.join(', ')}.`);
    if (profile.responsibilities.length)
        parts.push(`Key responsibilities: ${profile.responsibilities.slice(0, 6).join('; ')}.`);
    if (profile.mustAssess.length)
        parts.push(`You MUST verify the candidate can: ${profile.mustAssess.join('; ')}.`);
    if (profile.expectedEvidence.length)
        parts.push(`A strong answer includes concrete evidence: ${profile.expectedEvidence.join(', ')}.`);
    if (profile.redFlags.length)
        parts.push(`Treat these as weak/red-flag answers: ${profile.redFlags.join('; ')}.`);
    const terms = trimTerminology(profile.terminology);
    if (terms.length)
        parts.push(`Use these domain terms naturally where relevant: ${terms.join(', ')}.`);
    parts.push(
        'Do not accept generic claims like "I have experience in this". Ask for a specific real example, the data or steps used, and the outcome. Use domain terminology naturally without showing off.'
    );
    return parts.filter(Boolean).join(' ');
}

/** تجميع تعليمات الوكيل الخمس الطبقية (يُستخدم مرجعياً/للتشخيص). */
export function assembleAgentPrompt(args: {
    globalPrompt: string;
    domainGuidance: string;
    expertisePrompt: string;
    blueprintBlock: string;
    candidateContext: string;
}): string {
    return [
        args.globalPrompt,
        args.domainGuidance ? `DOMAIN KNOWLEDGE:\n${args.domainGuidance}` : '',
        args.expertisePrompt ? `JOB EXPERTISE:\n${args.expertisePrompt}` : '',
        args.blueprintBlock ? `INTERVIEW BLUEPRINT:\n${args.blueprintBlock}` : '',
        args.candidateContext ? `CANDIDATE CONTEXT:\n${args.candidateContext}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');
}

/** مخطط JSON صارم لمخرجات LLM (Profile + Blueprint في نداء واحد). */
const GENERATION_SCHEMA = {
    type: 'object' as const,
    properties: {
        roleSummary: { type: 'string' as const },
        seniority: { type: 'string' as const },
        environment: { type: 'string' as const },
        requiredSkills: { type: 'array' as const, items: { type: 'string' as const } },
        toolsAndSystems: { type: 'array' as const, items: { type: 'string' as const } },
        responsibilities: { type: 'array' as const, items: { type: 'string' as const } },
        mustAssess: { type: 'array' as const, items: { type: 'string' as const } },
        expectedEvidence: { type: 'array' as const, items: { type: 'string' as const } },
        redFlags: { type: 'array' as const, items: { type: 'string' as const } },
        qualityRisk: { type: 'array' as const, items: { type: 'string' as const } },
        anchorQuestions: { type: 'array' as const, items: { type: 'string' as const } },
        competencies: {
            type: 'array' as const,
            items: {
                type: 'object' as const,
                properties: {
                    competencyKey: { type: 'string' as const },
                    title: { type: 'string' as const },
                    priority: { type: 'string' as const, enum: ['critical', 'high', 'medium'] },
                    questionObjective: { type: 'string' as const },
                    expectedEvidence: { type: 'array' as const, items: { type: 'string' as const } },
                    redFlags: { type: 'array' as const, items: { type: 'string' as const } },
                    scoreRubric: {
                        type: 'object' as const,
                        properties: {
                            '1': { type: 'string' as const },
                            '2': { type: 'string' as const },
                            '3': { type: 'string' as const },
                            '4': { type: 'string' as const },
                            '5': { type: 'string' as const },
                        },
                        required: ['1', '2', '3', '4', '5'],
                        additionalProperties: false,
                    },
                    followUpRules: { type: 'array' as const, items: { type: 'string' as const } },
                },
                required: [
                    'competencyKey', 'title', 'priority', 'questionObjective',
                    'expectedEvidence', 'redFlags', 'scoreRubric', 'followUpRules',
                ],
                additionalProperties: false,
            },
        },
    },
    required: [
        'roleSummary', 'seniority', 'environment', 'requiredSkills', 'toolsAndSystems',
        'responsibilities', 'mustAssess', 'expectedEvidence', 'redFlags', 'qualityRisk',
        'anchorQuestions', 'competencies',
    ],
    additionalProperties: false,
};

/** يحوّل PackCompetency إلى GeneratedCompetency (للـfallback). */
function packCompetencyToGenerated(c: PackCompetency): GeneratedCompetency {
    return {
        competencyKey: c.competencyKey,
        title: c.title,
        priority: c.priority,
        questionObjective: c.questionObjective,
        expectedEvidence: [...c.expectedEvidence],
        redFlags: [...c.redFlags],
        scoreRubric: { ...c.scoreRubric },
        followUpRules: [...c.followUpRules],
    };
}

/** rubric عام افتراضي 1..5 لكفاءة مُولّدة من التصنيف. */
function genericRubric(): Record<string, string> {
    return {
        '1': 'إجابة عامة جداً بلا أمثلة أو أدلة.',
        '2': 'مفاهيم عامة دون ربطها بتجربة حقيقية.',
        '3': 'تجربة معقولة مع بعض التفاصيل.',
        '4': 'تجربة واضحة بأمثلة وخطوات ونتائج.',
        '5': 'خبرة عميقة بحالة كاملة ونتائج قابلة للقياس.',
    };
}

/** يبني fallback من الحزمة العميقة إن وُجدت، وإلا من كفاءات التصنيف المتوقعة. */
function buildFallback(
    jobTitle: string,
    taxonomy: DomainTaxonomyEntry,
    pack: DomainPack | undefined,
    specialization: string,
    domainGuidance: string,
    language: string,
    roleKey?: string | null,
    roleDomain?: string
): GeneratedExpertise {
    if (pack) {
        const competencies = pack.competencies.map(packCompetencyToGenerated);
        return {
            roleSummary: jobTitle ? `${jobTitle} — ${pack.specialization}` : pack.specialization,
            jobTitle,
            domain: pack.domain,
            specialization: pack.specialization,
            seniority: '',
            environment: '',
            expertisePrompt: '',
            domainGuidance,
            domainPackKey: pack.packKey,
            terminology: trimTerminology(pack.terminology),
            requiredSkills: [],
            toolsAndSystems: [],
            responsibilities: [],
            mustAssess: competencies.map((c) => c.title),
            expectedEvidence: competencies.flatMap((c) => c.expectedEvidence).slice(0, 8),
            redFlags: competencies.flatMap((c) => c.redFlags).slice(0, 6),
            qualityRisk: [],
            language,
            anchorQuestions: [...pack.suggestedAnchorQuestions].slice(0, 3),
            competencies,
            generationSource: 'pack_fallback',
            // طُوبقت حزمة عميقة → المعرفة الأساسية عميقة حتى مع فشل LLM.
            knowledgeDepth: 'deep_pack',
            blueprintContentVersion: '',
            generatedAt: '',
        };
    }
    // fallback من التصنيف الخفيف (L1 — 4–5 كفاءات + مصطلحات + anchors مخصّصة per roleKey)
    const rk = String(roleKey || '').trim();
    const l1 = rk
        ? buildRoleL1Profile(
            rk,
            jobTitle,
            roleDomain || taxonomy.domain,
            specialization,
            taxonomy,
            language
        )
        : null;
    const compKeys = (l1?.competencies ?? taxonomy.expectedCompetencies).slice(0, 8);
    const competencies: GeneratedCompetency[] = compKeys.map((key) =>
        taxonomyCompetencyToGenerated(key, jobTitle, specialization, language)
    );
    const anchors = sanitizeAnchorQuestions(
        l1?.anchors ?? buildTaxonomyAnchors(jobTitle, specialization, taxonomy, language)
    );
    const terminology = l1?.terminology?.length
        ? l1.terminology
        : getTaxonomyLightTerminology(taxonomy);
    const guidance = l1?.domainGuidanceExtra
        ? `${domainGuidance} ${l1.domainGuidanceExtra}`
        : domainGuidance;
    const l1Ok = !!rk && competencies.length >= 4
        && terminology.length >= 10
        && anchors.length === 3
        && wordCount(guidance) >= 150;
    return {
        roleSummary: jobTitle || taxonomy.label,
        jobTitle,
        domain: taxonomy.domain,
        specialization,
        seniority: '',
        environment: '',
        expertisePrompt: '',
        domainGuidance: guidance,
        domainPackKey: undefined,
        terminology,
        requiredSkills: [],
        toolsAndSystems: [],
        responsibilities: [],
        mustAssess: competencies.map((c) => c.title),
        expectedEvidence: ['مثال حقيقي محدد', 'بيانات/خطوات', 'نتيجة قابلة للقياس'],
        redFlags: ['إجابات عامة بلا أمثلة'],
        qualityRisk: [],
        language,
        anchorQuestions: anchors,
        competencies,
        generationSource: l1Ok ? 'taxonomy_generated' : 'taxonomy_fallback',
        knowledgeDepth: l1Ok ? 'taxonomy_generated' : 'fallback',
        blueprintContentVersion: '',
        generatedAt: '',
    };
}

function attachRoleContext(
    result: GeneratedExpertise,
    roleResolution: RoleResolution,
    packMatch: PackMatchResult
): GeneratedExpertise {
    const careerLevel = String(roleResolution.careerLevel || result.seniority || 'mid');
    // Interview seniority can differ from the catalog level: support titles (e.g.
    // "HR Assistant") are stored at `mid` for UI reasons but must be interviewed as
    // junior so the generated competencies match the role's real (execution) scope.
    // Only the overlay uses this; the stored careerLevel/labelKey/UI stay untouched.
    const overlayLevel = deriveInterviewLevel(
        roleResolution.displayTitle || result.jobTitle,
        careerLevel,
        roleResolution.roleKey,
    );
    const overlay = buildOverlayPromptBlock(overlayLevel);
    const executiveExtra =
        roleResolution.managementTrack === 'executive'
            ? 'Executive interview overlay: probe strategy, organizational vision, stakeholder alignment, and enterprise-level trade-offs.'
            : '';
    const expertisePrompt = [result.expertisePrompt, overlay, executiveExtra]
        .filter(Boolean)
        .join('\n\n');
    const packKey = result.domainPackKey || packMatch.packKey || '';
    const deepPackActive = shouldUseDeepPackMatch(packMatch);
    const packVer =
        result.packVersion
        || (packMatch.pack && deepPackActive
            ? getPackVersion(packMatch.pack)
            : null);
    const blueprintContentVersion =
        packKey && packVer && result.knowledgeDepth === 'deep_pack'
            ? `pack-${packKey}-${packVer}`
            : `taxonomy-${result.knowledgeDepth}-1.0.0`;
    return {
        ...result,
        jobTitle: roleResolution.displayTitle || result.jobTitle,
        seniority: careerLevel,
        roleKey: roleResolution.roleKey,
        careerLevel,
        managementTrack: String(roleResolution.managementTrack || 'ic'),
        labelKey: roleResolution.labelKey,
        roleResolution: {
            roleKey: roleResolution.roleKey,
            careerLevel,
            managementTrack: String(roleResolution.managementTrack || 'ic'),
            matchSource: roleResolution.matchSource,
            confidence: roleResolution.confidence,
            labelKey: roleResolution.labelKey,
        },
        expertisePrompt,
        blueprintContentVersion,
        packVersion: packVer ?? undefined,
        generatedAt: new Date().toISOString(),
        packMatchConfidence: packMatch.confidence,
        experienceTracks:
            deepPackActive && packMatch.pack
                ? packMatch.pack.supportedExperienceTracks
                : result.experienceTracks,
        interviewPaths:
            deepPackActive && packMatch.pack
                ? packMatch.pack.interviewPaths
                : result.interviewPaths,
    };
}

function sanitizeStringArray(v: unknown, max = 12): string[] {
    if (!Array.isArray(v)) return [];
    return v
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, max);
}

/**
 * يولّد Profile + Blueprint لحملة. يستنتج المجال، يطابق حزمة عميقة إن وُجدت،
 * ثم يطلب من LLM تخصيصاً كاملاً. عند الفشل يرجع لمحتوى الحزمة/التصنيف الخام.
 */
export async function generateExpertiseAndBlueprint(campaign: {
    criteria?: Record<string, any>;
    jobAdvertisement?: string;
}): Promise<GeneratedExpertise> {
    const criteria = (campaign.criteria && typeof campaign.criteria === 'object')
        ? campaign.criteria
        : {};
    const roleResolution = resolveJobRoleFromCriteria(criteria);
    const jobTitle = roleResolution.displayTitle || extractJobTitle(criteria);
    const criteriaText = buildCriteriaText(criteria, campaign.jobAdvertisement);
    let inferenceText = `${jobTitle}\n${criteriaText}`;
    const researchDomain = String(criteria.researchDomain || '').trim();
    if (researchDomain) inferenceText += `\nResearch domain: ${researchDomain}`;

    const taxonomy = inferDomain(inferenceText);

    let packMatch: PackMatchResult;
    if (roleResolution.matchSource !== 'ambiguous_legacy' && roleResolution.roleKey) {
        packMatch = matchDomainPackByRoleKeyWithConfidence(roleResolution.roleKey);
        const titleMatch = matchDomainPackWithConfidence(inferenceText, jobTitle, taxonomy.domain);
        if (
            titleMatch.packKey
            && titleMatch.packKey !== packMatch.packKey
            && titleMatch.confidence !== 'low'
        ) {
            console.warn(
                `⚠️ blueprintGenerator: roleKey/title pack conflict roleKey=${packMatch.packKey} ` +
                    `titleMatch=${titleMatch.packKey} title=${jobTitle} ` +
                    `titleConfidence=${titleMatch.confidence} margin=${titleMatch.scoreMargin ?? 0}`
            );
        }
    } else {
        packMatch = {
            pack: null,
            packKey: null,
            confidence: 'low',
            score: 0,
            matchSource: 'none',
        };
    }
    if (!packMatch.pack) {
        const hasCatalogRoleKey =
            !!roleResolution.roleKey
            && roleResolution.matchSource !== 'ambiguous_legacy'
            && roleResolution.matchSource !== 'unknown';
        if (hasCatalogRoleKey) {
            // Catalog roleKey without a deep pack → L1 taxonomy path (skip title-only deep match).
            packMatch = {
                pack: null,
                packKey: null,
                confidence: 'low',
                score: 0,
                matchSource: 'none',
            };
        } else {
            packMatch = matchDomainPackWithConfidence(inferenceText, jobTitle, taxonomy.domain);
        }
    }
    const useDeepPack = shouldUseDeepPackMatch(packMatch);
    const pack: DomainPack | undefined = useDeepPack ? packMatch.pack ?? undefined : undefined;
    if (packMatch.confidence === 'medium' && !useDeepPack) {
        console.warn(
            `⚠️ blueprintGenerator: medium-confidence pack skipped for deep_pack pack=${packMatch.packKey} ` +
                `score=${packMatch.score} margin=${packMatch.scoreMargin ?? 0} source=${packMatch.matchSource} title=${jobTitle}`
        );
    } else if (packMatch.confidence === 'medium' && useDeepPack) {
        console.warn(
            `⚠️ blueprintGenerator: medium-confidence pack match pack=${packMatch.packKey} ` +
                `score=${packMatch.score} margin=${packMatch.scoreMargin ?? 0} source=${packMatch.matchSource} title=${jobTitle}`
        );
    }

    const specialization = pack
        ? pack.specialization
        : inferSpecialization(taxonomy, inferenceText);
    const domainGuidance = buildDomainGuidance(pack, taxonomy, specialization);
    const language = detectLanguage(inferenceText);

    const openai = getOpenAIClient();
    if (!openai) {
        const fb = buildFallback(
            jobTitle,
            taxonomy,
            pack,
            specialization,
            domainGuidance,
            language,
            roleResolution.roleKey,
            roleResolution.domain
        );
        fb.seniority = String(roleResolution.careerLevel || '');
        fb.expertisePrompt = generateExpertisePrompt({
            jobTitle: fb.jobTitle,
            domain: fb.domain,
            specialization: fb.specialization,
            seniority: String(roleResolution.careerLevel || fb.seniority),
            roleSummary: fb.roleSummary,
            requiredSkills: fb.requiredSkills,
            toolsAndSystems: fb.toolsAndSystems,
            responsibilities: fb.responsibilities,
            mustAssess: fb.mustAssess,
            expectedEvidence: fb.expectedEvidence,
            redFlags: fb.redFlags,
            terminology: fb.terminology,
        });
        return attachRoleContext(fb, roleResolution, packMatch);
    }

    try {
        const packTerminology = trimTerminology(pack?.terminology);
        const taxTerminology = getTaxonomyLightTerminology(taxonomy);
        const packHint = pack
            ? `A curated expertise pack exists for this domain. Use it as the backbone and customize to THIS job:\n` +
              `Pack domain guidance: ${pack.domainGuidance}\n` +
              `Pack competencies: ${pack.competencies.map((c) => c.title).join(', ')}\n` +
              (packTerminology.length ? `Domain terminology to use naturally: ${packTerminology.join(', ')}\n` : '') +
              `Pack anchor questions:\n${pack.suggestedAnchorQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n`
            : `No curated pack for this domain. Infer professional, role-specific competencies from the job below. ` +
              `Domain (inferred): ${taxonomy.label}. Common specializations: ${taxonomy.commonSpecializations.join(', ')}.\n` +
              `Expected competency themes: ${taxonomy.expectedCompetencies.join(', ')}.\n` +
              (taxTerminology.length ? `Light domain terminology to weave in: ${taxTerminology.join(', ')}.\n` : '');

        // Interview seniority steers which competencies to GENERATE (not just the
        // agent's runtime overlay). A support title (e.g. "HR Assistant") kept at
        // catalog `mid` for UI reasons must still generate execution-scoped
        // competencies, not the mid-level "process ownership / stakeholder
        // management / KPI ownership" that the domain themes below would otherwise
        // seed. deriveInterviewLevel downgrades such titles to junior.
        const interviewLevel = deriveInterviewLevel(
            jobTitle,
            String(roleResolution.careerLevel || 'mid'),
            roleResolution.roleKey,
        );
        const isEntryLevel =
            interviewLevel === 'intern' ||
            interviewLevel === 'graduate' ||
            interviewLevel === 'junior';
        // Per-level scope so senior/manager/executive genuinely differ (not just a
        // generic "at the X level" line). Unmapped levels fall back to the generic
        // phrasing. Entry/support has its own strong branch above.
        const SENIORITY_SCOPE: Record<string, string> = {
            mid: 'interview at the MID (individual-contributor) level: center the competencies on independent, reliable EXECUTION of the core role with sound judgment — quality and accuracy of work, problem-solving within scope, applying process, and improving their own deliverables. Do NOT assume people-management, team ownership, budget authority, or org-level strategy.',
            senior: 'interview at the SENIOR (individual-contributor expert) level: center on DEPTH of expertise and OWNERSHIP of complex/ambiguous work — driving improvements, setting standards, mentoring peers, and owning outcomes in their own area, WITHOUT necessarily managing people. Include influence and technical/functional leadership; do NOT assume direct reports or budget ownership.',
            lead: 'interview at the LEAD level: combine deep expertise with directing a small group or workstream — technical/functional leadership, coordinating others, and owning delivery of a scoped area. Not full people-management or org strategy.',
            supervisor: 'interview at the SUPERVISOR level: center on FRONT-LINE team leadership — overseeing a small team\'s day-to-day execution, scheduling and workload, on-the-job coaching, quality and adherence to process, and escalating issues. Owns the team\'s operational output, NOT budget or function-level strategy.',
            manager: 'interview at the MANAGER level: center on delivering RESULTS THROUGH A TEAM — people leadership (hiring, developing, feedback), planning and prioritization across the team, stakeholder alignment, process/target ownership, and unblocking others. Balance hands-on judgment with team outcomes; de-emphasize pure task execution.',
            head: 'interview at the HEAD-OF-FUNCTION level: center on owning an entire function or department — setting functional direction and standards, owning the function\'s targets and outcomes, leading managers or a large team, resource/budget ownership, and cross-functional influence. More strategic than a single-team manager, below enterprise executive.',
            director: 'interview at the DIRECTOR level: center on senior leadership of a large area or multiple teams — strategy and results for the domain, org design within it, budget/resource ownership, developing managers, and cross-functional leadership. De-emphasize task-level execution.',
            executive: 'interview at the EXECUTIVE level: center on STRATEGY and ORGANIZATIONAL leadership — vision and direction, org design, cross-functional and enterprise trade-offs, resource/budget ownership, and aligning stakeholders at scale. De-emphasize task-level execution entirely.',
        };
        const seniorityRule = isEntryLevel
            ? `\n- SENIORITY (entry / support role — ${jobTitle || 'this role'}): the competencies MUST be EXECUTION and SUPPORT scoped — e.g. accuracy and attention to detail, following procedures/policies, coordination and scheduling, HRIS/Excel/data-entry basics, responsiveness, and confidentiality. Do NOT generate ownership/strategy competencies (process ownership, owning KPIs/targets/results, strategic or data-driven decision ownership, "stakeholder management"): this role executes and supports, it does not own outcomes. If the domain themes below list such competencies, REPLACE them with execution-scoped ones. Prefer plain phrasing (e.g. "coordinating with colleagues and managers") over corporate jargon like "stakeholder management".`
            : `\n- SENIORITY: ${SENIORITY_SCOPE[interviewLevel] || `interview at the ${interviewLevel} level — scope competencies to what this level genuinely owns`}. Competencies at a lower level must NOT be inflated to ownership/strategy, and a higher level must NOT be reduced to routine task execution.`;
        const sys = `You are an expert technical interviewer and hiring strategist. Produce a specialized interview blueprint for ONE specific job.
Rules:
- Output language for anchorQuestions, questionObjective, expectedEvidence, redFlags, scoreRubric, followUpRules: ${language === 'ar' ? 'Arabic' : 'English'}.
- Provide EXACTLY 3 anchorQuestions (fixed core questions for all candidates of this campaign). They must be specific to the role, ask for a real example + data/steps + outcome — never generic "tell me about yourself".
- Provide 6 to 8 competencies (minimum 6). Each competency: a snake_case competencyKey, a title, priority (critical|high|medium), a questionObjective, expectedEvidence (3-6 items), redFlags (2-4 items), a scoreRubric for levels 1..5 (each a short qualitative description), and followUpRules (1-3 rules — each rule is exactly ONE short question with ONE question mark, never a compound checklist).
- requiredSkills/toolsAndSystems/responsibilities/mustAssess/expectedEvidence/redFlags/qualityRisk describe the JOB (not a candidate). Keep concise.
- Be concrete and domain-specific. Do not invent facts; derive from the job context.${seniorityRule}${arabicAnchorStyleSuffix(language)}`;

        const user = `${packHint}\nJob title: ${jobTitle || '(not explicitly provided — infer from context)'}\n\nJob context (campaign criteria + advertisement):\n${criteriaText || '(minimal — infer reasonable specifics)'}`;

        // Blueprint GENERATION model (separate from the live interview agent,
        // which stays gpt-4o-mini for latency). Default gpt-5-mini — it yields
        // more role-specific, seniority-scoped competencies (verified live); the
        // trade-off is ~60s generation + a big token budget, acceptable because
        // generation is a one-off OFFLINE call. Switch back with
        // BLUEPRINT_LLM_MODEL=gpt-4o-mini (~5s, still good). Reasoning models
        // (gpt-5 / o-series) reject a custom temperature and use
        // max_completion_tokens; a large budget (BLUEPRINT_LLM_MAX_TOKENS, default
        // 16000) keeps reasoning tokens from starving the JSON output (at 2200 it
        // returns empty).
        const genModel = (process.env.BLUEPRINT_LLM_MODEL || 'gpt-5-mini').trim() || 'gpt-5-mini';
        const genIsReasoning = /^(gpt-5|o1|o3|o4)/i.test(genModel);
        const response = await openai.chat.completions.create({
            model: genModel,
            messages: [
                { role: 'system', content: sys },
                { role: 'user', content: user },
            ],
            ...(genIsReasoning
                ? { max_completion_tokens: Number(process.env.BLUEPRINT_LLM_MAX_TOKENS) || 16000 }
                : { temperature: 0.4, max_tokens: 2200 }),
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'interview_blueprint_generation',
                    strict: true,
                    schema: GENERATION_SCHEMA,
                },
            },
        });
        const text = response.choices[0]?.message?.content?.trim() || '';
        if (!text) throw new Error('empty LLM response');
        const parsed = JSON.parse(text) as Record<string, any>;

        const anchorQuestions = sanitizeAnchorQuestions(sanitizeStringArray(parsed.anchorQuestions, 3));
        const rawCompetencies = Array.isArray(parsed.competencies) ? parsed.competencies : [];
        const competencies: GeneratedCompetency[] = rawCompetencies
            .slice(0, 8)
            .map((c: any): GeneratedCompetency => ({
                competencyKey: String(c.competencyKey || '').trim() || 'competency',
                title: String(c.title || '').trim() || 'Competency',
                priority: ['critical', 'high', 'medium'].includes(c.priority) ? c.priority : 'high',
                questionObjective: String(c.questionObjective || '').trim(),
                expectedEvidence: sanitizeStringArray(c.expectedEvidence, 8),
                redFlags: sanitizeStringArray(c.redFlags, 6),
                scoreRubric:
                    c.scoreRubric && typeof c.scoreRubric === 'object'
                        ? {
                              '1': String(c.scoreRubric['1'] || ''),
                              '2': String(c.scoreRubric['2'] || ''),
                              '3': String(c.scoreRubric['3'] || ''),
                              '4': String(c.scoreRubric['4'] || ''),
                              '5': String(c.scoreRubric['5'] || ''),
                          }
                        : genericRubric(),
                followUpRules: sanitizeStringArray(c.followUpRules, 4),
            }));

        // إن أعاد LLM مخرجات ناقصة جوهرياً، ارجع للـfallback.
        if (anchorQuestions.length < 3 || competencies.length < 6) {
            console.warn('⚠️ blueprintGenerator: LLM output incomplete — using fallback');
            const fb = buildFallback(
                jobTitle,
                taxonomy,
                pack,
                specialization,
                domainGuidance,
                language,
                roleResolution.roleKey,
                roleResolution.domain
            );
            fb.expertisePrompt = generateExpertisePrompt({
                jobTitle: fb.jobTitle,
                domain: fb.domain,
                specialization: fb.specialization,
                seniority: String(roleResolution.careerLevel || ''),
                roleSummary: fb.roleSummary,
                requiredSkills: fb.requiredSkills,
                toolsAndSystems: fb.toolsAndSystems,
                responsibilities: fb.responsibilities,
                mustAssess: fb.mustAssess,
                expectedEvidence: fb.expectedEvidence,
                redFlags: fb.redFlags,
                terminology: fb.terminology,
            });
            return attachRoleContext(fb, roleResolution, packMatch);
        }

        const requiredSkills = sanitizeStringArray(parsed.requiredSkills);
        const toolsAndSystems = sanitizeStringArray(parsed.toolsAndSystems);
        const responsibilities = sanitizeStringArray(parsed.responsibilities);
        const mustAssess = sanitizeStringArray(parsed.mustAssess);
        const expectedEvidence = sanitizeStringArray(parsed.expectedEvidence);
        const redFlags = sanitizeStringArray(parsed.redFlags);
        const qualityRisk = sanitizeStringArray(parsed.qualityRisk);
        const roleSummary = String(parsed.roleSummary || '').trim() || (jobTitle || taxonomy.label);
        const seniority = String(roleResolution.careerLevel || parsed.seniority || '').trim();
        const environment = String(parsed.environment || '').trim();

        const terminology = pack
            ? trimTerminology(pack.terminology)
            : getTaxonomyLightTerminology(taxonomy);
        const expertisePrompt = generateExpertisePrompt({
            jobTitle,
            domain: pack ? pack.domain : taxonomy.domain,
            specialization,
            seniority,
            roleSummary,
            requiredSkills,
            toolsAndSystems,
            responsibilities,
            mustAssess,
            expectedEvidence,
            redFlags,
            terminology,
        });

        return attachRoleContext(
            {
                roleSummary,
                jobTitle,
                domain: pack ? pack.domain : taxonomy.domain,
                specialization,
                seniority,
                environment,
                expertisePrompt,
                domainGuidance,
                domainPackKey: pack?.packKey,
                terminology,
                requiredSkills,
                toolsAndSystems,
                responsibilities,
                mustAssess,
                expectedEvidence,
                redFlags,
                qualityRisk,
                language,
                anchorQuestions,
                competencies,
                generationSource: 'llm',
                knowledgeDepth: pack ? 'deep_pack' : 'taxonomy_generated',
                blueprintContentVersion: '',
                generatedAt: '',
            },
            roleResolution,
            packMatch
        );
    } catch (err: any) {
        console.error('❌ blueprintGenerator: LLM generation failed — using fallback:', err?.message || err);
        const fb = buildFallback(
            jobTitle,
            taxonomy,
            pack,
            specialization,
            domainGuidance,
            language,
            roleResolution.roleKey,
            roleResolution.domain
        );
        fb.expertisePrompt = generateExpertisePrompt({
            jobTitle: fb.jobTitle,
            domain: fb.domain,
            specialization: fb.specialization,
            seniority: String(roleResolution.careerLevel || fb.seniority),
            roleSummary: fb.roleSummary,
            requiredSkills: fb.requiredSkills,
            toolsAndSystems: fb.toolsAndSystems,
            responsibilities: fb.responsibilities,
            mustAssess: fb.mustAssess,
            expectedEvidence: fb.expectedEvidence,
            redFlags: fb.redFlags,
            terminology: fb.terminology,
        });
        return attachRoleContext(fb, roleResolution, packMatch);
    }
}
