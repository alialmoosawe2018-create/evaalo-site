# إعداد رابط Webhook لـ n8n

## السيناريوهات المختلفة:

### 1. السيرفر يعمل محلياً (localhost) و n8n على نفس الجهاز

**استخدم:**
```
http://localhost:5000/webhook/n8n
```

### 2. السيرفر يعمل محلياً و n8n على سيرفر خارجي

**الحل: استخدام ngrok**

#### خطوات الإعداد:

1. **تثبيت ngrok:**
   - حمّل من: https://ngrok.com/download
   - أو استخدم: `npm install -g ngrok`

2. **تشغيل ngrok:**
   ```bash
   ngrok http 5000
   ```

3. **ستحصل على رابط مثل:**
   ```
   https://abc123.ngrok.io
   ```

4. **استخدم في n8n:**
   ```
   https://abc123.ngrok.io/webhook/n8n
   ```

**ملاحظة:** الرابط يتغير في كل مرة تشغل ngrok (في النسخة المجانية). للحصول على رابط ثابت، تحتاج إلى حساب مدفوع.

### 3. السيرفر على سيرفر (VPS/Cloud)

#### أ) إذا كان لديك عنوان IP ثابت:

```
http://YOUR_IP_ADDRESS:5000/webhook/n8n
```

مثال:
```
http://192.168.1.100:5000/webhook/n8n
```

#### ب) إذا كان لديك Domain Name:

```
http://yourdomain.com:5000/webhook/n8n
```

أو:
```
https://yourdomain.com/webhook/n8n
```
(إذا كان لديك SSL certificate)

### 4. السيرفر على Cloud Service (Heroku, Railway, etc.)

استخدم الرابط الذي يوفره الخدمة:

**مثال Heroku:**
```
https://your-app-name.herokuapp.com/webhook/n8n
```

**مثال Railway:**
```
https://your-app-name.up.railway.app/webhook/n8n
```

## التحقق من الرابط:

### اختبار محلي:
```bash
curl http://localhost:5000/webhook/n8n
```

### اختبار من n8n:
استخدم **HTTP Request** node في n8n لاختبار الاتصال.

## نصائح مهمة:

1. **الأمان:**
   - في الإنتاج، استخدم HTTPS
   - أضف authentication إذا لزم الأمر

2. **Firewall:**
   - تأكد من فتح المنفذ 5000 في Firewall
   - تأكد من أن السيرفر يستمع على `0.0.0.0` وليس فقط `localhost`

3. **CORS:**
   - تأكد من إعداد CORS بشكل صحيح في السيرفر

## مثال على الإعداد في n8n:

1. افتح **HTTP Request** node
2. Method: `POST`
3. URL: `http://localhost:5000/webhook/n8n` (أو الرابط المناسب لك)
4. Body Content Type: `multipart/form-data`
5. أضف البيانات والملفات

## استكشاف الأخطاء:

### خطأ: "Connection refused"
- تأكد من أن السيرفر يعمل
- تحقق من المنفذ 5000

### خطأ: "Timeout"
- تحقق من أن السيرفر متاح من خارج الجهاز
- استخدم ngrok للاختبار

### خطأ: "CORS error"
- تأكد من إعداد CORS في السيرفر
- أضف عنوان n8n إلى قائمة المسموح بها


