# إعداد LiveKit Docs MCP Server في Cursor

## ما هو LiveKit Docs MCP Server؟

LiveKit Docs MCP server يسمح لـ Cursor بالبحث في وثائق LiveKit مباشرة، مما يساعد في:
- بناء Avatar بشكل أفضل
- فهم API بشكل أسرع
- الحصول على أمثلة Python
- البحث في كود GitHub

## خطوات التثبيت

### الطريقة 1: من خلال إعدادات Cursor (الأسهل)

1. افتح Cursor
2. اضغط على `Ctrl + Shift + P` (أو `Cmd + Shift + P` على Mac)
3. ابحث عن: `Cursor: Open Settings`
4. ابحث عن: `MCP` أو `Model Context Protocol`
5. أضف الإعدادات التالية:

```json
{
  "mcpServers": {
    "livekit-docs": {
      "url": "https://docs.livekit.io/mcp"
    }
  }
}
```

### الطريقة 2: من خلال ملف الإعدادات مباشرة

1. افتح ملف إعدادات Cursor:
   - Windows: `%APPDATA%\Cursor\User\settings.json`
   - Mac: `~/Library/Application Support/Cursor/User/settings.json`
   - Linux: `~/.config/Cursor/User/settings.json`

2. أضف الإعدادات التالية في `settings.json`:

```json
{
  "mcpServers": {
    "livekit-docs": {
      "url": "https://docs.livekit.io/mcp"
    }
  }
}
```

3. أعد تشغيل Cursor

### الطريقة 3: استخدام ملف منفصل (موصى به)

1. أنشئ ملف `cursor-mcp-config.json` في مجلد المشروع
2. انسخ المحتوى من `cursor-mcp-config.json` الموجود في المشروع
3. أضف الإعدادات إلى Cursor يدوياً

## التحقق من التثبيت

بعد إعادة تشغيل Cursor، يجب أن ترى:
- LiveKit Docs متاح في Cursor
- يمكنك البحث في وثائق LiveKit مباشرة
- أمثلة Python متاحة

## الاستخدام

بعد التثبيت، يمكنك:
1. سؤال Cursor عن LiveKit APIs
2. طلب أمثلة على Avatar integration
3. البحث في وثائق LiveKit مباشرة

مثال:
```
"كيف أستخدم AvatarSession في LiveKit؟"
"أعطني مثال على Python لبناء Avatar agent"
```

## ملاحظات

- يتطلب اتصال بالإنترنت
- يعمل مع Cursor و Claude Code و Codex و Gemini CLI
- يدعم البحث في GitHub code و Changelog

---

**راجع:** `LIVEKIT_PRODUCT_CHANGELOG.md` للمزيد من المعلومات
