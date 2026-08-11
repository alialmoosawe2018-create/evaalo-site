# Job Level — من Allowed Levels إلى Recommended Levels

**الحالة: تصميم فقط، غير منفّذ.** هذه الوثيقة تسجّل القرارات المحسومة والأسئلة المفتوحة لمرحلة لاحقة.

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

## التعديلات المطلوبة

### 1. احترام المستوى المختار في `composeRoleResolution`

الملف: [apps/shared/jobCatalog/catalogOptions.ts](../apps/shared/jobCatalog/catalogOptions.ts).

الفرع الحالي هو مصدر السلوك الذي يمحو اختيار المستخدم: حين لا يجد مدخلاً مطابقاً يرجع إلى `getRepresentativeEntry` ويعيد `entry.careerLevel` الخاص بالمدخل البديل، فينقلب اختيار "Receptionist + Manager" إلى `mid` بصمت.

المطلوب: عند غياب المدخل، الاحتفاظ بـ `careerLevel` المختار واستعارة العنوان المحايد و`domain` و`specialization` من المدخل التمثيلي فقط.

**هذا الملف مشترك مع الباك إند، لذا هذه المرحلة تستلزم `npm run deploy:backend` بالإضافة إلى `deploy:frontend`.**

### 2. توسيع قائمة الخيارات في الواجهة

الملفان: [apps/frontend/src/components/CareerLevelSelect.jsx](../apps/frontend/src/components/CareerLevelSelect.jsx) و[apps/frontend/src/components/JobRoleFields.jsx](../apps/frontend/src/components/JobRoleFields.jsx).

عرض المستويات كلها مع فصل بصري بين مجموعة Recommended (من `getLevelsForRoleUI`) والبقية، وإظهار التنبيه الناعم عند الاختيار خارج التوصية. يتطلب دعم مجموعات في `LanguageStyleSingleSelect` أو بديلاً عنه.

هذا يُلغي الحاجة إلى تعطيل الحقل للوظائف الـ 25 ذات المستوى الواحد، لأن قائمتها لن تكون فارغة بعد اليوم.

## أسئلة مفتوحة تُحسم قبل التنفيذ

1. **`labelKey` للتركيبات خارج الكتالوج**: يُترك فارغاً أم يُبنى بصيغة اصطلاحية `${roleKey}.${careerLevel}` رغم عدم وجود مدخل؟ يؤثر على `findCatalogEntryByLabelKey` وعلى استعلامات الحملات القديمة.
2. **إظهار `mid` وتسميته**: المفتاح `careerLevel_mid` **غير موجود** في [apps/frontend/src/translations.js](../apps/frontend/src/translations.js) في أي من اللغات الثلاث، لأن `mid` مستوى ضمني لا يُعرض. التصميم يفرض إظهاره، وبالتالي يفرض حسم التسمية: `Mid` أم `Entry Level`؟ هذا قرار كان مؤجلاً وأصبح شرطاً مسبقاً.
3. **`graduate`**: مستوى أم Job Title؟ "Graduate Civil Engineer" و"Graduate Mechanical Engineer" و"Graduate Trainee" مسميات وظيفية فعلية لا مجرد درجة، وهي حالياً غير قابلة للاختيار لأن `graduate` خارج `UI_CAREER_LEVELS`.
4. **`graduate_trainee`**: عنوانه في قائمة الوظائف "Graduate Trainee" عبر `POSITION_TITLE_OVERRIDES` في [apps/shared/jobCatalog/positionTitle.ts](../apps/shared/jobCatalog/positionTitle.ts) بينما مستواه الافتراضي `mid` يعطي "Junior Specialist". يُراجع التعريف ليتطابقا.
5. **شكل التنبيه الناعم**: نص تحت الحقل، أم أيقونة بجانب الخيار، أم مجرد فصل المجموعتين في القائمة دون نص.

## خطة التحقق

- توسيع [apps/backend/src/scripts/role-resolution-matrix-test.ts](../apps/backend/src/scripts/role-resolution-matrix-test.ts): `composeRoleResolution('receptionist', 'manager')` يجب أن يعيد `careerLevel: 'manager'` و`displayTitle: 'Receptionist'`.
- الحفاظ على الثابت القائم: أي وظيفة تعرّف `mid` تبقى `mid` افتراضياً.
- `npx tsx src/scripts/validate-job-catalog.ts` للتأكد من سلامة الكتالوج.
- فحص الترجمة العربية والكردية لتركيبة خارج الكتالوج للتأكد من عمل مسار `positionRole_*`.
