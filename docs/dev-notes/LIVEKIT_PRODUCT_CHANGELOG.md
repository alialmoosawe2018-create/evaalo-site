# Product Changelog

## LiveKit Docs MCP server

تم إطلاق "LiveKit Docs MCP server" الذي يسهل البحث في وثائق LiveKit لمساعدي البرمجة مثل Cursor، Claude Code، Codex، و Gemini CLI من خلال endpoint واحد لـ MCP. كما تم التوسع ليشمل:
- البحث في كود GitHub
- تغطية Changelog
- أمثلة Python

### تعليمات التثبيت لـ Claude Code:

```bash
claude mcp add --transport http livekit-docs https://docs.livekit.io/mcp
```

### تعليمات التثبيت لـ Cursor:

يمكن للمستخدمين النقر على الرابط المقدم أو إضافة JSON التالي يدوياً:

```json
{
  "livekit-docs": {
    "url": "https://docs.livekit.io/mcp"
  }
}
```

## New inference models

تم إضافة دعم لنماذج جديدة في LiveKit Inference. يُنصح المستخدمون بتحديث سلسلة النموذج في كود الـ Agent.

### نماذج STT (Speech-to-Text):

- **Deepgram Flux**
- **AssemblyAI Universal Streaming Multilingual**
- **ElevenLabs Scribe v2 Realtime**

### نماذج LLM (Large Language Model):

- **OpenAI GPT-5.1**
- **OpenAI GPT-5.1 Chat Latest**
- **OpenAI GPT-5.2**
- **OpenAI GPT-5.2 Chat Latest**
- **Gemini 3 Pro (Preview)**
- **Gemini 3 Flash (Preview)**
- **DeepSeek v3.2**

## معلومات إضافية

بالنسبة للمطورين في Scale tier، يوفر LiveKit Inference:
- أسعار أقل لـ STT و TTS
- دعم لـ cached LLM

---

**المصدر:** LiveKit Product Changelog
**التاريخ:** 2025
