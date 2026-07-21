/**
 * First-login demo candidates / recent-interview mocks.
 * Names and job titles follow the active UI language via `t`.
 */

const DEMO_POSITION_KEYS = {
    softwareEngineer: 'demoSample_position_softwareEngineer',
    productManager: 'demoSample_position_productManager',
    dataAnalyst: 'demoSample_position_dataAnalyst',
    uxDesigner: 'demoSample_position_uxDesigner',
};

/** English position strings kept for filters / catalog lookup when not using display labels. */
const DEMO_POSITION_EN = {
    softwareEngineer: 'Software Engineer',
    productManager: 'Product Manager',
    dataAnalyst: 'Data Analyst',
    uxDesigner: 'UX Designer',
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
            position_applied_for: DEMO_POSITION_EN.softwareEngineer,
            years_of_experience: '5',
            current_company: 'Tech Corp',
            highest_education_level: "Bachelor's Degree",
            gender: 'male',
            skills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
            languages: ['Arabic', 'English'],
            coverLetter:
                'Experienced software engineer with 5 years of experience in web development...',
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
            position_applied_for: DEMO_POSITION_EN.productManager,
            years_of_experience: '7',
            current_company: 'StartupXYZ',
            highest_education_level: "Master's Degree",
            gender: 'male',
            skills: ['Product Management', 'Agile', 'Data Analysis'],
            languages: ['Arabic', 'English'],
            coverLetter: 'Product manager with extensive experience in agile methodologies...',
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
            position_applied_for: DEMO_POSITION_EN.dataAnalyst,
            years_of_experience: '3',
            current_company: 'Data Solutions Inc',
            highest_education_level: "Bachelor's Degree",
            gender: 'male',
            skills: ['Python', 'SQL', 'Tableau', 'Excel'],
            languages: ['Arabic', 'English', 'French'],
            coverLetter: 'Data analyst passionate about turning data into insights...',
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
            position_applied_for: DEMO_POSITION_EN.uxDesigner,
            years_of_experience: '4',
            current_company: 'Design Studio',
            highest_education_level: "Bachelor's Degree",
            gender: 'female',
            skills: ['Figma', 'Adobe XD', 'User Research', 'Prototyping'],
            languages: ['Arabic', 'English'],
            coverLetter: 'Creative UX designer focused on user-centered design...',
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
            position: t(DEMO_POSITION_KEYS.softwareEngineer),
            status: 'pending',
            date: '2025-01-15',
        },
        {
            id: 'mock-2',
            candidate: t('demoSample_name_sarah'),
            position: t(DEMO_POSITION_KEYS.productManager),
            status: 'pending',
            date: '2025-01-14',
        },
        {
            id: 'mock-3',
            candidate: t('demoSample_name_mohammed'),
            position: t(DEMO_POSITION_KEYS.dataAnalyst),
            status: 'pending',
            date: '2025-01-13',
        },
        {
            id: 'mock-4',
            candidate: t('demoSample_name_emily'),
            position: t(DEMO_POSITION_KEYS.uxDesigner),
            status: 'pending',
            date: '2025-01-12',
        },
    ];
}

export function isMockRecentInterviewId(id) {
    return String(id ?? '').startsWith('mock-');
}
