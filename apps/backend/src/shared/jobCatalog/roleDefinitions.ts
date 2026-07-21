import type { RoleDefinition } from './types.js';

/** Expand one roleKey into catalog entries via buildCatalog. */
function role(
    roleKey: string,
    domain: string,
    specialization: string,
    section: RoleDefinition['section'],
    defaultTrack: RoleDefinition['defaultManagementTrack'],
    levels: RoleDefinition['levels'],
    extra?: Pick<RoleDefinition, 'requiresDomainQualifier'>
): RoleDefinition {
    return {
        roleKey,
        domain,
        specialization,
        section,
        defaultManagementTrack: defaultTrack,
        levels,
        ...extra,
    };
}

/**
 * Canonical role definitions — one Deep Pack per roleKey; career levels expand to displayTitle entries.
 * Source: Evaalo Job Catalog (full career paths). Shared leadership titles appear once only.
 */
export const ROLE_DEFINITIONS: RoleDefinition[] = [
    // ── 1. HR ──
    role('hr_coordinator', 'business', 'hr_operations', 'hr', 'ic', [
        { careerLevel: 'junior', displayTitle: 'HR Coordinator' },
        { careerLevel: 'senior', displayTitle: 'Senior HR Coordinator' },
    ]),
    role('hr_specialist', 'business', 'hr_operations', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HR Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior HR Specialist' },
    ]),
    role('hr_generalist', 'business', 'hr_generalist', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HR Generalist' },
        { careerLevel: 'senior', displayTitle: 'Senior HR Generalist' },
        { careerLevel: 'supervisor', displayTitle: 'HR Supervisor', managementTrack: 'supervisor' },
    ]),
    role('hr_business_partner', 'business', 'hr_business_partner', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HR Business Partner' },
        { careerLevel: 'senior', displayTitle: 'Senior HR Business Partner' },
        { careerLevel: 'manager', displayTitle: 'HR Business Partner Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of HR Business Partnering', managementTrack: 'director' },
    ]),
    role('hr_manager', 'business', 'hr_management', 'hr', 'manager', [
        { careerLevel: 'manager', displayTitle: 'HR Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior HR Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of HR', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'HR Director', managementTrack: 'director' },
    ]),
    role('recruiter', 'business', 'recruitment', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Recruitment' },
        { careerLevel: 'senior', displayTitle: 'Senior Recruiter' },
        { careerLevel: 'supervisor', displayTitle: 'Recruitment Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Recruitment Manager', managementTrack: 'manager' },
    ]),
    role('talent_acquisition_specialist', 'business', 'talent_acquisition', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Talent Acquisition Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Talent Acquisition Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Talent Acquisition Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Talent Acquisition Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Talent Acquisition', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Talent Acquisition Director', managementTrack: 'director' },
    ]),
    role('compensation_benefits_specialist', 'business', 'compensation_benefits', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Compensation and Benefits Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Compensation and Benefits Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Compensation and Benefits Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Compensation and Benefits Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Total Rewards', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Compensation and Benefits Director', managementTrack: 'director' },
    ]),
    role('training_coordinator', 'business', 'learning_development', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Training Coordinator' },
        { careerLevel: 'senior', displayTitle: 'Senior Training Coordinator' },
    ]),
    role('learning_development_specialist', 'business', 'learning_development', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Learning and Development Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Learning and Development Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Learning and Development Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Learning and Development Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Learning and Development', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Learning and Development Director', managementTrack: 'director' },
    ]),
    role('hris_specialist', 'business', 'hris', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HRIS Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior HRIS Specialist' },
    ]),
    role('employee_relations_specialist', 'business', 'employee_relations', 'hr', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Employee Relations Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Employee Relations Specialist' },
    ]),

    // ── 2. Sales & BD ──
    role('sales_representative', 'business', 'sales', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Sales Representative' },
        { careerLevel: 'senior', displayTitle: 'Senior Sales Representative' },
        { careerLevel: 'lead', displayTitle: 'Sales Team Lead' },
        { careerLevel: 'supervisor', displayTitle: 'Sales Supervisor', managementTrack: 'supervisor' },
    ]),
    role('sales_executive', 'business', 'sales', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Sales Executive' },
        { careerLevel: 'senior', displayTitle: 'Senior Sales Executive' },
    ]),
    role('sales_manager', 'business', 'sales', 'sales', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Sales Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Sales Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Sales', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Sales Director', managementTrack: 'director' },
    ]),
    role('sales_coordinator', 'business', 'sales_operations', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Sales Coordinator' },
    ]),
    role('sales_associate', 'business', 'retail', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Sales Associate' },
    ]),
    role('account_manager', 'business', 'account_management', 'sales', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Account Executive' },
        { careerLevel: 'mid', displayTitle: 'Account Manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Account Manager' },
        { careerLevel: 'supervisor', displayTitle: 'Account Management Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Account Management Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Account Management', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Commercial Director', managementTrack: 'director' },
    ]),
    role('key_account_manager', 'business', 'key_account_management', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Key Account Manager' },
    ]),
    role('business_development_manager', 'business', 'business_development', 'sales', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Business Development Executive' },
        { careerLevel: 'mid', displayTitle: 'Business Development Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Business Development Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Business Development Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Business Development Manager', managementTrack: 'manager' },
        { careerLevel: 'lead', displayTitle: 'Senior Business Development Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Business Development', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Business Development Director', managementTrack: 'director' },
    ]),
    role('customer_success_manager', 'business', 'customer_success', 'sales', 'manager', [
        { careerLevel: 'mid', displayTitle: 'Customer Success Specialist' },
        { careerLevel: 'manager', displayTitle: 'Customer Success Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Customer Success Manager', managementTrack: 'manager' },
        { careerLevel: 'lead', displayTitle: 'Customer Success Team Lead' },
        { careerLevel: 'supervisor', displayTitle: 'Customer Success Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'director', displayTitle: 'Customer Success Director', managementTrack: 'director' },
    ]),
    role('customer_support_specialist', 'business', 'customer_support', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Customer Support Specialist' },
    ]),
    role('call_center_agent', 'customer_operations', 'call_center', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Call Center Agent' },
        { careerLevel: 'senior', displayTitle: 'Senior Call Center Agent' },
    ]),
    role('store_manager', 'business', 'retail', 'sales', 'manager', [
        { careerLevel: 'supervisor', displayTitle: 'Store Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Store Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Area Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Retail Operations Manager', managementTrack: 'manager' },
    ]),
    role('merchandiser', 'business', 'merchandising', 'sales', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Merchandiser' },
        { careerLevel: 'senior', displayTitle: 'Senior Merchandiser' },
        { careerLevel: 'supervisor', displayTitle: 'Merchandising Supervisor', managementTrack: 'supervisor' },
    ]),

    // ── 3. Marketing ──
    role('digital_marketing_specialist', 'business', 'digital_marketing', 'marketing', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Digital Marketing Coordinator' },
        { careerLevel: 'mid', displayTitle: 'Digital Marketing Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Digital Marketing Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Digital Marketing Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Digital Marketing Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Digital Marketing', managementTrack: 'director' },
    ]),
    role('marketing_manager', 'business', 'marketing', 'marketing', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Marketing Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Marketing Director', managementTrack: 'director' },
    ]),
    role('performance_marketing_specialist', 'business', 'performance_marketing', 'marketing', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Performance Marketing Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Performance Marketing Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Performance Marketing Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Performance Marketing Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Growth', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Growth Marketing Director', managementTrack: 'director' },
    ]),
    role('seo_specialist', 'business', 'seo', 'marketing', 'ic', [
        { careerLevel: 'mid', displayTitle: 'SEO Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior SEO Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'SEO Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'SEO Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of SEO', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Head of Organic Growth', managementTrack: 'director' },
    ]),
    role('social_media_manager', 'business', 'social_media', 'marketing', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Social Media Coordinator' },
        { careerLevel: 'mid', displayTitle: 'Social Media Specialist' },
        { careerLevel: 'manager', displayTitle: 'Social Media Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Social Media Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Social Media Director', managementTrack: 'director' },
    ]),
    role('content_creator', 'business', 'content', 'marketing', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Content Creator' },
        { careerLevel: 'senior', displayTitle: 'Content Specialist' },
        { careerLevel: 'lead', displayTitle: 'Senior Content Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Content Lead' },
        { careerLevel: 'manager', displayTitle: 'Content Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Content', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Content Director', managementTrack: 'director' },
    ]),
    role('brand_manager', 'business', 'brand', 'marketing', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Brand Executive' },
        { careerLevel: 'mid', displayTitle: 'Brand Specialist' },
        { careerLevel: 'manager', displayTitle: 'Brand Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Brand Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Brand', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Brand Director', managementTrack: 'director' },
    ]),
    role('pre_sales_engineer', 'technology', 'pre_sales', 'marketing', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Pre-Sales Engineer' },
    ]),
    role('product_marketing_manager', 'business', 'product_marketing', 'marketing', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Product Marketing Manager', managementTrack: 'manager' },
    ]),
    role('crm_specialist', 'business', 'crm', 'marketing', 'ic', [
        { careerLevel: 'mid', displayTitle: 'CRM Specialist' },
    ]),

    // ── 4. Finance & Accounting ──
    role('general_accountant', 'business', 'general_accounting', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Accountant' },
        { careerLevel: 'mid', displayTitle: 'General Accountant' },
        { careerLevel: 'senior', displayTitle: 'Senior Accountant' },
        { careerLevel: 'supervisor', displayTitle: 'Accounting Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Accounting Manager', managementTrack: 'manager' },
    ]),
    role('accounts_payable', 'business', 'accounts_payable', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Accounts Payable Clerk' },
        { careerLevel: 'mid', displayTitle: 'Accounts Payable Officer' },
        { careerLevel: 'senior', displayTitle: 'Senior Accounts Payable Officer' },
        { careerLevel: 'supervisor', displayTitle: 'Accounts Payable Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Accounts Payable Manager', managementTrack: 'manager' },
    ]),
    role('accounts_receivable', 'business', 'accounts_receivable', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Accounts Receivable Clerk' },
        { careerLevel: 'mid', displayTitle: 'Accounts Receivable Officer' },
        { careerLevel: 'senior', displayTitle: 'Senior Accounts Receivable Officer' },
        { careerLevel: 'supervisor', displayTitle: 'Accounts Receivable Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Accounts Receivable Manager', managementTrack: 'manager' },
    ]),
    role('cost_accountant', 'business', 'cost_accounting', 'finance', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Cost Accountant' },
        { careerLevel: 'senior', displayTitle: 'Senior Cost Accountant' },
        { careerLevel: 'supervisor', displayTitle: 'Cost Accounting Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Cost Accounting Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Cost Control Manager', managementTrack: 'manager' },
    ]),
    role('chief_accountant', 'business', 'accounting_leadership', 'finance', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Chief Accountant', managementTrack: 'manager' },
    ]),
    role('financial_controller', 'business', 'financial_control', 'finance', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Financial Controller', managementTrack: 'manager' },
    ]),
    role('finance_manager', 'business', 'finance', 'finance', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Finance Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Finance Director', managementTrack: 'director' },
    ]),
    role('financial_analyst', 'business', 'financial_analysis', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Financial Analyst' },
        { careerLevel: 'mid', displayTitle: 'Financial Analyst' },
        { careerLevel: 'senior', displayTitle: 'Senior Financial Analyst' },
        { careerLevel: 'manager', displayTitle: 'Financial Planning and Analysis Manager', managementTrack: 'manager' },
    ]),
    role('internal_auditor', 'business', 'internal_audit', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Internal Audit Associate' },
        { careerLevel: 'mid', displayTitle: 'Internal Auditor' },
        { careerLevel: 'senior', displayTitle: 'Senior Internal Auditor' },
        { careerLevel: 'supervisor', displayTitle: 'Internal Audit Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Internal Audit Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Internal Audit', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Internal Audit Director', managementTrack: 'director' },
    ]),
    role('external_auditor', 'business', 'external_audit', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Audit Associate' },
        { careerLevel: 'mid', displayTitle: 'External Auditor' },
        { careerLevel: 'senior', displayTitle: 'Senior External Auditor' },
        { careerLevel: 'supervisor', displayTitle: 'Audit Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Audit Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Audit Director', managementTrack: 'director' },
    ]),
    role('payroll_officer', 'business', 'payroll', 'finance', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Payroll Officer' },
        { careerLevel: 'senior', displayTitle: 'Senior Payroll Officer' },
        { careerLevel: 'supervisor', displayTitle: 'Payroll Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Payroll Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Payroll', managementTrack: 'director' },
    ]),
    role('tax_specialist', 'business', 'tax', 'finance', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Tax Associate' },
        { careerLevel: 'mid', displayTitle: 'Tax Specialist' },
        { careerLevel: 'senior', displayTitle: 'Senior Tax Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Tax Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Tax Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Tax', managementTrack: 'director' },
    ]),
    role('treasury_officer', 'business', 'treasury', 'finance', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Treasury Officer' },
    ]),
    role('credit_controller', 'business', 'credit_control', 'finance', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Credit Controller' },
        { careerLevel: 'manager', displayTitle: 'Credit Control Manager', managementTrack: 'manager' },
    ]),
    role('cashier', 'business', 'cash_operations', 'finance', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Cashier' },
        { careerLevel: 'senior', displayTitle: 'Senior Cashier' },
        { careerLevel: 'supervisor', displayTitle: 'Cashier Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'lead', displayTitle: 'Cash Office Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Cash Operations Manager', managementTrack: 'manager' },
    ]),

    // ── 5. Admin & Operations ──
    role('administrative_assistant', 'leadership_admin', 'administration', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Administrative Assistant' },
        { careerLevel: 'senior', displayTitle: 'Senior Administrative Assistant' },
        { careerLevel: 'lead', displayTitle: 'Administrative Coordinator' },
        { careerLevel: 'supervisor', displayTitle: 'Administrative Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Administrative Manager', managementTrack: 'manager' },
    ]),
    role('executive_assistant', 'leadership_admin', 'executive_support', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Executive Assistant' },
        { careerLevel: 'senior', displayTitle: 'Senior Executive Assistant' },
        { careerLevel: 'manager', displayTitle: 'Executive Office Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Chief of Staff', managementTrack: 'director' },
    ]),
    role('office_manager', 'leadership_admin', 'office_management', 'admin', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Office Coordinator' },
        { careerLevel: 'manager', displayTitle: 'Office Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Office Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Administration Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Head of Administration', managementTrack: 'director' },
    ]),
    role('business_analyst', 'technology', 'business_analysis', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Business Analyst' },
        { careerLevel: 'senior', displayTitle: 'Senior Business Analyst' },
        { careerLevel: 'lead', displayTitle: 'Business Operations Lead' },
    ]),
    role('business_manager', 'leadership_admin', 'business_management', 'admin', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Business Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Business Manager', managementTrack: 'manager' },
    ]),
    role('operations_manager', 'leadership_admin', 'operations', 'admin', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Operations Coordinator' },
        { careerLevel: 'mid', displayTitle: 'Operations Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Operations Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Operations Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Operations Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Operations', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Operations Director', managementTrack: 'director' },
    ]),
    role('general_manager', 'leadership_admin', 'general_management', 'admin', 'manager', [
        { careerLevel: 'manager', displayTitle: 'General Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior General Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Managing Director', managementTrack: 'director' },
    ]),
    role('intern', 'leadership_admin', 'internship', 'admin', 'ic', [
        { careerLevel: 'intern', displayTitle: 'Intern' },
    ]),
    role('graduate_trainee', 'leadership_admin', 'graduate_program', 'admin', 'ic', [
        { careerLevel: 'graduate', displayTitle: 'Graduate Trainee' },
        { careerLevel: 'junior', displayTitle: 'Management Trainee' },
        { careerLevel: 'mid', displayTitle: 'Junior Specialist' },
    ]),
    role('researcher', 'business', 'research', 'admin', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Research Assistant' },
        { careerLevel: 'mid', displayTitle: 'Researcher' },
        { careerLevel: 'senior', displayTitle: 'Senior Researcher' },
        { careerLevel: 'lead', displayTitle: 'Research Lead' },
        { careerLevel: 'manager', displayTitle: 'Research Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Research', managementTrack: 'director' },
    ], { requiresDomainQualifier: true }),
    role('researcher_energy', 'engineering', 'energy_research', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Researcher – Energy' },
    ]),
    role('researcher_market_intelligence', 'business', 'market_research', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Researcher – Market Intelligence' },
    ]),
    role('researcher_public_policy', 'business', 'public_policy_research', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Researcher – Public Policy' },
    ]),
    role('researcher_data_research', 'technology', 'data_research', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Researcher – Data Research' },
    ]),
    role('document_controller', 'business', 'document_control', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Document Controller' },
    ]),
    role('compliance_officer', 'legal_services', 'compliance', 'legal', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Compliance Officer' },
    ]),
    role('risk_manager', 'business', 'risk_management', 'admin', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Risk Manager', managementTrack: 'manager' },
    ]),
    role('receptionist', 'customer_operations', 'reception', 'admin', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Receptionist' },
    ]),

    // ── Executive ──
    role('ceo', 'leadership_admin', 'executive_leadership', 'admin', 'executive', [
        { careerLevel: 'executive', displayTitle: 'Chief Executive Officer', managementTrack: 'executive' },
    ]),
    role('cfo', 'leadership_admin', 'executive_leadership', 'admin', 'executive', [
        { careerLevel: 'executive', displayTitle: 'Chief Financial Officer', managementTrack: 'executive' },
    ]),
    role('cto', 'leadership_admin', 'executive_leadership', 'admin', 'executive', [
        { careerLevel: 'executive', displayTitle: 'Chief Technology Officer', managementTrack: 'executive' },
    ]),
    role('chro', 'leadership_admin', 'executive_leadership', 'admin', 'executive', [
        { careerLevel: 'executive', displayTitle: 'Chief Human Resources Officer', managementTrack: 'executive' },
    ]),
    role('coo', 'leadership_admin', 'executive_leadership', 'admin', 'executive', [
        { careerLevel: 'executive', displayTitle: 'Chief Operating Officer', managementTrack: 'executive' },
    ]),

    // ── 6. Procurement & Supply Chain ──
    role('procurement_officer', 'business', 'procurement', 'procurement', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Procurement Assistant' },
        { careerLevel: 'mid', displayTitle: 'Procurement Officer' },
        { careerLevel: 'senior', displayTitle: 'Senior Procurement Officer' },
        { careerLevel: 'supervisor', displayTitle: 'Procurement Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Procurement Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Procurement', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Procurement Director', managementTrack: 'director' },
    ]),
    role('purchasing_officer', 'business', 'procurement', 'procurement', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Purchasing Officer' },
    ]),
    role('buyer', 'business', 'procurement', 'procurement', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Buyer' },
    ]),
    role('inventory_controller', 'business', 'inventory_control', 'procurement', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Inventory Controller' },
    ]),
    role('logistics_coordinator', 'business', 'logistics', 'procurement', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Logistics Coordinator' },
        { careerLevel: 'senior', displayTitle: 'Logistics Officer' },
        { careerLevel: 'lead', displayTitle: 'Senior Logistics Officer' },
        { careerLevel: 'supervisor', displayTitle: 'Logistics Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Logistics Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Logistics', managementTrack: 'director' },
    ]),
    role('supply_chain_manager', 'business', 'supply_chain', 'procurement', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Supply Chain Analyst' },
        { careerLevel: 'mid', displayTitle: 'Supply Chain Specialist' },
        { careerLevel: 'supervisor', displayTitle: 'Supply Chain Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Supply Chain Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Supply Chain', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Supply Chain Director', managementTrack: 'director' },
    ]),
    role('warehouse_supervisor', 'business', 'warehouse', 'procurement', 'supervisor', [
        { careerLevel: 'junior', displayTitle: 'Warehouse Assistant' },
        { careerLevel: 'mid', displayTitle: 'Warehouse Officer' },
        { careerLevel: 'supervisor', displayTitle: 'Warehouse Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Warehouse Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Distribution Manager', managementTrack: 'manager' },
    ]),

    // ── 7. Technology ──
    role('backend_developer', 'technology', 'backend_engineering', 'technology', 'ic', [
        { careerLevel: 'intern', displayTitle: 'Backend Developer Intern' },
        { careerLevel: 'junior', displayTitle: 'Junior Backend Developer' },
        { careerLevel: 'mid', displayTitle: 'Backend Developer' },
        { careerLevel: 'senior', displayTitle: 'Senior Backend Developer' },
        { careerLevel: 'lead', displayTitle: 'Lead Backend Developer' },
        { careerLevel: 'head', displayTitle: 'Principal Backend Engineer' },
        { careerLevel: 'manager', displayTitle: 'Backend Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Head of Backend Engineering', managementTrack: 'director' },
    ]),
    role('frontend_developer', 'technology', 'frontend_engineering', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Frontend Developer' },
        { careerLevel: 'mid', displayTitle: 'Frontend Developer' },
        { careerLevel: 'senior', displayTitle: 'Senior Frontend Developer' },
        { careerLevel: 'lead', displayTitle: 'Lead Frontend Developer' },
        { careerLevel: 'manager', displayTitle: 'Frontend Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Frontend Engineering', managementTrack: 'director' },
    ]),
    role('full_stack_developer', 'technology', 'fullstack_engineering', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Full Stack Developer' },
        { careerLevel: 'mid', displayTitle: 'Full Stack Developer' },
        { careerLevel: 'senior', displayTitle: 'Senior Full Stack Developer' },
        { careerLevel: 'lead', displayTitle: 'Lead Full Stack Developer' },
        { careerLevel: 'manager', displayTitle: 'Full Stack Engineering Manager', managementTrack: 'manager' },
    ]),
    role('software_engineer', 'technology', 'software_engineering', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Software Engineer' },
        { careerLevel: 'mid', displayTitle: 'Software Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Software Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Software Engineer' },
        { careerLevel: 'head', displayTitle: 'Principal Software Engineer' },
        { careerLevel: 'manager', displayTitle: 'Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Head of Engineering', managementTrack: 'director' },
    ]),
    role('mobile_developer_android', 'technology', 'mobile_android', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Android Developer' },
        { careerLevel: 'mid', displayTitle: 'Android Developer' },
        { careerLevel: 'senior', displayTitle: 'Senior Android Developer' },
        { careerLevel: 'lead', displayTitle: 'Lead Android Developer' },
        { careerLevel: 'manager', displayTitle: 'Mobile Engineering Manager', managementTrack: 'manager' },
    ]),
    role('mobile_developer_ios', 'technology', 'mobile_ios', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior iOS Developer' },
        { careerLevel: 'mid', displayTitle: 'iOS Developer' },
        { careerLevel: 'senior', displayTitle: 'Senior iOS Developer' },
        { careerLevel: 'lead', displayTitle: 'Lead iOS Developer' },
    ]),
    role('cloud_engineer', 'technology', 'cloud_engineering', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Cloud Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Cloud Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Cloud Engineer' },
        { careerLevel: 'manager', displayTitle: 'Cloud Infrastructure Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Cloud Engineering', managementTrack: 'director' },
    ]),
    role('devops_engineer', 'technology', 'devops', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior DevOps Engineer' },
        { careerLevel: 'mid', displayTitle: 'DevOps Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior DevOps Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead DevOps Engineer' },
        { careerLevel: 'manager', displayTitle: 'DevOps Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Platform Engineering', managementTrack: 'director' },
    ]),
    role('site_reliability_engineer', 'technology', 'sre', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Site Reliability Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Site Reliability Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Site Reliability Engineer' },
        { careerLevel: 'manager', displayTitle: 'SRE Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Reliability Engineering', managementTrack: 'director' },
    ]),
    role('data_analyst', 'technology', 'data_analytics', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Data Analyst' },
        { careerLevel: 'mid', displayTitle: 'Data Analyst' },
        { careerLevel: 'senior', displayTitle: 'Senior Data Analyst' },
        { careerLevel: 'lead', displayTitle: 'Analytics Lead' },
        { careerLevel: 'manager', displayTitle: 'Analytics Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Analytics', managementTrack: 'director' },
    ]),
    role('data_engineer', 'technology', 'data_engineering', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Data Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Data Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Data Engineer' },
        { careerLevel: 'manager', displayTitle: 'Data Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Data Engineering', managementTrack: 'director' },
    ]),
    role('data_scientist', 'technology', 'data_science', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Data Scientist' },
        { careerLevel: 'senior', displayTitle: 'Senior Data Scientist' },
        { careerLevel: 'lead', displayTitle: 'Lead Data Scientist' },
        { careerLevel: 'manager', displayTitle: 'Data Science Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Data Science', managementTrack: 'director' },
    ]),
    role('machine_learning_engineer', 'technology', 'machine_learning', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Machine Learning Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Machine Learning Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Machine Learning Engineer' },
        { careerLevel: 'manager', displayTitle: 'Machine Learning Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Machine Learning', managementTrack: 'director' },
    ]),
    role('cybersecurity_analyst', 'technology', 'cybersecurity', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Cybersecurity Analyst' },
        { careerLevel: 'senior', displayTitle: 'Senior Cybersecurity Analyst' },
    ]),
    role('cybersecurity_engineer', 'technology', 'cybersecurity', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Cybersecurity Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Cybersecurity Engineer' },
        { careerLevel: 'lead', displayTitle: 'Security Lead' },
        { careerLevel: 'manager', displayTitle: 'Cybersecurity Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Cybersecurity', managementTrack: 'director' },
        { careerLevel: 'executive', displayTitle: 'Chief Information Security Officer', managementTrack: 'executive' },
    ]),
    role('security_systems_engineer', 'technology', 'security_systems', 'hse_security', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Security Systems Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Security Systems Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'Security Systems Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Security Systems Manager', managementTrack: 'manager' },
    ]),
    role('database_administrator', 'technology', 'database_administration', 'technology', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Database Administrator' },
        { careerLevel: 'mid', displayTitle: 'Database Administrator' },
        { careerLevel: 'senior', displayTitle: 'Senior Database Administrator' },
        { careerLevel: 'lead', displayTitle: 'Database Lead' },
        { careerLevel: 'manager', displayTitle: 'Database Manager', managementTrack: 'manager' },
    ]),
    role('network_engineer', 'technology', 'networking', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Network Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Network Engineer' },
        { careerLevel: 'lead', displayTitle: 'Network Lead' },
        { careerLevel: 'manager', displayTitle: 'Network Manager', managementTrack: 'manager' },
    ]),
    role('system_administrator', 'technology', 'systems_administration', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'System Administrator' },
        { careerLevel: 'senior', displayTitle: 'Senior System Administrator' },
        { careerLevel: 'lead', displayTitle: 'Systems Lead' },
        { careerLevel: 'manager', displayTitle: 'Infrastructure Manager', managementTrack: 'manager' },
    ]),
    role('computer_engineer', 'technology', 'computer_engineering', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Computer Engineer' },
    ]),
    role('software_tester', 'technology', 'software_testing', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Software Tester' },
    ]),
    role('qa_engineer', 'technology', 'quality_assurance', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'QA Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior QA Engineer' },
        { careerLevel: 'lead', displayTitle: 'QA Lead' },
        { careerLevel: 'manager', displayTitle: 'QA Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Quality Assurance', managementTrack: 'director' },
    ]),
    role('qa_automation_engineer', 'technology', 'qa_automation', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'QA Automation Engineer' },
    ]),
    role('solutions_architect', 'technology', 'solutions_architecture', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Solutions Architect' },
        { careerLevel: 'senior', displayTitle: 'Senior Solutions Architect' },
        { careerLevel: 'lead', displayTitle: 'Principal Solutions Architect' },
        { careerLevel: 'head', displayTitle: 'Chief Architect', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Head of Architecture', managementTrack: 'director' },
    ]),
    role('it_support_specialist', 'technology', 'it_support', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'IT Support Specialist' },
    ]),
    role('systems_analyst', 'technology', 'systems_analysis', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Systems Analyst' },
    ]),
    role('erp_consultant', 'technology', 'erp', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'ERP Consultant' },
    ]),
    role('business_intelligence_analyst', 'technology', 'business_intelligence', 'technology', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Business Intelligence Analyst' },
    ]),

    // ── 8. Product & Design ──
    role('product_manager', 'creative', 'product_management', 'product_design', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Associate Product Manager' },
        { careerLevel: 'manager', displayTitle: 'Product Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Product Manager', managementTrack: 'manager' },
        { careerLevel: 'lead', displayTitle: 'Lead Product Manager', managementTrack: 'manager' },
        { careerLevel: 'supervisor', displayTitle: 'Group Product Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Product', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Product Director', managementTrack: 'director' },
        { careerLevel: 'executive', displayTitle: 'Chief Product Officer', managementTrack: 'executive' },
    ]),
    role('product_designer', 'creative', 'product_design', 'product_design', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Product Designer' },
        { careerLevel: 'mid', displayTitle: 'Product Designer' },
        { careerLevel: 'senior', displayTitle: 'Senior Product Designer' },
        { careerLevel: 'lead', displayTitle: 'Lead Product Designer' },
        { careerLevel: 'manager', displayTitle: 'Design Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Product Design', managementTrack: 'director' },
    ]),
    role('ui_ux_designer', 'creative', 'ui_ux_design', 'product_design', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior UI/UX Designer' },
        { careerLevel: 'mid', displayTitle: 'UI/UX Designer' },
        { careerLevel: 'senior', displayTitle: 'Senior UI/UX Designer' },
        { careerLevel: 'lead', displayTitle: 'Lead UI/UX Designer' },
        { careerLevel: 'manager', displayTitle: 'UX Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Design', managementTrack: 'director' },
    ]),
    role('graphic_designer', 'creative', 'graphic_design', 'product_design', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Graphic Designer' },
        { careerLevel: 'senior', displayTitle: 'Senior Graphic Designer' },
        { careerLevel: 'lead', displayTitle: 'Graphic Design Lead' },
        { careerLevel: 'director', displayTitle: 'Creative Director', managementTrack: 'director' },
    ]),
    role('video_editor', 'creative', 'video_editing', 'product_design', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Video Editor' },
        { careerLevel: 'senior', displayTitle: 'Senior Video Editor' },
        { careerLevel: 'lead', displayTitle: 'Video Editing Lead' },
        { careerLevel: 'manager', displayTitle: 'Creative Production Manager', managementTrack: 'manager' },
    ]),
    role('technical_writer', 'creative', 'technical_writing', 'product_design', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Technical Writer' },
        { careerLevel: 'senior', displayTitle: 'Senior Technical Writer' },
        { careerLevel: 'lead', displayTitle: 'Documentation Lead' },
        { careerLevel: 'manager', displayTitle: 'Documentation Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Documentation', managementTrack: 'director' },
    ]),

    // ── 9. Project Management ──
    role('project_coordinator', 'business', 'project_management', 'project', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Project Coordinator' },
        { careerLevel: 'senior', displayTitle: 'Assistant Project Manager' },
    ]),
    role('project_manager', 'business', 'project_management', 'project', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Project Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Project Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Portfolio Manager', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Project Director', managementTrack: 'director' },
    ]),
    role('program_manager', 'business', 'program_management', 'project', 'manager', [
        { careerLevel: 'junior', displayTitle: 'Program Coordinator' },
        { careerLevel: 'manager', displayTitle: 'Program Manager', managementTrack: 'manager' },
        { careerLevel: 'senior', displayTitle: 'Senior Program Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Programs', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Program Director', managementTrack: 'director' },
    ]),
    role('scrum_master', 'technology', 'agile', 'project', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Scrum Master' },
        { careerLevel: 'senior', displayTitle: 'Senior Scrum Master' },
        { careerLevel: 'lead', displayTitle: 'Agile Coach' },
        { careerLevel: 'manager', displayTitle: 'Agile Delivery Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Agile Delivery', managementTrack: 'director' },
    ]),

    // ── 10. Construction & General Engineering ──
    // Standard path: Graduate → Junior → Engineer → Senior → Lead (manager titles shared carefully)
    role('civil_engineer', 'engineering', 'civil_engineering', 'engineering', 'ic', [
        { careerLevel: 'graduate', displayTitle: 'Graduate Civil Engineer' },
        { careerLevel: 'junior', displayTitle: 'Junior Civil Engineer' },
        { careerLevel: 'mid', displayTitle: 'Civil Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Civil Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Civil Engineer' },
    ]),
    role('mechanical_engineer', 'engineering', 'mechanical_engineering', 'engineering', 'ic', [
        { careerLevel: 'graduate', displayTitle: 'Graduate Mechanical Engineer' },
        { careerLevel: 'junior', displayTitle: 'Junior Mechanical Engineer' },
        { careerLevel: 'mid', displayTitle: 'Mechanical Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Mechanical Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Mechanical Engineer' },
    ]),
    role('electrical_engineer', 'engineering', 'electrical_engineering', 'engineering', 'ic', [
        { careerLevel: 'graduate', displayTitle: 'Graduate Electrical Engineer' },
        { careerLevel: 'junior', displayTitle: 'Junior Electrical Engineer' },
        { careerLevel: 'mid', displayTitle: 'Electrical Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Electrical Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Electrical Engineer' },
    ]),
    role('chemical_engineer', 'engineering', 'chemical_engineering', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Chemical Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Chemical Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Chemical Engineer' },
    ]),
    role('structural_engineer', 'engineering', 'structural_engineering', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Structural Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Structural Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Structural Engineer' },
    ]),
    role('site_engineer', 'engineering', 'site_engineering', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Site Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Site Engineer' },
    ]),
    role('site_supervisor', 'engineering', 'site_supervision', 'engineering', 'supervisor', [
        { careerLevel: 'supervisor', displayTitle: 'Site Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Site Manager', managementTrack: 'manager' },
    ]),
    role('foreman', 'engineering', 'field_supervision', 'engineering', 'supervisor', [
        { careerLevel: 'supervisor', displayTitle: 'Foreman', managementTrack: 'supervisor' },
        { careerLevel: 'senior', displayTitle: 'Senior Foreman', managementTrack: 'supervisor' },
    ]),
    role('resident_engineer', 'engineering', 'resident_engineering', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Resident Engineer' },
    ]),
    role('bim_engineer', 'engineering', 'bim', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'BIM Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior BIM Engineer' },
    ]),
    role('hvac_engineer', 'engineering', 'hvac', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HVAC Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior HVAC Engineer' },
    ]),
    role('industrial_engineer', 'engineering', 'industrial_engineering', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Industrial Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Industrial Engineer' },
    ]),
    role('maintenance_engineer', 'engineering', 'maintenance', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Maintenance Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Maintenance Engineer' },
    ]),
    role('planning_engineer', 'engineering', 'planning', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Planning Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Planning Engineer' },
    ]),
    role('piping_engineer', 'engineering', 'piping', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Piping Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Piping Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Piping Engineer' },
        { careerLevel: 'manager', displayTitle: 'Piping Engineering Manager', managementTrack: 'manager' },
    ]),
    role('process_engineer', 'engineering', 'process_engineering', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Process Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Process Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Process Engineer' },
        { careerLevel: 'manager', displayTitle: 'Process Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Process Engineering', managementTrack: 'director' },
    ]),
    role('qa_qc_engineer', 'engineering', 'qa_qc', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'QA/QC Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior QA/QC Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'QA/QC Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'QA/QC Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Quality', managementTrack: 'director' },
    ]),
    role('quantity_surveyor', 'engineering', 'quantity_surveying', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Quantity Surveyor' },
        { careerLevel: 'senior', displayTitle: 'Senior Quantity Surveyor' },
    ]),
    role('contracts_engineer', 'engineering', 'contracts', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Contracts Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Contracts Engineer' },
    ]),
    role('environmental_engineer', 'engineering', 'environmental', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Environmental Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Environmental Engineer' },
    ]),
    role('fire_protection_engineer', 'engineering', 'fire_protection', 'hse_security', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Fire Protection Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Fire Protection Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'Fire Protection Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Fire Protection Manager', managementTrack: 'manager' },
    ]),
    role('geotechnical_engineer', 'engineering', 'geotechnical', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Geotechnical Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Geotechnical Engineer' },
    ]),
    role('mechanical_design_engineer', 'engineering', 'mechanical_design', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Mechanical Design Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Mechanical Design Engineer' },
    ]),
    role('roads_engineer', 'engineering', 'roads', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Roads Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Roads Engineer' },
    ]),
    role('survey_engineer', 'engineering', 'surveying', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Survey Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Survey Engineer' },
    ]),
    role('technical_office_engineer', 'engineering', 'technical_office', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Technical Office Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Technical Office Engineer' },
    ]),
    role('construction_field_engineer', 'engineering', 'construction_field', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Construction Field Engineer' },
        { careerLevel: 'senior', displayTitle: 'Field Engineer – Construction' },
    ]),
    role('field_engineer_oil_gas', 'engineering', 'oil_gas_field', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Field Engineer – Oil and Gas' },
        { careerLevel: 'senior', displayTitle: 'Senior Field Engineer – Oil and Gas' },
    ]),
    role('field_service_engineer', 'engineering', 'field_service', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Field Service Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Field Service Engineer' },
    ]),
    role('instrumentation_engineer', 'engineering', 'instrumentation', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Instrumentation Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Instrumentation Engineer' },
    ]),
    role('automation_engineer', 'engineering', 'automation', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Automation Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Automation Engineer' },
    ]),
    role('reliability_engineer', 'engineering', 'reliability', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Reliability Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Reliability Engineer' },
    ]),
    role('proposal_engineer', 'engineering', 'proposals', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Proposal Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Proposal Engineer' },
    ]),
    role('commissioning_engineer', 'engineering', 'commissioning', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Commissioning Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Commissioning Engineer' },
    ]),
    role('quality_control_engineer_chemical', 'engineering', 'qc_chemical', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Quality Control Engineer – Chemical' },
        { careerLevel: 'senior', displayTitle: 'Senior Quality Control Engineer – Chemical' },
        { careerLevel: 'supervisor', displayTitle: 'Quality Control Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Quality Manager', managementTrack: 'manager' },
    ]),

    // ── 11. Oil & Gas ──
    role('petroleum_engineer', 'engineering', 'petroleum', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Petroleum Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Petroleum Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Petroleum Engineer' },
        { careerLevel: 'manager', displayTitle: 'Petroleum Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Petroleum Engineering', managementTrack: 'director' },
    ]),
    role('drilling_engineer', 'engineering', 'drilling', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Drilling Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Drilling Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Drilling Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'Drilling Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Drilling Manager', managementTrack: 'manager' },
    ]),
    role('reservoir_engineer', 'engineering', 'reservoir', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Reservoir Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Reservoir Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Reservoir Engineer' },
        { careerLevel: 'manager', displayTitle: 'Reservoir Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Reservoir Engineering', managementTrack: 'director' },
    ]),
    role('production_engineer_oil_gas', 'engineering', 'production_oil_gas', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Production Engineer – Oil and Gas' },
        { careerLevel: 'senior', displayTitle: 'Senior Production Engineer – Oil and Gas' },
        { careerLevel: 'lead', displayTitle: 'Lead Production Engineer – Oil and Gas' },
        { careerLevel: 'supervisor', displayTitle: 'Production Engineering Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Production Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Production Engineering', managementTrack: 'director' },
    ]),
    role('production_engineer_manufacturing', 'engineering', 'production_manufacturing', 'engineering', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Production Engineer – Manufacturing' },
        { careerLevel: 'senior', displayTitle: 'Senior Production Engineer – Manufacturing' },
        { careerLevel: 'supervisor', displayTitle: 'Production Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Production Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Plant Manager', managementTrack: 'manager' },
    ]),
    role('production_chemical_engineer', 'engineering', 'production_chemical', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Production Chemical Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Production Chemical Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Production Chemical Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'Production Chemistry Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Production Chemistry Manager', managementTrack: 'manager' },
    ]),
    role('mud_engineer', 'engineering', 'drilling_fluids', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Mud Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Mud Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Mud Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'Mud Engineering Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Drilling Fluids Manager', managementTrack: 'manager' },
    ]),
    role('well_testing_engineer', 'engineering', 'well_testing', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Well Testing Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Well Testing Engineer' },
        { careerLevel: 'supervisor', displayTitle: 'Well Testing Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'Well Testing Manager', managementTrack: 'manager' },
    ]),
    role('pipeline_engineer', 'engineering', 'pipeline', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Pipeline Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Pipeline Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Pipeline Engineer' },
        { careerLevel: 'manager', displayTitle: 'Pipeline Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of Pipelines', managementTrack: 'director' },
    ]),
    role('refinery_engineer', 'engineering', 'refinery', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Refinery Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Refinery Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Refinery Engineer' },
        { careerLevel: 'manager', displayTitle: 'Refinery Engineering Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Refinery Operations Manager', managementTrack: 'manager' },
    ]),
    role('rotating_equipment_engineer', 'engineering', 'rotating_equipment', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Rotating Equipment Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Rotating Equipment Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Rotating Equipment Engineer' },
        { careerLevel: 'manager', displayTitle: 'Rotating Equipment Manager', managementTrack: 'manager' },
    ]),
    role('static_equipment_engineer', 'engineering', 'static_equipment', 'oil_gas', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Static Equipment Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior Static Equipment Engineer' },
        { careerLevel: 'lead', displayTitle: 'Lead Static Equipment Engineer' },
        { careerLevel: 'manager', displayTitle: 'Static Equipment Manager', managementTrack: 'manager' },
    ]),

    // ── 12. HSE ──
    role('hse_officer', 'engineering', 'hse', 'hse_security', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HSE Officer' },
        { careerLevel: 'senior', displayTitle: 'Senior HSE Officer' },
        { careerLevel: 'supervisor', displayTitle: 'HSE Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'manager', displayTitle: 'HSE Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'Head of HSE', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'HSE Director', managementTrack: 'director' },
    ]),
    role('hse_engineer', 'engineering', 'hse', 'hse_security', 'ic', [
        { careerLevel: 'mid', displayTitle: 'HSE Engineer' },
        { careerLevel: 'senior', displayTitle: 'Senior HSE Engineer' },
    ]),

    // ── 13. Legal ──
    role('legal_assistant', 'legal_services', 'legal', 'legal', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Legal Assistant' },
        { careerLevel: 'senior', displayTitle: 'Paralegal' },
    ]),
    role('legal_advisor', 'legal_services', 'legal', 'legal', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Legal Advisor' },
        { careerLevel: 'senior', displayTitle: 'Senior Legal Advisor' },
    ]),
    role('legal_counsel', 'legal_services', 'legal', 'legal', 'ic', [
        { careerLevel: 'mid', displayTitle: 'Legal Counsel' },
        { careerLevel: 'senior', displayTitle: 'Senior Legal Counsel' },
        { careerLevel: 'head', displayTitle: 'Head of Legal', managementTrack: 'director' },
        { careerLevel: 'director', displayTitle: 'Legal Director', managementTrack: 'director' },
        { careerLevel: 'executive', displayTitle: 'General Counsel', managementTrack: 'executive' },
    ]),
    role('lawyer', 'legal_services', 'legal', 'legal', 'ic', [
        { careerLevel: 'junior', displayTitle: 'Junior Lawyer' },
        { careerLevel: 'mid', displayTitle: 'Lawyer' },
        { careerLevel: 'senior', displayTitle: 'Senior Lawyer' },
        { careerLevel: 'lead', displayTitle: 'Managing Associate' },
        { careerLevel: 'head', displayTitle: 'Partner', managementTrack: 'director' },
    ]),

    // ── 14. Hospitality ──
    role('chef', 'hospitality_services', 'culinary', 'hospitality', 'ic', [
        { careerLevel: 'intern', displayTitle: 'Kitchen Trainee' },
        { careerLevel: 'junior', displayTitle: 'Commis Chef' },
        { careerLevel: 'mid', displayTitle: 'Chef de Partie' },
        { careerLevel: 'senior', displayTitle: 'Sous Chef' },
        { careerLevel: 'lead', displayTitle: 'Head Chef' },
        { careerLevel: 'manager', displayTitle: 'Executive Chef', managementTrack: 'manager' },
        { careerLevel: 'director', displayTitle: 'Culinary Director', managementTrack: 'director' },
        { careerLevel: 'head', displayTitle: 'Chef' },
    ]),
    role('restaurant_manager', 'hospitality_services', 'restaurant_management', 'hospitality', 'manager', [
        { careerLevel: 'manager', displayTitle: 'Restaurant Manager', managementTrack: 'manager' },
    ]),
    role('hotel_manager', 'hospitality_services', 'hotel_management', 'hospitality', 'manager', [
        { careerLevel: 'supervisor', displayTitle: 'Hotel Supervisor', managementTrack: 'supervisor' },
        { careerLevel: 'senior', displayTitle: 'Assistant Hotel Manager', managementTrack: 'manager' },
        { careerLevel: 'manager', displayTitle: 'Hotel Manager', managementTrack: 'manager' },
        { careerLevel: 'lead', displayTitle: 'Senior Hotel Manager', managementTrack: 'manager' },
        { careerLevel: 'head', displayTitle: 'General Manager – Hotel', managementTrack: 'manager' },
    ]),

];

/** Section display order for UI suggestion lists (HR → Sales → …). */
export const SECTION_ORDER: RoleDefinition['section'][] = [
    'hr',
    'sales',
    'marketing',
    'finance',
    'procurement',
    'admin',
    'technology',
    'product_design',
    'project',
    'engineering',
    'oil_gas',
    'hse_security',
    'legal',
    'hospitality',
];
