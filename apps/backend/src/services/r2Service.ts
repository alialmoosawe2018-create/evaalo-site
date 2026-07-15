// ============================================
// ملف: services/r2Service.ts
// الوظيفة: رفع ملفات خاصة (Private) إلى Cloudflare R2 وتوليد روابط تنزيل
// موقّتة (Presigned URLs) عند الطلب. لا تُخزَّن روابط دائمة في قاعدة البيانات.
// R2 متوافق مع S3 API، لذا نستخدم @aws-sdk/client-s3.
// ============================================

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let cachedClient: S3Client | null = null;

function getAccountId(): string | undefined {
  return process.env.R2_ACCOUNT_ID?.trim() || undefined;
}

function getBucket(): string | undefined {
  return process.env.R2_BUCKET?.trim() || undefined;
}

/** هل إعدادات R2 مكتملة؟ يُستخدم لتفعيل/تعطيل التسجيل دون كسر بقية النظام. */
export function isR2Configured(): boolean {
  return Boolean(
    getAccountId() &&
    getBucket() &&
    process.env.R2_ACCESS_KEY_ID?.trim() &&
    process.env.R2_SECRET_ACCESS_KEY?.trim()
  );
}

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = getAccountId();
  if (!accountId) throw new Error('R2_ACCOUNT_ID is not configured');
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });
  return cachedClient;
}

/**
 * رفع buffer إلى R2 كملف خاص (دون روابط عامة).
 * @param key مسار/مفتاح الكائن داخل الباكت (مثل: voice-recordings/<org>/<candidate>/<session>.mp3)
 * @param body محتوى الملف
 * @param contentType نوع المحتوى (مثل: audio/mpeg)
 */
export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * توليد رابط تنزيل موقّت (Presigned GET URL) لمفتاح موجود.
 * @param key مفتاح الكائن
 * @param expiresSeconds مدة صلاحية الرابط بالثواني (افتراضي ساعة واحدة)
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresSeconds: number = 3600
): Promise<string> {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn: expiresSeconds }
  );
}
