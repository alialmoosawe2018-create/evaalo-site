// ============================================
// ملف: services/deepgramPreRecordedService.ts
// الوظيفة: Deepgram Pre-Recorded API للـ STT (الإنجليزية)
// ============================================

import axios from "axios";
import { convertPCM16ToWAV } from "./audioUtils.js";

const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen";

/**
 * تحويل PCM16 إلى نص باستخدام Deepgram (مُحسّن للإنجليزية)
 */
export async function transcribePCM(pcmBuffer: Buffer): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  if (!pcmBuffer || pcmBuffer.length === 0) {
    return "";
  }

  // Deepgram يقبل raw PCM مع encoding param، أو WAV
  const wavBuffer = convertPCM16ToWAV(pcmBuffer, 16000, 1);

  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    model: "nova-2",
    language: "en",
    punctuate: "true",
  });

  const url = `${DEEPGRAM_API_URL}?${params}`;

  try {
    const response = await axios.post(url, wavBuffer, {
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "audio/wav",
      },
      timeout: 30000,
      maxBodyLength: Infinity,
    });

    const transcript =
      response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    return transcript.trim();
  } catch (err: any) {
    if (err.response?.status === 400) {
      throw new Error(`Deepgram invalid config: ${err.response?.data?.err_msg || err.message}`);
    }
    if (err.response?.status === 429) {
      throw new Error("Deepgram rate limit exceeded");
    }
    throw err;
  }
}
