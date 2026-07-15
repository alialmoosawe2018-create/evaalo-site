# AI Head Hunter — استقبال نتائج من n8n (بدون تعارض مع المقابلات)

## تطوير + إنتاج (workflow واحد)

| البيئة | `PUBLIC_API_URL` | Frontend API | من يرى النتائج |
|--------|------------------|--------------|----------------|
| تطوير (محلي) | `http://100.73.82.78:5000` (Tailscale) | `http://localhost:5000` | localhost |
| إنتاج (VPS) | `https://api.evaalo.com` | `https://api.evaalo.com` | evaalo.com |

**شرط التطوير:** n8n على VPS متصل بـ Tailscale ويصل إلى IP جهازك (مثلاً `curl http://100.73.82.78:5000/`).

**لا تستخدم رابط callback ثابت في n8n** — استخدم `callbackUrl` من payload البحث فقط.

## تدفق الاتجاهين

| الاتجاه | المسار | الغرض |
|--------|--------|--------|
| المتصفح → الباكند → n8n | `POST /api/head-hunter/search` | إنشاء `searchId` + `callbackToken` وإرسال منصب، موقع، خيارات إلى `N8N_HEADHUNTER_WEBHOOK_URL` |
| n8n → الباكند | `POST /webhook/n8n/head-hunter?searchId=…&token=…` | JSON النتيجة من الـ workflow (مخزّن لكل `searchId`) |
| الواجهة ← الباكند | `GET /api/head-hunter/last-result?searchId=…` | نتيجة البحث للمستخدم الحالي فقط (auth + ملكية) |

## لماذا ليس `/webhook/stage1`؟

مسارات **المقابلات / الملفات / المرشح** منفصلة عن Head Hunter:

- `POST /webhook/n8n/stage1` … `stage3` و aliases `/webhook/stage1` … — تتوقع **candidateId** (ObjectId) وقد ترفق **ملفات** (multer)، وتحدّث سجل المرشح.
- **لا** تستخدمها لإرجاع نتائج بحث Head Hunter حتى لا يختلط المنطق ولا تظهر أخطاء `Valid candidate ID is required`.

## عقد API

### 1) الباكند → n8n (عند `POST /api/head-hunter/search`)

```json
{
  "searchId": "headhunter_…",
  "organizationId": "org_…",
  "userId": "user_…",
  "callbackUrl": "https://api.example.com/webhook/n8n/head-hunter?searchId=headhunter_…&token=<hex>",
  "inboundSecret": "<optional — for n8n X-Head-Hunter-Secret header>",
  "position": "HR Specialist",
  "location": "Baghdad, Iraq",
  "minCandidateCount": 20,
  "requiredLanguages": "Arabic, English",
  "requiredSkills": "Recruiting, HRIS",
  "source": "ai-head-hunter",
  "submittedAt": "2026-06-16T12:00:00.000Z"
}
```

- `callbackUrl` يُبنى من `PUBLIC_API_URL` في `.env` للبيئة التي شغّلت البحث.
- `token` في query = `callbackToken` عشوائي (32 بايت hex) يُتحقق منه عند inbound.

الاستجابة للواجهة:

```json
{
  "ok": true,
  "searchId": "headhunter_…",
  "status": "submitted"
}
```

### 2) n8n → الباكند (كل callback)

```
POST https://<HOST>/webhook/n8n/head-hunter?searchId=headhunter_…&token=<hex>
Content-Type: application/json
X-Head-Hunter-Secret: <N8N_HEADHUNTER_INBOUND_SECRET>
X-Idempotency-Key: {{ $execution.id }}-{{ linkedin_url or name per candidate }}
```

**مرشح واحد (LinkedIn):**

```json
{
  "searchId": "headhunter_…",
  "name": "Candidate Name",
  "job_title": "…",
  "experiences": []
}
```

**آخر callback (إلزامي لإعلان الاكتمال):**

```json
{
  "searchId": "headhunter_…",
  "searchComplete": true
}
```

يقبل أيضاً `completed: true` أو `done: true` بدلاً من `searchComplete`.

- مرشح مفرد: يُدمَج مع النتائج السابقة **لنفس searchId**
- دفعة `{ "candidates": [ … ] }`: تستبدل/تجمّع حسب منطق الدمج الحالي
- بدون `searchId` → `400`
- `searchId` غير معروف → `404`
- `token` خاطئ أو مفقود → `401`

### 3) الواجهة ← الباكند

```
GET /api/head-hunter/last-result?searchId=headhunter_…
Authorization: Bearer …
```

```json
{
  "ok": true,
  "searchId": "headhunter_…",
  "status": "submitted|completed|failed",
  "hasData": true,
  "receivedAt": "…",
  "payload": { "candidates": [] },
  "errorMessage": null
}
```

## n8n — عقد HTTP Request

| العقدة | URL |
|--------|-----|
| Send Candidate | `callbackUrl` base + `?searchId=…&token=…` (استخرج token من `callbackUrl` في webhook body) |
| Complete Search | `callbackUrl` كاملاً من webhook body |

مثال Send Candidate URL expression:

```
={{ $('Webhook').first().json.body.callbackUrl.split('?')[0] + '?searchId=' + encodeURIComponent($json.searchId) + '&token=' + encodeURIComponent($('Webhook').first().json.body.callbackUrl.match(/[?&]token=([^&]+)/)?.[1] || '') }}
```

Complete Search:

```
={{ $('Webhook').first().json.body.callbackUrl }}
```

## مستويات البحث (`minCandidateCount`)

| القيمة | الواجهة | عمق البحث (n8n) |
|--------|---------|-----------------|
| `20` | أكثر من 20 | 2 استعلام، 2 صفحة/استعلام، حتى 35 enrich |
| `40` | أكثر من 40 | 4 استعلامات، 5 صفحات/استعلام، حتى 55 enrich |

القيم القديمة `15` / `30` ما زالت مقبولة في الـ API لسجل البحث المحفوظ.

`minCandidateCount` يتحكم **بعمق الاكتشاف** (Serp/enrich) فقط — 20 = حتى 35 enrich، 40 = حتى 55 enrich. أثناء الحلقة: enrich → Map → AI → تجميع (score ≥ 25) — **20 مرشحاً بالتوازي** لكل دفعة (`streamBatchSize: 20`). عند الاكتمال: ترتيب وإرسال **كل المرشحين المؤهلين** (≥ 50، أو 45، أو 40 حسب التدرج) وليس حداً ثابتاً 20/40.

### توسيع تلقائي (tier 40) — مرحلتان

عند اختيار **أكثر من 40** (`minCandidateCount: 40`)، إذا كانت نتائج المرحلة الأولى **أقل من 40** مرشحاً مؤهلاً:

1. **المرحلة 1:** بحث عادي (4 استعلامات، 5 صفحات، حتى 55 enrich) → ترتيب → **إرسال المرشحين المؤهلين فوراً** إلى الواجهة **بدون** `searchComplete`.
2. **المرحلة 2 (خلفية):** بعد انتهاء إرسال المرحلة 1، يبدأ توسيع تلقائي (+3 استعلامات، +3 صفحات/استعلام، +40 enrich) مع استبعاد روابط LinkedIn المرسلة مسبقاً.
3. **إرسال الجديد فقط** من المرحلة 2، ثم callback أخير بـ `searchComplete: true` مع metadata اختياري: `phase1Count`, `totalSent`, `minTarget`, `targetMet`, `expansionRan`.

**تجربة المستخدم:** في الحالات الصعبة (سوق ضيق)، تظهر نتائج المرحلة الأولى خلال ~3–5 دقائق بينما يستمر البحث في الخلفية — لا ينتظر المستخدم حتى نهاية التوسيع لرؤية أول مرشح.

عقد n8n الجديدة: `Track Send Progress`, `Start Phase 2?`, `Expand Phase 2 Queries`, `Filter New URLs`, `Finalize Phase 2 Send`, `Is Phase 2?`.

## أمان

### Backend `.env`

```env
PUBLIC_API_URL=https://api.evaalo.com
N8N_HEADHUNTER_INBOUND_SECRET=your-long-random-string
HEAD_HUNTER_CALLBACK_ALLOWLIST=https://api.evaalo.com,http://100.73.82.78:5000
```

- `HEAD_HUNTER_CALLBACK_ALLOWLIST`: origins مسموحة لـ `PUBLIC_API_URL`. إذا وُجد IP Tailscale (`100.x.x.x`) في القائمة، يُسمح بأي host `100.*.*.*`.
- عند بدء البحث: إذا `PUBLIC_API_URL` غير مسموح → `500`.

### inbound (n8n → الباكند)

ترتيب التحقق:

1. `X-Head-Hunter-Secret` (إن ضُبط `N8N_HEADHUNTER_INBOUND_SECRET`)
2. `searchId` موجود في ذاكرة الباكند الذي بدأ البحث
3. `token` query يطابق `callbackToken` للبحث
4. idempotency (`X-Idempotency-Key`)

### n8n — allowlist (SSRF)

عقدة **Validate Callback URL** بعد Validate Search Input ترفض webhook إذا:

- `callbackUrl` مفقود أو غير صالح
- host ليس `api.evaalo.com` ولا `100.*.*.*` (Tailscale)
- path لا يحتوي `/webhook/n8n/head-hunter`

### n8n — متغير البيئة

إذا كان n8n يمنع `$env` (رسالة `access to env vars denied`)، يمرّر الباكند `inboundSecret` في payload البحث (نفس `N8N_HEADHUNTER_INBOUND_SECRET`) وتستخدمه العقد:

```
X-Head-Hunter-Secret: {{ $('Webhook').first().json.body.inboundSecret }}
```

بديلاً: ضبط `N8N_HEADHUNTER_INBOUND_SECRET` في n8n Settings → Variables واستخدام `$env.N8N_HEADHUNTER_INBOUND_SECRET`.

### last-result (الواجهة ← الباكند)

- يتطلب auth وصلاحية `headhunter.search`
- يُرجع `403` إذا `searchId` لا يخص المستخدم/المنظمة الحالية

## ملاحظة عن الوثائق القديمة

- `GET /api/head-hunter/last-result` **بدون** `searchId` لم يعد مدعوماً (`400`).
- التخزين العالمي `lastHeadHunterInbound` أُزيل — كل بحث معزول بـ `searchId`.
- **لا** ترسل النتائج للبيئتين معاً — `searchId` في ذاكرة خادم واحد فقط.
