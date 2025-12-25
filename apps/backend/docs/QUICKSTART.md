# دليل البدء السريع - Quick Start Guide

## الخطوة 1: التثبيت

```bash
# تثبيت التبعيات
npm install
```

## الخطوة 2: إعداد قاعدة البيانات

### إنشاء قاعدة البيانات PostgreSQL

```sql
CREATE DATABASE evaalo_db;
```

### أو باستخدام psql:

```bash
psql -U postgres
CREATE DATABASE evaalo_db;
\q
```

## الخطوة 3: إعداد المتغيرات البيئية

```bash
# نسخ ملف المثال
cp .env.example .env
```

عدّل ملف `.env` بالمتغيرات التالية:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/evaalo_db

# Redis
REDIS_URL=redis://localhost:6379

# S3 (يمكنك استخدام MinIO محلياً للاختبار)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=evaalo-uploads
S3_KEY=minioadmin
S3_SECRET=minioadmin
S3_REGION=us-east-1

# JWT
JWT_SECRET=your-super-secret-key-change-this

# Custom LLM
CUSTOM_LLM_URL=https://api.evaalo.com/v1/chat/completions
CUSTOM_LLM_SERVER_KEY=your-server-key

# Vapi
VAPI_WEBHOOK_SECRET=your-webhook-secret
```

## الخطوة 4: تشغيل قاعدة البيانات و Redis

### PostgreSQL
```bash
# Linux/Mac
sudo systemctl start postgresql

# أو باستخدام Docker
docker run -d --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15
```

### Redis
```bash
# Linux/Mac
sudo systemctl start redis

# أو باستخدام Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

## الخطوة 5: تشغيل Migrations

```bash
npm run migrate
```

سيتم إنشاء جميع الجداول في قاعدة البيانات تلقائياً.

## الخطوة 6: تشغيل الخادم

### وضع التطوير
```bash
npm run dev
```

### وضع الإنتاج
```bash
npm start
```

الخادم سيعمل على: `http://localhost:3000`

## الخطوة 7: اختبار API

### فحص الحالة
```bash
curl http://localhost:3000/api/health
```

### إنشاء جلسة
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"metadata": {}}'
```

## المشاكل الشائعة

### خطأ في الاتصال بقاعدة البيانات
- تأكد من تشغيل PostgreSQL
- تحقق من صحة `DATABASE_URL` في ملف `.env`
- تأكد من وجود قاعدة البيانات

### خطأ في الاتصال بـ Redis
- تأكد من تشغيل Redis
- تحقق من صحة `REDIS_URL` في ملف `.env`

### خطأ في S3
- للاختبار المحلي، يمكنك استخدام MinIO:
```bash
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data --console-address ":9001"
```

ثم في `.env`:
```env
S3_ENDPOINT=http://localhost:9000
S3_KEY=minioadmin
S3_SECRET=minioadmin
```

## الخطوة التالية

- راجع [وثائق API](./API.md) لمعرفة جميع المسارات
- راجع [دليل النشر](./DEPLOYMENT.md) لنشر الخادم

