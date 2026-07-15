# ✅ Transcript Aggregation Layer - حل Over-fragmentation

## ❌ **المشكلة:**

VAD (Voice Activity Detection) حساس جداً → يرسل كلمات مفردة كـ final transcripts:
- "I"
- "the"
- "your"
- "Can you"

**الأثر:**
- LLM يرد قبل اكتمال الجملة
- TTS يشتغل عدة مرات
- Avatar يبدأ ويتوقف ويعيد الحركة
- `playback_finished called more times than playback segments were captured`

---

## ✅ **الحل: Transcript Aggregation Layer**

### **الآلية:**

1. **Partial Transcripts:** إرسال للعرض فقط (real-time feedback)
2. **Final Transcripts:** تجميع في buffer
3. **Aggregation Rules:**
   - ⚡ **إرسال فوري:** إذا وصلنا إلى 5 كلمات (`MIN_WORDS_FOR_IMMEDIATE`)
   - ⏱️ **إرسال بعد delay:** انتظر 1.5 ثانية (`AGGREGATION_DELAY_MS`)
   - 🚫 **تجاهل قصير:** لا تعالج transcripts أقل من 3 كلمات (`MIN_WORDS_FOR_PROCESSING`)

---

## 📊 **الكود:**

```typescript
// ✅ FIX: Transcript Aggregation Layer
let transcriptBuffer: string[] = [];
let transcriptBufferTimeout: NodeJS.Timeout | null = null;
const AGGREGATION_DELAY_MS = 1500; // 1.5 ثانية
const MIN_WORDS_FOR_IMMEDIATE = 5; // 5 كلمات = إرسال فوري
const MIN_WORDS_FOR_PROCESSING = 3; // 3 كلمات = حد أدنى للـ LLM

// Partial transcripts → عرض فقط
if (!isFinal) {
    ws.send({ type: 'transcript', text: transcript, isFinal: false });
    return;
}

// Final transcripts → تجميع
if (isFinal && transcript.trim().length > 0) {
    transcriptBuffer.push(transcript.trim());
    
    const wordCount = transcriptBuffer.join(' ').split(/\s+/).length;
    
    // إرسال فوري إذا وصلنا 5 كلمات
    if (wordCount >= MIN_WORDS_FOR_IMMEDIATE) {
        await flushTranscriptBuffer();
    } else {
        // انتظر 1.5 ثانية
        transcriptBufferTimeout = setTimeout(async () => {
            await flushTranscriptBuffer();
        }, AGGREGATION_DELAY_MS);
    }
}
```

---

## 🎯 **النتيجة:**

✅ **لا مزيد من:** "I" → LLM → TTS → Avatar  
✅ **بدلاً من:** "I have experience in JavaScript and React" → LLM → TTS → Avatar  
✅ **Transcripts كاملة:** جمل كاملة بدلاً من كلمات مفردة  
✅ **Avatar مستقر:** لا يبدأ ويتوقف  
✅ **TTS مرة واحدة:** لكل جملة كاملة  

---

## 📋 **الإعدادات:**

- `AGGREGATION_DELAY_MS = 1500` (1.5 ثانية)
- `MIN_WORDS_FOR_IMMEDIATE = 5` (5 كلمات)
- `MIN_WORDS_FOR_PROCESSING = 3` (3 كلمات)

يمكن تعديل هذه القيم حسب الحاجة.
