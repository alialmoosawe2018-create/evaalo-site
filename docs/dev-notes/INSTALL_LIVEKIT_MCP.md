# 🚀 تثبيت LiveKit Docs MCP Server في Cursor

## الخطوات السريعة

### 1. افتح إعدادات Cursor

**Windows:**
```
اضغط: Ctrl + Shift + P
اكتب: "Preferences: Open User Settings (JSON)"
```

**Mac:**
```
اضغط: Cmd + Shift + P
اكتب: "Preferences: Open User Settings (JSON)"
```

### 2. أضف الإعدادات التالية

انسخ والصق هذا الكود في ملف `settings.json`:

```json
{
  "mcpServers": {
    "livekit-docs": {
      "url": "https://docs.livekit.io/mcp"
    }
  }
}
```

### 3. أعد تشغيل Cursor

أغلق Cursor تماماً وأعد فتحه.

## ✅ التحقق من التثبيت

بعد إعادة التشغيل، جرب:

1. اسأل Cursor: "كيف أستخدم AvatarSession في LiveKit؟"
2. يجب أن يحصل Cursor على معلومات من وثائق LiveKit مباشرة

## 📝 ملاحظات

- **الملف المرجعي:** `cursor-mcp-config.json` يحتوي على نفس الإعدادات
- **التوثيق الكامل:** راجع `LIVEKIT_MCP_SETUP.md`
- **Changelog:** راجع `LIVEKIT_PRODUCT_CHANGELOG.md`

## 🎯 الفوائد

بعد التثبيت، يمكنك:
- ✅ البحث في وثائق LiveKit مباشرة
- ✅ الحصول على أمثلة Python للـ Avatar
- ✅ فهم APIs بشكل أسرع
- ✅ بناء Avatar بشكل أفضل

---

**جاهز للاستخدام!** 🎉
