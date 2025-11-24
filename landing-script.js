// ====================================
// Landing Page - JavaScript Functionality
// ====================================

// ====================================
// EVAALO Simple Intro Animation
// ====================================

function playEvaaloIntro() {
    const overlay = document.getElementById('evaalo-intro-overlay');
    const eElement = document.getElementById('evaaloE');
    const textElement = document.getElementById('evaaloText');
    const eClear = document.getElementById('eClear');
    const eCircular = document.getElementById('eCircular');
    const letters = textElement.querySelectorAll('span');
    
    // Prevent scrolling during intro
    document.body.style.overflow = 'hidden';
    
    // GSAP Timeline
    const tl = gsap.timeline({
        onComplete: () => {
            // Fade out overlay
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.remove();
                document.body.style.overflow = 'auto';
            }, 600);
        }
    });
    
    // Step 1: Clear E letter appears (0.6s)
    tl.to(eElement, {
        opacity: 1,
        duration: 0.6,
        ease: 'power2.out'
    });
    
    // Step 2: Hold clear E briefly (0.3s)
    tl.to({}, { duration: 0.3 });
    
    // Step 3: Morph from clear e to circular shape while rotating (2s)
    tl.to(eClear, {
        opacity: 0,
        scale: 0.95,
        duration: 1.0,
        ease: 'power1.in'
    }, '+=0.1');
    
    tl.to(eCircular, {
        opacity: 1,
        scale: 1,
        duration: 1.0,
        ease: 'power1.out'
    }, '-=0.8');
    
    // Rotate the entire e during transformation - smooth like water
    tl.to(eElement, {
        rotation: 360,
        duration: 2.0,
        ease: 'sine.inOut'  // Smooth, natural, water-like rotation
    }, '-=1.5');
    
    // Step 4: Text "vaalo" fades in (0.8s)
    tl.to(textElement, {
        opacity: 1,
        duration: 0.3,
        ease: 'power2.out'
    }, '-=0.5');
    
    // Letters appear with stagger
    tl.fromTo(letters, 
        {
            opacity: 0,
            x: -20
        },
        {
            opacity: 1,
            x: 0,
            duration: 0.5,
            stagger: 0.08,
            ease: 'back.out(1.5)'
        },
        '-=0.3'
    );
    
    // Step 5: Hold the full logo (0.8s)
    tl.to({}, { duration: 0.8 });
}

// Initialize intro on page load
window.addEventListener('load', () => {
    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
        // Skip animation
        const overlay = document.getElementById('evaalo-intro-overlay');
        if (overlay) overlay.remove();
        document.body.style.overflow = 'auto';
    } else {
        // Play animation after brief delay
        setTimeout(() => {
            playEvaaloIntro();
        }, 200);
    }
});

// Translations
const translations = {
    en: {
        badge: "Now Hiring for 2025",
        nowHiring: "Now Hiring for 2025",
        heroTitle1: "Smart Hiring",
        heroTitle2: "Starts Here",
        heroDescription: "AI evaluations for voice, video, and written interviews — smart tool that helps companies choose the best candidates faster and more accurately.",
        applyNow: "Get Started",
        learnMore: "Learn More",
        employees: "+ Employees",
        openPositions: "+ Open Positions",
        countries: "+ Countries",
        featuresTitle: "Features",
        featuresDescription: "Powerful AI-driven tools to streamline your hiring process and find the best talent.",
        whyJoinUs: "Why Companies Choose evaalo",
        whyJoinDescription: "We help companies evaluate candidates accurately and objectively through AI-powered voice, video, and written interviews.",
        whyJoinFeature1Title: "Smart & Fair Evaluation",
        whyJoinFeature1Description: "AI-based assessments without human bias for accurate candidate scoring.",
        whyJoinFeature2Title: "Interview Anytime, Anywhere",
        whyJoinFeature2Description: "Candidates complete interviews autonomously — no scheduling or interviewers required.",
        whyJoinFeature3Title: "Deep Skill Profiling",
        whyJoinFeature3Description: "Analysis of communication, confidence, body language, writing clarity, and problem-solving ability.",
        whyJoinFeature4Title: "Faster Hiring Decisions",
        whyJoinFeature4Description: "Instant evaluation reports that save your HR team time and effort.",
        whyJoinFeature5Title: "Advanced AI Technology",
        whyJoinFeature5Description: "Powered by state-of-the-art language and behavior analysis algorithms for maximum accuracy.",
        whyJoinFeature6Title: "Customizable to Your Needs",
        whyJoinFeature6Description: "Configure question sets, scoring rules, and interview formats to match your hiring criteria.",
        feature1Title: "AI Scoring & Evaluation",
        feature1Description: "AI-powered scoring that evaluates candidates objectively based on real skills, not human bias. • Reduces hiring bias • Delivers standardized and comparable results",
        feature2Title: "Written, Voice & Video Interviews",
        feature2Description: "Multiple interview formats suitable for all roles. • Written interviews for analytical assessment • Voice interviews for communication and confidence • Video interviews for body language and professional impression",
        feature3Title: "Instant Smart Reports",
        feature3Description: "Smart reports generated instantly after the candidate completes the interview. Detailed report insights: • Communication level • Experience and behavior • Voice tone and confidence analysis • Job suitability indicators",
        feature4Title: "Shareable Interview Link",
        feature4Description: "Simply share the interview link — no scheduling required.",
        feature5Title: "Works at Any Scale",
        feature5Description: "Scalable — from small teams to enterprise recruitment.",
        feature6Title: "Dashboard for HR Teams (Coming Soon)",
        feature6Description: "HR dashboard for centralized review and candidate tracking.",
        applicationProcess: "How evaalo Works",
        processDescription: "Simple. Smart. Accurate Hiring.",
        step1Title: "Select the Interview Format",
        step1Description: "Choose the evaluation type that fits the position: Written, Voice, or AI Video Interview.",
        step2Title: "Share the Interview Link",
        step2Description: "Send one link to candidates — through email, WhatsApp, or your ATS.",
        step3Title: "Candidate Completes the Interview",
        step3Description: "Candidates respond on their own time — no scheduling, no HR coordination, zero waiting.",
        step4Title: "AI Analyzes & Delivers the Report",
        step4Description: "Our AI evaluates communication clarity, tone, confidence, reasoning, and job-fit. You receive a clear, ranked report to help you select the best candidate — faster and more accurately.",
        ctaTitle: "Let AI Do the First Interview for You.",
        ctaDescription: "Save time. Reduce bias. Select smarter — and screen more candidates at scale.",
        startApplication: "Share Form Link",
        companyName: "evaalo AI",
        footerDescription: "Building the future together",
        quickLinks: "Quick Links",
        aboutUs: "About Us",
        contact: "Contact",
        legal: "Legal",
        privacy: "Privacy Policy",
        terms: "Terms of Service",
        dataSecurity: "Data & Security",
        footerTagline: "Building the future of smart recruitment.",
        comingSoon: "Video",
        copyright: "© 2025 evaalo AI. All rights reserved."
    },
    ar: {
        badge: "التوظيف مفتوح لعام 2025",
        nowHiring: "التوظيف مفتوح لعام 2025",
        heroTitle1: "التوظيف الذكي",
        heroTitle2: "يبدأ من هنا",
        heroDescription: "تقييمات الذكاء الاصطناعي للمقابلات الصوتية والمرئية والمكتوبة — أداة ذكية تساعد الشركات على اختيار أفضل المرشحين بشكل أسرع وأكثر دقة.",
        applyNow: "ابدأ الآن",
        learnMore: "اعرف المزيد",
        employees: "+ موظف",
        openPositions: "+ وظيفة متاحة",
        countries: "+ دولة",
        featuresTitle: "المميزات",
        featuresDescription: "أدوات قوية مدعومة بالذكاء الاصطناعي لتبسيط عملية التوظيف والعثور على أفضل المواهب.",
        whyJoinUs: "لماذا تختار الشركات evaalo",
        whyJoinDescription: "نساعد الشركات على تقييم المرشحين بدقة وموضوعية من خلال مقابلات صوتية ومرئية ومكتوبة مدعومة بالذكاء الاصطناعي.",
        whyJoinFeature1Title: "تقييم ذكي وعادل",
        whyJoinFeature1Description: "تقييمات قائمة على الذكاء الاصطناعي دون تحيز بشري لتسجيل دقيق للمرشحين.",
        whyJoinFeature2Title: "مقابلة في أي وقت وأي مكان",
        whyJoinFeature2Description: "يكمل المرشحون المقابلات بشكل مستقل — لا حاجة للجدولة أو المقابلين.",
        whyJoinFeature3Title: "تحليل عميق للمهارات",
        whyJoinFeature3Description: "تحليل التواصل والثقة ولغة الجسد ووضوح الكتابة والقدرة على حل المشكلات.",
        whyJoinFeature4Title: "قرارات توظيف أسرع",
        whyJoinFeature4Description: "تقارير تقييم فورية توفر الوقت والجهد لفريق الموارد البشرية لديك.",
        whyJoinFeature5Title: "تقنية ذكاء اصطناعي متقدمة",
        whyJoinFeature5Description: "مدعوم بخوارزميات تحليل اللغة والسلوك الحديثة لتحقيق أقصى دقة.",
        whyJoinFeature6Title: "قابل للتخصيص حسب احتياجاتك",
        whyJoinFeature6Description: "قم بتكوين مجموعات الأسئلة وقواعد التسجيل وتنسيقات المقابلة لتتناسب مع معايير التوظيف الخاصة بك.",
        feature1Title: "نظام تقييم ذكي",
        feature1Description: "تقييم قائم على الذكاء الاصطناعي يقيّم المرشحين بموضوعية بناءً على المهارات الحقيقية، وليس التحيز البشري. • يقلل من التحيز في التوظيف • يقدم نتائج موحدة وقابلة للمقارنة",
        feature2Title: "مقابلات مكتوبة وصوتية ومرئية",
        feature2Description: "أشكال متعددة للمقابلات تناسب جميع المناصب. • مقابلات مكتوبة للتقييم التحليلي • مقابلات صوتية للتواصل والثقة • مقابلات مرئية للغة الجسد والانطباع المهني",
        feature3Title: "تقارير ذكية فورية",
        feature3Description: "تقارير ذكية تُنشأ فوراً بعد إكمال المرشح للمقابلة. رؤى تفصيلية: • مستوى التواصل • الخبرة والسلوك • تحليل نبرة الصوت والثقة • مؤشرات ملاءمة الوظيفة",
        feature4Title: "رابط مقابلة قابل للمشاركة",
        feature4Description: "ببساطة شارك رابط المقابلة — لا حاجة للجدولة.",
        feature5Title: "يعمل على أي نطاق",
        feature5Description: "قابل للتوسع — من الفرق الصغيرة إلى التوظيف على مستوى المؤسسات.",
        feature6Title: "لوحة تحكم لفرق الموارد البشرية (قريباً)",
        feature6Description: "لوحة تحكم للموارد البشرية للمراجعة المركزية وتتبع المرشحين.",
        applicationProcess: "كيف يعمل evaalo",
        processDescription: "بسيط. ذكي. توظيف دقيق.",
        step1Title: "اختر نوع المقابلة",
        step1Description: "اختر نوع التقييم الذي يناسب الوظيفة: مكتوب، صوتي، أو مقابلة فيديو بالذكاء الاصطناعي.",
        step2Title: "شارك رابط المقابلة",
        step2Description: "أرسل رابطاً واحداً للمرشحين — عبر البريد الإلكتروني أو واتساب أو نظام التوظيف الخاص بك.",
        step3Title: "المرشح يكمل المقابلة",
        step3Description: "يستجيب المرشحون في وقتهم الخاص — بدون جدولة، بدون تنسيق مع الموارد البشرية، انتظار صفر.",
        step4Title: "الذكاء الاصطناعي يحلل ويقدم التقرير",
        step4Description: "يقيّم ذكاؤنا الاصطناعي وضوح التواصل والنبرة والثقة والتفكير والملاءمة الوظيفية. تحصل على تقرير واضح ومرتب لمساعدتك في اختيار أفضل مرشح — بشكل أسرع وأكثر دقة.",
        ctaTitle: "دع الذكاء الاصطناعي يجري المقابلة الأولى نيابة عنك.",
        ctaDescription: "وفّر الوقت. قلل التحيز. اختر بذكاء أكبر — وافحص المزيد من المرشحين بسهولة.",
        startApplication: "شارك رابط النموذج",
        companyName: "evaalo AI",
        footerDescription: "بناء المستقبل معًا",
        quickLinks: "روابط سريعة",
        aboutUs: "من نحن",
        contact: "اتصل بنا",
        legal: "قانوني",
        privacy: "سياسة الخصوصية",
        terms: "شروط الخدمة",
        dataSecurity: "البيانات والأمان",
        footerTagline: "بناء مستقبل التوظيف الذكي.",
        comingSoon: "فيديو",
        copyright: "© 2025 evaalo AI. جميع الحقوق محفوظة."
    },
    ku: {
        badge: "ئێستا دامەزراندن بۆ ساڵی 2025",
        nowHiring: "ئێستا دامەزراندن بۆ ساڵی 2025",
        heroTitle1: "دامەزراندنی زیرەک",
        heroTitle2: "لێرەوە دەست پێدەکات",
        heroDescription: "هەڵسەنگاندنی زیرەکی دەستکرد بۆ چاوپێکەوتنەکانی دەنگی، ڤیدیۆیی و نووسراو — ئامرازێکی زیرەک کە یارمەتی کۆمپانیاکان دەدات باشترین کاندیدەکان بە خێراتر و وردتر هەڵبژێرن.",
        applyNow: "دەست پێبکە",
        learnMore: "زیاتر فێر ببە",
        employees: "+ کارمەند",
        openPositions: "+ پێگەی کراوە",
        countries: "+ وڵات",
        featuresTitle: "تایبەتمەندیەکان",
        featuresDescription: "ئامرازە بەهێزەکانی پاڵپشتیکراو بە زیرەکی دەستکرد بۆ ئاسانکردنی پرۆسەی دامەزراندن و دۆزینەوەی باشترین بەهرەکان.",
        whyJoinUs: "بۆچی کۆمپانیاکان evaalo هەڵدەبژێرن",
        whyJoinDescription: "ئێمە یارمەتی کۆمپانیاکان دەدەین کاندیدەکان بە وردی و بێلایەنانە هەڵبسەنگێنن لە ڕێگەی چاوپێکەوتنە دەنگی و ڤیدیۆیی و نووسراوەکانی پاڵپشتیکراو بە زیرەکی دەستکرد.",
        whyJoinFeature1Title: "هەڵسەنگاندنی زیرەک و دادپەروەرانە",
        whyJoinFeature1Description: "هەڵسەنگاندنەکانی پشتبەستوو بە زیرەکی دەستکرد بەبێ لایەنگری مرۆیی بۆ خاڵدانی وورد بۆ کاندیدەکان.",
        whyJoinFeature2Title: "چاوپێکەوتن لە هەر کات و شوێنێک",
        whyJoinFeature2Description: "کاندیدەکان چاوپێکەوتنەکان بە سەربەخۆیی تەواو دەکەن — پێویست بە خشتەکردن یان چاوپێکەوتنکەر نییە.",
        whyJoinFeature3Title: "پرۆفایلی قووڵی لێهاتوویی",
        whyJoinFeature3Description: "شیکردنەوەی پەیوەندیکردن و متمانە و زمانی جەستە و ڕوونی نووسین و توانای چارەسەرکردنی کێشە.",
        whyJoinFeature4Title: "بڕیاری خێراتری دامەزراندن",
        whyJoinFeature4Description: "ڕاپۆرتی هەڵسەنگاندنی یەکسەر کە کات و هەوڵی تیمی سەرچاوە مرۆییەکانت پاشەکەوت دەکات.",
        whyJoinFeature5Title: "تەکنەلۆژیای زیرەکی دەستکردی پێشکەوتوو",
        whyJoinFeature5Description: "پاڵپشتیکراوە بە ئەلگۆریتمی شیکاری زمان و ڕەفتاری نوێترین بۆ وردترین وردی.",
        whyJoinFeature6Title: "دەستکاریکراو بۆ پێداویستیەکانت",
        whyJoinFeature6Description: "کۆمەڵە پرسیارەکان و یاساکانی خاڵدان و شێوازەکانی چاوپێکەوتن ڕێکبخە بۆ گونجاندن لەگەڵ پێوەرەکانی دامەزراندنت.",
        feature1Title: "سیستەمی خاڵدان بە زیرەکی دەستکرد",
        feature1Description: "خاڵدانی پاڵپشتیکراو بە زیرەکی دەستکرد کە کاندیدەکان بە بێلایەنی و لەسەر بنەمای لێهاتوویی ڕاستەقینە هەڵدەسەنگێنێت، نەک لایەنگری مرۆیی. • کەمکردنەوەی لایەنگری لە دامەزراندن • ئەنجامی یەکسان و بەراوردکراوە دابین دەکات",
        feature2Title: "چاوپێکەوتنی نووسراو، دەنگی و ڤیدیۆیی",
        feature2Description: "شێوازی چەندین جۆری چاوپێکەوتن کە گونجاوە بۆ هەموو ڕۆڵەکان. • چاوپێکەوتنی نووسراو بۆ هەڵسەنگاندنی شیکاری • چاوپێکەوتنی دەنگی بۆ پەیوەندیکردن و متمانە • چاوپێکەوتنی ڤیدیۆیی بۆ زمانی جەستە و کاریگەری پیشەیی",
        feature3Title: "ڕاپۆرتی زیرەکی یەکسەر",
        feature3Description: "ڕاپۆرتی زیرەک کە یەکسەر دوای تەواوکردنی چاوپێکەوتنی کاندید دروست دەکرێت. تێڕوانینی وردی ڕاپۆرت: • ئاستی پەیوەندیکردن • ئەزموون و ڕەفتار • شیکاری دەنگ و متمانە • نیشانەکانی گونجانی کار",
        feature4Title: "بەستەری چاوپێکەوتنی هاوبەشکراو",
        feature4Description: "بە سادەیی بەستەری چاوپێکەوتن هاوبەش بکە — پێویست بە خشتەکردن نییە.",
        feature5Title: "کاردەکات لە هەر قەبارەیەک",
        feature5Description: "گەورەکردنەوە — لە تیمە بچووکەکانەوە تا دامەزراندنی گەورە.",
        feature6Title: "داشبۆرد بۆ تیمەکانی سەرچاوە مرۆییەکان (بەم زووانە)",
        feature6Description: "داشبۆردی سەرچاوە مرۆییەکان بۆ پێداچوونەوەی ناوەندی و شوێنکەوتنی کاندیدەکان.",
        applicationProcess: "چۆن evaalo کاردەکات",
        processDescription: "سادە. زیرەک. دامەزراندنی ورد.",
        step1Title: "شێوازی چاوپێکەوتن هەڵبژێرە",
        step1Description: "جۆری هەڵسەنگاندن هەڵبژێرە کە گونجاوە بۆ پێگەکە: نووسراو، دەنگی، یان چاوپێکەوتنی ڤیدیۆی زیرەکی دەستکرد.",
        step2Title: "بەستەری چاوپێکەوتن هاوبەش بکە",
        step2Description: "بەستەرێک بنێرە بۆ کاندیدەکان — لە ڕێگەی ئیمەیڵ، واتساپ، یان سیستەمی دامەزراندنەکەت.",
        step3Title: "کاندید چاوپێکەوتنەکە تەواو دەکات",
        step3Description: "کاندیدەکان لە کاتی خۆیان وەڵام دەدەنەوە — بەبێ خشتەکردن، بەبێ هاوکاری سەرچاوە مرۆییەکان، چاوەڕوانی سفر.",
        step4Title: "زیرەکی دەستکرد شیدەکاتەوە و ڕاپۆرت دەنێرێت",
        step4Description: "زیرەکی دەستکردی ئێمە ڕوونی پەیوەندیکردن، دەنگ، متمانە، بیرکردنەوە و گونجانی کار هەڵدەسەنگێنێت. ڕاپۆرتێکی ڕوون و پلەبەندکراو وەردەگریت بۆ یارمەتیدانت لە هەڵبژاردنی باشترین کاندید — خێراتر و وردتر.",
        ctaTitle: "با AI چاوپێکەوتنی یەکەم بۆ تۆ ئەنجام بدات.",
        ctaDescription: "کات پاشەکەوت بکە. لایەنگریی کەم بکەرەوە. بە زیرەکی زیاتر هەڵبژێرە — و کاندیدی زیاتر لە ئاستێکی بەرزدا پشکنین بکە.",
        startApplication: "بەستەری فۆرم هاوبەش بکە",
        companyName: "evaalo AI",
        footerDescription: "بنیاتنانی داهاتوو پێکەوە",
        quickLinks: "بەستەرە خێراکان",
        aboutUs: "دەربارەی ئێمە",
        contact: "پەیوەندیمان پێوە بکە",
        legal: "یاسایی",
        privacy: "سیاسەتی تایبەتێتی",
        terms: "مەرجەکانی خزمەتگوزاری",
        dataSecurity: "داتا و پاراستن",
        footerTagline: "بنیاتنانی داهاتووی دامەزراندنی زیرەک.",
        comingSoon: "ڤیدیۆ",
        copyright: "© 2025 evaalo AI. هەموو مافێک پارێزراوە."
    }
};

// Current language
let currentLang = 'en';

// DOM elements
const languageDropdownBtn = document.getElementById('languageDropdownBtn');
const languageDropdownMenu = document.getElementById('languageDropdownMenu');
const languageBtnText = document.getElementById('languageBtnText');
const languageOptions = document.querySelectorAll('.language-option');
const applyNowBtn = document.getElementById('applyNowBtn');
const learnMoreBtn = document.getElementById('learnMoreBtn');
const ctaApplyBtn = document.getElementById('ctaApplyBtn');
const navMenuToggle = document.getElementById('navMenuToggle');
const navMenu = document.getElementById('navMenu');
const navMenuWrapper = navMenuToggle ? navMenuToggle.closest('.nav-menu-wrapper') : null;

// ====================================
// Language Selector Functionality
// ====================================

// Toggle dropdown
languageDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = languageDropdownBtn.getAttribute('aria-expanded') === 'true';
    
    languageDropdownBtn.setAttribute('aria-expanded', !isExpanded);
    languageDropdownMenu.classList.toggle('active');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    // Don't interfere with navigation links in mobile sidebar
    if (e.target.closest('.nav-links-mobile') || e.target.closest('.nav-menu-wrapper.active')) {
        // Allow navigation links to work normally
        return;
    }
    
    if (!languageDropdownBtn.contains(e.target) && !languageDropdownMenu.contains(e.target)) {
        languageDropdownBtn.setAttribute('aria-expanded', 'false');
        languageDropdownMenu.classList.remove('active');
    }
});

// Language selection
languageOptions.forEach(option => {
    option.addEventListener('click', () => {
        const lang = option.getAttribute('data-lang');
        changeLanguage(lang);
        
        // Close dropdown
        if (languageDropdownBtn) {
            languageDropdownBtn.setAttribute('aria-expanded', 'false');
        }
        if (languageDropdownMenu) {
            languageDropdownMenu.classList.remove('active');
        }
    });
});

// Mobile language dropdown
const navLanguageItem = document.getElementById('navLanguageItem');
const navLanguageDropdown = document.getElementById('navLanguageDropdown');

// Desktop language dropdown
const navLanguageItemDesktop = document.getElementById('navLanguageItemDesktop');
const navLanguageDropdownDesktop = document.getElementById('navLanguageDropdownDesktop');

// Mobile language dropdown handler
if (navLanguageItem) {
    let isOpening = false;
    let clickOutsideHandler;
    
    // Toggle dropdown on click (mobile only)
    navLanguageItem.addEventListener('click', (e) => {
        // CRITICAL: Don't interfere with regular navigation links
        // Check if clicking on a regular link (not the dropdown trigger)
        const clickedLink = e.target.closest('a.nav-link:not(.nav-link-dropdown)');
        if (clickedLink) {
            // This is a regular link - let it navigate normally
            return;
        }
        
        // Don't toggle if clicking on a language option - let it handle its own click
        if (e.target.closest('.nav-language-option')) {
            return;
        }
        
        // Check if we're on mobile
        if (window.innerWidth > 768) {
            return;
        }
        
        // Only prevent default if clicking directly on the dropdown trigger (span or svg inside nav-link-dropdown)
        // NOT on any links
        const isDropdownTrigger = e.target.closest('.nav-link-dropdown') === navLanguageItem && 
                                  !e.target.closest('a') &&
                                  (e.target.tagName === 'SPAN' || e.target.tagName === 'SVG' || e.target.closest('svg') || e.target === navLanguageItem);
        
        if (isDropdownTrigger) {
            e.preventDefault();
            e.stopPropagation();
        } else {
            // If clicking on something else (like a link), don't prevent default
            return;
        }
        
        // Toggle expanded class
        const willBeExpanded = !navLanguageItem.classList.contains('expanded');
        navLanguageItem.classList.toggle('expanded');
        
        // Force reflow to ensure CSS is applied
        void navLanguageItem.offsetHeight;
        
        const dropdown = document.getElementById('navLanguageDropdown');
        if (dropdown) {
            if (willBeExpanded) {
                // Opening dropdown
                isOpening = true;
                dropdown.style.display = 'flex';
                
                // Add click outside handler after a short delay
                setTimeout(() => {
                    isOpening = false;
                    if (!clickOutsideHandler) {
                        clickOutsideHandler = (event) => {
                            // Don't close if clicking on a navigation link
                            if (event.target.closest('a.nav-link:not(.nav-link-dropdown)')) {
                                return;
                            }
                            
                            if (!navLanguageItem.contains(event.target) && 
                                navLanguageItem.classList.contains('expanded') && 
                                !isOpening) {
                                navLanguageItem.classList.remove('expanded');
                                const dropdownEl = document.getElementById('navLanguageDropdown');
                                if (dropdownEl) {
                                    dropdownEl.style.display = 'none';
                                }
                            }
                        };
                        document.addEventListener('click', clickOutsideHandler);
                    }
                }, 50);
            } else {
                // Closing dropdown
                dropdown.style.display = 'none';
                if (clickOutsideHandler) {
                    document.removeEventListener('click', clickOutsideHandler);
                    clickOutsideHandler = null;
                }
            }
        }
    });
}

// Desktop language dropdown handler (hover-based)
if (navLanguageItemDesktop) {
    let dropdownTimeout;
    
    // Show dropdown on hover
    const showDropdown = () => {
        if (dropdownTimeout) {
            clearTimeout(dropdownTimeout);
            dropdownTimeout = null;
        }
        if (navLanguageDropdownDesktop) {
            navLanguageDropdownDesktop.style.opacity = '1';
            navLanguageDropdownDesktop.style.visibility = 'visible';
            navLanguageDropdownDesktop.style.transform = 'translateY(0)';
            navLanguageDropdownDesktop.style.pointerEvents = 'auto';
        }
    };
    
    // Hide dropdown on mouse leave with delay
    const hideDropdown = () => {
        dropdownTimeout = setTimeout(() => {
            if (navLanguageDropdownDesktop) {
                navLanguageDropdownDesktop.style.opacity = '0';
                navLanguageDropdownDesktop.style.visibility = 'hidden';
                navLanguageDropdownDesktop.style.transform = 'translateY(-8px)';
                navLanguageDropdownDesktop.style.pointerEvents = 'none';
            }
        }, 150); // Small delay to allow moving mouse to dropdown
    };
    
    navLanguageItemDesktop.addEventListener('mouseenter', showDropdown);
    navLanguageItemDesktop.addEventListener('mouseleave', hideDropdown);
    
    // Keep dropdown open when hovering over it
    if (navLanguageDropdownDesktop) {
        navLanguageDropdownDesktop.addEventListener('mouseenter', () => {
            if (dropdownTimeout) {
                clearTimeout(dropdownTimeout);
                dropdownTimeout = null;
            }
            showDropdown();
        });
        
        navLanguageDropdownDesktop.addEventListener('mouseleave', hideDropdown);
    }
}

// Language selection from nav menu (inside hamburger menu)
const navLanguageOptions = document.querySelectorAll('.nav-language-option');
navLanguageOptions.forEach(option => {
    option.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const lang = option.getAttribute('data-lang');
        changeLanguage(lang);
        
        // Close mobile dropdown
        if (navLanguageItem) {
            navLanguageItem.classList.remove('expanded');
            const dropdown = document.getElementById('navLanguageDropdown');
            if (dropdown && window.innerWidth <= 768) {
                dropdown.style.display = 'none';
            }
        }
        
        // Close desktop dropdown
        if (navLanguageDropdownDesktop) {
            navLanguageDropdownDesktop.style.opacity = '0';
            navLanguageDropdownDesktop.style.visibility = 'hidden';
            navLanguageDropdownDesktop.style.transform = 'translateY(-8px)';
        }
        
        // Close nav menu after language selection (mobile only)
        // On desktop, keep menu open after selection
        if (window.innerWidth <= 768 && navMenuWrapper) {
            navMenuWrapper.classList.remove('active');
        }
        if (window.innerWidth <= 768 && navMenuToggle) {
            navMenuToggle.setAttribute('aria-expanded', 'false');
        }
    });
});

// ====================================
// Navigation Menu Toggle - Sidebar Style
// ====================================

const navMenuBackdrop = document.getElementById('navMenuBackdrop');

// Mobile hamburger menu - sidebar functionality
if (navMenuToggle && navMenuWrapper) {
    // Function to open sidebar
    function openSidebar() {
        navMenuWrapper.classList.add('active');
        document.body.classList.add('sidebar-open');
        navMenuToggle.setAttribute('aria-expanded', 'true');
    }

    // Function to close sidebar
    function closeSidebar() {
        navMenuWrapper.classList.remove('active');
        document.body.classList.remove('sidebar-open');
        navMenuToggle.setAttribute('aria-expanded', 'false');
    }

    // Toggle sidebar on hamburger click
    navMenuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navMenuWrapper.classList.contains('active')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    // Close sidebar when clicking on backdrop
    if (navMenuBackdrop) {
        navMenuBackdrop.addEventListener('click', () => {
            closeSidebar();
        });
    }

    // Close sidebar when clicking on a nav link (mobile only)
    if (navMenu) {
        const navLinks = navMenu.querySelectorAll('a.nav-link:not(.nav-link-dropdown)');
        navLinks.forEach(link => {
            // Ensure links are clickable
            link.style.pointerEvents = 'auto';
            link.style.cursor = 'pointer';
            
            // Close sidebar after navigation (don't prevent default)
            link.addEventListener('click', (e) => {
                if (window.innerWidth <= 768) {
                    setTimeout(() => {
                        closeSidebar();
                    }, 100);
                }
            }, { passive: true });
        });
    }

    // Close sidebar on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navMenuWrapper.classList.contains('active')) {
            closeSidebar();
        }
    });

    // Handle window resize - close sidebar when switching to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && navMenuWrapper.classList.contains('active')) {
            closeSidebar();
        }
    });
}

// ====================================
// Language Translation
// ====================================

function changeLanguage(lang) {
    currentLang = lang;
    
    // Update button text (if exists)
    const languageNames = {
        en: 'English',
        ar: 'العربية',
        ku: 'کوردی'
    };
    if (languageBtnText) {
        languageBtnText.textContent = languageNames[lang];
    }
    
    // Update active state
    languageOptions.forEach(option => {
        if (option.getAttribute('data-lang') === lang) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
    
    // Update active state for nav language options (inside hamburger menu)
    const navLanguageOptions = document.querySelectorAll('.nav-language-option');
    navLanguageOptions.forEach(option => {
        if (option.getAttribute('data-lang') === lang) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
    
    // Update HTML lang attribute only (not dir to keep layout stable)
    const htmlElement = document.getElementById('htmlLang');
    htmlElement.setAttribute('lang', lang);
    
    // Add RTL class only to text containers on landing page
    const landingPage = document.querySelector('.hero');
    if (landingPage) {
        if (lang === 'ar' || lang === 'ku') {
            document.body.classList.add('rtl-text');
            document.body.classList.remove('ltr-text');
        } else {
            document.body.classList.add('ltr-text');
            document.body.classList.remove('rtl-text');
        }
    }
    
    // Translate all elements
    translatePage(lang);
}

function translatePage(lang) {
    const elements = document.querySelectorAll('[data-translate]');
    
    elements.forEach(element => {
        const key = element.getAttribute('data-translate');
        if (translations[lang] && translations[lang][key]) {
            element.textContent = translations[lang][key];
        }
    });
}

// ====================================
// Smooth Scrolling
// ====================================

learnMoreBtn.addEventListener('click', () => {
    document.getElementById('features').scrollIntoView({
        behavior: 'smooth'
    });
});

// ====================================
// Counter Animation
// ====================================

function animateCounter(element, target, duration = 2000) {
    const start = 0;
    const increment = target / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

// Intersection Observer for counter animation
const observerOptions = {
    threshold: 0.5,
    rootMargin: '0px'
};

const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const statNumbers = document.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const target = parseInt(stat.getAttribute('data-number'));
                animateCounter(stat, target);
            });
            counterObserver.disconnect();
        }
    });
}, observerOptions);

const statsSection = document.querySelector('.hero-stats');
if (statsSection) {
    counterObserver.observe(statsSection);
}

// ====================================
// Fade-in on Scroll Animation
// ====================================

const fadeInObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
});

// Apply fade-in animation to sections
document.querySelectorAll('.feature-card, .process-step').forEach(element => {
    element.style.opacity = '0';
    element.style.transform = 'translateY(30px)';
    element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    fadeInObserver.observe(element);
});

// ====================================
// Process Steps Carousel - Swiper.js (Professional smooth swipe)
// ====================================

let processSwiper = null;
const processPrevBtn = document.getElementById('processPrevBtn');
const processNextBtn = document.getElementById('processNextBtn');
const processStepsContainer = document.querySelector('.process-steps-swiper');
const processSteps = document.querySelectorAll('.process-step');

// Check if mobile
function isMobile() {
    return window.innerWidth <= 768;
}

function initProcessSwiper() {
    if (!processStepsContainer || !isMobile()) {
        // Desktop: destroy swiper if exists
        if (processSwiper) {
            processSwiper.destroy(true, true);
            processSwiper = null;
        }
        return;
    }
    
    // Destroy existing swiper if any
    if (processSwiper) {
        processSwiper.destroy(true, true);
        processSwiper = null;
    }
    
    // Initialize Swiper with professional smooth touch settings
    processSwiper = new Swiper('.process-steps-swiper', {
        slidesPerView: 1,
        spaceBetween: 20,
        speed: 300,
        touchRatio: 1,
        simulateTouch: true,
        touchStartPreventDefault: false,
        touchMoveStopPropagation: false,
        grabCursor: true,
        resistance: true,
        resistanceRatio: 0.85,
        longSwipesRatio: 0.5,
        longSwipesMs: 300,
        threshold: 5,
        followFinger: true,
        freeMode: false,
        freeModeSticky: false,
        nested: false,
        watchSlidesProgress: true,
        watchSlidesVisibility: true,
        preventClicks: true,
        preventClicksPropagation: true,
        slideToClickedSlide: false,
        pagination: {
            el: '.process-step-indicators',
            type: 'bullets',
            clickable: true,
            bulletActiveClass: 'swiper-pagination-bullet-active',
            renderBullet: function (index, className) {
                return '<span class="' + className + '"></span>';
            },
        },
        on: {
            init: function() {
                updateProcessNavButtons();
            },
            slideChange: function() {
                updateProcessNavButtons();
            },
            slideChangeTransitionStart: function() {
                updateProcessNavButtons();
            },
            slideChangeTransitionEnd: function() {
                updateProcessNavButtons();
            },
            reachBeginning: function() {
                updateProcessNavButtons();
            },
            reachEnd: function() {
                updateProcessNavButtons();
            },
        }
    });
    
    updateProcessNavButtons();
}

function updateProcessNavButtons() {
    if (!processPrevBtn || !processNextBtn) return;
    
    if (isMobile() && processSwiper) {
        // Mobile: use Swiper active index
        const activeIndex = processSwiper.activeIndex;
        const totalSteps = processSwiper.slides.length;
        
        if (activeIndex === 0) {
            processPrevBtn.disabled = true;
        } else {
            processPrevBtn.disabled = false;
        }
        
        if (activeIndex >= totalSteps - 1) {
            processNextBtn.disabled = true;
        } else {
            processNextBtn.disabled = false;
        }
    } else {
        // Desktop: show all cards, no navigation buttons needed
        if (processPrevBtn) processPrevBtn.disabled = true;
        if (processNextBtn) processNextBtn.disabled = true;
    }
}

// Initialize Swiper on page load and resize
if (processStepsContainer) {
    // Initialize on load
    if (typeof Swiper !== 'undefined') {
        initProcessSwiper();
    } else {
        // Wait for Swiper to load
        window.addEventListener('load', () => {
            if (typeof Swiper !== 'undefined') {
                initProcessSwiper();
            }
        });
    }
    
    // Arrow buttons navigation
    if (processPrevBtn) {
        processPrevBtn.addEventListener('click', () => {
            if (isMobile() && processSwiper) {
                processSwiper.slidePrev();
            }
        });
    }
    
    if (processNextBtn) {
        processNextBtn.addEventListener('click', () => {
            if (isMobile() && processSwiper) {
                processSwiper.slideNext();
            }
        });
    }
    
    // Update on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            initProcessSwiper();
            updateProcessNavButtons();
        }, 250);
    });
    
    // Initial button state
    updateProcessNavButtons();
}

// ====================================
// Navigation to Application Form
// ====================================

function navigateToApplication() {
    window.location.href = 'form1.html';
}

applyNowBtn.addEventListener('click', navigateToApplication);
ctaApplyBtn.addEventListener('click', navigateToApplication);

// ====================================
// Scroll Indicator Hide on Scroll
// ====================================

const scrollIndicator = document.querySelector('.scroll-indicator');

window.addEventListener('scroll', () => {
    if (window.scrollY > 100) {
        scrollIndicator.style.opacity = '0';
        scrollIndicator.style.pointerEvents = 'none';
    } else {
        scrollIndicator.style.opacity = '1';
        scrollIndicator.style.pointerEvents = 'auto';
    }
});

// ====================================
// Navbar Transparency on Scroll (if needed)
// ====================================

window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        languageDropdownBtn.style.background = 'rgba(255, 255, 255, 1)';
    } else {
        languageDropdownBtn.style.background = 'rgba(255, 255, 255, 0.95)';
    }
});

// ====================================
// Page Load Animation
// ====================================

window.addEventListener('load', () => {
    document.body.style.opacity = '1';
});

// Apply initial load style
document.body.style.opacity = '0';
document.body.style.transition = 'opacity 0.5s ease';

// ====================================
// Neural Network Animation
// ====================================

class NeuralNetwork {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.particleCount = 50;
        this.maxDistance = 150;
        
        this.init();
        this.animate();
    }
    
    init() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        
        // Create particles
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                color: this.getRandomColor()
            });
        }
        
        // Handle resize
        window.addEventListener('resize', () => {
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
        });
    }
    
    getRandomColor() {
        const colors = [
            'rgba(56, 189, 248, 0.6)',   // Electric Blue
            'rgba(168, 85, 247, 0.6)',   // Purple
            'rgba(34, 211, 238, 0.6)',   // Cyan
            'rgba(192, 132, 252, 0.6)'   // Light Purple
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    drawParticle(particle) {
        this.ctx.beginPath();
        this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = particle.color;
        this.ctx.fill();
        
        // Add glow effect
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = particle.color;
    }
    
    drawLine(p1, p2, distance) {
        const opacity = (1 - distance / this.maxDistance) * 0.5;
        this.ctx.beginPath();
        this.ctx.strokeStyle = `rgba(56, 189, 248, ${opacity})`;
        this.ctx.lineWidth = 1;
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
    }
    
    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Update and draw particles
        this.particles.forEach((particle, i) => {
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;
            
            // Bounce off edges
            if (particle.x < 0 || particle.x > this.canvas.width) particle.vx *= -1;
            if (particle.y < 0 || particle.y > this.canvas.height) particle.vy *= -1;
            
            // Keep particles in bounds
            particle.x = Math.max(0, Math.min(this.canvas.width, particle.x));
            particle.y = Math.max(0, Math.min(this.canvas.height, particle.y));
            
            // Draw particle
            this.drawParticle(particle);
            
            // Draw connections
            for (let j = i + 1; j < this.particles.length; j++) {
                const p2 = this.particles[j];
                const dx = particle.x - p2.x;
                const dy = particle.y - p2.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < this.maxDistance) {
                    this.drawLine(particle, p2, distance);
                }
            }
        });
        
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize Neural Network
const neuralCanvas = document.getElementById('neuralNetwork');
if (neuralCanvas) {
    new NeuralNetwork(neuralCanvas);
}

// ====================================
// Initialize
// ====================================

document.addEventListener('DOMContentLoaded', () => {
    // Set initial language
    document.body.classList.add('ltr-text'); // Default to LTR
    changeLanguage('en');
    
    // Show page
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});




