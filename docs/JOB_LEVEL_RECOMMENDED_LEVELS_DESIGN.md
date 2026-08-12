# Job Level — من Allowed Levels إلى Recommended Levels

**الحالة: منفّذ.** هذه الوثيقة تسجّل التصميم والقرارات التي بُني عليها.

## الخلفية

كل وظيفة في [apps/shared/jobCatalog/roleDefinitions.ts](../apps/shared/jobCatalog/roleDefinitions.ts) لها مصفوفة `levels` مكتوبة يدوياً، وقائمة Job Level في الواجهة تعرض تقاطع هذه المصفوفة مع `UI_CAREER_LEVELS`. عملياً هذا يجعل الكتالوج **مانعاً**: ما لم يُكتب في التعريف لا يمكن اختياره.

المشكلة أن هذا السلوك يفترض أن مسميات الوظائف موحدة عالمياً، وهي ليست كذلك. شركة قد تسمّي مسؤول فريق الاستقبال "Receptionist" لا لأن الوظيفة صارت إدارية بل لأن هذا مسمّاها الداخلي. الكتالوج ليس من حقه أن يمنعها.

سبق أن أُصلح خلل مرتبط بهذا: الواجهة كانت تفرض المستوى الوحيد الظاهر، فتُسجَّل HR Specialist كـ Senior تلقائياً. ذلك الإصلاح محصور في الواجهة ولا يعالج المسألة المعمارية أدناه.

## المبدأ

الكتالوج يتحول من **مانع** إلى **مُرشد**:

- مستويات الوظيفة المعرّفة في `roleDefinitions.ts` تُعرض كـ **Recommended**.
- بقية المستويات تبقى قابلة للاختيار في مجموعة ثانية.
- عند اختيار مستوى خارج التوصية يظهر تنبيه ناعم بمعنى `This level is uncommon for this role` — **بدون منع**.

## القرار المحسوم: العنوان لا يُركَّب

عند اختيار مستوى خارج التوصية، **عنوان الوظيفة لا يتغير ولا يُولَّد تلقائياً**:

| الحالة | العنوان المحفوظ | المستوى المحفوظ |
|---|---|---|
| التركيبة موجودة في الكتالوج (`hr_specialist` + `senior`) | `Senior HR Specialist` من الكتالوج | `senior` |
| التركيبة غير موجودة (`receptionist` + `manager`) | `Receptionist` من `getRolePositionTitle` | `manager` |

### لماذا هذا القرار

الكتالوج يحتوي اليوم **626 تركيبة** عبر **179 وظيفة**. فتح كل المستويات يعني فضاءً قدره 179 × 11 = **1,969 تركيبة**، أي فجوة ~1,343 تركيبة يحتاج كل منها عنواناً إنجليزياً وترجمة عربية وكردية مكتوبة يدوياً. قاعدة "العنوان المحايد" تُسقط هذه الفجوة بالكامل، وهي أيضاً الأصدق مع الواقع: الشركة في المثال أعلاه تسمّيه "Receptionist" فعلاً.

## ما يعمل بلا أي تعديل

- **الترجمة**: [apps/frontend/src/utils/localizeCatalogLabel.js](../apps/frontend/src/utils/localizeCatalogLabel.js) يجرّب مفتاح الدور المحايد `positionRole_*` **قبل** مفتاح المستوى، فالعربية والكردية تعملان دون أي إضافة إلى `positionLabels.ar.json` أو `positionLabels.ku.json`.
- **توليد المقابلة**: `CAREER_LEVEL_OVERLAYS` في [apps/shared/jobCatalog/careerLevelOverlays.ts](../apps/shared/jobCatalog/careerLevelOverlays.ts) تغطي المستويات الأحد عشر كلها، فصعوبة الأسئلة وتوقعات القيادة وتركيز الـ rubric تُضبط تلقائياً لأي مستوى يختاره المستخدم.
- **بيانات الترشيح**: لا حاجة لحقل `recommendedLevels` جديد ولا لأي إدخال بيانات. الـ `levels` الحالية **هي** قائمة الموصى به؛ يتغير معناها فقط لا محتواها.

## التعديلات المنفّذة

### 1. احترام المستوى المختار في `composeRoleResolution`

الملف: [apps/shared/jobCatalog/catalogOptions.ts](../apps/shared/jobCatalog/catalogOptions.ts).

الفرع الحالي هو مصدر السلوك الذي يمحو اختيار المستخدم: حين لا يجد مدخلاً مطابقاً يرجع إلى `getRepresentativeEntry` ويعيد `entry.careerLevel` الخاص بالمدخل البديل، فينقلب اختيار "Receptionist + Manager" إلى `mid` بصمت.

المنفَّذ: عند غياب المدخل، يُحتفظ بـ `careerLevel` المختار ويُستعار العنوان المحايد من `getRolePositionTitle` و`domain` و`specialization` من المدخل التمثيلي فقط، و`managementTrack` يُشتق من المستوى عبر `LEVEL_MANAGEMENT_TRACK` (`head` تتبع اتفاق الكتالوج فتُعطي `director`). الثقة `0.75` بدل `0.98` للتمييز بين تركيبة من الكتالوج وتركيبة اختارها المستخدم.

**هذا الملف له نسختان يجب أن تبقيا متطابقتين:** `apps/shared/jobCatalog/` و`apps/backend/src/shared/jobCatalog/`. لذلك يستلزم `npm run deploy:backend` بالإضافة إلى `git push origin master` (الذي ينشر الواجهة عبر Cloudflare Pages).

### 2. توسيع قائمة الخيارات في الواجهة

الملفان: [apps/frontend/src/components/CareerLevelSelect.jsx](../apps/frontend/src/components/CareerLevelSelect.jsx) و[apps/frontend/src/components/JobRoleFields.jsx](../apps/frontend/src/components/JobRoleFields.jsx).

`getLevelOptionsForRoleUI` تعيد `{ recommended, other }`: الموصى به من `getLevelsForRoleUI`، والبقية من `UI_CAREER_LEVELS` مرتّبة بالرتبة. و`isRecommendedLevelForRole` تقيس على `def.levels` **لا** على قائمة الواجهة، حتى لا يُعَدّ `mid` الضمني خارج التوصية.

`LanguageStyleSingleSelect` صار يقبل حقل `group` اختيارياً على كل خيار ويرسم عنوان مجموعة عند تغيّره. القائمة تبقى مسطّحة فلم تتأثر أي من مواضع الاستخدام الأخرى.

هذا يُلغي الحاجة إلى تعطيل الحقل للوظائف الـ 25 ذات المستوى الواحد، لأن قائمتها لم تعد فارغة.

## القرارات المحسومة عند التنفيذ

1. **`labelKey` للتركيبات خارج الكتالوج**: يُبنى بالصيغة الاصطلاحية `${roleKey}.${careerLevel}` — وهو سلوك الفرع القائم أصلاً. `findCatalogEntryByLabelKey` تعيد `undefined` له فيسقط `resolutionFromCriteriaFields` إلى فرع `roleKey` الذي صار يعطي النتيجة الصحيحة بعد البند الأول، فتدور الحملات القديمة دورة كاملة سليمة.
2. **`mid`**: يبقى **ضمنياً وغير معروض**، ولا حاجة لمفتاح `careerLevel_mid`. أُضيف بدله خيار `jobRole_level_none` («بلا تحديد») يظهر في رأس القائمة حين يكون هناك مستوى مختار، فيعيد الحقل إلى الافتراضي. هذا يحفظ الثابت الذي أرساه `fa80b7c`: أي وظيفة تعرّف `mid` تبقى `mid` افتراضياً.
3. **`graduate`**: لم يُضَف إلى القائمة الموسّعة. يبقى كما هو ويُبحث كمسألة كتالوج مستقلة (هل هو مستوى أم Job Title؟).
4. **`graduate_trainee`**: تعارض عنوانه مع مستواه الافتراضي خارج نطاق هذه المرحلة — تصحيح بيانات كتالوج مستقل.
5. **شكل التنبيه الناعم**: نص صغير تحت الحقل (`job-role-level-hint`) بنمط تحذيرات الموقع، بلا منع.

## التحقق المنفَّذ

- `role-resolution-matrix-test.ts` وُسِّع: `composeRoleResolution('receptionist', 'manager')` يعيد `careerLevel: 'manager'` و`displayTitle: 'Receptionist'` و`managementTrack: 'manager'`؛ و`credit_controller + manager` يبقى "Credit Control Manager" لأنه في الكتالوج؛ وكل مستويات `UI_CAREER_LEVELS` متاحة لكل وظيفة بلا تكرار.
- الثابت القائم محفوظ: أي وظيفة تعرّف `mid` تبقى `mid` افتراضياً.
- `validate-job-catalog.ts` ✅ (626 مدخلاً، 179 وظيفة) و`tsc --noEmit` ✅ وبناء Vite ✅.
- تطابق نسختي `catalogOptions.ts` مؤكَّد بـ `diff`.
