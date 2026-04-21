import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Candidate, { ICandidate } from '../models/Candidate.js';
import { sendToN8N, sendStatusUpdateToN8N } from '../services/n8nService.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

/** الاستمارة قد ترسل languages كـ [{ name, level }] بينما المخطط يخزن string[] */
function normalizeLanguagesToStringArray(input: unknown): string[] {
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

// GET /api/candidates - جلب جميع المرشحين
router.get('/', async (req: Request, res: Response) => {
    try {
        // Check if database is connected
        if (mongoose.connection.readyState !== 1) {
            console.warn('⚠️ Database not connected. Returning empty array.');
            return res.json({
                success: true,
                count: 0,
                data: [],
                warning: 'Database is not connected. Please check database connection.'
            });
        }
        
        const campaignFilter = typeof req.query.campaignId === 'string' && req.query.campaignId.trim()
            ? { campaignId: req.query.campaignId.trim() }
            : {};
        const candidates = await Candidate.find(campaignFilter).sort({ createdAt: -1 });
        res.json({
            success: true,
            count: candidates.length,
            data: candidates
        });
    } catch (error: any) {
        console.error('Error fetching candidates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch candidates',
            message: error.message
        });
    }
});

// Mock مرشح للتطوير (عند استخدام candidateId=xxx أو test)
const MOCK_CANDIDATE = {
    _id: '000000000000000000000001',
    full_name: 'Test User',
    email: 'test@example.com',
    position_applied_for: 'Developer',
    skills: [],
    years_of_experience: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
};

// GET /api/candidates/:id - جلب مرشح محدد
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const isDevMock = (id === 'xxx' || id === 'test') && process.env.NODE_ENV !== 'production';
        if (isDevMock) {
            return res.json({
                success: true,
                data: MOCK_CANDIDATE,
                _mock: true
            });
        }
        if (!mongoose.Types.ObjectId.isValid(id) || id.length !== 24) {
            return res.status(400).json({
                success: false,
                error: 'Invalid candidate ID',
                message: 'candidateId must be a valid 24-character hex string (e.g. 65f1c2b8e9a3d41c0a12b345)'
            });
        }
        const candidate = await Candidate.findById(id);
        
        if (!candidate) {
            return res.status(404).json({
                success: false,
                error: 'Candidate not found'
            });
        }
        
        res.json({
            success: true,
            data: candidate
        });
    } catch (error: any) {
        console.error('Error fetching candidate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch candidate',
            message: error.message
        });
    }
});

// Multer للحصول على multipart/form-data (مع الملفات أو بدونه)
const candidateUpload = upload.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'photo', maxCount: 1 }
]);

/** JSON body: لا نمرّر multer لأنه يستهلك الـ stream؛ multipart فقط للاستمارة مع الملفات */
const candidateUploadOptional = (req: Request, res: Response, next: NextFunction) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
        return candidateUpload(req, res, next);
    }
    next();
};

/** توحيد مفاتيح المرشح: camelCase → snake_case + دمج firstName/lastName → full_name */
const CAMEL_TO_SNAKE_CANDIDATE: [string, string][] = [
    ['fullName', 'full_name'],
    ['positionAppliedFor', 'position_applied_for'],
    ['companyAppliedTo', 'company_applied_to'],
    ['yearsOfExperience', 'years_of_experience'],
    ['currentCompany', 'current_company'],
    ['highestEducationLevel', 'highest_education_level'],
];

function normalizeCandidateBodyKeys(body: Record<string, any>): void {
    for (const [camel, snake] of CAMEL_TO_SNAKE_CANDIDATE) {
        const snakeVal = body[snake];
        const snakeEmpty =
            snakeVal == null || (typeof snakeVal === 'string' && !String(snakeVal).trim());
        if (snakeEmpty && body[camel] != null && body[camel] !== '') {
            body[snake] = body[camel];
        }
        delete body[camel];
    }
    const fn = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const ln = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const existingFull = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    if (!existingFull && (fn || ln)) {
        body.full_name = [fn, ln].filter(Boolean).join(' ').trim();
    }
    delete body.firstName;
    delete body.lastName;
}

function parseSkillsOrLanguagesArray(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return normalizeLanguagesToStringArray(raw);
    }
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return [];
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return normalizeLanguagesToStringArray(parsed);
            }
        } catch {
            /* ليست JSON */
        }
        return s
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean);
    }
    return [];
}

// POST /api/candidates - إضافة مرشح جديد
router.post('/', candidateUploadOptional, async (req: Request, res: Response) => {
    try {
        let candidateData: any = req.body || {};
        
        // skills / languages: JSON array أو سلسلة مفصولة
        candidateData.skills = parseSkillsOrLanguagesArray(candidateData.skills);
        candidateData.languages = parseSkillsOrLanguagesArray(candidateData.languages);
        if (typeof candidateData.agreeToTerms === 'string') {
            candidateData.agreeToTerms = candidateData.agreeToTerms === 'true';
        }
        
        // إضافة الملفات من req.files إلى candidateData.files
        const files: Array<{ kind: 'cv' | 'photo'; filename: string; originalName: string; path: string; mimeType: string; size: number; uploadedAt: Date }> = [];
        const uploads = (req as any).files as { cv?: Express.Multer.File[]; photo?: Express.Multer.File[] } | undefined;
        if (uploads?.cv?.length) {
            const f = uploads.cv[0];
            files.push({
                kind: 'cv',
                filename: f.filename,
                originalName: f.originalname,
                path: f.path,
                mimeType: f.mimetype,
                size: f.size,
                uploadedAt: new Date()
            });
        }
        if (uploads?.photo?.length) {
            const f = uploads.photo[0];
            files.push({
                kind: 'photo',
                filename: f.filename,
                originalName: f.originalname,
                path: f.path,
                mimeType: f.mimetype,
                size: f.size,
                uploadedAt: new Date()
            });
        }
        if (files.length) candidateData.files = files;

        normalizeCandidateBodyKeys(candidateData);
        
        // Log received data for debugging
        console.log('📥 Received candidate data:', JSON.stringify({ ...candidateData, files: candidateData.files?.length }, null, 2));
        
        // Check if database is connected
        if (mongoose.connection.readyState !== 1) {
            console.error('❌ Database not connected. ReadyState:', mongoose.connection.readyState);
            return res.status(503).json({
                success: false,
                error: 'Database not connected',
                message: 'Please check database connection. Server is running but database is not available.'
            });
        }
        
        const campaignId =
            typeof candidateData.campaignId === 'string' && candidateData.campaignId.trim()
                ? candidateData.campaignId.trim()
                : undefined;
        if (campaignId) {
            candidateData.campaignId = campaignId;
        } else {
            delete candidateData.campaignId;
        }
        const candidateDataForDB = candidateData;
        
        // التحقق من وجود email مكرر
        const existingCandidate = await Candidate.findOne({ email: candidateDataForDB.email });
        if (existingCandidate) {
            return res.status(400).json({
                success: false,
                error: 'Email already exists',
                message: 'This email is already registered'
            });
        }
        
        // Validate required fields
        if (!candidateDataForDB.full_name || !candidateDataForDB.email || !candidateDataForDB.phone) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'Full name, email, and phone are required'
            });
        }
        
        const candidate = new Candidate(candidateDataForDB);
        await candidate.save();
        
        console.log('✅ Candidate saved successfully:', candidate._id);
        if (campaignId) {
            console.log('📋 Campaign ID found:', campaignId);
        }
        
        // إرسال البيانات + المعايير إلى n8n للتحليل (غير متزامن - لا يمنع الاستجابة)
        const candidateObj = candidate.toObject();
        sendToN8N({
            ...candidateObj,
            _id: candidateObj._id?.toString() || candidateObj._id
        } as any, campaignId).catch(err => {
            console.error('Failed to send to n8n (non-blocking):', err);
        });
        
        res.status(201).json({
            success: true,
            message: 'Candidate added successfully',
            data: candidate
        });
    } catch (error: any) {
        console.error('❌ Error creating candidate:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        // Better error messages
        let errorMessage = error.message || 'Failed to create candidate';
        let statusCode = 500;
        
        if (error.name === 'ValidationError') {
            statusCode = 400;
            errorMessage = 'Validation error: ' + Object.values(error.errors).map((e: any) => e.message).join(', ');
        } else if (error.name === 'MongoServerError' && error.code === 11000) {
            statusCode = 400;
            errorMessage = 'Duplicate entry: This email already exists';
        } else if (error.name === 'CastError') {
            statusCode = 400;
            errorMessage = 'Invalid data format';
        }
        
        res.status(statusCode).json({
            success: false,
            error: 'Failed to create candidate',
            message: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/candidates/:id - تحديث مرشح
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const body = { ...req.body };
        normalizeCandidateBodyKeys(body);
        if (body.languages !== undefined) {
            if (typeof body.languages === 'string') {
                try {
                    body.languages = JSON.parse(body.languages) || [];
                } catch {
                    body.languages = [];
                }
            }
            body.languages = normalizeLanguagesToStringArray(body.languages);
        }
        const candidate = await Candidate.findByIdAndUpdate(
            req.params.id,
            body,
            { new: true, runValidators: true }
        );
        
        if (!candidate) {
            return res.status(404).json({
                success: false,
                error: 'Candidate not found'
            });
        }
        
        // إرسال تحديث الحالة إلى n8n إذا تم تحديث الحالة
        if (req.body.status) {
            sendStatusUpdateToN8N(
                candidate._id.toString(),
                req.body.status,
                req.body.aiEvaluation
            ).catch(err => {
                console.error('Failed to send status update to n8n (non-blocking):', err);
            });
        }
        
        res.json({
            success: true,
            message: 'Candidate updated successfully',
            data: candidate
        });
    } catch (error: any) {
        console.error('Error updating candidate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update candidate',
            message: error.message
        });
    }
});

// DELETE /api/candidates/:id - حذف مرشح
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const candidate = await Candidate.findByIdAndDelete(req.params.id);
        
        if (!candidate) {
            return res.status(404).json({
                success: false,
                error: 'Candidate not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Candidate deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting candidate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete candidate',
            message: error.message
        });
    }
});

export default router;

















