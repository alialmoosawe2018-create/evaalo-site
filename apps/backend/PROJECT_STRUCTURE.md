# هيكل المشروع - Project Structure

## نظرة عامة

مشروع Evaalo Backend مبني باستخدام Node.js و Express.js مع PostgreSQL و Redis.

## البنية الأساسية

```
evaalo-backend/
│
├── src/                          # الكود المصدري
│   ├── config/                   # ملفات الإعداد
│   │   ├── database.js          # إعداد قاعدة البيانات (Sequelize)
│   │   ├── redis.js             # إعداد Redis
│   │   ├── s3.js                # إعداد AWS S3
│   │   ├── logger.js            # إعداد Winston Logger
│   │   └── constants.js         # الثوابت المشتركة
│   │
│   ├── models/                   # نماذج قاعدة البيانات
│   │   ├── index.js             # تصدير جميع النماذج والعلاقات
│   │   ├── Session.js           # نموذج الجلسات
│   │   ├── Message.js           # نموذج الرسائل
│   │   ├── File.js              # نموذج الملفات
│   │   └── User.js              # نموذج المستخدمين
│   │
│   ├── controllers/              # Controllers للـ API
│   │   ├── sessionController.js # إدارة الجلسات
│   │   ├── messageController.js # إدارة الرسائل
│   │   ├── uploadController.js  # رفع الملفات
│   │   ├── webhookController.js # معالجة Webhooks من Vapi
│   │   ├── exportController.js  # تصدير البيانات
│   │   └── authController.js    # المصادقة
│   │
│   ├── routes/                   # مسارات API
│   │   ├── index.js             # تجميع جميع المسارات
│   │   ├── sessions.js          # مسارات الجلسات
│   │   ├── messages.js          # مسارات الرسائل
│   │   ├── uploads.js           # مسارات الرفع
│   │   ├── webhooks.js          # مسارات Webhooks
│   │   ├── export.js            # مسارات التصدير
│   │   └── auth.js              # مسارات المصادقة
│   │
│   ├── middleware/               # Middleware
│   │   └── auth.js              # مصادقة JWT
│   │
│   ├── queue/                    # معالجة المهام الخلفية
│   │   └── audioProcessor.js    # معالج الصوتيات (BullMQ Worker)
│   │
│   ├── utils/                    # Utilities
│   │   └── llmClient.js         # عميل Custom LLM API
│   │
│   ├── database/                 # قاعدة البيانات
│   │   └── migrate.js           # ملف Migration
│   │
│   └── server.js                 # ملف الخادم الرئيسي
│
├── docs/                         # الوثائق
│   ├── API.md                   # وثائق API الكاملة
│   ├── DEPLOYMENT.md            # دليل النشر
│   ├── QUICKSTART.md            # دليل البدء السريع
│   └── FRONTEND_INTEGRATION.md  # دليل التكامل مع Frontend
│
├── logs/                         # ملفات السجلات (يُنشأ تلقائياً)
│
├── Dockerfile                    # صورة Docker
├── docker-compose.yml            # تكوين Docker Compose
├── .dockerignore                 # ملفات مستبعدة من Docker
├── ecosystem.config.cjs          # إعداد PM2
├── nginx.conf.example            # مثال إعداد Nginx
├── package.json                  # تبعيات المشروع
├── env.example                   # مثال المتغيرات البيئية
├── .gitignore                    # ملفات Git المستبعدة
├── README.md                     # الوثائق الرئيسية
└── PROJECT_STRUCTURE.md          # هذا الملف
```

## تدفق البيانات (Data Flow)

### 1. إنشاء جلسة مقابلة
```
Frontend → POST /api/sessions → SessionController → Database
```

### 2. إرسال رسالة
```
Frontend → POST /api/sessions/:id/messages → MessageController → Database
```

### 3. استقبال Webhook من Vapi
```
Vapi → POST /api/webhooks/vapi → WebhookController → Database + Queue
```

### 4. رفع ملف صوتي
```
Frontend → POST /api/uploads → UploadController → S3 Pre-signed URL
Frontend → PUT (S3) → S3 Storage
```

### 5. تصدير البيانات
```
Frontend → GET /api/export/dataset → ExportController → Database → JSONL File
```

## قاعدة البيانات

### الجداول (Tables)

1. **sessions** - الجلسات
   - id (UUID)
   - user_id (UUID, nullable)
   - vapi_call_id (String)
   - status (Enum)
   - started_at, ended_at (Date)
   - duration (Integer)
   - quality_score (Float)
   - metadata (JSONB)

2. **messages** - الرسائل
   - id (UUID)
   - session_id (UUID, FK)
   - role (Enum: user, assistant, system)
   - text (Text)
   - audio_url (String)
   - tokens (Integer)
   - timestamp (BigInt)
   - vapi_message_id (String)
   - metadata (JSONB)

3. **files** - الملفات
   - id (UUID)
   - session_id (UUID, FK, nullable)
   - file_id (String, unique)
   - url (String)
   - s3_key (String, unique)
   - duration (Integer)
   - type (Enum)
   - content_type (String)
   - size (BigInt)
   - metadata (JSONB)

4. **users** - المستخدمون
   - id (UUID)
   - email (String, unique)
   - password (String, hashed)
   - name (String)
   - role (Enum: admin, user)
   - is_active (Boolean)
   - last_login (Date)

### العلاقات (Relationships)

- Session hasMany Messages
- Session hasMany Files
- User hasMany Sessions
- Message belongsTo Session
- File belongsTo Session
- Session belongsTo User

## المهام الخلفية (Background Jobs)

### BullMQ Queue: audio-processing

معالجة ملفات الصوت:
- تحميل الصوت
- تحويل إلى نص (Speech-to-Text) - قابل للتوسع
- استخراج البيانات الوصفية
- تحديث قاعدة البيانات

## التخزين (Storage)

### S3-Compatible Storage

- الملفات الصوتية للمقابلات
- النصوص المنسوخة
- أي ملفات أخرى متعلقة بالجلسات

### Redis

- BullMQ queues
- Caching (قابل للتوسع)

## الأمان

- JWT للمصادقة
- Bcrypt لتشفير كلمات المرور
- Helmet.js لحماية HTTP headers
- Rate limiting للحماية من الازدحام
- CORS محدد للواجهة الأمامية فقط

## السجلات (Logging)

- Winston logger
- Daily rotating log files
- Structured JSON logging
- Error tracking
- Event tracking

## API Endpoints Summary

### Public Endpoints (لا تحتاج مصادقة)
- `POST /api/sessions` - إنشاء جلسة
- `GET /api/sessions/:id` - جلب جلسة
- `POST /api/sessions/:id/messages` - إضافة رسالة
- `GET /api/sessions/:id/messages` - جلب الرسائل
- `POST /api/uploads` - رابط الرفع
- `POST /api/webhooks/vapi` - Webhook Vapi

### Protected Endpoints (تحتاج مصادقة)
- `GET /api/export/dataset` - تصدير البيانات
- `GET /api/export/sessions/:id` - تصدير جلسة

### Auth Endpoints
- `POST /api/auth/register` - تسجيل
- `POST /api/auth/login` - تسجيل دخول
- `GET /api/auth/verify` - التحقق من Token

## المتغيرات البيئية

راجع ملف `env.example` للحصول على قائمة كاملة.

## النشر

- **Development**: `npm run dev`
- **Production**: `npm start` أو PM2 أو Docker

راجع `docs/DEPLOYMENT.md` للتفاصيل.

