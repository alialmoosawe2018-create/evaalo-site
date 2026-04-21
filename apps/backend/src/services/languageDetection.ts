// ============================================
// ملف: services/languageDetection.ts
// الوظيفة: كشف لغة الصوت باستخدام Whisper على عينة قصيرة (LID)
// ============================================

import axios from "axios";
import FormData from "form-data";
import { convertPCM16ToWAV } from "./audioUtils.js";

const OPENAI_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const LID_SAMPLE_MS = 2000; // أول 2 ثانية للكشف عن اللغة
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // PCM16

/**
 * كشف لغة الصوت باستخدام Whisper على عينة قصيرة
 * @param pcmBuffer - PCM16 buffer (16kHz, mono)
 * @returns 'en' | 'ar' | 'unknown'
 */
export async function detectLanguage(pcmBuffer: Buffer): Promise<"en" | "ar" | "unknown"> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return "unknown";
  }

  // أخذ أول 2 ثانية فقط للتوفير
  const sampleBytes = Math.min(
    pcmBuffer.length,
    (LID_SAMPLE_MS / 1000) * SAMPLE_RATE * BYTES_PER_SAMPLE
  );
  const sample = pcmBuffer.subarray(0, sampleBytes);

  if (sample.length < 3200) {
    // أقل من 100ms
    return "unknown";
  }

  const wavBuffer = convertPCM16ToWAV(sample, SAMPLE_RATE, 1);
  const formData = new FormData();
  formData.append("file", wavBuffer, {
    filename: "lid.wav",
    contentType: "audio/wav",
  });
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json"); // لإرجاع language

  try {
    const response = await axios.post(OPENAI_API_URL, formData, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...formData.getHeaders(),
      },
      timeout: 15000,
    });

    const lang = (response.data?.language || "").toLowerCase();
    if (lang === "en" || lang.startsWith("en")) return "en";
    if (lang === "ar" || lang.startsWith("ar")) return "ar";
    return "unknown";
  } catch (err) {
    console.error(`[LID ERROR] ${(err as Error).message}`);
    return "unknown";
  }
}
