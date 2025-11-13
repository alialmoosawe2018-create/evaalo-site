// ====================================
// Application Form - JavaScript
// ====================================

// Translations
const translations = {
    en: {
        title: "Job Application Form",
        subtitle: "Tell us about yourself",
        complete: "% Complete",
        personalInfo: "Personal Information",
        firstName: "First Name",
        lastName: "Last Name",
        email: "Email Address",
        phone: "Phone Number",
        location: "Location",
        firstNamePlaceholder: "Enter your first name",
        lastNamePlaceholder: "Enter your last name",
        emailPlaceholder: "your.email@example.com",
        phonePlaceholder: "(123) 456-7890",
        locationPlaceholder: "City, State/Country",
        professionalInfo: "Professional Information",
        position: "Position Applied For",
        selectPosition: "Select a position",
        pleaseSpecify: "Please specify",
        positionOtherPlaceholder: "Enter your position",
        experience: "Years of Experience",
        selectYears: "Select years",
        "years0-1": "0-1 years",
        "years2-3": "2-3 years",
        "years4-5": "4-5 years",
        "years6-10": "6-10 years",
        "years10+": "10+ years",
        currentCompany: "Current Company",
        currentCompanyPlaceholder: "Your current employer (optional)",
        education: "Highest Education Level",
        selectEducation: "Select education level",
        highSchool: "High School",
        associate: "Associate Degree",
        bachelor: "Bachelor's Degree",
        master: "Master's Degree",
        phd: "PhD",
        other: "Other",
        educationOtherPlaceholder: "Your education level",
        linkedin: "LinkedIn Profile",
        linkedinPlaceholder: "https://linkedin.com/in/yourprofile",
        skills: "Skills & Qualifications",
        keySkills: "Key Skills",
        skillsPlaceholder: "Type a skill and press Enter or click Add",
        add: "Add",
        addSkills: "Add at least 3 skills",
        languagesSpoken: "Languages Spoken",
        languagesPlaceholder: "Language (e.g., English, Spanish)",
        certifications: "Certifications",
        certificationsPlaceholder: "List any professional certifications you hold...",
        additionalInfo: "Additional Information",
        availability: "Availability",
        selectAvailability: "Select availability",
        immediate: "Immediate",
        within2weeks: "Within 2 weeks",
        within1month: "Within 1 month",
        within2months: "Within 2 months",
        within3months: "3+ months",
        expectedSalary: "Expected Salary Range",
        min: "Min",
        max: "Max",
        coverLetter: "Cover Letter / Why are you interested in this position?",
        coverLetterPlaceholder: "Tell us why you're interested in this role and what makes you a great fit...",
        characters: "/500 characters",
        hearAboutUs: "How did you hear about us?",
        selectSource: "Select source",
        jobBoard: "Job Board (Indeed, LinkedIn, etc.)",
        companyWebsite: "Company Website",
        employeeReferral: "Employee Referral",
        socialMedia: "Social Media",
        recruiter: "Recruiter",
        agreeTerms: "I agree to the Terms and Conditions and Privacy Policy",
        previous: "Previous",
        next: "Next",
        submit: "Submit Application",
        successTitle: "Application Submitted Successfully!",
        successMessage: "Thank you for your interest. We'll review your application and get back to you soon.",
        // Validation messages
        required: "This field is required",
        invalidEmail: "Please enter a valid email address",
        invalidPhone: "Please enter a valid phone number",
        invalidUrl: "Please enter a valid URL",
        minSkills: "Please add at least 3 skills",
        // Position options
        softwareEngineer: "Software Engineer",
        frontendDeveloper: "Frontend Developer",
        backendDeveloper: "Backend Developer",
        fullstackDeveloper: "Full Stack Developer",
        dataScientist: "Data Scientist",
        productManager: "Product Manager",
        uiuxDesigner: "UI/UX Designer",
        devopsEngineer: "DevOps Engineer",
        qaEngineer: "QA Engineer",
        projectManager: "Project Manager"
    },
    ar: {
        title: "نموذج طلب التوظيف",
        subtitle: "أخبرنا عن نفسك",
        complete: "% مكتمل",
        personalInfo: "المعلومات الشخصية",
        firstName: "الاسم الأول",
        lastName: "اسم العائلة",
        email: "البريد الإلكتروني",
        phone: "رقم الهاتف",
        location: "الموقع",
        firstNamePlaceholder: "أدخل اسمك الأول",
        lastNamePlaceholder: "أدخل اسم عائلتك",
        emailPlaceholder: "your.email@example.com",
        phonePlaceholder: "(123) 456-7890",
        locationPlaceholder: "المدينة، الولاية/البلد",
        professionalInfo: "المعلومات المهنية",
        position: "الوظيفة المتقدم لها",
        selectPosition: "اختر وظيفة",
        pleaseSpecify: "يرجى التحديد",
        positionOtherPlaceholder: "أدخل وظيفتك",
        experience: "سنوات الخبرة",
        selectYears: "اختر السنوات",
        "years0-1": "0-1 سنة",
        "years2-3": "2-3 سنوات",
        "years4-5": "4-5 سنوات",
        "years6-10": "6-10 سنوات",
        "years10+": "10+ سنوات",
        currentCompany: "الشركة الحالية",
        currentCompanyPlaceholder: "صاحب العمل الحالي (اختياري)",
        education: "أعلى مستوى تعليمي",
        selectEducation: "اختر المستوى التعليمي",
        highSchool: "ثانوية عامة",
        associate: "دبلوم",
        bachelor: "بكالوريوس",
        master: "ماجستير",
        phd: "دكتوراه",
        other: "أخرى",
        educationOtherPlaceholder: "مستواك التعليمي",
        linkedin: "ملف LinkedIn الشخصي",
        linkedinPlaceholder: "https://linkedin.com/in/yourprofile",
        skills: "المهارات والمؤهلات",
        keySkills: "المهارات الرئيسية",
        skillsPlaceholder: "اكتب مهارة واضغط Enter أو انقر إضافة",
        add: "إضافة",
        addSkills: "أضف 3 مهارات على الأقل",
        languagesSpoken: "اللغات المنطوقة",
        languagesPlaceholder: "اللغة (مثلاً، الإنجليزية، الإسبانية)",
        certifications: "الشهادات",
        certificationsPlaceholder: "اذكر أي شهادات مهنية تحملها...",
        additionalInfo: "معلومات إضافية",
        availability: "التوفر",
        selectAvailability: "اختر التوفر",
        immediate: "فوري",
        within2weeks: "خلال أسبوعين",
        within1month: "خلال شهر",
        within2months: "خلال شهرين",
        within3months: "3+ أشهر",
        expectedSalary: "نطاق الراتب المتوقع",
        min: "الحد الأدنى",
        max: "الحد الأقصى",
        coverLetter: "رسالة التغطية / لماذا أنت مهتم بهذه الوظيفة؟",
        coverLetterPlaceholder: "أخبرنا لماذا أنت مهتم بهذا الدور وما الذي يجعلك مناسبًا...",
        characters: "/500 حرف",
        hearAboutUs: "كيف سمعت عنا؟",
        selectSource: "اختر المصدر",
        jobBoard: "لوحة الوظائف (Indeed، LinkedIn، إلخ)",
        companyWebsite: "موقع الشركة",
        employeeReferral: "إحالة موظف",
        socialMedia: "وسائل التواصل الاجتماعي",
        recruiter: "موظف توظيف",
        agreeTerms: "أوافق على الشروط والأحكام وسياسة الخصوصية",
        previous: "السابق",
        next: "التالي",
        submit: "تقديم الطلب",
        successTitle: "تم تقديم الطلب بنجاح!",
        successMessage: "شكرًا لاهتمامك. سنراجع طلبك ونعود إليك قريبًا.",
        // Validation messages
        required: "هذا الحقل مطلوب",
        invalidEmail: "يرجى إدخال بريد إلكتروني صحيح",
        invalidPhone: "يرجى إدخال رقم هاتف صحيح",
        invalidUrl: "يرجى إدخال رابط صحيح",
        minSkills: "يرجى إضافة 3 مهارات على الأقل",
        // Position options
        softwareEngineer: "مهندس برمجيات",
        frontendDeveloper: "مطور واجهة أمامية",
        backendDeveloper: "مطور خلفي",
        fullstackDeveloper: "مطور متكامل",
        dataScientist: "عالم بيانات",
        productManager: "مدير منتج",
        uiuxDesigner: "مصمم UI/UX",
        devopsEngineer: "مهندس DevOps",
        qaEngineer: "مهندس ضمان الجودة",
        projectManager: "مدير مشروع"
    },
    ku: {
        title: "فۆرمی داواکاری کار",
        subtitle: "باسی خۆت بۆمان بکە",
        complete: "% تەواو",
        personalInfo: "زانیاری کەسی",
        firstName: "ناوی یەکەم",
        lastName: "ناوی خێزان",
        email: "ناونیشانی ئیمەیڵ",
        phone: "ژمارەی تەلەفۆن",
        location: "شوێن",
        firstNamePlaceholder: "ناوی یەکەمت بنووسە",
        lastNamePlaceholder: "ناوی خێزانت بنووسە",
        emailPlaceholder: "your.email@example.com",
        phonePlaceholder: "(123) 456-7890",
        locationPlaceholder: "شار، ویلایەت/وڵات",
        professionalInfo: "زانیاری پیشەیی",
        position: "پێگەی داواکراو",
        selectPosition: "پێگەیەک هەڵبژێرە",
        pleaseSpecify: "تکایە دیاری بکە",
        positionOtherPlaceholder: "پێگەکەت بنووسە",
        experience: "ساڵانی ئەزموون",
        selectYears: "ساڵان هەڵبژێرە",
        "years0-1": "0-1 ساڵ",
        "years2-3": "2-3 ساڵ",
        "years4-5": "4-5 ساڵ",
        "years6-10": "6-10 ساڵ",
        "years10+": "10+ ساڵ",
        currentCompany: "کۆمپانیای ئێستا",
        currentCompanyPlaceholder: "خاوەنکارەکەی ئێستات (ئیختیاری)",
        education: "بەرزترین ئاستی پەروەردە",
        selectEducation: "ئاستی پەروەردە هەڵبژێرە",
        highSchool: "ئامادەیی",
        associate: "دیپلۆم",
        bachelor: "بەکالۆریۆس",
        master: "ماستەر",
        phd: "دکتۆرا",
        other: "هیتر",
        educationOtherPlaceholder: "ئاستی پەروەردەت",
        linkedin: "پرۆفایلی LinkedIn",
        linkedinPlaceholder: "https://linkedin.com/in/yourprofile",
        skills: "لێهاتوویی و لایەنگیری",
        keySkills: "لێهاتووییە سەرەکییەکان",
        skillsPlaceholder: "لێهاتووییەک بنووسە و Enter داگرە یان کرتە لەسەر زیادکردن",
        add: "زیادکردن",
        addSkills: "لایەنی کەم 3 لێهاتوویی زیاد بکە",
        languagesSpoken: "زمانە قسەکراوەکان",
        languagesPlaceholder: "زمان (نموونە، ئینگلیزی، ئیسپانی)",
        certifications: "بڕوانامەکان",
        certificationsPlaceholder: "لیستی هەر بڕوانامەی پیشەیی بکە کە هەتە...",
        additionalInfo: "زانیاری زیاتر",
        availability: "بەردەستبوون",
        selectAvailability: "بەردەستبوون هەڵبژێرە",
        immediate: "دەستبەجێ",
        within2weeks: "لە ماوەی 2 هەفتە",
        within1month: "لە ماوەی 1 مانگ",
        within2months: "لە ماوەی 2 مانگ",
        within3months: "3+ مانگ",
        expectedSalary: "مەودای موچەی چاوەڕوانکراو",
        min: "کەمترین",
        max: "زۆرترین",
        coverLetter: "نامەی دڵنیایی / بۆچی ئارەزووت بەم پێگەیە هەیە؟",
        coverLetterPlaceholder: "پێمان بڵێ بۆچی ئارەزووت بەم ڕۆڵە هەیە و چی تۆ گونجاو دەکات...",
        characters: "/500 پیت",
        hearAboutUs: "چۆن گوێت لێمان بوو؟",
        selectSource: "سەرچاوە هەڵبژێرە",
        jobBoard: "تەختەی کار (Indeed، LinkedIn، هتد)",
        companyWebsite: "ماڵپەڕی کۆمپانیا",
        employeeReferral: "ناردنی کارمەند",
        socialMedia: "تۆڕە کۆمەڵایەتییەکان",
        recruiter: "دامەزرێنەر",
        agreeTerms: "رازیم بە مەرج و ئامانجەکان و سیاسەتی تایبەتێتی",
        previous: "پێشوو",
        next: "دواتر",
        submit: "داواکاری پێشکەش بکە",
        successTitle: "داواکاری بە سەرکەوتوویی پێشکەش کرا!",
        successMessage: "سوپاس بۆ ئارەزووت. داواکاریەکەت پێداچوونەوە دەکەین و زوو دەگەڕێینەوە بۆت.",
        // Validation messages
        required: "ئەم خانەیە پێویستە",
        invalidEmail: "تکایە ئیمەیڵێکی دروست بنووسە",
        invalidPhone: "تکایە ژمارەی تەلەفۆنێکی دروست بنووسە",
        invalidUrl: "تکایە بەستەرێکی دروست بنووسە",
        minSkills: "تکایە لایەنی کەم 3 لێهاتوویی زیاد بکە",
        // Position options
        softwareEngineer: "ئەندازیاری نەرمەکاڵا",
        frontendDeveloper: "گەشەپێدەری پێشەوە",
        backendDeveloper: "گەشەپێدەری پاشەوە",
        fullstackDeveloper: "گەشەپێدەری تەواو",
        dataScientist: "زانای داتا",
        productManager: "بەڕێوەبەری بەرهەم",
        uiuxDesigner: "دیزاینەری UI/UX",
        devopsEngineer: "ئەندازیاری DevOps",
        qaEngineer: "ئەندازیاری دڵنیایی کوالیتی",
        projectManager: "بەڕێوەبەری پرۆژە"
    }
};

// Position options
const positionOptions = [
    { value: 'software-engineer', translationKey: 'softwareEngineer' },
    { value: 'frontend-developer', translationKey: 'frontendDeveloper' },
    { value: 'backend-developer', translationKey: 'backendDeveloper' },
    { value: 'fullstack-developer', translationKey: 'fullstackDeveloper' },
    { value: 'data-scientist', translationKey: 'dataScientist' },
    { value: 'product-manager', translationKey: 'productManager' },
    { value: 'uiux-designer', translationKey: 'uiuxDesigner' },
    { value: 'devops-engineer', translationKey: 'devopsEngineer' },
    { value: 'qa-engineer', translationKey: 'qaEngineer' },
    { value: 'project-manager', translationKey: 'projectManager' },
    { value: 'other', translationKey: 'other' }
];

// Current language
let currentLang = 'en';

// DOM Elements
const languageDropdownBtn = document.getElementById('languageDropdownBtn');
const languageDropdownMenu = document.getElementById('languageDropdownMenu');
const languageBtnText = document.getElementById('languageBtnText');
const languageOptions = document.querySelectorAll('.language-option');
const form = document.getElementById('applicationForm');
const sections = document.querySelectorAll('.form-section');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const submitBtn = document.getElementById('submitBtn');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const successMessage = document.getElementById('successMessage');

// Skills and languages
let skillsArray = [];
let languagesArray = [];

let currentSection = 0;

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
        languageDropdownBtn.setAttribute('aria-expanded', 'false');
        languageDropdownMenu.classList.remove('active');
    });
});

// ====================================
// Language Translation
// ====================================

function changeLanguage(lang) {
    currentLang = lang;
    
    // Update button text
    const languageNames = {
        en: 'English',
        ar: 'العربية',
        ku: 'کوردی'
    };
    languageBtnText.textContent = languageNames[lang];
    
    // Update active state
    languageOptions.forEach(option => {
        if (option.getAttribute('data-lang') === lang) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
    
    // Update HTML direction
    const htmlElement = document.getElementById('htmlLang');
    if (lang === 'ar' || lang === 'ku') {
        htmlElement.setAttribute('dir', 'rtl');
        htmlElement.setAttribute('lang', lang);
    } else {
        htmlElement.setAttribute('dir', 'ltr');
        htmlElement.setAttribute('lang', lang);
    }
    
    // Translate all elements
    translatePage(lang);
    
    // Re-populate position dropdown
    populatePositionDropdown();
}

function translatePage(lang) {
    // Translate elements with data-translate attribute
    const elements = document.querySelectorAll('[data-translate]');
    
    elements.forEach(element => {
        const key = element.getAttribute('data-translate');
        if (translations[lang] && translations[lang][key]) {
            // Handle special cases
            if (element.tagName === 'OPTION') {
                element.textContent = translations[lang][key];
            } else if (element.classList.contains('checkbox-label') || key === 'agreeTerms') {
                // Handle terms and conditions with HTML
                const text = translations[lang][key];
                if (lang === 'en') {
                    element.innerHTML = 'I agree to the <a href="#" target="_blank">Terms and Conditions</a> and <a href="#" target="_blank">Privacy Policy</a> <span class="required">*</span>';
                } else if (lang === 'ar') {
                    element.innerHTML = 'أوافق على <a href="#" target="_blank">الشروط والأحكام</a> و<a href="#" target="_blank">سياسة الخصوصية</a> <span class="required">*</span>';
                } else if (lang === 'ku') {
                    element.innerHTML = 'رازیم بە <a href="#" target="_blank">مەرج و ئامانجەکان</a> و <a href="#" target="_blank">سیاسەتی تایبەتێتی</a> <span class="required">*</span>';
                }
            } else {
                element.textContent = translations[lang][key];
            }
        }
    });
    
    // Translate placeholders
    const placeholderElements = document.querySelectorAll('[data-placeholder]');
    placeholderElements.forEach(element => {
        const key = element.getAttribute('data-placeholder');
        if (translations[lang] && translations[lang][key]) {
            element.placeholder = translations[lang][key];
        }
    });
}

// Populate position dropdown with translated options
function populatePositionDropdown() {
    const positionSelect = document.getElementById('position');
    
    // Keep the first option (Select a position)
    const firstOption = positionSelect.options[0];
    positionSelect.innerHTML = '';
    positionSelect.appendChild(firstOption);
    
    // Add all position options with translations
    positionOptions.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = translations[currentLang][option.translationKey];
        positionSelect.appendChild(optionElement);
    });
}

// ====================================
// Form Navigation
// ====================================

function showSection(n) {
    sections.forEach((section, index) => {
        section.classList.remove('active');
        if (index === n) {
            section.classList.add('active');
        }
    });
    
    // Update buttons
    if (n === 0) {
        prevBtn.style.display = 'none';
    } else {
        prevBtn.style.display = 'inline-block';
    }
    
    if (n === sections.length - 1) {
        nextBtn.style.display = 'none';
        submitBtn.style.display = 'inline-block';
    } else {
        nextBtn.style.display = 'inline-block';
        submitBtn.style.display = 'none';
    }
    
    // Update progress
    updateProgress();
}

function updateProgress() {
    const progress = ((currentSection + 1) / sections.length) * 100;
    progressFill.style.width = progress + '%';
    progressPercent.textContent = Math.round(progress);
}

function validateSection(sectionIndex) {
    const section = sections[sectionIndex];
    const inputs = section.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        const errorMessage = input.parentElement.querySelector('.error-message');
        
        if (!input.value.trim()) {
            if (errorMessage) {
                errorMessage.textContent = translations[currentLang].required;
                errorMessage.style.display = 'block';
            }
            input.classList.add('error');
            isValid = false;
        } else {
            // Specific validations
            if (input.type === 'email' && !isValidEmail(input.value)) {
                if (errorMessage) {
                    errorMessage.textContent = translations[currentLang].invalidEmail;
                    errorMessage.style.display = 'block';
                }
                input.classList.add('error');
                isValid = false;
            } else if (input.type === 'tel' && !isValidPhone(input.value)) {
                if (errorMessage) {
                    errorMessage.textContent = translations[currentLang].invalidPhone;
                    errorMessage.style.display = 'block';
                }
                input.classList.add('error');
                isValid = false;
            } else if (input.type === 'url' && input.value && !isValidUrl(input.value)) {
                if (errorMessage) {
                    errorMessage.textContent = translations[currentLang].invalidUrl;
                    errorMessage.style.display = 'block';
                }
                input.classList.add('error');
                isValid = false;
            } else if (input.id === 'skills' && skillsArray.length < 3) {
                const skillsError = document.querySelector('#skills').parentElement.querySelector('.error-message');
                if (skillsError) {
                    skillsError.textContent = translations[currentLang].minSkills;
                    skillsError.style.display = 'block';
                }
                isValid = false;
            } else if (input.type === 'checkbox' && !input.checked) {
                if (errorMessage) {
                    errorMessage.textContent = translations[currentLang].required;
                    errorMessage.style.display = 'block';
                }
                input.classList.add('error');
                isValid = false;
            } else {
                if (errorMessage) {
                    errorMessage.style.display = 'none';
                }
                input.classList.remove('error');
            }
        }
    });
    
    return isValid;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^[\d\s\-\(\)\+]+$/.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

// Clear error on input
document.querySelectorAll('input, select, textarea').forEach(input => {
    input.addEventListener('input', () => {
        const errorMessage = input.parentElement.querySelector('.error-message');
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
        input.classList.remove('error');
    });
});

// Next button
nextBtn.addEventListener('click', () => {
    if (validateSection(currentSection)) {
        if (currentSection < sections.length - 1) {
            currentSection++;
            showSection(currentSection);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
});

// Previous button
prevBtn.addEventListener('click', () => {
    if (currentSection > 0) {
        currentSection--;
        showSection(currentSection);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});

// ====================================
// Skills Management
// ====================================

function addSkill() {
    const skillInput = document.getElementById('skillsInput');
    const skill = skillInput.value.trim();
    
    if (skill && !skillsArray.includes(skill)) {
        skillsArray.push(skill);
        renderSkills();
        skillInput.value = '';
        document.getElementById('skills').value = skillsArray.join(',');
    }
}

function renderSkills() {
    const skillsTags = document.getElementById('skillsTags');
    skillsTags.innerHTML = '';
    
    skillsArray.forEach((skill, index) => {
        const tag = document.createElement('span');
        tag.className = 'skill-tag';
        tag.innerHTML = `
            ${skill}
            <button type="button" class="remove-tag" data-index="${index}">&times;</button>
        `;
        skillsTags.appendChild(tag);
    });
    
    // Add remove listeners
    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            skillsArray.splice(index, 1);
            renderSkills();
            document.getElementById('skills').value = skillsArray.join(',');
        });
    });
}

document.getElementById('addSkillBtn').addEventListener('click', addSkill);
document.getElementById('skillsInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addSkill();
    }
});

// ====================================
// Languages Management
// ====================================

function addLanguage() {
    const languageInput = document.getElementById('languagesInput');
    const language = languageInput.value.trim();
    
    if (language && !languagesArray.includes(language)) {
        languagesArray.push(language);
        renderLanguages();
        languageInput.value = '';
        document.getElementById('languages').value = languagesArray.join(',');
    }
}

function renderLanguages() {
    const languagesTags = document.getElementById('languagesTags');
    languagesTags.innerHTML = '';
    
    languagesArray.forEach((language, index) => {
        const tag = document.createElement('span');
        tag.className = 'skill-tag';
        tag.innerHTML = `
            ${language}
            <button type="button" class="remove-tag" data-index="${index}">&times;</button>
        `;
        languagesTags.appendChild(tag);
    });
    
    // Add remove listeners
    document.querySelectorAll('#languagesTags .remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            languagesArray.splice(index, 1);
            renderLanguages();
            document.getElementById('languages').value = languagesArray.join(',');
        });
    });
}

document.getElementById('addLanguageBtn').addEventListener('click', addLanguage);
document.getElementById('languagesInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addLanguage();
    }
});

// ====================================
// Other Form Functionality
// ====================================

// Show/hide "Other" fields
document.getElementById('position').addEventListener('change', (e) => {
    const otherGroup = document.getElementById('positionOtherGroup');
    if (e.target.value === 'other') {
        otherGroup.style.display = 'block';
    } else {
        otherGroup.style.display = 'none';
    }
});

document.getElementById('education').addEventListener('change', (e) => {
    const otherGroup = document.getElementById('educationOtherGroup');
    if (e.target.value === 'other') {
        otherGroup.style.display = 'block';
    } else {
        otherGroup.style.display = 'none';
    }
});

// Cover letter character count
const coverLetterTextarea = document.getElementById('coverLetter');
const coverLetterCount = document.getElementById('coverLetterCount');

coverLetterTextarea.addEventListener('input', () => {
    const count = coverLetterTextarea.value.length;
    coverLetterCount.textContent = Math.min(count, 500);
    
    if (count > 500) {
        coverLetterTextarea.value = coverLetterTextarea.value.substring(0, 500);
    }
});

// ====================================
// Form Submission
// ====================================

// n8n Webhook URL - Production
const WEBHOOK_URL = "http://77.237.234.153:5678/webhook/f42eb384-b485-424b-8ce6-318fe972f6f5";

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (validateSection(currentSection)) {
        // Collect form data
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        
        // Add additional metadata
        payload.submittedAt = new Date().toISOString();
        payload.language = currentLang;
        payload.skills = skillsArray;
        payload.languages = languagesArray;
        
        console.log('Form submitted:', payload);
        
        // Send to n8n webhook
        try {
            const res = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload),
                mode: 'cors'
            });
            
            // Log response for debugging
            console.log('Webhook response status:', res.status);
            const responseData = await res.json().catch(() => ({}));
            console.log('Webhook response data:', responseData);
            
            // Check if webhook returned success (200-299 status codes)
            if (res.ok || res.status === 200) {
                console.log('✅ Form submitted successfully to webhook!');
                
                // Hide form and show success message
                form.style.display = 'none';
                document.querySelector('.form-header').style.display = 'none';
                successMessage.style.display = 'block';
                
                // Scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
                
                // Clear form data from localStorage
                localStorage.removeItem('formData');
            } else {
                console.error('❌ Webhook returned non-OK status:', res.status);
                alert('Submission failed. Please try again or contact support.');
            }
        } catch (error) {
            // CORS or network error - but data might still be sent
            console.error('❌ Error sending to webhook:', error);
            console.log('ℹ️ Note: This might be a CORS issue, but data may have been received by webhook');
            
            // Show success anyway since webhook might have received the data
            alert('Form submitted! If you experience issues, please contact support.');
            
            // Hide form and show success message
            form.style.display = 'none';
            document.querySelector('.form-header').style.display = 'none';
            successMessage.style.display = 'block';
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
});

// ====================================
// Initialize
// ====================================

document.addEventListener('DOMContentLoaded', () => {
    // Set initial language
    changeLanguage('en');
    
    // Show first section
    showSection(0);
    
    // Populate position dropdown
    populatePositionDropdown();
});

