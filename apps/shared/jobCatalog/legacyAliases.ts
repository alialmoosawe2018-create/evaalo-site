/** Safe legacy title → structured role (never ambiguous titles). */
export const LEGACY_TITLE_ALIASES: Record<
    string,
    {
        roleKey: string;
        careerLevel: string;
        managementTrack: string;
        labelKey: string;
        displayTitle: string;
    }
> = {
    Recruiter: {
        roleKey: 'recruiter',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'recruiter.mid',
        displayTitle: 'Recruitment',
    },
    'Recruitment Coordinator': {
        roleKey: 'recruiter',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'recruiter.mid',
        displayTitle: 'Recruitment',
    },
    Accountant: {
        roleKey: 'general_accountant',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'general_accountant.mid',
        displayTitle: 'General Accountant',
    },
    'Procurement Office': {
        roleKey: 'procurement_officer',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'procurement_officer.mid',
        displayTitle: 'Procurement Officer',
    },
    'Fire Fighting Engineer': {
        roleKey: 'fire_protection_engineer',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'fire_protection_engineer.mid',
        displayTitle: 'Fire Protection Engineer',
    },
    Intern: {
        roleKey: 'intern',
        careerLevel: 'intern',
        managementTrack: 'ic',
        labelKey: 'intern.intern',
        displayTitle: 'Intern',
    },
    Trainee: {
        roleKey: 'graduate_trainee',
        careerLevel: 'graduate',
        managementTrack: 'ic',
        labelKey: 'graduate_trainee.graduate',
        displayTitle: 'Graduate Trainee',
    },
    'Graduate Trainee': {
        roleKey: 'graduate_trainee',
        careerLevel: 'graduate',
        managementTrack: 'ic',
        labelKey: 'graduate_trainee.graduate',
        displayTitle: 'Graduate Trainee',
    },
    'Production Engineer (Oil & Gas)': {
        roleKey: 'production_engineer_oil_gas',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'production_engineer_oil_gas.mid',
        displayTitle: 'Production Engineer – Oil and Gas',
    },
    CEO: {
        roleKey: 'ceo',
        careerLevel: 'executive',
        managementTrack: 'executive',
        labelKey: 'ceo.executive',
        displayTitle: 'Chief Executive Officer',
    },
    'Mobile Developer (Android)': {
        roleKey: 'mobile_developer_android',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'mobile_developer_android.mid',
        displayTitle: 'Android Developer',
    },
    'Mobile Developer (iOS)': {
        roleKey: 'mobile_developer_ios',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'mobile_developer_ios.mid',
        displayTitle: 'iOS Developer',
    },
    'QA Engineer / Tester': {
        roleKey: 'qa_engineer',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'qa_engineer.mid',
        displayTitle: 'QA Engineer',
    },
    'Compensation & Benefits Specialist': {
        roleKey: 'compensation_benefits_specialist',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'compensation_benefits_specialist.mid',
        displayTitle: 'Compensation and Benefits Specialist',
    },
    'Learning & Development Specialist': {
        roleKey: 'learning_development_specialist',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'learning_development_specialist.mid',
        displayTitle: 'Learning and Development Specialist',
    },
    'Site Reliability Engineer (SRE)': {
        roleKey: 'site_reliability_engineer',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'site_reliability_engineer.mid',
        displayTitle: 'Site Reliability Engineer',
    },
    'Quality Control Engineer (Chemical)': {
        roleKey: 'quality_control_engineer_chemical',
        careerLevel: 'mid',
        managementTrack: 'ic',
        labelKey: 'quality_control_engineer_chemical.mid',
        displayTitle: 'Quality Control Engineer – Chemical',
    },
};

/** Titles that must NOT map to a fixed roleKey — infer from job ad/criteria. */
export const AMBIGUOUS_LEGACY_TITLES: string[] = [
    'Production Engineer',
    'Field Engineer',
    'Security Engineer',
    'Auditor',
    'Researcher',
    'Intern / Trainee',
];
