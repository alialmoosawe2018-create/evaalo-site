# دليل النشر - Deployment Guide

## النشر باستخدام PM2

### 1. تثبيت PM2
```bash
npm install -g pm2
```

### 2. إعداد المتغيرات البيئية
```bash
cp .env.example .env
# عدّل ملف .env بقيمك الخاصة
```

### 3. تشغيل Migrations
```bash
npm run migrate
```

### 4. تشغيل الخادم باستخدام PM2
```bash
pm2 start ecosystem.config.cjs --env production
```

### 5. حفظ إعدادات PM2
```bash
pm2 save
pm2 startup
```

### 6. إدارة الخادم
```bash
pm2 status              # عرض حالة الخادم
pm2 logs evaalo-backend # عرض السجلات
pm2 restart evaalo-backend # إعادة التشغيل
pm2 stop evaalo-backend    # إيقاف
pm2 delete evaalo-backend  # حذف
```

## النشر باستخدام Docker

### 1. بناء الصورة
```bash
docker build -t evaalo-backend .
```

### 2. تشغيل باستخدام Docker Compose
```bash
docker-compose up -d
```

### 3. تشغيل Migrations في الحاوية
```bash
docker-compose exec backend npm run migrate
```

### 4. إدارة الحاويات
```bash
docker-compose logs -f backend    # عرض السجلات
docker-compose restart backend    # إعادة التشغيل
docker-compose stop               # إيقاف
docker-compose down               # إيقاف وحذف
```

## النشر على VPS

### المتطلبات
- Ubuntu 20.04+ أو أي توزيعة Linux حديثة
- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Nginx (اختياري للـ HTTPS)

### خطوات النشر

#### 1. تحديث النظام
```bash
sudo apt update
sudo apt upgrade -y
```

#### 2. تثبيت Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

#### 3. تثبيت PostgreSQL
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### 4. إعداد قاعدة البيانات
```bash
sudo -u postgres psql
```

في psql:
```sql
CREATE DATABASE evaalo_db;
CREATE USER evaalo WITH PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE evaalo_db TO evaalo;
\q
```

#### 5. تثبيت Redis
```bash
sudo apt install -y redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

#### 6. نسخ المشروع
```bash
cd /var/www
sudo git clone <your-repo-url> evaalo-backend
cd evaalo-backend
```

#### 7. تثبيت التبعيات
```bash
npm install --production
```

#### 8. إعداد المتغيرات البيئية
```bash
cp .env.example .env
nano .env
```

عدّل القيم:
- `DATABASE_URL=postgresql://evaalo:your-password@localhost:5432/evaalo_db`
- `REDIS_URL=redis://localhost:6379`
- `JWT_SECRET=` (مفتاح عشوائي قوي)
- وغيرها من القيم

#### 9. تشغيل Migrations
```bash
npm run migrate
```

#### 10. تشغيل باستخدام PM2
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

#### 11. إعداد Nginx (لـ HTTPS)

تثبيت Nginx:
```bash
sudo apt install -y nginx
```

نسخ ملف الإعداد:
```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/evaalo-backend
sudo nano /etc/nginx/sites-available/evaalo-backend
```

تفعيل الموقع:
```bash
sudo ln -s /etc/nginx/sites-available/evaalo-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 12. إعداد SSL مع Let's Encrypt
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.evaalo.com
```

#### 13. فتح المنافذ في Firewall
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## مراقبة الأداء

### عرض السجلات
```bash
# PM2 logs
pm2 logs evaalo-backend

# Application logs
tail -f logs/combined-*.log

# Error logs
tail -f logs/error-*.log
```

### مراقبة الموارد
```bash
pm2 monit
```

### إحصائيات قاعدة البيانات
```bash
sudo -u postgres psql evaalo_db
```

```sql
SELECT COUNT(*) FROM sessions;
SELECT COUNT(*) FROM messages;
SELECT COUNT(*) FROM files;
```

## النسخ الاحتياطي

### نسخ احتياطي لقاعدة البيانات
```bash
sudo -u postgres pg_dump evaalo_db > backup_$(date +%Y%m%d).sql
```

### استعادة قاعدة البيانات
```bash
sudo -u postgres psql evaalo_db < backup_20240101.sql
```

## التحديثات

### تحديث الكود
```bash
cd /var/www/evaalo-backend
git pull origin main
npm install --production
npm run migrate
pm2 restart evaalo-backend
```

## استكشاف الأخطاء

### فحص حالة الخدمات
```bash
sudo systemctl status postgresql
sudo systemctl status redis
pm2 status
```

### فحص الاتصال بقاعدة البيانات
```bash
psql $DATABASE_URL -c "SELECT version();"
```

### فحص الاتصال بـ Redis
```bash
redis-cli ping
```

### فحص المنافذ
```bash
sudo netstat -tulpn | grep :3000
```

## الأمان

1. **استخدم كلمات مرور قوية** لجميع الخدمات
2. **حدث النظام بانتظام**: `sudo apt update && sudo apt upgrade`
3. **استخدم HTTPS فقط** في الإنتاج
4. **احمِ ملف .env** ولا تشاركه أبداً
5. **استخدم firewall** (ufw) لحماية الخادم
6. **راقب السجلات** بانتظام للكشف عن الأنشطة المشبوهة

