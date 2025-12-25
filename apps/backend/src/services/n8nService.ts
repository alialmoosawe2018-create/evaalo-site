// خدمة إرسال البيانات إلى n8n للتحليل
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    positionAppliedFor: string;
    yearsOfExperience: string;
    skills?: string[];
    languages?: string[];
    coverLetter?: string;
    status?: string;
    createdAt?: Date | string;
    [key: string]: any;
}

/**
 * إرسال بيانات المرشح + المعايير إلى n8n للتحليل (في webhook واحد)
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
        // جلب المعايير من قاعدة البيانات إذا كان campaignId موجود
        let criteria = null;
        if (campaignId) {
            try {
                const RecruitmentCampaign = (await import('../models/RecruitmentCampaign.js')).default;
                const campaign = await RecruitmentCampaign.findOne({ campaignId });
                if (campaign) {
                    // استخدام المعايير الديناميكية من campaign.criteria
                    criteria = campaign.criteria || {};
                    console.log('✅ Campaign criteria loaded:', criteria);
                } else {
                    console.log('⚠️ Campaign not found:', campaignId);
                }
            } catch (error: any) {
                console.error('❌ Error loading campaign criteria:', error.message);
            }
        }
        
        // تحضير البيانات للإرسال
        const candidateId = candidateData._id?.toString?.() || candidateData._id || candidateData.id?.toString?.() || candidateData.id;
        const createdAt = candidateData.createdAt instanceof Date 
            ? candidateData.createdAt.toISOString() 
            : (typeof candidateData.createdAt === 'string' ? candidateData.createdAt : new Date().toISOString());
        
        // تحويل interviewDate إلى ISO string إذا كان موجوداً
        const interviewDate = candidateData.interviewDate instanceof Date
            ? candidateData.interviewDate.toISOString()
            : (typeof candidateData.interviewDate === 'string' ? candidateData.interviewDate : null);

        // إرسال المعايير + بيانات المرشح معاً في webhook واحد
        const payload = {
            event: 'candidate_submitted',
            timestamp: new Date().toISOString(),
            // إضافة المعايير إذا كانت موجودة
            ...(criteria && { criteria }),
            candidate: {
                // المعلومات الأساسية
                id: candidateId,
                firstName: candidateData.firstName,
                lastName: candidateData.lastName,
                email: candidateData.email,
                phone: candidateData.phone,
                
                // معلومات الوظيفة
                positionAppliedFor: candidateData.positionAppliedFor,
                yearsOfExperience: candidateData.yearsOfExperience,
                currentCompany: candidateData.currentCompany || null,
                
                // معلومات الموقع والتعليم
                location: candidateData.location || null,
                highestEducationLevel: candidateData.highestEducationLevel || null,
                linkedin: candidateData.linkedin || null,
                
                // المهارات واللغات
                skills: candidateData.skills || [],
                languages: candidateData.languages || [],
                certifications: candidateData.certifications || null,
                
                // معلومات الراتب
                salaryMin: candidateData.salaryMin || null,
                salaryMax: candidateData.salaryMax || null,
                salaryCurrency: candidateData.salaryCurrency || 'USD',
                
                // معلومات إضافية
                availability: candidateData.availability || null,
                coverLetter: candidateData.coverLetter || '',
                hearAboutUs: candidateData.hearAboutUs || null,
                
                // التواريخ والحالة
                status: candidateData.status || 'pending',
                interviewDate: interviewDate,
                createdAt: createdAt,
                updatedAt: candidateData.updatedAt instanceof Date
                    ? candidateData.updatedAt.toISOString()
                    : (typeof candidateData.updatedAt === 'string' ? candidateData.updatedAt : null)
            }
        };

        console.log('📤 Sending candidate data + criteria to n8n:', JSON.stringify(payload, null, 2));
        
        // إرسال البيانات إلى n8n webhook
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

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

// تم حذف sendRecruitmentCampaignToN8N لأنها لم تعد مستخدمة
// الآن المعايير تُحفظ في قاعدة البيانات ويتم إرسالها مع بيانات المرشح في webhook واحد عبر sendToN8N


















