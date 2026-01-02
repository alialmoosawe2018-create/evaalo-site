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
import os from 'os';
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
// في التطوير: السماح بجميع المنافذ المحلية (localhost, 127.0.0.1, IPs محلية)
// في الإنتاج: السماح فقط بـ evaalo.com
const isDevelopment = process.env.NODE_ENV !== 'production';

// قائمة الـ origins المسموحة (ثابتة)
const staticOrigins = [
    'https://www.evaalo.com',
    'https://evaalo.com',
    'http://www.evaalo.com',
    'http://evaalo.com',
    FRONTEND_URL
].filter(Boolean);

// قائمة الأنماط (patterns) للمنافذ المحلية (في التطوير فقط)
const patternOrigins = isDevelopment ? [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/, // IPs محلية
    /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/, // IPs محلية
] : [];

app.use(cors({
    origin: (origin, callback) => {
        // السماح بطلبات بدون origin (مثل Postman أو mobile apps)
        if (!origin) {
            console.log('⚠️ Request without origin - allowing');
            return callback(null, true);
        }
        
        console.log('🔍 Checking CORS for origin:', origin);
        console.log('🌍 Environment:', isDevelopment ? 'development' : 'production');
        
        // التحقق من القائمة الثابتة
        if (staticOrigins.includes(origin)) {
            console.log('✅ Origin allowed (exact match):', origin);
            return callback(null, true);
        }
        
        // التحقق من الأنماط (patterns) - يعمل في التطوير والإنتاج
        for (const pattern of patternOrigins) {
            if (pattern instanceof RegExp && pattern.test(origin)) {
                console.log('✅ Origin allowed (pattern match):', origin);
                return callback(null, true);
            }
        }
        
        // رفض الطلب
        console.error('❌ CORS blocked origin:', origin);
        console.log('📋 Static allowed origins:', staticOrigins);
        console.log('📋 Pattern origins:', patternOrigins.length, 'patterns');
        callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
    },
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

// ============================================
// 3️⃣ Endpoint بدء المقابلة (Dynamic System Prompt)
// ============================================
// ✅ الحل الصحيح: Backend يبني System Prompt فقط ويرجعه للـ Frontend
app.post('/api/interview-context', async (req, res) => {
  try {
    const { candidate } = req.body;

    if (!candidate) {
      return res.status(400).json({ error: 'candidate is required' });
    }

    // 1️⃣ بناء System Prompt ديناميكي (مبسّط)
    const fullName = `${candidate.firstName} ${candidate.lastName}`;
    const systemPrompt = `Hello ${fullName}, welcome to your interview for the ${candidate.jobTitle} position.
How are you feeling today?`;

    // 📝 طباعة System Prompt للتحقق (في التطوير فقط)
    if (process.env.NODE_ENV !== 'production') {
      console.log('📋 System Prompt Generated:');
      console.log('='.repeat(60));
      console.log(systemPrompt);
      console.log('='.repeat(60));
    }

    // 2️⃣ إرجاع System Prompt للـ Frontend
    res.json({
      success: true,
      systemPrompt: systemPrompt,
    });
  } catch (error: any) {
    console.error('❌ interview-context error:', error.message);
    res.status(500).json({ error: 'Failed to generate interview context' });
  }
});

// Route للتحقق من حالة السيرفر
app.get('/health', (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        res.json({ 
            status: 'ok', 
            message: 'Server is running',
            database: dbStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.json({ 
            status: 'ok', 
            message: 'Server is running',
            database: 'unknown',
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
        
        console.log('📥 Received webhook from n8n (supports both Written & Voice Interview)');
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
        
        // إذا كان هناك تقييم Voice Interview من n8n
        if (data.voiceInterviewEvaluation) {
            updateData.voiceInterviewEvaluation = data.voiceInterviewEvaluation;
            console.log('✅ Updating Voice Interview evaluation for candidate:', candidateId);
            console.log('📋 Voice Interview Data:', JSON.stringify(data.voiceInterviewEvaluation, null, 2));
        }

        // دعم أيضاً إرسال البيانات مباشرة (بدون كائن writtenInterviewEvaluation)
        // ملاحظة: إذا كان هناك voiceInterviewEvaluation، لن نستخدم التنسيق المباشر للمقابلة الكتابية
        if ((data.overall_score || data.recommendation) && !data.voiceInterviewEvaluation && !data.writtenInterviewEvaluation) {
            // تحديد نوع المقابلة بناءً على وجود حقول خاصة بالمقابلة الصوتية
            const isVoiceInterview = data.communication_score !== undefined || data.confidence_score !== undefined || data.technical_score !== undefined || data.transcript;
            
            if (isVoiceInterview) {
                // مقابلة صوتية
                updateData.voiceInterviewEvaluation = {
                    overall_score: data.overall_score,
                    fit_for_role: data.fit_for_role,
                    strengths: data.strengths || [],
                    weaknesses: data.weaknesses || [],
                    red_flags: data.red_flags || [],
                    recommendation: data.recommendation,
                    summary: data.summary,
                    communication_score: data.communication_score,
                    confidence_score: data.confidence_score,
                    technical_score: data.technical_score,
                    transcript: data.transcript
                };
                console.log('✅ Updating Voice Interview evaluation (direct format) for candidate:', candidateId);
                console.log('📋 Voice Interview Data:', JSON.stringify(updateData.voiceInterviewEvaluation, null, 2));
            } else {
                // مقابلة كتابية
                updateData.writtenInterviewEvaluation = {
                    overall_score: data.overall_score,
                    fit_for_role: data.fit_for_role,
                    strengths: data.strengths || [],
                    weaknesses: data.weaknesses || [],
                    red_flags: data.red_flags || [],
                    recommendation: data.recommendation,
                    summary: data.summary
                };
                console.log('✅ Updating Written Interview evaluation (direct format) for candidate:', candidateId);
                console.log('📋 Written Interview Data:', JSON.stringify(updateData.writtenInterviewEvaluation, null, 2));
            }
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
// n8n Voice Interview Webhook Handler (استقبال نتائج المقابلة الصوتية من n8n)
// ============================================

// Webhook endpoint لاستقبال نتائج المقابلة الصوتية من n8n
app.post('/webhook/n8n-voice', upload.array('files', 10), async (req, res) => {
    try {
        const data = req.body;
        const files = req.files as Express.Multer.File[];
        
        console.log('📥 Received voice interview webhook from n8n');
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

        // إذا كان هناك تقييم Voice Interview من n8n
        if (data.voiceInterviewEvaluation) {
            updateData.voiceInterviewEvaluation = data.voiceInterviewEvaluation;
            console.log('✅ Updating Voice Interview evaluation for candidate:', candidateId);
            console.log('📋 Voice Interview Data:', JSON.stringify(data.voiceInterviewEvaluation, null, 2));
        }
        
        // دعم أيضاً إرسال البيانات مباشرة (بدون كائن voiceInterviewEvaluation)
        if (data.overall_score || data.recommendation) {
            updateData.voiceInterviewEvaluation = {
                overall_score: data.overall_score || data.voiceInterviewEvaluation?.overall_score,
                fit_for_role: data.fit_for_role || data.voiceInterviewEvaluation?.fit_for_role,
                strengths: data.strengths || data.voiceInterviewEvaluation?.strengths || [],
                weaknesses: data.weaknesses || data.voiceInterviewEvaluation?.weaknesses || [],
                red_flags: data.red_flags || data.voiceInterviewEvaluation?.red_flags || [],
                recommendation: data.recommendation || data.voiceInterviewEvaluation?.recommendation,
                summary: data.summary || data.voiceInterviewEvaluation?.summary,
                communication_score: data.communication_score || data.voiceInterviewEvaluation?.communication_score,
                confidence_score: data.confidence_score || data.voiceInterviewEvaluation?.confidence_score,
                technical_score: data.technical_score || data.voiceInterviewEvaluation?.technical_score,
                transcript: data.transcript || data.voiceInterviewEvaluation?.transcript
            };
            console.log('✅ Updating Voice Interview evaluation (direct format) for candidate:', candidateId);
            console.log('📋 Voice Interview Data:', JSON.stringify(updateData.voiceInterviewEvaluation, null, 2));
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
            console.log('✅ Candidate voice interview evaluation updated successfully:', candidateId);
        } else {
            console.log('⚠️ No data to update for candidate:', candidateId);
        }

        // إرجاع استجابة نجاح
        res.status(200).json({ 
            success: true,
            message: 'Voice interview webhook received and processed successfully',
            candidateId: candidateId,
            filesReceived: files?.length || 0
        });

    } catch (error: any) {
        console.error('❌ Error processing n8n voice interview webhook:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// ============================================
// دالة للحصول على IP المحلي
// ============================================
function getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface) continue;
        for (const addr of iface) {
            // تجاهل IPv6 والعناوين الداخلية
            if (addr.family === 'IPv4' && !addr.internal) {
                // إعطاء الأولوية لعناوين 192.168.x.x أو 10.x.x.x
                if (addr.address.startsWith('192.168.') || addr.address.startsWith('10.')) {
                    return addr.address;
                }
            }
        }
    }
    // إذا لم نجد IP محلي، نرجع أول IP متاح
    for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface) continue;
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return 'localhost';
}

// ============================================
// تشغيل السيرفر
// ============================================

const localIP = getLocalIP();

// الاتصال بقاعدة البيانات ثم تشغيل السيرفر
connectDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
        console.log(`🌐 Server is accessible from network: http://${localIP}:${PORT}`);
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 n8n Webhook URL (Written Interview): http://${localIP}:${PORT}/webhook/n8n`);
        console.log(`🔗 n8n Webhook URL (Voice Interview): http://${localIP}:${PORT}/webhook/n8n-voice`);
        console.log(`\n💡 للوصول من أجهزة أخرى على نفس الواي فاي:`);
        console.log(`   استخدم: http://${localIP}:${PORT}\n`);
    });
}).catch((error) => {
    console.error('❌ Failed to connect to database:', error);
    console.log('⚠️ Starting server without database connection...');
    // Start server anyway for development
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${PORT} (without database)`);
        console.log(`🌐 Server is accessible from network: http://${localIP}:${PORT}`);
        console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 n8n Webhook URL (Written Interview): http://${localIP}:${PORT}/webhook/n8n`);
        console.log(`🔗 n8n Webhook URL (Voice Interview): http://${localIP}:${PORT}/webhook/n8n-voice`);
        console.log(`\n💡 للوصول من أجهزة أخرى على نفس الواي فاي:`);
        console.log(`   استخدم: http://${localIP}:${PORT}\n`);
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

