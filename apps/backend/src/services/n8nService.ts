// خدمة إرسال البيانات إلى n8n للتحليل
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';
import { recordMetricAsync } from './siteMetricService.js';
import { readFile } from 'fs/promises';
import {
    evaluateVoiceInterview,
    type VoiceInterviewEvalContext,
    type VoiceInterviewEvaluation,
} from './llmService.js';
import type { VoiceSessionEndSummary } from '../evaalo-only-voice/voiceSessionEnd.js';
import { N8N_HONEYPOT_FIELD_NAMES } from '../constants/n8nStage1.js';
import Candidate from '../models/Candidate.js';
import {
    appendStageOutboundFields,
    assertStageOutboundSecurityForTrigger,
    StageCallbackConfigurationError,
    tryBuildStageOutboundBundle,
} from './stageCallbackAuth.js';
import { buildStage1ThreeBucketPayload } from './stage1N8nPayloadBuilder.js';
import { detectStage1TextLanguage } from './stage1EvaluationLanguage.js';
import {
    campaignCriteriaLanguage,
    resolveEvaluationLanguage,
    type EvaluationLanguage,
} from './evaluationLanguage.js';
import type { CampaignFormContext } from '../types/campaignFormContext.js';
import { findApplicationForCallback } from './candidateApplicationService.js';
import { extractTextFromCv, CvExtractionError } from './cvTextExtractor.js';
import { deriveCertificateTitle } from './certificateTitle.js';
import {
    readCertificateWithVision,
    formatVisionRead,
    CERT_VISION_MAX_PER_APPLICATION,
} from './certificateVisionReader.js';
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
 * يُسقط جنس الوظيفة من الحمولة المرسَلة إلى المُقيّم.
 *
 * `jobCriteria.gender` هو **شرط الشاغر** لا صفة المتقدّم. لكنّه كان يصل المُقيّم
 * داخل قائمة المعايير موسوماً «Gender: male»، بلا ما يميّزه عن بقيّة الحقول التي
 * تصف المرشّح — فقرأه النموذج صفةً للشخص. النتيجة في جلسة 6afff73c: مرشّحة اسمها
 * فاطمة يصفها التقييم بالمذكّر تارةً وبالمؤنّث تارةً في الفقرة نفسها.
 *
 * والحذف هو التصرّف الصحيح لا مجرّد الأسلم: المطابقة على الجنس **وزنها صفر** في
 * تسجيل المرحلة الأولى — أي أنّنا قرّرنا عمداً ألّا نُقيّم به — فإرساله إلى مُقيّم
 * لغويّ لا يضيف إشارة ويضيف احتمال ضرر. الحقل يبقى في الحملة لأغراضها الأخرى.
 */
export function stripVacancyGender(
    criteria: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    if (!criteria || typeof criteria !== 'object') return {};
    const { gender: _vacancyGender, ...rest } = criteria as Record<string, unknown>;
    return rest;
}

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

/**
 * The canonical marker. The Stage 1 prompt keys on this exact phrase — "a
 * certificate noted as 'not extracted' is an image/scan and is not evidence by
 * itself ... never cite one marked 'not extracted' as a strength" — so every
 * note that means "this file told us nothing" must contain it verbatim, or the
 * guard cannot fire.
 */
export const CERT_NOT_EXTRACTED = 'content not extracted';

/**
 * How much real content a certificate must carry to count as evidence.
 *
 * Measured, not guessed: across the 9 Stage 1 applications that carried
 * certificates, EIGHT extracted successfully and yielded 37–46 characters per
 * file — the holder's own name and an ID line, nothing else. A genuine
 * certificate's text layer runs to hundreds of characters ("This is to certify
 * that … has successfully completed …"). 40 sits an order of magnitude below
 * the real thing and above the noise.
 */
export const CERT_MIN_MEANINGFUL_CHARS = 40;

/** Lines that are pure bookkeeping: an identifier, not a qualification. */
const CERT_ID_LINE =
    /^\s*(?:cert(?:ificate)?\s*(?:id|no\.?|number|#)|serial(?:\s*(?:no\.?|number))?|ref(?:erence)?(?:\s*(?:no\.?|number))?|reg(?:istration)?\s*(?:no\.?|number)|id)\s*[:#-]?\s*\S*\s*$/i;

/**
 * What is left of a certificate once the parts that say nothing about the
 * qualification are removed: the holder's own name, identifier lines, dates and
 * punctuation.
 *
 * This exists because "extraction succeeded" and "extraction produced meaning"
 * were the same state. A design-heavy or scanned certificate keeps its title in
 * the image and leaves only a name and an ID in the text layer, so it sailed
 * past the error path and was handed to the evaluator as legitimate evidence.
 * The evaluator then did the only thing it could and reported the ID as a
 * strength — "certificates uploaded exist (Cert ID: PTTFL721)" — which tells a
 * reviewer nothing and reads as if it did.
 */
export function meaningfulCertificateChars(text: string, holderName?: string): number {
    const nameTokens = String(holderName || '')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 2);

    return text
        .split(/\r?\n/)
        .filter((line) => !CERT_ID_LINE.test(line))
        .join(' ')
        // the holder's own name is on every certificate and identifies nothing
        .split(/\s+/)
        .filter((word) => {
            const bare = word.replace(/[^\p{L}\p{N}]/gu, '');
            if (!bare) return false;
            if (nameTokens.some((t) => t.localeCompare(bare, undefined, { sensitivity: 'base' }) === 0)) return false;
            // bare identifiers and dates carry no qualification meaning
            if (/^\d+$/.test(bare)) return false;
            if (/^\p{L}{0,4}\d{3,}/u.test(bare)) return false;
            return true;
        })
        .join(' ')
        .replace(/[^\p{L}\p{N} ]/gu, '')
        .trim().length;
}

async function buildCertificatesTextForN8n(
    files: CandidateData['files'],
    holderName?: string
): Promise<{
    certificatesText: string;
    certificatesCount: number;
    /**
     * filename → what the certificate says it is. Derived here because the text
     * is already in hand: doing it at upload time would put PDF parsing on the
     * submit request, and doing it when the profile opens would read every file
     * again. Only confident matches appear — see certificateTitle.ts.
     */
    titles: Record<string, string>;
} | null> {
    const certs = (files || []).filter((f) => attachmentKind(f) === 'certificate');
    if (!certs.length) return null;
    const parts: string[] = [];
    const titles: Record<string, string> = {};
    let idx = 0;
    /** Calls attempted and titles actually recovered — logged so the cost is visible. */
    let visionReads = 0;
    let visionRecovered = 0;
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
            const title = deriveCertificateTitle(text);

            // A recognised qualification always survives: if the text names one,
            // the file carried meaning however short it is.
            if (!title && meaningfulCertificateChars(text, holderName) < CERT_MIN_MEANINGFUL_CHARS) {
                // The title is in the image. Read it there — but only here, only
                // for the files that need it, and only up to a cap. A certificate
                // with a sound text layer never reaches this branch and never
                // costs a call.
                if (visionReads < CERT_VISION_MAX_PER_APPLICATION) {
                    visionReads += 1;
                    const seen = await readCertificateWithVision(
                        buf,
                        f.mimeType || '',
                        f.originalName || f.filename
                    );
                    if (seen) {
                        visionRecovered += 1;
                        parts.push(`${label}\n${formatVisionRead(seen)}`);
                        // The profile showed the applicant's own filename for these
                        // files, for the same reason the evaluator saw nothing.
                        if (f.filename) titles[String(f.filename)] = seen.title;
                        continue;
                    }
                }
                parts.push(
                    `${label} (no readable qualification — ${CERT_NOT_EXTRACTED}; the file's text layer holds only a name and an identifier, so the title is in the image)`
                );
                continue;
            }

            const capped =
                text.length > CERT_PER_FILE_CHARS ? text.slice(0, CERT_PER_FILE_CHARS) : text;
            parts.push(`${label}\n${capped}`);
            if (title && f.filename) titles[String(f.filename)] = title;
        } catch (err) {
            const code = err instanceof CvExtractionError ? err.code : 'PARSE_FAILED';
            // Every branch carries CERT_NOT_EXTRACTED verbatim. Two of these used
            // to say "no readable text" and "could not read certificate", neither
            // of which contains the phrase the prompt actually looks for — so the
            // guard silently failed to fire on exactly the files it was written for.
            const note =
                code === 'UNSUPPORTED_TYPE'
                    ? `(image/unsupported certificate — ${CERT_NOT_EXTRACTED})`
                    : code === 'EMPTY_CV'
                      ? `(no readable text, likely a scanned/image certificate — ${CERT_NOT_EXTRACTED})`
                      : `(could not read certificate — ${CERT_NOT_EXTRACTED})`;
            parts.push(`${label} ${note}`);
        }
    }
    let joined = parts.join('\n\n');
    if (joined.length > CERT_TOTAL_CHARS) joined = joined.slice(0, CERT_TOTAL_CHARS);
    // Printed so the cost of this feature is visible in the logs rather than
    // inferred from a bill: attempts vs titles actually recovered.
    if (visionReads) {
        console.log(
            `📄 certificate vision: ${visionRecovered}/${visionReads} title(s) recovered from images`
        );
    }
    return { certificatesText: joined, certificatesCount: certs.length, titles };
}

/**
 * Store the derived titles so the profile can show what each certificate is
 * instead of the applicant's own filename repeated six times.
 *
 * Best-effort and fire-and-forget: this runs in the Stage 1 outbox worker, and a
 * failed cosmetic write must never affect whether the evaluation is dispatched.
 * Written to the person's `files` and the application's `attachments` alike —
 * they are separate copies of the same upload, and the profile may read either.
 */
async function persistCertificateTitles(
    candidateId: unknown,
    applicationId: unknown,
    titles: Record<string, string>
): Promise<void> {
    const entries = Object.entries(titles);
    if (entries.length === 0) return;
    try {
        for (const [filename, title] of entries) {
            const id = String(candidateId || '').trim();
            if (id) {
                await Candidate.updateOne(
                    { _id: id, 'files.filename': filename },
                    { $set: { 'files.$.title': title } }
                );
            }
            const appId = String(applicationId || '').trim();
            if (appId) {
                const CandidateApplication = (await import('../models/CandidateApplication.js'))
                    .default;
                await CandidateApplication.updateOne(
                    { applicationId: appId, 'attachments.filename': filename },
                    { $set: { 'attachments.$.title': title } }
                );
            }
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[certificates] could not store derived titles: ${message}`);
    }
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
const sendToN8NImpl = async (candidateData: CandidateData, campaignId?: string): Promise<boolean> => {
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
        // نفس سبب المرحلة الثانية: جنس الشاغر ليس صفةً للمتقدّم، ووزنه صفر في
        // التسجيل — فلا إشارة تُفقد بإسقاطه، ويُدفع احتمال أن يُقرأ وصفاً للشخص.
        const criteria = criteriaObjectToList(stripVacancyGender(criteriaRaw));

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
        const evaluationLanguage = resolveEvaluationLanguage({
            campaignCriteria: criteriaRaw,
            evaluationContext: evalCtx,
            detected: detectStage1TextLanguage(c),
        });

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
            const certExtract = await buildCertificatesTextForN8n(
                candidateData.files,
                candidateData.full_name
            );
            if (certExtract) {
                payload.certificatesText = certExtract.certificatesText;
                payload.certificatesCount = certExtract.certificatesCount;
                // Cosmetic and awaited only so failures are logged here; the
                // helper swallows its own errors.
                await persistCertificateTitles(
                    candidateData._id ?? candidateData.id,
                    payload.applicationId,
                    certExtract.titles
                );
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
 * زمن إرسال التقييم إلى n8n ونتيجته.
 *
 * هذه أطول خطوة في السلسلة وأقلّها ظهوراً: الإرسال غير حاجب، وفشلُه يُبتلع عمداً
 * كي لا يُسقط حفظَ المرشّح — أي أنّ تعطّل التقييم كان يمرّ صامتاً تماماً. الغلاف
 * يقيس المدّة ويسجّل ما إذا خرجت الحمولة فعلاً، دون أن يغيّر شيئاً في السلوك.
 */
export const sendToN8N = async (
    candidateData: CandidateData,
    campaignId?: string,
): Promise<boolean> => {
    const startedAt = Date.now();
    let sent = false;
    try {
        sent = await sendToN8NImpl(candidateData, campaignId);
        return sent;
    } finally {
        recordMetricAsync({
            scope: 'evaluation',
            name: 'stage1:dispatch',
            durationMs: Date.now() - startedAt,
            failed: !sent,
            outcome: sent ? 'sent' : 'not_sent',
        });
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
 * لغة تقييم المرحلة (٢/٣): الحملة أولاً، ثم رابط المشاركة، ثم كشف الترانسكريبت.
 *
 * لقطة المعايير المرافقة للجلسة قد لا تحمل اللغة (تُلتقط عند بدء المقابلة، لا عند
 * نشر الحملة)، لذا نقرأ الحملة من قاعدة البيانات عند غيابها — وإلا عاد التقييم
 * بالعربية افتراضياً على حملة إنجليزية.
 */
async function resolveStageEvaluationLanguage(opts: {
    campaignId?: string;
    criteriaSnapshot?: Record<string, unknown> | null;
    shareLanguage?: unknown;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<EvaluationLanguage> {
    let criteria: Record<string, unknown> | null = opts.criteriaSnapshot ?? null;
    if (!campaignCriteriaLanguage(criteria) && opts.campaignId?.trim()) {
        criteria = (await loadCampaignCriteriaForLanguage(opts.campaignId)) ?? criteria;
    }
    return resolveEvaluationLanguage({
        campaignCriteria: criteria,
        shareLanguage: opts.shareLanguage,
        detected: detectTranscriptLanguage(opts.conversationHistory),
    });
}

async function loadCampaignCriteriaForLanguage(
    campaignId: string
): Promise<Record<string, unknown> | null> {
    try {
        const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
        const doc = await RecruitmentCampaign.findOne({ campaignId: campaignId.trim() })
            .select('criteria.evaluationLanguage criteria.language')
            .lean();
        const criteria = (doc as { criteria?: unknown } | null)?.criteria;
        return criteria && typeof criteria === 'object' && !Array.isArray(criteria)
            ? (criteria as Record<string, unknown>)
            : null;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[n8n] campaign language lookup failed for ${campaignId}: ${message}`);
        return null;
    }
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
    /** من أنهى الجلسة وهل انتهت قبل مرحلة الإنجليزية — يقرأه مُقيّم n8n. */
    sessionEnd?: VoiceSessionEndSummary;
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
        const effectiveLanguage = await resolveStageEvaluationLanguage({
            campaignId,
            criteriaSnapshot: payload.jobCriteria,
            shareLanguage: payload.language,
            conversationHistory: payload.conversationHistory,
        });
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
            body.jobCriteria = stripVacancyGender(payload.jobCriteria);
            const criteriaList = criteriaObjectToList(body.jobCriteria as Record<string, unknown>);
            if (criteriaList.length > 0) {
                body.criteria = criteriaList;
            }
        }
        if (payload.jobAdvertisement?.trim()) {
            body.jobAdvertisement = payload.jobAdvertisement.trim();
        }
        // كيف انتهت الجلسة. `earlyEnd` وحدها هي ما يغيّر سلوك المقيّم؛ البقية
        // تشخيص يُحفظ مع التنفيذ ليُقرأ لاحقاً دون العودة إلى سجلّات الحاوية.
        if (payload.sessionEnd) {
            body.sessionEnd = payload.sessionEnd;
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
            `[n8n voice] payload | mode=${isPublic ? 'public' : 'screening'} campaignId=${String(body.campaignId || '')} lang=${effectiveLanguage} criteria=${payload.jobCriteria ? Object.keys(payload.jobCriteria).length : 0} metrics=${JSON.stringify(evaluation)} transcriptChars=${String(body.fullTranscript || '').length}` +
                (payload.sessionEnd
                    ? ` endedBy=${payload.sessionEnd.completedByServer ? 'server' : 'client'} earlyEnd=${payload.sessionEnd.earlyEnd}`
                    : '')
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
        const effectiveLanguage = await resolveStageEvaluationLanguage({
            campaignId,
            criteriaSnapshot: payload.jobCriteria,
            shareLanguage: payload.language,
            conversationHistory: payload.conversationHistory,
        });

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
            `[n8n video] payload | mode=${isPublic ? 'public' : 'screening'} campaignId=${String(body.campaignId || '')} lang=${effectiveLanguage} transcriptChars=${String(body.fullTranscript || '').length} blueprintCompetencies=${competencyCount}`
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
    sessionEnd?: VoiceSessionEndSummary;
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
        sessionEnd: payload.sessionEnd,
    });
};

// تم حذف sendRecruitmentCampaignToN8N لأنها لم تعد مستخدمة
// الآن المعايير تُحفظ في قاعدة البيانات ويتم إرسالها مع بيانات المرشح في webhook واحد عبر sendToN8N


















