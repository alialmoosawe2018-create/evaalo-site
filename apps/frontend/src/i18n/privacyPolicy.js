/** Privacy Policy copy — May 2026 (EN / AR / KU) */

import { privacyPolicyAr } from './privacyPolicy.ar.js';
import { privacyPolicyKu } from './privacyPolicy.ku.js';

export const privacyPolicyByLocale = {
    en: {
        updated: 'Last updated: May 2026',
        opening: {
            paragraphs: [
                'Evaalo, LLC ("evaalo," "we," "us," or "our") operates the evaalo platform and related services, including AI-assisted recruitment, candidate screening, interview management, and recruitment workflow tools.',
                'We respect your privacy and are committed to handling personal data responsibly. This Privacy Policy explains what information we collect, how we use it, when we may share it, and the choices available to users.',
            ],
            contactLine: 'For privacy-related questions or requests, contact us at:',
        },
        s1: {
            title: '1. Scope of This Privacy Policy',
            paragraphs: [
                'This Privacy Policy applies to evaalo\'s website, platform, recruitment tools, candidate screening workflows, interview tools, and related services.',
                'evaalo may be used by employers, recruiters, hiring organizations, and candidates.',
                'When an employer or organization uses evaalo to recruit candidates, that organization generally determines the purpose of collecting candidate information and making recruitment decisions. evaalo processes candidate data to provide and operate the platform for that organization.',
                'Employers remain responsible for their recruitment practices, job advertisements, candidate communications, hiring decisions, and compliance with applicable employment and privacy laws.',
            ],
        },
        s2: {
            title: '2. Information We Collect',
            intro: 'We may collect information directly from users, from hiring organizations, from candidates, and automatically through use of the platform.',
            candidate: {
                title: 'a. Candidate Information',
                intro: 'Candidate information may include:',
                bullets: [
                    'Name',
                    'Email address',
                    'Phone number, if provided',
                    'Resume or CV',
                    'Work history',
                    'Education history',
                    'Skills, qualifications, certifications, and experience',
                    'Application form responses',
                    'Text responses during screening or interviews',
                    'Voice responses during interviews',
                    'Video responses or recordings, where applicable',
                    'Interview transcripts',
                    'AI-generated summaries, scores, comparisons, recommendations, or evaluation outputs',
                    'Information provided by the candidate or the hiring organization during the recruitment process',
                ],
            },
            employer: {
                title: 'b. Employer and Organization Information',
                intro: 'We may collect information from employers, recruiters, and organizations, including:',
                bullets: [
                    'Company or organization name',
                    'Contact name',
                    'Email address',
                    'Account credentials',
                    'Team or organization details',
                    'Job titles, job descriptions, hiring criteria, and recruitment campaign information',
                    'Candidate evaluation criteria',
                    'Billing and subscription-related information',
                    'Support requests and communications with evaalo',
                ],
            },
            technical: {
                title: 'c. Technical and Usage Information',
                intro: 'When users access the platform, we may collect technical information such as:',
                bullets: [
                    'IP address',
                    'Browser type',
                    'Device type',
                    'Operating system',
                    'Log data',
                    'Session and authentication information',
                    'Platform activity and usage data',
                    'Error reports and security-related logs',
                    'Integration and API-related data, where applicable',
                ],
            },
        },
        s3: {
            title: '3. AI-Assisted Recruitment and Human Review',
            paragraphs: [
                'evaalo uses artificial intelligence and automation technologies to assist recruitment workflows.',
                'Depending on the services used, AI may help organize, summarize, compare, analyze, or evaluate information from job applications, resumes, interview responses, voice recordings, video recordings, and other candidate data.',
            ],
            analyzeIntro: 'AI-assisted features may analyze information such as:',
            analyzeBullets: [
                'Job-related skills and qualifications',
                'Interview responses',
                'Communication patterns',
                'Language proficiency',
                'Experience-related information',
                'Candidate fit against hiring criteria',
                'Overall performance indicators',
            ],
            footParagraphs: [
                'evaalo does not make final hiring decisions.',
                'AI-generated outputs are intended to assist employers and recruiters. Employers remain responsible for reviewing relevant information, making recruitment decisions, and ensuring that AI-assisted outputs are used fairly, appropriately, and lawfully.',
            ],
        },
        s4: {
            title: '4. Audio and Video Interviews',
            paragraphs: [
                'evaalo may provide voice and video interview functionality.',
                'Where audio or video interviews are recorded, candidates may be informed before recording begins. Recordings may be used to provide interview functionality, generate transcripts, create summaries, support recruitment workflows, and assist with candidate evaluation.',
                'Audio and video recordings may be processed using approved service providers that support evaalo\'s platform functionality.',
                'Where required by applicable law, evaalo or the hiring organization may request consent before recording an interview.',
            ],
        },
        s5: {
            title: '5. How We Use Information',
            intro: 'We may use personal data to:',
            bullets: [
                'Operate, maintain, and improve the evaalo platform',
                'Create and manage accounts',
                'Conduct candidate screening and interview workflows',
                'Process resumes, applications, interview responses, and recordings',
                'Generate AI-assisted summaries, evaluations, comparisons, and reports',
                'Enable employers to review candidate information',
                'Manage recruitment campaigns',
                'Provide customer support',
                'Send service-related notices and communications',
                'Maintain security and prevent fraud, misuse, or unauthorized access',
                'Monitor platform performance and troubleshoot errors',
                'Process billing, subscriptions, and payment-related activities',
                'Comply with legal obligations',
                'Enforce our agreements and protect evaalo, users, candidates, and organizations',
            ],
        },
        s6: {
            title: '6. How We Share Information',
            intro: 'We may share information in the following circumstances:',
            hiringOrgs: {
                title: 'a. With Hiring Organizations',
                p: 'Candidate information may be shared with the employer, recruiter, or organization that created or manages the relevant recruitment campaign.',
            },
            authorizedUsers: {
                title: 'b. With Authorized Users',
                p: 'Information may be accessible to authorized members of the hiring organization, such as recruiters, hiring managers, administrators, or other users permitted by that organization.',
            },
            serviceProviders: {
                title: 'c. With Service Providers',
                intro: 'We may use approved service providers that help us operate and support the platform, including providers for:',
                bullets: [
                    'Cloud hosting and infrastructure',
                    'Database services',
                    'Authentication and account management',
                    'Payment processing',
                    'File and recording storage',
                    'Communication services',
                    'Analytics and monitoring',
                    'Artificial intelligence and automation services',
                    'Workflow automation',
                    'Technical support and security services',
                ],
                foot: 'These providers may process personal data only as needed to provide services to evaalo.',
            },
            legal: {
                title: 'd. For Legal, Security, or Business Reasons',
                intro: 'We may disclose information when reasonably necessary to:',
                bullets: [
                    'Comply with applicable law, legal process, or lawful government requests',
                    'Protect the rights, safety, security, or property of evaalo, users, candidates, employers, or others',
                    'Prevent fraud, abuse, security incidents, or unauthorized use',
                    'Enforce our agreements',
                    'Support a merger, acquisition, financing, reorganization, sale of assets, or similar business transaction',
                ],
            },
            noSell: {
                title: 'e. No Sale of Personal Data',
                p: 'evaalo does not sell personal data to third parties.',
            },
        },
        s7: {
            title: '7. Data Storage and Security',
            intro: 'We use reasonable administrative, technical, and organizational safeguards designed to protect personal data.',
            bullets: [
                'Secure hosting environments',
                'Encryption in transit using HTTPS',
                'Access controls and authentication measures',
                'Restricted access to sensitive systems',
                'Monitoring and logging',
                'Security practices designed to reduce unauthorized access, misuse, or loss of data',
            ],
            foot: 'No online system can guarantee absolute security. Users should protect their account credentials and notify us promptly of any suspected unauthorized access.',
        },
        s8: {
            title: '8. Data Retention',
            paragraphs: [
                'We retain personal data for as long as reasonably necessary to provide the evaalo services, support recruitment processes, comply with legal obligations, resolve disputes, enforce agreements, maintain security, and meet legitimate business requirements.',
                'Candidate data may be retained according to the hiring organization\'s recruitment process, account settings, retention preferences, or legal obligations.',
                'Audio and video recordings may be retained for the period selected by the relevant hiring organization, unless deletion is requested or continued retention is required for legal, security, contractual, or dispute-resolution purposes.',
                'When data is no longer needed, we may delete, anonymize, or securely archive it in accordance with applicable requirements.',
            ],
        },
        s9: {
            title: '9. Your Privacy Rights',
            intro: 'Depending on your location and applicable law, you may have rights to:',
            bullets: [
                'Request access to personal data',
                'Request correction or update of inaccurate information',
                'Request deletion of personal data',
                'Request restriction of certain processing',
                'Object to certain processing',
                'Withdraw consent where processing is based on consent',
                'Request information about how personal data is used',
            ],
            requestIntro: 'To submit a privacy request, contact:',
            verifyNote:
                'Please include sufficient information for us to verify your identity and identify the relevant data.',
            candidateNote:
                'If you are a candidate, you may also contact the employer or organization that invited you to the recruitment process, as that organization may control the recruitment campaign and related candidate data.',
        },
        s10: {
            title: '10. Cookies and Similar Technologies',
            intro: 'evaalo may use cookies and similar technologies to:',
            bullets: [
                'Maintain user sessions',
                'Support login and authentication',
                'Protect platform security',
                'Remember preferences',
                'Improve user experience',
                'Analyze platform performance',
                'Detect technical issues and prevent misuse',
            ],
            foot: 'Some cookies are necessary for the platform to function properly. Users may be able to manage certain cookie settings through their browser or device settings.',
        },
        s11: {
            title: '11. International Data Transfers',
            paragraphs: [
                'evaalo and its service providers may store or process personal data in countries other than the country where a user is located.',
                'When personal data is transferred internationally, we take reasonable steps to protect it in accordance with applicable requirements.',
            ],
        },
        s12: {
            title: '12. Children\'s Privacy',
            paragraphs: [
                'evaalo is not intended for individuals under the age of 18.',
                'We do not knowingly collect personal data from children. If you believe that a child has provided personal data to evaalo, please contact us at:',
            ],
            contactLine: null,
        },
        s13: {
            title: '13. Third-Party Services',
            paragraphs: [
                'evaalo may integrate with third-party services, tools, or platforms.',
                'Those third-party services may have their own privacy policies and terms. evaalo is not responsible for the privacy practices of third-party services that are not controlled by evaalo.',
                'Users should review the privacy policies of relevant third-party services where applicable.',
            ],
        },
        s14: {
            title: '14. Changes to This Privacy Policy',
            paragraphs: [
                'We may update this Privacy Policy from time to time to reflect changes in our services, legal requirements, technology, or business practices.',
                'When we make significant changes, we may provide notice through the evaalo platform, by email, or through another appropriate method.',
                'The "Last updated" date at the top of this Privacy Policy shows when it was most recently revised.',
            ],
        },
        contact: {
            title: '15. Contact Us',
            intro: 'For questions, requests, or concerns regarding this Privacy Policy or evaalo\'s privacy practices, contact us at:',
            company: 'Evaalo, LLC',
        },
    },
    ar: privacyPolicyAr,
    ku: privacyPolicyKu,
};
