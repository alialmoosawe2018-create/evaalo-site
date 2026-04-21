// ============================================
// ملف: services/audioUtils.ts
// الوظيفة: تحويل PCM16 إلى WAV (مشترك بين STT services)
// ============================================

/**
 * تحويل PCM16 إلى WAV format
 */
export function convertPCM16ToWAV(
  pcmData: Buffer,
  sampleRate: number,
  channels: number
): Buffer {
  const dataLength = pcmData.length;
  const fileSize = 36 + dataLength;

  const wavHeader = Buffer.alloc(44);

  // RIFF header
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(fileSize - 8, 4);
  wavHeader.write("WAVE", 8);

  // fmt chunk
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(sampleRate * channels * 2, 28);
  wavHeader.writeUInt16LE(channels * 2, 32);
  wavHeader.writeUInt16LE(16, 34);

  // data chunk
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(dataLength, 40);

  return Buffer.concat([wavHeader, pcmData]);
}
