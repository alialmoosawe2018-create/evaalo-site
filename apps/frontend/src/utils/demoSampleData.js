/**
 * First-login demo candidates / recent-interview mocks.
 * Names and job titles follow the active UI language via `t`.
 */

const DEMO_POSITION_KEYS = {
    mechanicalEngineer: 'demoSample_position_mechanicalEngineer',
    salesManager: 'demoSample_position_salesManager',
    financeSpecialist: 'demoSample_position_financeSpecialist',
    hrAssistant: 'demoSample_position_hrAssistant',
};

/** English position strings kept for filters / catalog lookup when not using display labels. */
const DEMO_POSITION_EN = {
    mechanicalEngineer: 'Mechanical Engineer',
    salesManager: 'Sales Manager',
    financeSpecialist: 'Finance Specialist',
    hrAssistant: 'HR Assistant',
};

/** Professional demo headshots served from `public/images/demo/`. */
const DEMO_PHOTOS = {
    yousef: '/images/demo/yousef-haider-mazen.jpg',
    ahmed: '/images/demo/ahmed-abdullah-hussein.jpg',
    mohammed: '/images/demo/mohammed-hassan.jpg',
    ritaj: '/images/demo/ritaj-mustafa-musa.jpg',
};

/** Print-ready demo CVs served from `public/demo/cvs/`. */
const DEMO_CVS = {
    yousef: '/demo/cvs/yousef-haider-mazen.html',
    ahmed: '/demo/cvs/ahmed-abdullah-hussein.html',
    mohammed: '/demo/cvs/mohammed-hassan.html',
    ritaj: '/demo/cvs/ritaj-mustafa-musa.html',
};

/**
 * @param {(key: string) => string} t
 * @returns {Array<object>}
 */
export function buildSampleCandidates(t) {
    return [
        {
            id: 1,
            full_name: t('demoSample_name_ahmed'),
            email: 'ali.mahmoud.najm@example.com',
            phone: '+966 50 123 4567',
            position_applied_for: DEMO_POSITION_EN.mechanicalEngineer,
            years_of_experience: '5',
            current_company: 'Tech Corp',
            highest_education_level: "Bachelor's Degree",
            gender: 'male',
            photo: DEMO_PHOTOS.yousef,
            cv: DEMO_CVS.yousef,
            cvFileName: 'Yousef_Haider_Mazen_CV.html',
            skills: ['CAD', 'SolidWorks', 'Thermodynamics', 'Maintenance'],
            languages: ['Arabic', 'English'],
            coverLetter:
                'Experienced mechanical engineer with 5 years of experience in design and maintenance...',
            aiEvaluation: {
                score: 85,
                communication: 90,
                technical: 88,
                problemSolving: 82,
                confidence: 87,
                feedback:
                    'Strong technical skills and excellent communication. Shows good problem-solving abilities.',
            },
            status: 'pending',
            interviewDate: '2025-01-15',
        },
        {
            id: 2,
            full_name: t('demoSample_name_sarah'),
            email: 'ahmed.abdullah.hussein@example.com',
            phone: '+1 555 123 4567',
            position_applied_for: DEMO_POSITION_EN.salesManager,
            years_of_experience: '7',
            current_company: 'StartupXYZ',
            highest_education_level: "Master's Degree",
            gender: 'male',
            photo: DEMO_PHOTOS.ahmed,
            cv: DEMO_CVS.ahmed,
            cvFileName: 'Ahmed_Abdullah_Hussein_CV.html',
            skills: ['B2B Sales', 'CRM', 'Negotiation', 'Team Leadership'],
            languages: ['Arabic', 'English'],
            coverLetter: 'Sales manager with extensive experience in B2B growth and team leadership...',
            aiEvaluation: {
                score: 78,
                communication: 85,
                technical: 72,
                problemSolving: 80,
                confidence: 75,
                feedback: 'Good communication skills but needs improvement in technical areas.',
            },
            status: 'pending',
            interviewDate: '2025-01-14',
        },
        {
            id: 3,
            full_name: t('demoSample_name_mohammed'),
            email: 'mohammed.hassan@example.com',
            phone: '+971 50 987 6543',
            position_applied_for: DEMO_POSITION_EN.financeSpecialist,
            years_of_experience: '3',
            current_company: 'Data Solutions Inc',
            highest_education_level: "Bachelor's Degree",
            gender: 'male',
            photo: DEMO_PHOTOS.mohammed,
            cv: DEMO_CVS.mohammed,
            cvFileName: 'Mohammed_Hassan_CV.html',
            skills: ['Financial Analysis', 'Budgeting', 'Excel', 'Reporting'],
            languages: ['Arabic', 'English', 'French'],
            coverLetter: 'Finance specialist focused on budgeting, reporting, and financial analysis...',
            aiEvaluation: {
                score: 92,
                communication: 88,
                technical: 95,
                problemSolving: 90,
                confidence: 93,
                feedback:
                    'Excellent technical skills and strong analytical thinking. Highly recommended.',
            },
            status: 'pending',
            interviewDate: '2025-01-13',
        },
        {
            id: 4,
            full_name: t('demoSample_name_emily'),
            email: 'ritaj.mustafa.musa@example.com',
            phone: '+964 770 123 4567',
            position_applied_for: DEMO_POSITION_EN.hrAssistant,
            years_of_experience: '4',
            current_company: 'Design Studio',
            highest_education_level: "Bachelor's Degree",
            gender: 'female',
            photo: DEMO_PHOTOS.ritaj,
            cv: DEMO_CVS.ritaj,
            cvFileName: 'Ritaj_Mustafa_Musa_CV.html',
            skills: ['Recruitment Support', 'HRIS', 'Employee Relations', 'Onboarding'],
            languages: ['Arabic', 'English'],
            coverLetter: 'HR assistant experienced in recruitment support, onboarding, and employee relations...',
            aiEvaluation: {
                score: 65,
                communication: 70,
                technical: 60,
                problemSolving: 65,
                confidence: 65,
                feedback: 'Needs improvement in technical skills and communication clarity.',
            },
            status: 'pending',
            interviewDate: '2025-01-12',
        },
    ];
}

/**
 * @param {(key: string) => string} t
 * @returns {Array<{ id: string, candidate: string, position: string, status: string, date: string }>}
 */
export function buildMockRecentInterviews(t) {
    return [
        {
            id: 'mock-1',
            candidate: t('demoSample_name_ahmed'),
            full_name: t('demoSample_name_ahmed'),
            position: t(DEMO_POSITION_KEYS.mechanicalEngineer),
            status: 'pending',
            date: '2025-01-15',
            gender: 'male',
            photoUrl: DEMO_PHOTOS.yousef,
        },
        {
            id: 'mock-2',
            candidate: t('demoSample_name_sarah'),
            full_name: t('demoSample_name_sarah'),
            position: t(DEMO_POSITION_KEYS.salesManager),
            status: 'pending',
            date: '2025-01-14',
            gender: 'male',
            photoUrl: DEMO_PHOTOS.ahmed,
        },
        {
            id: 'mock-3',
            candidate: t('demoSample_name_mohammed'),
            full_name: t('demoSample_name_mohammed'),
            position: t(DEMO_POSITION_KEYS.financeSpecialist),
            status: 'pending',
            date: '2025-01-13',
            gender: 'male',
            photoUrl: DEMO_PHOTOS.mohammed,
        },
        {
            id: 'mock-4',
            candidate: t('demoSample_name_emily'),
            full_name: t('demoSample_name_emily'),
            position: t(DEMO_POSITION_KEYS.hrAssistant),
            status: 'pending',
            date: '2025-01-12',
            gender: 'female',
            photoUrl: DEMO_PHOTOS.ritaj,
        },
    ];
}

export function isMockRecentInterviewId(id) {
    return String(id ?? '').startsWith('mock-');
}
