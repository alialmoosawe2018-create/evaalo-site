// ============================================
// ملف: services/speechmaticsBatchService.ts
// الوظيفة: Speechmatics Batch API للـ STT (العربية)
// ============================================

import axios from "axios";
import FormData from "form-data";
import { convertPCM16ToWAV } from "./audioUtils.js";

const SPEECHMATICS_API_URL = "https://asr.api.speechmatics.com/v2/jobs";
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 30000;

/**
 * تحويل PCM16 إلى نص باستخدام Speechmatics Batch (مُحسّن للعربية)
 */
export async function transcribePCM(pcmBuffer: Buffer): Promise<string> {
  const key = process.env.SPEECHMATICS_API_KEY;
  if (!key) {
    throw new Error("SPEECHMATICS_API_KEY is not configured");
  }

  if (!pcmBuffer || pcmBuffer.length === 0) {
    return "";
  }

  const wavBuffer = convertPCM16ToWAV(pcmBuffer, 16000, 1);

  const formData = new FormData();
  formData.append("data_file", wavBuffer, {
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  formData.append(
    "config",
    JSON.stringify({
      type: "transcription",
      transcription_config: {
        language: "ar",
      },
    })
  );

  try {
    const createRes = await axios.post(SPEECHMATICS_API_URL, formData, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...formData.getHeaders(),
      },
      timeout: 15000,
    });

    const jobId = createRes.data?.id;
    if (!jobId) {
      throw new Error("Speechmatics did not return job ID");
    }

    const transcript = await pollForResult(jobId, key);
    return transcript;
  } catch (err: any) {
    if (err.response?.status === 400) {
      throw new Error(
        `Speechmatics invalid config: ${JSON.stringify(err.response?.data) || err.message}`
      );
    }
    if (err.response?.status === 429) {
      throw new Error("Speechmatics rate limit exceeded");
    }
    throw err;
  }
}

async function pollForResult(jobId: string, apiKey: string): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const res = await axios.get(`${SPEECHMATICS_API_URL}/${jobId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 10000,
    });

    const status = res.data?.job?.status;
    if (status === "done") {
      const transcriptRes = await axios.get(
        `${SPEECHMATICS_API_URL}/${jobId}/transcript?format=txt`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10000,
          responseType: "text",
        }
      );
      const transcript = typeof transcriptRes.data === "string" ? transcriptRes.data : "";
      return transcript.trim();
    }
    if (status === "failed") {
      throw new Error(
        `Speechmatics job failed: ${res.data?.job?.failure_reason || "unknown"}`
      );
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Speechmatics transcription timeout");
}
