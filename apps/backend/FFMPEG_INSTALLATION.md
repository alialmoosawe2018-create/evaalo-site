# FFmpeg Installation Guide

## ⚠️ مهم جداً: FFmpeg مطلوب لتحويل الصوت

لحل مشكلة STT (Speech-to-Text)، نحتاج إلى تحويل الصوت من `webm/opus` إلى `wav (pcm16, 16kHz, mono)`.

هذا يتطلب تثبيت **FFmpeg** على النظام.

---

## 📥 تثبيت FFmpeg على Windows:

### الطريقة 1: استخدام Chocolatey (الأسهل)

**⚠️ مهم: يجب تشغيل PowerShell كـ Administrator**

```powershell
# 1. افتح PowerShell كـ Administrator (Run as Administrator)

# 2. إذا كان هناك lock file، احذفه أولاً:
Remove-Item -Path "C:\ProgramData\chocolatey\lib\c00565a56f0e64a50f2ea5badcb97694d43e0755" -Force -ErrorAction SilentlyContinue

# 3. تثبيت FFmpeg
choco install ffmpeg -y
```

**أو بدون Chocolatey:**
```powershell
# تثبيت Chocolatey أولاً (إذا لم يكن مثبتاً)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# تثبيت FFmpeg
choco install ffmpeg -y
```

### الطريقة 2: التحميل اليدوي (موصى به إذا فشلت الطريقة 1)

1. اذهب إلى: https://www.gyan.dev/ffmpeg/builds/
2. حمّل "ffmpeg-release-essentials.zip" (أو أحدث إصدار)
3. استخرج الملفات إلى مجلد (مثلاً: `C:\ffmpeg`)
4. أضف `ffmpeg.exe` إلى PATH:
   - اضغط `Win + R` واكتب `sysdm.cpl`
   - اضغط `Environment Variables`
   - في `System variables`، اختر `Path` واضغط `Edit`
   - اضغط `New` وأضف مسار `ffmpeg.exe` (مثلاً: `C:\ffmpeg\bin`)
   - اضغط `OK` في جميع النوافذ
   - **أعد تشغيل Terminal/PowerShell**

### الطريقة 3: استخدام winget (Windows 10/11)

```powershell
winget install ffmpeg
```

---

## ✅ التحقق من التثبيت:

```powershell
ffmpeg -version
```

يجب أن ترى معلومات عن FFmpeg.

---

## 🔧 بعد التثبيت:

1. **أعد تشغيل Terminal/Command Prompt**
2. **أعد تشغيل Backend:**
   ```bash
   cd cursor-react/apps/backend
   npm run dev
   ```

---

## 📝 ما يحدث الآن:

### قبل التثبيت:
- ❌ الصوت يُرسل كـ webm/opus
- ❌ Whisper لا يستطيع معالجته
- ❌ النتيجة: "Could you please repeat that?"

### بعد التثبيت:
- ✅ الصوت يُحول إلى wav (pcm16, 16kHz, mono)
- ✅ Whisper يستطيع معالجته بشكل صحيح
- ✅ النتيجة: نص صحيح من الكلام

---

## 🧪 اختبار:

بعد تثبيت FFmpeg وإعادة تشغيل Backend:

1. ابدأ المقابلة
2. تحدث بوضوح
3. تحقق من Backend console:
   - يجب أن ترى: `🔄 Converting webm/opus to wav...`
   - ثم: `✅ Audio converted successfully`
   - ثم: `📝 Whisper transcription result: [نصك هنا]`

---

## ⚠️ ملاحظات:

- **FFmpeg ضروري** - بدونها، التحويل سيفشل
- **أعد تشغيل Backend** بعد التثبيت
- **تحقق من PATH** إذا لم يعمل

---

## 🆘 إذا استمرت المشكلة:

1. تحقق من أن FFmpeg في PATH:
   ```powershell
   where.exe ffmpeg
   ```

2. تحقق من Backend logs للأخطاء

3. تأكد من أن Backend يعمل بعد إعادة التشغيل

