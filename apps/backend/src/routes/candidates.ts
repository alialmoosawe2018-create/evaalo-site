import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Candidate, { ICandidate } from '../models/Candidate.js';
import { sendToN8N, sendStatusUpdateToN8N } from '../services/n8nService.js';

const router = express.Router();

// GET /api/candidates - جلب جميع المرشحين
router.get('/', async (req: Request, res: Response) => {
    try {
        const candidates = await Candidate.find().sort({ createdAt: -1 });
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

// GET /api/candidates/:id - جلب مرشح محدد
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const candidate = await Candidate.findById(req.params.id);
        
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

// POST /api/candidates - إضافة مرشح جديد
router.post('/', async (req: Request, res: Response) => {
    try {
        console.log('🚀 POST /api/candidates - Request received');
        console.log('📋 Request method:', req.method);
        console.log('🌐 Request origin:', req.headers.origin);
        console.log('📋 Request headers:', JSON.stringify(req.headers, null, 2));
        
        const candidateData = req.body;
        
        // Log received data for debugging
        console.log('📥 Received candidate data:', JSON.stringify(candidateData, null, 2));
        
        // Check if database is connected
        if (mongoose.connection.readyState !== 1) {
            console.error('❌ Database not connected. ReadyState:', mongoose.connection.readyState);
            return res.status(503).json({
                success: false,
                error: 'Database not connected',
                message: 'Please check database connection. Server is running but database is not available.'
            });
        }
        
        // قراءة campaignId من body قبل إزالته من candidateData (لأنه ليس جزءاً من Schema)
        const campaignId = candidateData.campaignId;
        
        // إزالة campaignId من candidateData قبل إنشاء الـ candidate (لأنه ليس حقل في Schema)
        const { campaignId: _, ...candidateDataForDB } = candidateData;
        
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
        const missingFields = [];
        if (!candidateDataForDB.firstName) missingFields.push('firstName');
        if (!candidateDataForDB.lastName) missingFields.push('lastName');
        if (!candidateDataForDB.email) missingFields.push('email');
        if (!candidateDataForDB.phone) missingFields.push('phone');
        
        if (missingFields.length > 0) {
            console.error('❌ Missing required fields:', missingFields);
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: `Missing required fields: ${missingFields.join(', ')}`,
                missingFields: missingFields
            });
        }
        
        console.log('📝 Creating candidate with data:', JSON.stringify(candidateDataForDB, null, 2));
        
        const candidate = new Candidate(candidateDataForDB);
        
        // Validate before saving
        const validationError = candidate.validateSync();
        if (validationError) {
            console.error('❌ Validation error:', validationError);
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                message: validationError.message,
                details: Object.keys(validationError.errors || {}).map(key => ({
                    field: key,
                    message: validationError.errors[key].message
                }))
            });
        }
        
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
            details: process.env.NODE_ENV === 'development' ? {
                originalError: error.message,
                stack: error.stack
            } : undefined
        });
    }
});

// PUT /api/candidates/:id - تحديث مرشح
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const candidate = await Candidate.findByIdAndUpdate(
            req.params.id,
            req.body,
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


















