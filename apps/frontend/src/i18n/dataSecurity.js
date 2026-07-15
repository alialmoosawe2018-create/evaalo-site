/** Data & Security copy — May 2026 (EN / AR / KU) */

import { dataSecurityAr } from './dataSecurity.ar.js';
import { dataSecurityKu } from './dataSecurity.ku.js';

export const dataSecurityByLocale = {    en: {
        updated: 'Last updated: May 2026',
        opening: {
            paragraphs: [
                'Evaalo, LLC is committed to protecting the security, confidentiality, and integrity of information processed through the Evaalo platform.',
                'This page explains the security practices and safeguards used to help protect user, organization, candidate, and recruitment data.',
            ],
            contactLine: 'For security-related questions or reports, contact:',
        },
        s1: {
            title: '1. Security Approach',
            paragraphs: [
                'Evaalo uses reasonable administrative, technical, and organizational measures designed to protect information from unauthorized access, misuse, loss, alteration, or disclosure.',
                'Security practices are regularly reviewed and may evolve as Evaalo develops its services, infrastructure, and operational controls.',
                'No online service can guarantee absolute security. However, Evaalo works to reduce security risks and respond appropriately when issues are identified.',
            ],
        },
        s2: {
            title: '2. Data Protection Measures',
            intro:
                'Evaalo uses safeguards designed to protect data during transmission, storage, and access.',
            measuresIntro: 'These measures may include:',
            bullets: [
                'Encryption in transit using HTTPS',
                'Authentication and session security controls',
                'Restricted access to sensitive systems and data',
                'Role-based access controls where applicable',
                'Secure environment configuration',
                'Logging of relevant security-sensitive actions',
                'Security updates and dependency maintenance',
                'Measures designed to reduce unauthorized access and misuse',
            ],
        },
        s3: {
            title: '3. Data Storage and Infrastructure',
            paragraphs: [
                'Evaalo may use trusted cloud infrastructure and service providers to host, store, process, and deliver platform functionality.',
            ],
            servicesIntro:
                'Depending on the services used, data may be processed through secure infrastructure supporting:',
            bullets: [
                'Application hosting',
                'Database services',
                'File and recording storage',
                'Authentication',
                'Payment processing',
                'Artificial intelligence services',
                'Voice and video interview functionality',
                'Workflow automation',
                'Monitoring and technical support',
            ],
            foot:
                'Where applicable, Evaalo uses organization-level controls intended to help separate data between different customer organizations and users.',
        },
        s4: {
            title: '4. Access Control',
            intro:
                'Access to Evaalo systems and data is limited to authorized individuals and services that require access for legitimate operational purposes.',
            controlsIntro: 'Evaalo applies access controls designed to ensure that:',
            bullets: [
                'Users can access only the information permitted by their role and organization',
                'Sensitive administrative actions are restricted',
                'Access credentials are protected',
                'Authentication is required for protected platform areas',
                'Relevant access activity may be logged for security and operational purposes',
            ],
            foot:
                'Users are responsible for protecting their passwords, authentication methods, and account credentials.',
        },
        s5: {
            title: '5. Audio, Video, and Interview Data',
            paragraphs: [
                'Evaalo may process candidate information submitted through recruitment workflows, including resumes, application responses, voice interview responses, video interview responses, transcripts, and AI-assisted evaluation outputs.',
                'Where voice or video interviews are used, recordings and related interview data may be processed to provide interview functionality, generate transcripts, create summaries, support recruitment evaluation, and operate the platform.',
                'Organizations using Evaalo remain responsible for ensuring that candidates are properly informed about recording, processing, and AI-assisted interview analysis where required by applicable law.',
            ],
        },
        s6: {
            title: '6. Third-Party Service Providers',
            intro:
                'Evaalo may rely on carefully selected third-party providers to support platform operations.',
            providersIntro: 'These providers may include services for:',
            bullets: [
                'Cloud hosting and infrastructure',
                'Databases',
                'Authentication',
                'Payment processing',
                'File and recording storage',
                'Email and communications',
                'Artificial intelligence',
                'Voice and video technologies',
                'Workflow automation',
                'Analytics, logging, and monitoring',
            ],
            footParagraphs: [
                'Third-party providers may process data only as necessary to provide services that support Evaalo\'s operation, security, and functionality.',
                'Each third-party provider may operate under its own terms, security practices, and privacy policies.',
            ],
        },
        s7: {
            title: '7. Security Incident Response',
            intro:
                'If Evaalo becomes aware of a suspected security incident, we may take steps appropriate to the nature of the incident, including:',
            bullets: [
                'Investigating the issue',
                'Limiting or mitigating potential impact',
                'Securing affected systems',
                'Reviewing relevant logs or technical information',
                'Applying corrective measures where appropriate',
                'Notifying affected users, organizations, or authorities when required by applicable law',
            ],
            foot:
                'The timing and scope of any notification may depend on the nature of the incident, legal requirements, and the information available during the investigation.',
        },
        s8: {
            title: '8. Backups and Service Continuity',
            paragraphs: [
                'Evaalo may use backup, recovery, and operational practices designed to help maintain service continuity and reduce the risk of data loss.',
                'Backup and recovery processes may vary depending on the type of data, infrastructure provider, storage system, and service configuration.',
                'Evaalo continues to improve its resilience, backup, recovery, and monitoring capabilities as the platform evolves.',
            ],
        },
        s9: {
            title: '9. User Responsibilities',
            intro: 'Users play an important role in keeping their accounts secure.',
            responsibleIntro: 'You are responsible for:',
            bullets: [
                'Keeping login credentials confidential',
                'Using strong passwords and secure authentication methods',
                'Not sharing account access with unauthorized persons',
                'Reviewing account activity for suspicious behavior',
                'Promptly reporting suspected unauthorized access',
                'Ensuring that authorized team members use the platform appropriately',
                'Protecting candidate data exported or downloaded from Evaalo',
            ],
            foot:
                'Organizations are also responsible for managing access for their own users, recruiters, administrators, and hiring managers.',
        },
        s10: {
            title: '10. Data Retention',
            intro:
                'Evaalo retains data for as long as reasonably necessary to provide the platform, support recruitment workflows, maintain security, comply with legal obligations, resolve disputes, and enforce agreements.',
            dependsIntro: 'Data retention may also depend on:',
            bullets: [
                'The hiring organization\'s recruitment process',
                'Account configuration',
                'Legal obligations',
                'Security requirements',
                'Contractual requirements',
                'Requests for deletion or data access',
            ],
            foot:
                'For more information about data retention and privacy rights, please review the Evaalo Privacy Policy.',
        },
        s11: {
            title: '11. Continuous Improvement',
            paragraphs: [
                'Security is an ongoing process.',
                'Evaalo may improve, update, replace, or expand its security controls, infrastructure, monitoring practices, access controls, backup processes, and technical safeguards as the platform grows.',
            ],
        },
        contact: {
            title: '12. Contact Us',
            intro: 'For security-related questions, reports, or concerns, contact:',
            company: 'Evaalo, LLC',
        },
    },
    ar: dataSecurityAr,
    ku: dataSecurityKu,
};
