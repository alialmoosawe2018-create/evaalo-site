// ============================================
// ملف: services/headHunterPhotoMirror.ts
// الوظيفة: نسخ صور المرشحين من شبكة المزوّد إلى R2 لحظة وصول النتائج،
//          واستبدال الروابط في الحمل بروابط من نطاقنا.
// ============================================
//
// المزوّد يعطينا عنواناً مؤقتاً لصورة على شبكته، وكانت الواجهة تعرضه كما هو.
// تلك العناوين تنتهي أو تُحذف مع الحساب، ونتائج الحملات محفوظة في المتصفح،
// فصور الحملات القديمة كانت تتحوّل تدريجياً إلى 404 وتسقط إلى حرف الاسم.
// النسخ هنا يجعل الصورة ملكنا فلا تنتهي، ويُخرج طلب الطرف الثالث من متصفح
// المستخدم أيضاً — فلا يعرف المزوّد من يستعرض أي مرشح.
//
// كل شيء هنا أفضلُ جهد: أي فشل يترك رابط المزوّد كما هو، وتبقى الواجهة تعمل
// كما كانت (وسقوطها إلى حرف الاسم عند الفشل موجود سلفاً في البطاقة واللوحة).

import crypto from 'crypto';
import { isR2Configured, uploadBuffer } from './r2Service.js';

/** بادئة مفاتيح الصور داخل الباكت. */
const PHOTO_KEY_PREFIX = 'headhunter-photos/';

/** مسار البثّ من الخلفية — عام بقصد، إذ لا يستطيع وسم <img> إرسال Bearer. */
const PHOTO_ROUTE_PATH = '/api/head-hunter/photo/';

/** الحقول التي قد تحمل صورة الملف الشخصي في حمل n8n / المزوّد. */
const PHOTO_FIELD_NAMES = new Set([
    'photo_url',
    'photourl',
    'profile_pic_url',
    'profilepicurl',
    'profile_picture_url',
    'profilepictureurl',
    'profile_image_url',
    'profileimageurl',
    'avatar_url',
    'avatarurl',
]);

/** صور الملفات الشخصية أصغر من هذا بكثير؛ الحدّ يمنع تحويل الويبهوك إلى قناة تحميل. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** مهلة قصيرة: الويبهوك ينتظرنا، وn8n ينتظر الويبهوك. */
const FETCH_TIMEOUT_MS = 5000;

/** سحب متزامن محدود حتى لا تتضخّم مدّة الويبهوك مع دفعة كبيرة. */
const FETCH_CONCURRENCY = 6;

/** سقف لكل حمل — دفعة واحدة لا يجوز أن تحتجز الويبهوك مهما كان حجمها. */
const MAX_PHOTOS_PER_PAYLOAD = 80;

/** عمق أقصى للمسح؛ حمل n8n متداخل لكن ليس بلا حدّ. */
const MAX_WALK_DEPTH = 8;

/**
 * مفاتيح رُفعت في عمر هذه العملية — تمنع إعادة سحب الصورة نفسها في كل بحث.
 * ليست ذاكرة صحّة (المفتاح موجود في R2 على أي حال)، بل توفير طلب فقط، فمسحها
 * عند بلوغ السقف غير مؤذٍ.
 */
const uploadedKeys = new Set<string>();
const UPLOADED_KEYS_CAP = 5000;

function rememberUploadedKey(key: string): void {
    if (uploadedKeys.size >= UPLOADED_KEYS_CAP) uploadedKeys.clear();
    uploadedKeys.add(key);
}

function getPublicApiBase(): string {
    return (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
}

/** مفتاح مشتقّ من الرابط: نفس الصورة عبر مرشحين أو أبحاث تُرفع مرّة واحدة. */
function photoHashForUrl(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex');
}

/** مفتاح الكائن داخل الباكت لبصمة معطاة. المسار يستخدمه ليقرأ ما رفعناه. */
export function headHunterPhotoObjectKey(hash: string): string {
    return `${PHOTO_KEY_PREFIX}${hash}`;
}

/** هل البصمة بالشكل الذي نولّده؟ يُستخدم للتحقق من مُعامل المسار. */
export function isHeadHunterPhotoHash(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value);
}

function publicPhotoUrl(hash: string): string {
    return `${getPublicApiBase()}${PHOTO_ROUTE_PATH}${hash}`;
}

/**
 * مضيفات لا نسحب منها. الروابط تأتي من حمل ويبهوك موثّق برمز نداء، لكنها في
 * الأصل نصّ من الخارج، ولا يجوز أن يجعلنا نصٌّ خارجيّ نطلب من شبكتنا الداخلية.
 * هذا فحص حرفيّ للمضيف ولا يلاحق ما يحلّه الـDNS، فهو تضييق لا حصانة كاملة؛
 * وما يخرج إلى المستخدم في كل الأحوال هو ما نتحقّق أنه صورة.
 */
function isBlockedHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') return true;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
}

/** هل هذا رابط صورة خارجيّ يستحقّ النسخ؟ روابطنا ذاتها تُترك كما هي (تكرار العملية آمن). */
function shouldMirror(url: string): boolean {
    if (url.startsWith(`${getPublicApiBase()}${PHOTO_ROUTE_PATH}`)) return false;
    if (url.includes(PHOTO_ROUTE_PATH)) return false;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return !isBlockedHost(parsed.hostname);
}

/** يجمع روابط الصور من أي شكل حمل — n8n يسلّم مصفوفات وكائنات متداخلة. */
function collectPhotoUrls(value: unknown, depth: number, out: Set<string>): void {
    if (depth > MAX_WALK_DEPTH || out.size >= MAX_PHOTOS_PER_PAYLOAD) return;
    if (Array.isArray(value)) {
        for (const item of value) collectPhotoUrls(item, depth + 1, out);
        return;
    }
    if (value == null || typeof value !== 'object') return;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw === 'string') {
            if (!PHOTO_FIELD_NAMES.has(key.toLowerCase())) continue;
            const url = raw.trim();
            if (url && shouldMirror(url) && out.size < MAX_PHOTOS_PER_PAYLOAD) out.add(url);
            continue;
        }
        collectPhotoUrls(raw, depth + 1, out);
    }
}

/** يستبدل كل نصّ يساوي رابطاً نسخناه، في أي حقل وأي عمق، دون تعديل الأصل. */
function rewriteUrls(value: unknown, map: Map<string, string>, depth: number): unknown {
    if (typeof value === 'string') return map.get(value) ?? value;
    if (depth > MAX_WALK_DEPTH) return value;
    if (Array.isArray(value)) return value.map((item) => rewriteUrls(item, map, depth + 1));
    if (value == null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        out[key] = rewriteUrls(raw, map, depth + 1);
    }
    return out;
}

async function fetchImage(url: string): Promise<{ body: Buffer; contentType: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
        if (!res.ok) return null;
        const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!contentType.startsWith('image/')) return null;
        const declared = Number(res.headers.get('content-length') || '');
        if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return null;
        return { body: bytes, contentType };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function mirrorOne(url: string): Promise<string | null> {
    const hash = photoHashForUrl(url);
    const objectKey = headHunterPhotoObjectKey(hash);
    if (uploadedKeys.has(objectKey)) return publicPhotoUrl(hash);

    const image = await fetchImage(url);
    if (!image) return null;
    try {
        await uploadBuffer(objectKey, image.body, image.contentType);
    } catch (err) {
        console.warn('[head-hunter] photo upload failed:', err instanceof Error ? err.message : err);
        return null;
    }
    rememberUploadedKey(objectKey);
    return publicPhotoUrl(hash);
}

async function mirrorAll(urls: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= urls.length) return;
            const url = urls[index];
            const mirrored = await mirrorOne(url);
            if (mirrored) map.set(url, mirrored);
        }
    });
    await Promise.all(workers);
    return map;
}

/**
 * ينسخ صور المرشحين في الحمل إلى R2 ويعيد حملاً روابطه من نطاقنا.
 *
 * يُنفَّذ داخل مسار الويبهوك قبل تخزين النتيجة، لا في الخلفية بعده: العميل
 * يستنسخ الحمل إلى `localStorage` من أول استطلاع يلتقطه، ونسخ لاحق لن يُدرك
 * ما حُفظ عنده أصلاً. الثمن ثوانٍ قليلة على الويبهوك، والمقابل أن ما يُحفظ عند
 * العميل صحيح من أول لحظة.
 *
 * يعيد الحمل كما هو دون أي طلب شبكة إذا لم يكن R2 مهيّأً، أو إن لم يكن لدينا
 * عنوان عامّ للخلفية في الإنتاج — إذ لا معنى لتخزين روابط تشير إلى localhost.
 */
export async function mirrorHeadHunterPhotos(payload: unknown): Promise<unknown> {
    if (!isR2Configured()) return payload;
    const base = getPublicApiBase();
    if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(base)) {
        console.warn('[head-hunter] PUBLIC_API_URL is not a public base — photos left on the provider');
        return payload;
    }

    const urls = new Set<string>();
    collectPhotoUrls(payload, 0, urls);
    if (urls.size === 0) return payload;

    const map = await mirrorAll([...urls]);
    if (map.size === 0) return payload;

    console.log(`[head-hunter] mirrored ${map.size}/${urls.size} candidate photo(s) to R2`);
    return rewriteUrls(payload, map, 0);
}
