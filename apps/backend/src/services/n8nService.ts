// خدمة إرسال البيانات إلى n8n للتحليل
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import {
    evaluateVoiceInterview,
    type VoiceInterviewEvalContext,
    type VoiceInterviewEvaluation,
} from './llmService.js';
import { N8N_HONEYPOT_FIELD_NAMES } from '../constants/n8nStage1.js';
import Candidate from '../models/Candidate.js';
import {
    appendStageOutboundFields,
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
    tryBuildStageOutboundBundle,
} from './stageCallbackAuth.js';
import { buildStage1ThreeBucketPayload } from './stage1N8nPayloadBuilder.js';
import { inferStage1EvaluationLanguage } from './stage1EvaluationLanguage.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';
import { findApplicationForCallback } from './candidateApplicationService.js';
import { extractTextFromCv, CvExtractionError } from './cvTextExtractor.js';
import {
    buildBlueprintSnapshot,
    getLockedBlueprintForCampaign,
} from './expertise/ensureBlueprint.js';

// الحصول على مسار المجلد الحالي
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// تحميل ملف .env من مجلد backend
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// دالة للحصول على المتغيرات (lazy loading للتأكد من القراءة الصحيحة)
const getN8NWebhookUrl = () => {
    // إعادة تحميل dotenv للتأكد
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    return process.env.N8N_WEBHOOK_URL || '';
};

// تسجيل الرابط عند التحميل
const N8N_WEBHOOK_URL = getN8NWebhookUrl();
console.log('🔗 N8N Webhook URL loaded:');
console.log(`   - N8N_WEBHOOK_URL: ${N8N_WEBHOOK_URL ? '✅ Configured' : '❌ Not configured'}`);

interface CandidateData {
    _id?: string | any;
    id?: string | any;
    full_name: string;
    email: string;
    phone: string;
    position_applied_for: string;
    years_of_experience: string;
    skills?: string[];
    languages?: string[];
    coverLetter?: string;
    status?: string;
    createdAt?: Date | string;
    files?: Array<{
        /** Person records carry `kind`; application attachments carry `type`. */
        kind?: 'cv' | 'photo' | 'certificate';
        type?: 'cv' | 'photo' | 'certificate' | 'other';
        filename: string;
        originalName: string;
        path?: string;
        mimeType: string;
        size: number;
    }>;
    [key: string]: any;
}

/** تسميات المعايير (متوافقة مع حقول الحملة / الاستمارة) */
const CRITERION_LABELS: Record<string, string> = {
    position: 'Position',
    location: 'Location',
    job: 'Job Title',
    company: 'Company',
    age: 'Age Range',
    gender: 'Gender',
    full_name: 'Full name',
    position_applied_for: 'Position applied for',
    company_applied_to: 'Company applied to',
    years_of_experience: 'Years of experience',
    current_company: 'Current company',
    highest_education_level: 'Highest education level',
    educationLevel: 'Education Level',
    experienceYears: 'Experience Years',
    salaryMin: 'Salary Min',
    salaryMax: 'Salary Max',
    salaryCurrency: 'Salary Currency',
    skills: 'Required Skills',
    languages: 'Required Languages',
    availability: 'Availability',
    certifications: 'Certifications',
};

export type N8nCriterionItem = { key: string; label: string; value: string };

/**
 * تحويل كائن معايير الحملة إلى قائمة فقط (لـ n8n: حلقات، عرض، إلخ)
 */
function criteriaObjectToList(raw: Record<string, unknown> | null | undefined): N8nCriterionItem[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const out: N8nCriterionItem[] = [];
    for (const [key, val] of Object.entries(raw)) {
        if (val === undefined || val === null) continue;
        let valueStr: string;
        if (typeof val === 'string') {
            valueStr = val.trim();
        } else if (typeof val === 'number' || typeof val === 'boolean') {
            valueStr = String(val);
        } else {
            try {
                valueStr = JSON.stringify(val);
            } catch {
                valueStr = String(val);
            }
        }
        if (!valueStr) continue;
        const label = CRITERION_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
        out.push({ key, label, value: valueStr });
    }
    return out;
}

/** مهارات المرشح كقائمة نصوص فقط */
function normalizeSkillsList(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
        .filter((s) => s.length > 0);
}

/** لغات المرشح كقائمة (يدعم [{name,level}] من الفورم) */
function normalizeLanguagesList(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object' && item !== null && 'name' in item) {
                const name = String((item as { name?: string }).name || '').trim();
                const level = String((item as { level?: string }).level || '').trim();
                if (!name && !level) return '';
                if (level) return `${name} (${level})`;
                return name;
            }
            return String(item ?? '').trim();
        })
        .filter((s) => s.length > 0);
}

/** إضافة كل مفتاح من الـ body المسطّح إلى FormData (المصفوفات والكائنات كـ JSON string) */
function appendFlatPayloadToFormData(form: FormData, data: Record<string, unknown>) {
    for (const [key, val] of Object.entries(data)) {
        if (val === undefined) continue;
        if (val === null) {
            form.append(key, '');
            continue;
        }
        if (Array.isArray(val)) {
            form.append(key, JSON.stringify(val));
            continue;
        }
        if (typeof val === 'object') {
            form.append(key, JSON.stringify(val));
            continue;
        }
        form.append(key, String(val));
    }
}

/** CV فقط لـ n8n — صورة المتقدم لا تُرسل */
function pickCvFileForN8n(files: CandidateData['files']) {
    if (!files?.length) return null;
    const byKind = files.find((f) => attachmentKind(f) === 'cv');
    if (byKind) return byKind;
    // Untagged legacy records fall back to mime sniffing — a certificate PDF is not the CV.
    return files.find((f) => attachmentKind(f) !== 'certificate' && f.mimeType === 'application/pdf') || null;
}

/**
 * Stage 1 v2 (#4): extract text from the candidate's certificate files so the
 * evaluator can weigh them as supporting evidence. PDF/DOCX/TXT are read; image
 * or scanned certificates are noted by name (OCR is out of scope for this
 * increment). Best-effort: a failing file is annotated, never thrown, so the
 * evaluation is never blocked by an unreadable certificate.
 */
/**
 * What an uploaded file actually is.
 *
 * The person's `files` label it `kind`; an application's `attachments` label it
 * `type`. Reading only `kind` silently dropped every certificate from the
 * screening payload once the payload started coming from the application — the
 * files were in the database, visible on the profile, and invisible to the
 * evaluator. The CV survived only by accident, through a "first PDF that is not
 * a certificate" fallback that also stops excluding certificates when `kind` is
 * absent, so a certificate could have been read AS the CV.
 */
export function attachmentKind(f: { kind?: unknown; type?: unknown } | null | undefined): string {
    return String((f?.kind ?? f?.type) ?? '');
}

const CERT_PER_FILE_CHARS = 6000;
const CERT_TOTAL_CHARS = 20000;
async function buildCertificatesTextForN8n(
    files: CandidateData['files']
): Promise<{ certificatesText: string; certificatesCount: number } | null> {
    const certs = (files || []).filter((f) => attachmentKind(f) === 'certificate');
    if (!certs.length) return null;
    const parts: string[] = [];
    let idx = 0;
    for (const f of certs) {
        idx += 1;
        const label = `[Certificate ${idx}: ${f.originalName || f.filename || 'certificate'}]`;
        const diskPath = (f.path || '').trim();
        if (!diskPath || !existsSync(diskPath)) {
            parts.push(`${label} (file unavailable)`);
            continue;
        }
        try {
            const buf = await readFile(diskPath);
            const text = await extractTextFromCv(buf, f.mimeType || '', f.originalName || f.filename);
            const capped =
                text.length > CERT_PER_FILE_CHARS ? text.slice(0, CERT_PER_FILE_CHARS) : text;
            parts.push(`${label}\n${capped}`);
        } catch (err) {
            const code = err instanceof CvExtractionError ? err.code : 'PARSE_FAILED';
            const note =
                code === 'UNSUPPORTED_TYPE'
                    ? '(image/unsupported certificate — content not extracted)'
                    : code === 'EMPTY_CV'
                      ? '(no readable text — likely a scanned/image certificate)'
                      : '(could not read certificate)';
            parts.push(`${label} ${note}`);
        }
    }
    let joined = parts.join('\n\n');
    if (joined.length > CERT_TOTAL_CHARS) joined = joined.slice(0, CERT_TOTAL_CHARS);
    return { certificatesText: joined, certificatesCount: certs.length };
}

async function resolveCandidateCampaignId(candidateId?: string): Promise<string> {
    if (!candidateId?.trim()) return '';
    try {
        const doc = await Candidate.findById(candidateId.trim()).select('campaignId').lean();
        return typeof doc?.campaignId === 'string' ? doc.campaignId : '';
    } catch {
        return '';
    }
}

async function resolveOutboundApplicationId(
    candidateId?: string,
    campaignId?: string
): Promise<string> {
    if (!candidateId?.trim()) return '';
    try {
        const app = await findApplicationForCallback({
            candidateId: candidateId.trim(),
            campaignId: campaignId?.trim() || undefined,
        });
        return app?.applicationId || '';
    } catch {
        return '';
    }
}

/**
 * إرسال بيانات المرشح + المعايير إلى n8n للتحليل (في webhook واحد)
 * عند إرجاع النتيجة من n8n إلى الباكند استخدم POST {API}/webhook/n8n/stage1 (تقييم كتابي فقط).
 * @param candidateData - بيانات المرشح
 * @param campaignId - معرف الحملة (اختياري) - إذا تم توفيره، سيتم جلب المعايير وإرسالها مع بيانات المرشح
 * @returns Promise<boolean> - true إذا نجح الإرسال، false إذا فشل
 */
export const sendToN8N = async (candidateData: CandidateData, campaignId?: string): Promise<boolean> => {
    // إذا لم يكن هناك n8n webhook URL، تخطي الإرسال
    const webhookUrl = getN8NWebhookUrl();
    if (!webhookUrl || webhookUrl.trim() === '') {
        console.log('⚠️ N8N_WEBHOOK_URL not configured, skipping n8n integration');
        return false;
    }

    try {
        assertStageOutboundSecurityForTrigger();

        // جلب معايير الحملة وتحويلها إلى قائمة فقط لـ n8n
        let criteriaRaw: Record<string, unknown> | null = null;
        let campaignDoc: CampaignFormContext | null = null;
        if (campaignId) {
            try {
                const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
                const campaign = await RecruitmentCampaign.findOne({ campaignId }).lean();
                if (campaign) {
                    campaignDoc = campaign as CampaignFormContext;
                    const c = campaign.criteria;
                    criteriaRaw =
                        c && typeof c === 'object' && !Array.isArray(c)
                            ? { ...(c as Record<string, unknown>) }
                            : {};
                    console.log('✅ Campaign criteria loaded (object → list for n8n)');
                } else {
                    console.log('⚠️ Campaign not found:', campaignId);
                }
            } catch (error: any) {
                console.error('❌ Error loading campaign criteria:', error.message);
            }
        }
        const criteria = criteriaObjectToList(criteriaRaw);
        
        // تحضير البيانات للإرسال
        const candidateId = candidateData._id?.toString?.() || candidateData._id || candidateData.id?.toString?.() || candidateData.id;
        const createdAt = candidateData.createdAt instanceof Date 
            ? candidateData.createdAt.toISOString() 
            : (typeof candidateData.createdAt === 'string' ? candidateData.createdAt : new Date().toISOString());
        
        // تحويل interviewDate إلى ISO string إذا كان موجوداً
        const interviewDate = candidateData.interviewDate instanceof Date
            ? candidateData.interviewDate.toISOString()
            : (typeof candidateData.interviewDate === 'string' ? candidateData.interviewDate : null);

        const cvFileMeta = pickCvFileForN8n(candidateData.files);
        const cvDiskPath = cvFileMeta?.path?.trim() || '';
        const hasCvBinary = Boolean(cvDiskPath && existsSync(cvDiskPath));
        const cvMeta = cvFileMeta
            ? {
                  storedFilename: cvFileMeta.filename,
                  originalName: cvFileMeta.originalName,
                  mimeType: cvFileMeta.mimeType,
                  size: cvFileMeta.size
              }
            : null;

        const skillsList = normalizeSkillsList(candidateData.skills);
        const languagesList = normalizeLanguagesList(candidateData.languages);

        const c = candidateData as CandidateData & Record<string, unknown>;
        const evalCtx = candidateData.evaluationContext as { evaluationLanguage?: string } | undefined;
        const evaluationLanguage =
            evalCtx?.evaluationLanguage ?? inferStage1EvaluationLanguage(c, criteriaRaw);

        /** حقول المرشح في جذر الـ body (بدون كائن candidate)؛ skills/languages/criteria كمصفوفات في نفس الجذر */
        const payload: Record<string, unknown> = {
            event: 'candidate_submitted' as const,
            evaluationSource: 'written' as const,
            stage: 1,
            evaluationLanguage,
            timestamp: new Date().toISOString(),
            campaignId: campaignId || null,
            id: candidateId,
            full_name: c.full_name || (c.fullName as string) || '',
            email: candidateData.email,
            phone: candidateData.phone,
            position_applied_for: c.position_applied_for || (c.positionAppliedFor as string) || '',
            years_of_experience: c.years_of_experience || (c.yearsOfExperience as string) || '',
            current_company: c.current_company || (c.currentCompany as string) || null,
            location: candidateData.location || null,
            highest_education_level: c.highest_education_level || (c.highestEducationLevel as string) || null,
            company_applied_to: c.company_applied_to || (c.companyAppliedTo as string) || null,
            linkedin: candidateData.linkedin || null,
            certifications: candidateData.certifications || null,
            expectedSalary: candidateData.expectedSalary || null,
            salaryMin: candidateData.salaryMin || null,
            salaryMax: candidateData.salaryMax || null,
            salaryCurrency: candidateData.salaryCurrency || 'USD',
            availability: candidateData.availability || null,
            coverLetter: candidateData.coverLetter || '',
            hearAboutUs: candidateData.hearAboutUs || null,
            status: candidateData.status || 'pending',
            interviewDate,
            createdAt,
            updatedAt:
                candidateData.updatedAt instanceof Date
                    ? candidateData.updatedAt.toISOString()
                    : typeof candidateData.updatedAt === 'string'
                      ? candidateData.updatedAt
                      : null,
            ...(cvMeta
                ? {
                      cvStoredFilename: cvMeta.storedFilename,
                      cvOriginalName: cvMeta.originalName,
                      cvMimeType: cvMeta.mimeType,
                      cvSize: cvMeta.size
                  }
                : {}),
            criteria,
            skills: skillsList,
            languages: languagesList
        };

        // Stage 1 v2 (#4): attach extracted certificate text as supporting evidence.
        // Non-fatal — never block the evaluation if a certificate can't be read.
        try {
            const certExtract = await buildCertificatesTextForN8n(candidateData.files);
            if (certExtract) {
                payload.certificatesText = certExtract.certificatesText;
                payload.certificatesCount = certExtract.certificatesCount;
            }
        } catch (err) {
            console.error(
                '⚠️ certificate text extraction failed (non-fatal):',
                (err as Error)?.message
            );
        }

        if (campaignDoc) {
            try {
                const structured = buildStage1ThreeBucketPayload(campaignDoc, c);
                Object.assign(payload, structured);
                console.log(
                    `📦 n8n stage1 structured payload v${structured.payloadSchemaVersion} | rubricItems=${structured.evaluationRubric.length} submittedFields=${structured.submittedApplication.submittedFieldIds.length}`
                );
            } catch (structErr: any) {
                console.warn('⚠️ Failed to build three-bucket payload (legacy criteria only):', structErr?.message);
            }
        }

        for (const key of N8N_HONEYPOT_FIELD_NAMES) {
            const val = c[key];
            if (val !== undefined && val !== null) {
                payload[key] = typeof val === 'string' ? val : String(val);
            }
        }

        const applicationId = await resolveOutboundApplicationId(String(candidateId || ''), campaignId || '');
        if (applicationId) {
            payload.applicationId = applicationId;
        }
        const stageBundle = tryBuildStageOutboundBundle('stage1', {
            candidateId: String(candidateId || ''),
            sessionId: '',
            campaignId: campaignId || '',
            applicationId,
        });
        appendStageOutboundFields(payload, stageBundle);

        console.log(
            hasCvBinary
                ? '📤 n8n stage1: multipart outbound (secure=' + Boolean(stageBundle) + ')'
                : '📤 n8n stage1: JSON outbound (secure=' + Boolean(stageBundle) + ')'
        );
        console.log('📋 n8n payload:', JSON.stringify(payload, null, 2));

        let response: Response;
        if (hasCvBinary && cvFileMeta) {
            const fileBuffer = await readFile(cvDiskPath);
            const mime = cvFileMeta.mimeType || 'application/pdf';
            const uploadName = cvFileMeta.originalName || cvFileMeta.filename || 'cv.pdf';
            const form = new FormData();
            /** نفس بنية JSON: كل حقل في الجذر + ملف cv */
            appendFlatPayloadToFormData(form, payload);
            form.append('cv', new Blob([fileBuffer], { type: mime }), uploadName);

            response = await fetch(webhookUrl, {
                method: 'POST',
                body: form
            });
        } else {
            response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (response.ok) {
            console.log('✅ Data sent to n8n successfully');
            return true;
        } else {
            console.error('❌ Failed to send data to n8n:', response.status, response.statusText);
            return false;
        }
    } catch (error: any) {
        if (error instanceof StageCallbackConfigurationError) {
            throw error;
        }
        // لا نريد أن يفشل حفظ البيانات إذا فشل إرسال n8n
        console.error('❌ Error sending data to n8n:', error.message);
        return false;
    }
};

/**
 * إرسال تحديث حالة المرشح إلى n8n
 * @param candidateId - معرف المرشح
 * @param status - الحالة الجديدة
 * @param aiEvaluation - تقييم AI (اختياري)
 */
export const sendStatusUpdateToN8N = async (
    candidateId: string,
    status: string,
    aiEvaluation?: any
): Promise<boolean> => {
    if (!N8N_WEBHOOK_URL || N8N_WEBHOOK_URL.trim() === '') {
        return false;
    }

    try {
        const payload = {
            event: 'candidate_status_updated',
            timestamp: new Date().toISOString(),
            candidateId,
            status,
            aiEvaluation
        };

        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log('✅ Status update sent to n8n successfully');
            return true;
        } else {
            console.error('❌ Failed to send status update to n8n:', response.status);
            return false;
        }
    } catch (error: any) {
        console.error('❌ Error sending status update to n8n:', error.message);
        return false;
    }
};

/**
 * تحويل سجل المحادثة إلى نص مقابلة كامل
 * user = رسائل المستخدم | ai agent = رسائل المساعد
 */
function formatConversationToFullTranscript(conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>): string {
    return conversationHistory
        .map((m) => {
            const label = m.role === 'user' ? 'user' : 'ai agent';
            return `${label}: ${m.content}`;
        })
        .join('\n\n');
}

/**
 * يطبّع لغة رابط المشاركة/الجلسة (التي اختارها الموظف) إلى لغة إخراج التقييم.
 * يطابق منطق Stage 1: ku/kurdish → ar، ar/arabic → ar، en/english → en.
 * @returns 'ar' | 'en' | null (null عند 'auto' أو قيمة غير معروفة → نعتمد كشف النص)
 */
function normalizeShareEvaluationLanguage(raw: unknown): 'ar' | 'en' | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (s === 'en' || s === 'english' || s.startsWith('en-')) return 'en';
    if (s === 'ar' || s === 'arabic' || s.startsWith('ar-')) return 'ar';
    if (s === 'ku' || s === 'kurdish' || s === 'ckb') return 'ar';
    return null;
}

/**
 * يكشف لغة المقابلة الفعلية من نص المحادثة (عربي مقابل لاتيني) اعتماداً على
 * رسائل المرشح (role=user) لأنها الحقيقة الأساسية لما تحدّث به. يُستخدم كخيار احتياطي
 * عندما لا تتوفّر لغة صريحة من رابط المشاركة/الجلسة.
 * @returns 'ar' | 'en' | null (null عند عدم كفاية النص للحسم)
 */
function detectTranscriptLanguage(
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): 'ar' | 'en' | null {
    const userText = conversationHistory
        .filter((m) => m.role === 'user')
        .map((m) => String(m.content || ''))
        .join(' ');
    const sample = userText.trim()
        ? userText
        : conversationHistory.map((m) => String(m.content || '')).join(' ');
    const arabic = (sample.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
    const latin = (sample.match(/[A-Za-z]/g) || []).length;
    const total = arabic + latin;
    if (total < 10) return null;
    // نص عربي غالباً يتضمّن مصطلحات إنجليزية، لذا عتبة 0.25 تكفي لاعتباره عربياً.
    return arabic / total >= 0.25 ? 'ar' : 'en';
}

export const sendVoiceTranscriptToN8N = async (payload: {
    sessionId: string;
    candidateId?: string;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    language?: string;
    /** التقييم (Communication Skills, English Fluency, Confidence Level) — يُضمّن في نفس الرسالة */
    evaluation?: { communicationSkills: number; englishFluency: number; confidenceLevel: number };
    /** المسار العام (رابط مشارَك): يُغيّر الرابط الوجهة ويُرفِق معايير الوظيفة */
    mode?: 'public';
    /** معايير الوظيفة من الحملة — تُرسل مع الترانسكريبت في المسار العام */
    jobCriteria?: Record<string, unknown>;
    /** معرّف الحملة (hex) — يُرفق مع الترانسكريبت العام */
    campaignId?: string;
    /** إعلان الوظيفة من الحملة — اختياري */
    jobAdvertisement?: string;
}): Promise<boolean> => {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    const isPublic = payload.mode === 'public';
    const publicUrl = (process.env.N8N_PUBLIC_SCREENING_WEBHOOK_URL || '').trim();
    const dedicated = (process.env.N8N_VOICE_TRANSCRIPT_WEBHOOK_URL || '').trim();
    const mainUrl = (getN8NWebhookUrl() || '').trim();
    // المسار العام: N8N_PUBLIC_SCREENING_WEBHOOK_URL ثم fallback إلى الرابط الصوتي ثم الرئيسي.
    const voiceWebhookUrl = (isPublic ? publicUrl : '') || dedicated || mainUrl;
    /** رد التحليل الصوتي من n8n يجب أن يُرسل إلى POST {API}/webhook/n8n/stage2 (صوت فقط). */
    if (!voiceWebhookUrl) {
        console.log('⚠️ [n8n voice] no webhook configured (N8N_PUBLIC_SCREENING_WEBHOOK_URL / N8N_VOICE_TRANSCRIPT_WEBHOOK_URL / N8N_WEBHOOK_URL), skipping');
        return false;
    }
    if (!payload.conversationHistory?.length) {
        console.log('[VOICE TRANSCRIPT] No conversation to send');
        return false;
    }
    try {
        assertStageOutboundSecurityForTrigger();
        const fullTranscript = formatConversationToFullTranscript(payload.conversationHistory);
        const candidateId = payload.candidateId?.trim() || '';
        const campaignId =
            payload.campaignId?.trim() || (await resolveCandidateCampaignId(candidateId));
        // Stage 2: لغة رابط المشاركة/الجلسة فقط — لا كشف من الترانسكريpt (مختلط عربي/إنجليزي).
        const shareLanguage = normalizeShareEvaluationLanguage(payload.language);
        const effectiveLanguage = shareLanguage ?? 'ar';
        const body: Record<string, unknown> = {
            event: 'voice_interview_transcript',
            evaluationSource: 'voice' as const,
            stage: 2,
            timestamp: new Date().toISOString(),
            sessionId: payload.sessionId,
            candidateId: payload.candidateId || null,
            language: effectiveLanguage,
            fullTranscript,
            messageCount: payload.conversationHistory.length,
        };
        const evaluation = payload.evaluation ?? {
            communicationSkills: 5,
            englishFluency: 0,
            confidenceLevel: 5,
        };
        body.evaluation = evaluation;
        if (campaignId) {
            body.campaignId = campaignId;
        }
        if (isPublic) {
            body.source = 'public_screening';
        }
        if (payload.jobCriteria && Object.keys(payload.jobCriteria).length > 0) {
            body.jobCriteria = payload.jobCriteria;
            const criteriaList = criteriaObjectToList(payload.jobCriteria);
            if (criteriaList.length > 0) {
                body.criteria = criteriaList;
            }
        }
        if (payload.jobAdvertisement?.trim()) {
            body.jobAdvertisement = payload.jobAdvertisement.trim();
        }
        const applicationId = await resolveOutboundApplicationId(candidateId, campaignId);
        if (applicationId) body.applicationId = applicationId;
        const stageBundle = tryBuildStageOutboundBundle('stage2', {
            candidateId,
            sessionId: payload.sessionId,
            campaignId,
            applicationId,
        });
        appendStageOutboundFields(body, stageBundle);
        console.log(
            `[n8n voice] payload | mode=${isPublic ? 'public' : 'screening'} campaignId=${String(body.campaignId || '')} criteria=${payload.jobCriteria ? Object.keys(payload.jobCriteria).length : 0} metrics=${JSON.stringify(evaluation)} transcriptChars=${String(body.fullTranscript || '').length}`
        );
        const jsonBody = JSON.stringify(body);
        const post = (url: string) =>
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: jsonBody,
            });

        let response = await post(voiceWebhookUrl);
        let usedUrl = voiceWebhookUrl;
        const fb = String(process.env.N8N_VOICE_WEBHOOK_404_FALLBACK || '').trim().toLowerCase();
        const fallbackOn404 = fb === 'true' || fb === '1';
        if (
            !response.ok &&
            response.status === 404 &&
            fallbackOn404 &&
            dedicated &&
            mainUrl &&
            dedicated !== mainUrl
        ) {
            console.warn(
                '[n8n voice] 404 on voice webhook — retrying N8N_WEBHOOK_URL (N8N_VOICE_WEBHOOK_404_FALLBACK)'
            );
            response = await post(mainUrl);
            usedUrl = mainUrl;
        }

        if (response.ok) {
            const pathHint = (() => {
                try {
                    return new URL(usedUrl).pathname;
                } catch {
                    return '(bad URL)';
                }
            })();
            console.log(
                `✅ [n8n voice] OK ${payload.conversationHistory.length} exchanges -> ${pathHint}${dedicated && usedUrl === dedicated ? ' [voice webhook]' : ' [N8N_WEBHOOK_URL — fallback or single URL]'}`
            );
            return true;
        }
        let urlHint = '';
        try {
            const u = new URL(usedUrl);
            urlHint = `${u.origin}${u.pathname}`;
        } catch {
            urlHint = '(invalid URL)';
        }
        console.error('❌ Failed to send voice transcript to n8n:', response.status, response.statusText);
        if (response.status === 404) {
            console.error(
                '   404: في n8n — workflow ترانسكريبت: Active، Production URL من عقدة Webhook (ليس Test). أو N8N_VOICE_WEBHOOK_404_FALLBACK=true مؤقتاً لإرسال إلى N8N_WEBHOOK_URL.'
            );
            console.error('   URL used:', urlHint);
        }
        return false;
    } catch (error: unknown) {
        if (error instanceof StageCallbackConfigurationError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error('❌ Error sending voice transcript to n8n:', message);
        return false;
    }
};

// تم حذف sendVoiceEvaluationToN8N — التقييم يُضمّن الآن في نفس رسالة الترانسكريبت

export const sendVideoTranscriptToN8N = async (payload: {
    sessionId: string;
    candidateId?: string;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    language?: string;
    /** المسار العام (رابط مشارَك): يُغيّر الرابط الوجهة */
    mode?: 'public';
    /** معايير الوظيفة (Snapshot من الحملة أو الجلسة) */
    jobCriteria?: Record<string, unknown>;
    /** لقطة Interview Blueprint وقت بدء المقابلة — لقياس competencyScores في n8n Stage 3 */
    blueprintSnapshot?: Record<string, unknown>;
    /** campaignId — يُضمّن في payload الموحّد */
    campaignId?: string;
}): Promise<boolean> => {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    const isPublic = payload.mode === 'public';
    const publicUrl = (process.env.N8N_PUBLIC_VIDEO_SCREENING_WEBHOOK_URL || '').trim();
    const dedicated = (process.env.N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL || '').trim();
    const mainUrl = (getN8NWebhookUrl() || '').trim();
    // المسار العام: N8N_PUBLIC_VIDEO_SCREENING_WEBHOOK_URL ثم fallback إلى رابط الفيديو ثم الرئيسي.
    const videoWebhookUrl = (isPublic ? publicUrl : '') || dedicated || mainUrl;
    if (!videoWebhookUrl) {
        console.log('⚠️ [n8n video] no webhook configured (N8N_PUBLIC_VIDEO_SCREENING_WEBHOOK_URL / N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL / N8N_WEBHOOK_URL), skipping');
        return false;
    }
    if (!payload.conversationHistory?.length) {
        console.log('[VIDEO TRANSCRIPT] No conversation to send');
        return false;
    }
    try {
        assertStageOutboundSecurityForTrigger();
        const fullTranscript = formatConversationToFullTranscript(payload.conversationHistory);
        const candidateId = payload.candidateId?.trim() || '';
        const campaignId =
            payload.campaignId?.trim() || (await resolveCandidateCampaignId(candidateId));
        // Stage 3: share-link language only (same as Stage 1/2 — no transcript auto-detect / auto).
        const shareLanguage = normalizeShareEvaluationLanguage(payload.language);
        const effectiveLanguage = shareLanguage ?? 'ar';

        // /prepare + /start reuse never persist a session, so /end often has no
        // snapshot even when the campaign's blueprint has been locked for minutes.
        // Fill it here — the last hop before n8n — whenever campaignId is known.
        let blueprintSnapshot =
            payload.blueprintSnapshot && Object.keys(payload.blueprintSnapshot).length > 0
                ? payload.blueprintSnapshot
                : undefined;
        if (!blueprintSnapshot && campaignId) {
            try {
                blueprintSnapshot = buildBlueprintSnapshot(
                    await getLockedBlueprintForCampaign(campaignId)
                );
                if (blueprintSnapshot) {
                    const n = Array.isArray(blueprintSnapshot.competencies)
                        ? blueprintSnapshot.competencies.length
                        : 0;
                    console.log(
                        `[n8n video] recovered blueprint snapshot for campaign ${campaignId} (${n} competencies)`
                    );
                }
            } catch (bpErr: unknown) {
                const message = bpErr instanceof Error ? bpErr.message : String(bpErr);
                console.warn(
                    `[n8n video] blueprint snapshot lookup failed for ${campaignId}: ${message}`
                );
            }
        }

        const body: Record<string, unknown> = {
            event: 'video_interview_transcript',
            evaluationSource: 'video' as const,
            // payload موحّد عبر كل المسارات (متوافق مع الحقول الحالية)
            interviewType: 'video',
            stage: 3,
            timestamp: new Date().toISOString(),
            sessionId: payload.sessionId,
            candidateId: payload.candidateId || null,
            campaignId: payload.campaignId || null,
            language: effectiveLanguage,
            fullTranscript,
            messageCount: payload.conversationHistory.length,
        };
        if (campaignId) {
            body.campaignId = campaignId;
        }
        if (payload.jobCriteria && Object.keys(payload.jobCriteria).length > 0) {
            body.jobCriteria = payload.jobCriteria;
        }
        if (blueprintSnapshot && Object.keys(blueprintSnapshot).length > 0) {
            body.blueprintSnapshot = blueprintSnapshot;
        }
        if (isPublic) {
            body.source = 'public_screening';
        }
        const applicationId = await resolveOutboundApplicationId(candidateId, campaignId || undefined);
        if (applicationId) body.applicationId = applicationId;
        const stageBundle = tryBuildStageOutboundBundle('stage3', {
            candidateId,
            sessionId: payload.sessionId,
            campaignId,
            applicationId,
        });
        appendStageOutboundFields(body, stageBundle);
        const competencyCount = Array.isArray(
            (body.blueprintSnapshot as { competencies?: unknown } | undefined)?.competencies
        )
            ? ((body.blueprintSnapshot as { competencies: unknown[] }).competencies.length)
            : 0;
        console.log(
            `[n8n video] payload | mode=${isPublic ? 'public' : 'screening'} campaignId=${String(body.campaignId || '')} transcriptChars=${String(body.fullTranscript || '').length} blueprintCompetencies=${competencyCount}`
        );
        const response = await fetch(videoWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (response.ok) {
            const pathHint = (() => {
                try {
                    return new URL(videoWebhookUrl).pathname;
                } catch {
                    return '(bad URL)';
                }
            })();
            console.log(`✅ [n8n video] OK ${payload.conversationHistory.length} exchanges -> ${pathHint}`);
            return true;
        }
        let urlHint = '';
        try {
            const u = new URL(videoWebhookUrl);
            urlHint = `${u.origin}${u.pathname}`;
        } catch {
            urlHint = '(invalid URL)';
        }
        console.error('❌ Failed to send video transcript to n8n:', response.status, response.statusText);
        if (response.status === 404) {
            console.error(
                '   404: تأكد أن workflow الفيديو Active وأن الرابط Production URL من عقدة Webhook.'
            );
            console.error('   URL used:', urlHint);
        }
        return false;
    } catch (error: unknown) {
        if (error instanceof StageCallbackConfigurationError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error('❌ Error sending video transcript to n8n:', message);
        return false;
    }
};

const VOICE_EVAL_FALLBACK: VoiceInterviewEvaluation = {
    communicationSkills: 5,
    englishFluency: 0,
    confidenceLevel: 5,
};

/**
 * Evaluate voice interview + send Stage 2 transcript to n8n.
 * Criteria are passed through from the voice session (website/public flow) — not re-loaded from MongoDB here.
 * When jobCriteria is absent, n8n Stage 2 uses the no-criteria branch; when present, the criteria branch.
 */
export const finalizeAndSendVoiceTranscriptToN8N = async (payload: {
    sessionId: string;
    candidateId?: string;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    language?: string;
    mode?: 'public';
    jobCriteria?: Record<string, unknown>;
    campaignId?: string;
    jobAdvertisement?: string;
    evalContext?: VoiceInterviewEvalContext;
    /** Wall-clock session length (seconds). Required for the evidence gate. */
    durationSec?: number;
    applicationId?: string | null;
}): Promise<boolean> => {
    const {
        assessVoiceInterviewEvidence,
        persistInsufficientVoiceEvidence,
    } = await import('./voiceInterviewEvidenceGate.js');

    const assessment = assessVoiceInterviewEvidence(
        payload.conversationHistory,
        payload.durationSec ?? 0
    );
    if (!assessment.ok) {
        await persistInsufficientVoiceEvidence({
            candidateId: payload.candidateId,
            applicationId: payload.applicationId,
            campaignId: payload.campaignId,
            language: payload.language,
            assessment,
            sessionId: payload.sessionId,
        });
        return false;
    }

    let evaluation = await evaluateVoiceInterview(payload.conversationHistory, payload.evalContext);
    if (!evaluation) {
        console.warn('[n8n voice] evaluateVoiceInterview returned null — using fallback metrics');
        evaluation = { ...VOICE_EVAL_FALLBACK };
    }

    return sendVoiceTranscriptToN8N({
        sessionId: payload.sessionId,
        candidateId: payload.candidateId,
        conversationHistory: payload.conversationHistory,
        language: payload.language,
        mode: payload.mode,
        evaluation,
        jobCriteria: payload.jobCriteria,
        campaignId: payload.campaignId,
        jobAdvertisement: payload.jobAdvertisement,
    });
};

// تم حذف sendRecruitmentCampaignToN8N لأنها لم تعد مستخدمة
// الآن المعايير تُحفظ في قاعدة البيانات ويتم إرسالها مع بيانات المرشح في webhook واحد عبر sendToN8N


















