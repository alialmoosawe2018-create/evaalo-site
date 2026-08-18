import React from 'react';
import { API_BASE_URL } from '../config/apiBase.js';

export const API_BASE = API_BASE_URL;

/**
 * نوع الملف مطبّعاً: السجلات الخام على المرشح تحمل `kind`، بينما صفوف Application
 * (applicationToStageListRow → app.attachments) تحمل نفس القيمة تحت `type`.
 * نقبل الاثنين حتى تظهر الشهادات/الـ CV/الصورة في كلا الشكلين.
 */
export function fileKind(f) {
    return (f && (f.kind || f.type)) || '';
}

/** فصل ملف السيرة والصورة (يدعم السجلات القديمة بدون kind/type) */
export function stage1FilesFromCandidate(candidate) {
    const files = candidate?.files;
    if (!files?.length) return { cv: null, photo: null };
    let cv = files.find((f) => fileKind(f) === 'cv');
    let photo = files.find((f) => fileKind(f) === 'photo');
    // Untagged legacy records fall back to mime sniffing, but a certificate is
    // never the CV or the profile photo.
    const untagged = files.filter((f) => fileKind(f) !== 'certificate');
    if (!cv) cv = untagged.find((f) => f.mimeType === 'application/pdf');
    if (!photo) photo = untagged.find((f) => String(f.mimeType || '').startsWith('image/'));
    return { cv, photo };
}

/** الشهادات المرفوعة مع الطلب (قد تكون PDF أو صوراً) */
export function candidateCertificates(candidate) {
    const files = candidate?.files;
    if (!files?.length) return [];
    return files
        .filter((f) => fileKind(f) === 'certificate' && f.filename)
        .map((f) => ({
            ...f,
            url: `${API_BASE}/uploads/${encodeURIComponent(f.filename)}`,
        }));
}

/** رابط CV كأيقونة PDF */
export function PdfCvLink({ href, fileName, size = 40 }) {
    const title = fileName || 'CV — PDF';
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            aria-label={title}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 0,
                verticalAlign: 'middle',
                borderRadius: '10px',
                transition: 'transform 0.15s ease, filter 0.15s ease',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.06)';
                e.currentTarget.style.filter = 'brightness(1.08)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.filter = 'none';
            }}
        >
            <svg
                width={size}
                height={size}
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                role="img"
            >
                <path
                    d="M10 4h18.5l9.5 9.5V44a2 2 0 01-2 2H10a2 2 0 01-2-2V6a2 2 0 012-2z"
                    fill="#DC2626"
                />
                <path d="M28.5 4V16H41" fill="#B91C1C" />
                <path
                    d="M28 4v11.5c0 .83.67 1.5 1.5 1.5H41"
                    stroke="#991B1B"
                    strokeWidth="0.5"
                    fill="none"
                    opacity="0.5"
                />
                <text
                    x="24"
                    y="30"
                    textAnchor="middle"
                    fill="white"
                    fontSize="11"
                    fontWeight="800"
                    fontFamily="system-ui, 'Segoe UI', sans-serif"
                    letterSpacing="-0.02em"
                >
                    PDF
                </text>
                <path
                    d="M14 34h20"
                    stroke="white"
                    strokeOpacity="0.35"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                />
            </svg>
        </a>
    );
}

/** عنوان صورة المتقدم من الملفات المرفوعة أو حقول قديمة */
export function candidatePhotoUrl(candidate) {
    const { photo } = stage1FilesFromCandidate(candidate);
    if (photo?.filename) {
        return `${API_BASE}/uploads/${encodeURIComponent(photo.filename)}`;
    }
    return candidate?.photo || candidate?.profilePhoto || null;
}

/**
 * خصائص صورة الأفاتار: أبعاد صريحة للتخطيط، بدون srcSet مكرر لنفس الملف (1x/2x لنفس الرابط لا يزيد الدقة).
 * للوضوح: اجعل حاوية `.candidate-avatar-ring` بعرض/ارتفاع العرض كاملاً دون border يأكل المساحة (استخدم box-shadow للحلقة).
 * @param {string|null|undefined} url
 * @param {number} layoutCssPx — عرض/ارتفاع العرض بالبكسل (مربع)
 * @returns {Record<string, never> | { src: string; width: number; height: number }}
 */
export function candidateAvatarImageProps(url, layoutCssPx) {
    if (!url || !layoutCssPx) return {};
    const px = Math.max(16, Math.round(layoutCssPx));
    return {
        src: url,
        width: px,
        height: px,
    };
}

/** عنوان ملف الـ CV (رفع حقيقي عبر /uploads، أو مسار عام لعينات أول تسجيل دخول) */
export function candidateCvUrl(candidate) {
    const { cv } = stage1FilesFromCandidate(candidate);
    if (cv?.filename) {
        const name = String(cv.filename);
        if (name.startsWith('/') || /^https?:\/\//i.test(name)) return name;
        if (cv.url && (String(cv.url).startsWith('/') || /^https?:\/\//i.test(String(cv.url)))) {
            return String(cv.url);
        }
        return `${API_BASE}/uploads/${encodeURIComponent(cv.filename)}`;
    }
    const direct = candidate?.cv || candidate?.cvUrl || null;
    return direct ? String(direct) : null;
}

/** اسم عرض ملف الـ CV (للعينات التجريبية أو المرفوعات) */
export function candidateCvFileName(candidate) {
    const { cv } = stage1FilesFromCandidate(candidate);
    if (cv?.originalName) return cv.originalName;
    if (cv?.filename && !String(cv.filename).startsWith('/')) return cv.filename;
    return candidate?.cvFileName || candidate?.cvOriginalName || null;
}

/* ------------------------------------------------------------------ */
/* Gender inference from name (heuristic)                              */
/* ------------------------------------------------------------------ */

/**
 * تطبيع نص الاسم لإمكانية المقارنة:
 * - يحذف الحركات والتشكيل العربي
 * - يوحّد همزات الألف (أ/إ/آ → ا)
 * - يحوّل التاء المربوطة إلى هاء (ة → ه) للمقارنة عبر الكتابات المختلفة (نأخذ الانتهاء قبل التطبيع)
 * - يصغّر اللاتيني ويحذف الفواصل/الواصلات
 */
function _normalizeNameToken(s) {
    if (!s) return '';
    return s
        .toLowerCase()
        .replace(/[\u064B-\u0652\u0670]/g, '')
        .replace(/[\u0623\u0625\u0622]/g, '\u0627')
        .replace(/\u0629/g, '\u0647')
        .replace(/[^\u0600-\u06ffa-z]/g, '');
}

/** أول كلمة من الاسم الكامل (الاسم الأول) كنقطة مرجعية للنوع. */
function _firstNameToken(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || '';
}

const _MALE_NAMES = new Set([
    // عربي
    'محمد', 'احمد', 'علي', 'حسن', 'حسين', 'عمر', 'يوسف', 'ابراهيم',
    'خالد', 'طارق', 'سعيد', 'كريم', 'مصطفى', 'مهند', 'عبدالله',
    'عبدالرحمن', 'عبدالعزيز', 'عبدالكريم', 'عبدالقادر', 'صالح',
    'سامي', 'هشام', 'وائل', 'فادي', 'فهد', 'فيصل', 'سعد', 'يحيى',
    'زياد', 'ضياء', 'ايمن', 'انس', 'بلال', 'مازن', 'مروان',
    'حمزة', 'اسامة', 'معاوية', 'عبيدة', // مذكر منتهي بـ ة (whitelist)
    'علاء', 'بهاء', 'رضا', 'مجيد', 'كاظم', 'جاسم', 'ناصر', 'جعفر',
    'صادق', 'حيدر', 'كرار', 'مرتضى', 'مهدي', 'منير', 'منذر',
    'نجم', 'نزار', 'وليد', 'يونس', 'ادم', 'اسحاق', 'اسماعيل',
    'سليمان', 'سلمان', 'داود', 'موسى', 'هارون', 'زكريا', 'يعقوب',
    'مالك', 'سيف', 'محمود', 'كاظم', 'باسم', 'ثائر', 'ثامر',
    // لاتيني / إنجليزي
    'mohammed', 'mohamed', 'muhammad', 'ali', 'omar', 'ahmed',
    'hassan', 'hussein', 'youssef', 'yousef', 'ibrahim', 'khaled',
    'tariq', 'said', 'kareem', 'mostafa', 'mustafa', 'mahmoud',
    'majid', 'haider', 'kadhim', 'kazem', 'mehdi', 'hamza', 'osama',
    'adam', 'adam', 'samer', 'sami', 'fadi', 'faisal', 'walid',
    'yahya', 'ziad', 'ayman', 'anas', 'bilal', 'wael', 'fahd',
    'abdallah', 'abdullah', 'abdulrahman', 'abdulkareem', 'saleh',
    'john', 'james', 'michael', 'david', 'william', 'richard',
    'thomas', 'mark', 'paul', 'andrew', 'kevin', 'brian', 'george',
]);

const _FEMALE_NAMES = new Set([
    // عربي
    'فاطمة', 'فاطمه', 'زينب', 'عائشة', 'عائشه', 'مريم', 'نور',
    'ليلى', 'هدى', 'سارة', 'ساره', 'رنا', 'رانيا', 'هاجر',
    'بثينة', 'بثينه', 'جميلة', 'جميله', 'سلوى', 'نجوى', 'سلمى',
    'هبة', 'هبه', 'هناء', 'هناءه', 'منى', 'منال', 'مها', 'مريم',
    'اسماء', 'اروى', 'ايمان', 'ايات', 'ايه', 'بسمة', 'بسمه',
    'تمارا', 'تيماء', 'دانية', 'دانيه', 'ديما', 'ديانا', 'دلال',
    'رحاب', 'رحمة', 'رحمه', 'ريم', 'روان', 'ريما', 'رغد',
    'زهراء', 'زهرة', 'زهره', 'سحر', 'سعاد', 'سندس', 'شذا',
    'شيماء', 'صبا', 'صفاء', 'ضحى', 'عبير', 'علا', 'غادة', 'غاده',
    'فدوى', 'كوثر', 'لمى', 'لينا', 'مرام', 'مادلين', 'ميس',
    'نادية', 'ناديه', 'نسرين', 'نهى', 'هالة', 'هاله', 'هند',
    'وفاء', 'وعد', 'يسرى', 'لارا', 'تالا', 'لميس', 'بيان',
    // لاتيني / إنجليزي
    'fatima', 'fatma', 'zeinab', 'aisha', 'maryam', 'mariam',
    'noor', 'nour', 'layla', 'leila', 'laila', 'hoda', 'huda',
    'sara', 'sarah', 'rana', 'rania', 'salma', 'salwa', 'najwa',
    'lara', 'tala', 'lamis', 'bayan', 'reem', 'rawan', 'rima',
    'mary', 'jennifer', 'linda', 'patricia', 'barbara', 'susan',
    'jessica', 'sarah', 'karen', 'nancy', 'lisa', 'betty', 'helen',
    'sandra', 'donna', 'carol', 'ruth', 'sharon', 'michelle',
]);

/**
 * يستنتج جنس المرشح من الاسم الأول وفق ثلاث طبقات:
 *   1) قاموس أسماء (مذكر/مؤنث) عربي + لاتيني.
 *   2) قواعد لاحقة عربية: انتهاء بـ ة/ه/ى ⇒ غالباً female، إلا أسماء استثناء (whitelist).
 *   3) عند الفشل: 'unknown'.
 *
 * إذا كان الـ candidate نفسه يحمل حقل gender صالح ('male'/'female') يُعتمد مباشرة.
 */
export function inferGenderFromName(input) {
    const raw =
        typeof input === 'object' && input != null
            ? (input.gender && ['male', 'female'].includes(String(input.gender).toLowerCase())
                ? String(input.gender).toLowerCase()
                : null)
            : null;
    if (raw) return raw;

    const fullName =
        typeof input === 'string'
            ? input
            : (input?.full_name || input?.fullName || '');
    const firstRaw = _firstNameToken(fullName);
    if (!firstRaw) return 'unknown';
    const norm = _normalizeNameToken(firstRaw);
    if (!norm) return 'unknown';

    if (_MALE_NAMES.has(norm)) return 'male';
    if (_FEMALE_NAMES.has(norm)) return 'female';

    // قواعد لاحقة عربية على الـ token الأصلي قبل تطبيع التاء المربوطة
    const last = firstRaw[firstRaw.length - 1];
    if (last === '\u0629' /* ة */) {
        // أسماء مذكر تنتهي بـ ة معروفة (whitelist بعد التطبيع)
        const maleTaaWhitelist = new Set(['حمزه', 'اسامه', 'معاويه', 'عبيده', 'طلحه', 'قتاده']);
        if (maleTaaWhitelist.has(norm)) return 'male';
        return 'female';
    }
    if (last === '\u0649' /* ى */ || last === '\u0627' /* ا */) {
        // أسماء ذكورية شائعة تنتهي بـ ى/ا (استثناءات إضافية)
        const maleAlefWhitelist = new Set(['موسى', 'عيسى', 'يحيى', 'مرتضى', 'مهدى', 'يونا', 'ادم']);
        if (maleAlefWhitelist.has(_normalizeNameToken(firstRaw))) return 'male';
        if (last === '\u0649') return 'female'; // سلمى/نجوى
    }

    return 'unknown';
}

/**
 * أفاتار رسمي مبسّط (Material-style): ظلّ أبيض على خلفية ذات تدرّج لوني واحد.
 * - لا تفاصيل وجه — يقرأ بوضوح حتى عند 32px.
 * - female: ظل بشعر متوسط/طويل يحتضن الكتفين.
 * - male: ظل بشعر قصير وفك واضح.
 * - unknown: نفس قاعدة male بألوان رمادية حيادية.
 */
export function GenderAvatar({ gender, size = 52 }) {
    const variant = gender === 'female' ? 'female' : gender === 'male' ? 'male' : 'unknown';
    const aria =
        variant === 'female'
            ? 'Female candidate avatar'
            : variant === 'male'
                ? 'Male candidate avatar'
                : 'Candidate avatar';

    const palette = {
        female: { bg1: '#F472B6', bg2: '#9333EA', ring: 'rgba(255,255,255,0.45)' },
        male: { bg1: '#38BDF8', bg2: '#2563EB', ring: 'rgba(255,255,255,0.45)' },
        unknown: { bg1: '#94A3B8', bg2: '#475569', ring: 'rgba(255,255,255,0.40)' },
    }[variant];

    const idBg = `ga-bg-${variant}`;
    const idClip = `ga-clip-${variant}`;
    const fgFill = '#ffffff';

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 64 64"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label={aria}
            style={{ display: 'block' }}
        >
            <defs>
                <linearGradient id={idBg} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={palette.bg1} />
                    <stop offset="100%" stopColor={palette.bg2} />
                </linearGradient>
                <clipPath id={idClip}>
                    <circle cx="32" cy="32" r="32" />
                </clipPath>
            </defs>

            <circle cx="32" cy="32" r="32" fill={`url(#${idBg})`} />

            <g clipPath={`url(#${idClip})`} fill={fgFill}>
                {variant === 'female' && (
                    <>
                        {/* رأس + شعر متوسط يلامس الكتفين */}
                        <path d="M32 14 C 24 14, 19 19, 19 27 C 19 30, 19.5 33, 21 35.5 L 21 41 L 17 47 L 17 50 L 47 50 L 47 47 L 43 41 L 43 35.5 C 44.5 33, 45 30, 45 27 C 45 19, 40 14, 32 14 Z" />
                        {/* أكتاف وقميص */}
                        <path d="M10 64 C 11 54, 19 49, 26 47.5 L 26 49 C 26 51, 28.5 52.5, 32 52.5 C 35.5 52.5, 38 51, 38 49 L 38 47.5 C 45 49, 53 54, 54 64 Z" />
                    </>
                )}

                {(variant === 'male' || variant === 'unknown') && (
                    <>
                        {/* رأس بشعر قصير أعلى الجبهة */}
                        <path d="M32 13 C 24.5 13, 20 18.5, 20 26 C 20 32.5, 24 38, 28.5 39.5 L 28.5 41 L 28.5 43 L 35.5 43 L 35.5 41 L 35.5 39.5 C 40 38, 44 32.5, 44 26 C 44 18.5, 39.5 13, 32 13 Z" />
                        {/* أكتاف وقميص */}
                        <path d="M10 64 C 11 54, 20 49, 28 47.5 L 28 49 C 28 50.5, 30 51.8, 32 51.8 C 34 51.8, 36 50.5, 36 49 L 36 47.5 C 44 49, 53 54, 54 64 Z" />
                    </>
                )}
            </g>

            {/* حلقة داخلية بيضاء خفيفة لإبراز الحواف عند الأحجام الصغيرة */}
            <circle
                cx="32"
                cy="32"
                r="31"
                fill="none"
                stroke={palette.ring}
                strokeWidth="1"
            />
        </svg>
    );
}

/**
 * يقرّر هل نعرض GenderAvatar بدل الحرف الأول.
 * - يعرضه فقط للمرشحين المباشرين (entryStage === 'audio' | 'video') ولا توجد صورة.
 * - Start Process يبقى بسلوكه الأصلي (الحرف الأول).
 */
export function shouldUseGenderAvatar(candidate, photoUrl) {
    if (photoUrl) return false;
    const stage = candidate?.entryStage;
    return stage === 'audio' || stage === 'video';
}
