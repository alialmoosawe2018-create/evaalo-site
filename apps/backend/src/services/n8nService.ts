// خدمة إرسال البيانات إلى n8n للتحليل
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

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
        kind?: 'cv' | 'photo';
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
    const byKind = files.find((f) => f.kind === 'cv');
    if (byKind) return byKind;
    return files.find((f) => f.mimeType === 'application/pdf') || null;
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
        // جلب معايير الحملة وتحويلها إلى قائمة فقط لـ n8n
        let criteriaRaw: Record<string, unknown> | null = null;
        if (campaignId) {
            try {
                const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
                const campaign = await RecruitmentCampaign.findOne({ campaignId });
                if (campaign) {
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

        /** حقول المرشح في جذر الـ body (بدون كائن candidate)؛ skills/languages/criteria كمصفوفات في نفس الجذر */
        const payload: Record<string, unknown> = {
            event: 'candidate_submitted' as const,
            evaluationSource: 'written' as const,
            stage: 1,
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

        console.log(
            hasCvBinary
                ? '📤 n8n: multipart — حقول مسطّحة في الجذر + criteria/skills/languages كمصفوفات + binary cv'
                : '📤 n8n: JSON — كل حقل مرشح في الجذر + criteria/skills/languages كمصفوفات'
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

export const sendVoiceTranscriptToN8N = async (payload: {
    sessionId: string;
    candidateId?: string;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    language?: string;
    /** التقييم (Communication Skills, English Fluency, Confidence Level) — يُضمّن في نفس الرسالة */
    evaluation?: { communicationSkills: number; englishFluency: number; confidenceLevel: number };
}): Promise<boolean> => {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    const dedicated = (process.env.N8N_VOICE_TRANSCRIPT_WEBHOOK_URL || '').trim();
    const mainUrl = (getN8NWebhookUrl() || '').trim();
    const voiceWebhookUrl = dedicated || mainUrl;
    /** رد التحليل الصوتي من n8n يجب أن يُرسل إلى POST {API}/webhook/n8n/stage2 (صوت فقط). */
    if (!voiceWebhookUrl) {
        console.log('⚠️ [n8n voice] N8N_WEBHOOK_URL or N8N_VOICE_TRANSCRIPT_WEBHOOK_URL not set, skipping');
        return false;
    }
    if (!payload.conversationHistory?.length) {
        console.log('[VOICE TRANSCRIPT] No conversation to send');
        return false;
    }
    try {
        const fullTranscript = formatConversationToFullTranscript(payload.conversationHistory);
        const body: Record<string, unknown> = {
            event: 'voice_interview_transcript',
            evaluationSource: 'voice' as const,
            stage: 2,
            timestamp: new Date().toISOString(),
            sessionId: payload.sessionId,
            candidateId: payload.candidateId || null,
            language: payload.language || 'auto',
            fullTranscript,
            messageCount: payload.conversationHistory.length,
        };
        if (payload.evaluation) {
            body.evaluation = payload.evaluation;
        }
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
    } catch (error: any) {
        console.error('❌ Error sending voice transcript to n8n:', error.message);
        return false;
    }
};

// تم حذف sendVoiceEvaluationToN8N — التقييم يُضمّن الآن في نفس رسالة الترانسكريبت

export const sendVideoTranscriptToN8N = async (payload: {
    sessionId: string;
    candidateId?: string;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    language?: string;
}): Promise<boolean> => {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    const dedicated = (process.env.N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL || '').trim();
    const mainUrl = (getN8NWebhookUrl() || '').trim();
    const videoWebhookUrl = dedicated || mainUrl;
    if (!videoWebhookUrl) {
        console.log('⚠️ [n8n video] N8N_WEBHOOK_URL or N8N_VIDEO_TRANSCRIPT_WEBHOOK_URL not set, skipping');
        return false;
    }
    if (!payload.conversationHistory?.length) {
        console.log('[VIDEO TRANSCRIPT] No conversation to send');
        return false;
    }
    try {
        const fullTranscript = formatConversationToFullTranscript(payload.conversationHistory);
        const body = {
            event: 'video_interview_transcript',
            evaluationSource: 'video' as const,
            stage: 3,
            timestamp: new Date().toISOString(),
            sessionId: payload.sessionId,
            candidateId: payload.candidateId || null,
            language: payload.language || 'auto',
            fullTranscript,
            messageCount: payload.conversationHistory.length,
        };
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
    } catch (error: any) {
        console.error('❌ Error sending video transcript to n8n:', error.message);
        return false;
    }
};

// تم حذف sendRecruitmentCampaignToN8N لأنها لم تعد مستخدمة
// الآن المعايير تُحفظ في قاعدة البيانات ويتم إرسالها مع بيانات المرشح في webhook واحد عبر sendToN8N


















