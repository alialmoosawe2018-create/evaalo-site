// ============================================
// ملف: server.ts
// الوظيفة: السيرفر الرئيسي للتطبيق
// ============================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { connectDatabase } from './config/database.js';
import candidateRoutes from './routes/candidates.js';
import recruitmentCampaignRoutes from './routes/recruitmentCampaigns.js';
import Candidate from './models/Candidate.js';

// للحصول على مسار المجلد الحالي في ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// تحميل متغيرات البيئة من ملف .env
dotenv.config();

// إنشاء تطبيق Express
const app = express();
const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ============================================
// Middleware (البرمجيات الوسيطة)
// ============================================

// السماح بطلبات من Frontend - جميع المنافذ المحتملة
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
        'https://www.evaalo.com',
        'https://evaalo.com',
        'http://www.evaalo.com',
        'http://evaalo.com',
        FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// السماح بقراءة JSON في الطلبات
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// إعداد multer لحفظ الملفات
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '..', 'uploads');
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // حفظ الملف باسم فريد: timestamp-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB حد أقصى
    },
    fileFilter: (req, file, cb) => {
        // قبول جميع أنواع الملفات (يمكنك تحديد أنواع معينة إذا أردت)
        cb(null, true);
    }
});

// ============================================
// Routes (المسارات)
// ============================================

// API Routes
app.use('/api/candidates', candidateRoutes);
app.use('/api/recruitment-campaigns', recruitmentCampaignRoutes);

// Route لتحميل الملفات (للملفات المحفوظة)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Route للتحقق من حالة السيرفر
app.get('/health', (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        // معلومات عن Vapi
        // ملاحظة: Vapi SDK يعمل في Frontend، لذا لا يوجد اتصال مباشر من Backend
        // لكن يمكننا التحقق من وجود متغيرات البيئة المتعلقة بـ Vapi
        const vapiConfig = {
            available: true, // Vapi متاح للاستخدام من خلال Frontend
            sdk: 'client-side', // Vapi SDK يعمل في المتصفح
            webhookEndpoint: '/webhook/vapi', // Endpoint لاستقبال webhooks من Vapi
            note: 'Vapi is initialized in the frontend using Public API Key'
        };
        
        res.json({ 
            status: 'ok', 
            message: 'Server is running',
            database: dbStatus,
            vapi: vapiConfig,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.json({ 
            status: 'ok', 
            message: 'Server is running',
            database: 'unknown',
            vapi: {
                available: true,
                sdk: 'client-side',
                note: 'Vapi is initialized in the frontend'
            },
            timestamp: new Date().toISOString()
        });
    }
});

// Route أساسي
app.get('/', (req, res) => {
    res.json({ 
        message: 'Vapi Voice Agent Backend API',
        version: '1.0.0'
    });
});

// ============================================
// Vapi Webhook Handler
// ============================================

// دالة معالجة استدعاءات الدوال من Vapi
function handleFunctionCall(message: any, res: express.Response) {
    const { functionCall } = message;
    
    switch (functionCall.name) {
        case 'lookup_order':
            const orderData = { 
                orderId: functionCall.parameters.orderId, 
                status: 'shipped' 
            };
            return res.json({ result: orderData });
        
        default:
            return res.status(400).json({ error: 'Unknown function' });
    }
}

// Webhook endpoint للتعامل مع أحداث Vapi
app.post('/webhook/vapi', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        switch (message.type) {
            case 'status-update':
                console.log(`📞 Call ${message.call?.id}: ${message.call?.status}`);
                break;

            case 'transcript':
                console.log(`💬 ${message.role}: ${message.transcript}`);
                break;

            case 'function-call':
                return handleFunctionCall(message, res);

            default:
                console.log(`📨 Received message type: ${message.type}`);
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// n8n Webhook Handler (استقبال نتائج التحليل من n8n)
// ============================================

// Webhook endpoint لاستقبال نتائج التحليل من n8n (يدعم الملفات)
// يمكن إرسال ملفات متعددة مع البيانات
app.post('/webhook/n8n', upload.array('files', 10), async (req, res) => {
    try {
        const data = req.body;
        const files = req.files as Express.Multer.File[];
        
        console.log('📥 Received webhook from n8n');
        console.log('📋 Data:', JSON.stringify(data, null, 2));
        console.log('📎 Files:', files?.length || 0, 'file(s)');

        // التحقق من وجود candidate ID
        if (!data.candidateId && !data.candidate?.id) {
            return res.status(400).json({ 
                success: false,
                error: 'Candidate ID is required' 
            });
        }

        const candidateId = data.candidateId || data.candidate?.id;

        // البحث عن المرشح في قاعدة البيانات
        const candidate = await Candidate.findById(candidateId);
        
        if (!candidate) {
            console.error(`❌ Candidate not found: ${candidateId}`);
            return res.status(404).json({ 
                success: false,
                error: 'Candidate not found' 
            });
        }

        // تحديث بيانات المرشح بناءً على البيانات المرسلة من n8n
        const updateData: any = {};

        // إذا كان هناك تقييم AI من n8n
        if (data.aiEvaluation) {
            updateData.aiEvaluation = data.aiEvaluation;
            console.log('✅ Updating AI evaluation for candidate:', candidateId);
        }

        // إذا كان هناك تقييم Written Interview من n8n
        if (data.writtenInterviewEvaluation) {
            updateData.writtenInterviewEvaluation = data.writtenInterviewEvaluation;
            console.log('✅ Updating Written Interview evaluation for candidate:', candidateId);
            console.log('📋 Written Interview Data:', JSON.stringify(data.writtenInterviewEvaluation, null, 2));
        }
        
        // دعم أيضاً إرسال البيانات مباشرة (بدون كائن writtenInterviewEvaluation)
        if (data.overall_score || data.recommendation) {
            updateData.writtenInterviewEvaluation = {
                overall_score: data.overall_score || data.writtenInterviewEvaluation?.overall_score,
                fit_for_role: data.fit_for_role || data.writtenInterviewEvaluation?.fit_for_role,
                strengths: data.strengths || data.writtenInterviewEvaluation?.strengths || [],
                weaknesses: data.weaknesses || data.writtenInterviewEvaluation?.weaknesses || [],
                red_flags: data.red_flags || data.writtenInterviewEvaluation?.red_flags || [],
                recommendation: data.recommendation || data.writtenInterviewEvaluation?.recommendation,
                summary: data.summary || data.writtenInterviewEvaluation?.summary
            };
            console.log('✅ Updating Written Interview evaluation (direct format) for candidate:', candidateId);
            console.log('📋 Written Interview Data:', JSON.stringify(updateData.writtenInterviewEvaluation, null, 2));
        }

        // إذا كان هناك حالة محدثة
        if (data.status) {
            updateData.status = data.status;
            console.log('✅ Updating status for candidate:', candidateId, 'to', data.status);
        }

        // إذا كان هناك ملاحظات أو تعليقات
        if (data.notes || data.comments) {
            updateData.notes = data.notes || data.comments;
        }

        // معالجة الملفات المرسلة
        if (files && files.length > 0) {
            const fileRecords = files.map(file => ({
                filename: file.filename,
                originalName: file.originalname,
                path: file.path,
                mimeType: file.mimetype,
                size: file.size,
                uploadedAt: new Date()
            }));

            // إضافة الملفات الجديدة إلى الملفات الموجودة
            const existingFiles = candidate.files || [];
            updateData.files = [...existingFiles, ...fileRecords];
            
            console.log(`✅ ${files.length} file(s) received and saved for candidate:`, candidateId);
            files.forEach(file => {
                console.log(`   - ${file.originalname} (${file.size} bytes) saved as ${file.filename}`);
            });
        }

        // تحديث المرشح إذا كان هناك بيانات للتحديث
        if (Object.keys(updateData).length > 0) {
            await Candidate.findByIdAndUpdate(candidateId, updateData, { new: true });
            console.log('✅ Candidate updated successfully:', candidateId);
        }

        // إرجاع استجابة نجاح
        res.status(200).json({ 
            success: true,
            message: 'Webhook received and processed successfully',
            candidateId: candidateId,
            filesReceived: files?.length || 0
        });

    } catch (error: any) {
        console.error('❌ Error processing n8n webhook:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// ============================================
// تشغيل السيرفر
// ============================================

// الاتصال بقاعدة البيانات ثم تشغيل السيرفر
connectDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
        console.log(`🌐 Server is accessible from network: http://192.168.1.104:${PORT}`);
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 n8n Webhook URL: http://192.168.1.104:${PORT}/webhook/n8n`);
    });
}).catch((error) => {
    console.error('❌ Failed to connect to database:', error);
    console.log('⚠️ Starting server without database connection...');
    // Start server anyway for development
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${PORT} (without database)`);
        console.log(`🌐 Server is accessible from network: http://192.168.1.104:${PORT}`);
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 n8n Webhook URL: http://192.168.1.104:${PORT}/webhook/n8n`);
        console.log('⚠️ Warning: Database connection failed. Some features may not work.');
    });
});

// ============================================
// معالجة الأخطاء
// ============================================

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

