import express, { Request, Response } from 'express';
import crypto from 'crypto';
import RecruitmentCampaign from '../models/RecruitmentCampaign.js';
import { generateJobAdvertisement, translateJobAdvertisement } from '../services/llmService.js';

const router = express.Router();

// POST /api/recruitment-campaigns/generate-ad - توليد إعلان الوظيفة تلقائياً من المعايير
router.post('/generate-ad', async (req: Request, res: Response) => {
    try {
        const { language, ...criteria } = req.body || {};
        const ad = await generateJobAdvertisement(criteria, language);
        if (!ad) {
            return res.status(400).json({
                success: false,
                error: 'Unable to generate advertisement',
                message: 'No criteria provided or OpenAI not configured'
            });
        }
        res.json({
            success: true,
            jobAdvertisement: ad,
            language: language || null
        });
    } catch (error: any) {
        console.error('❌ Error generating job advertisement:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate job advertisement',
            message: error.message
        });
    }
});

// POST /api/recruitment-campaigns/translate-ad - ترجمة إعلان الوظيفة إلى لغة أخرى
router.post('/translate-ad', async (req: Request, res: Response) => {
    try {
        const { text, targetLanguage } = req.body || {};
        if (!text || !String(text).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Missing text',
                message: 'Advertisement text is required to translate'
            });
        }
        if (!targetLanguage || !String(targetLanguage).trim()) {
            return res.status(400).json({
                success: false,
                error: 'Missing targetLanguage',
                message: 'Target language is required'
            });
        }
        const translated = await translateJobAdvertisement(String(text), String(targetLanguage));
        if (!translated) {
            return res.status(400).json({
                success: false,
                error: 'Unable to translate advertisement',
                message: 'Translation returned empty result or OpenAI not configured'
            });
        }
        res.json({
            success: true,
            translatedText: translated,
            language: String(targetLanguage)
        });
    } catch (error: any) {
        console.error('❌ Error translating job advertisement:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to translate job advertisement',
            message: error.message
        });
    }
});

// POST /api/recruitment-campaigns - إنشاء حملة توظيف جديدة وحفظها في قاعدة البيانات
router.post('/', async (req: Request, res: Response) => {
    try {
        const campaignData = req.body;
        
        console.log('📥 Received recruitment campaign data:', JSON.stringify(campaignData, null, 2));
        
        // التحقق من وجود معايير على الأقل
        const criteria = { ...campaignData };
        // إزالة الحقول غير المرتبطة بالمعايير
        const jobAdvertisement = criteria.jobAdvertisement;
        delete criteria.jobAdvertisement;
        delete criteria.interviewType;
        delete criteria.templateType;
        delete criteria.templateName;
        delete criteria.step;
        delete criteria.timestamp;
        
        if (Object.keys(criteria).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing criteria',
                message: 'At least one criterion is required'
            });
        }
        
        // إنشاء campaign ID فريد
        const campaignId = crypto.randomBytes(16).toString('hex');
        
        // حفظ المعايير في قاعدة البيانات
        const campaign = new RecruitmentCampaign({
            campaignId,
            criteria: criteria, // جميع المعايير المختارة
            jobAdvertisement: jobAdvertisement || undefined,
            interviewType: campaignData.interviewType || undefined,
            templateType: campaignData.templateType || undefined,
            templateName: campaignData.templateName || undefined
        });
        
        await campaign.save();
        
        console.log('✅ Recruitment campaign saved:', campaignId);
        
        // إرجاع campaign ID للاستخدام في الرابط
        res.status(201).json({
            success: true,
            message: 'Recruitment campaign created successfully',
            campaignId: campaignId,
            data: campaignData
        });
    } catch (error: any) {
        console.error('❌ Error creating recruitment campaign:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create recruitment campaign',
            message: error.message
        });
    }
});

// GET /api/recruitment-campaigns/:campaignId - الحصول على معايير حملة محددة
router.get('/:campaignId', async (req: Request, res: Response) => {
    try {
        const { campaignId } = req.params;
        
        const campaign = await RecruitmentCampaign.findOne({ campaignId });
        
        if (!campaign) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                campaignId: campaign.campaignId,
                criteria: campaign.criteria, // جميع المعايير الديناميكية
                jobAdvertisement: campaign.jobAdvertisement,
                interviewType: campaign.interviewType,
                templateType: campaign.templateType,
                templateName: campaign.templateName
            }
        });
    } catch (error: any) {
        console.error('❌ Error fetching recruitment campaign:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch recruitment campaign',
            message: error.message
        });
    }
});

export default router;

