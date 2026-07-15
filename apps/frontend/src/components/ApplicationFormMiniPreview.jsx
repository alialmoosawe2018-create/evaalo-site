import React from 'react';
import './applicationFormMiniPreview.css';

/** يطابق أقسام Form.jsx — نفس العناوين والحقول الظاهرة للمرشح */
const VARIANT_META = {
    personal: { progress: 20, sectionTitle: 'Personal Information' },
    professional: { progress: 40, sectionTitle: 'Professional Information' },
    executive: { progress: 40, sectionTitle: 'Professional Information' },
    skills: { progress: 60, sectionTitle: 'Skills & Qualifications' },
    additional: { progress: 75, sectionTitle: 'Additional Information' },
};

const TEMPLATE_ID_TO_VARIANT = {
    'template-standard': 'personal',
    'template-technical': 'professional',
    'template-executive': 'executive',
    'template-remote': 'additional',
};

export function resolveFormPreviewVariant(templateId) {
    if (!templateId) return 'personal';
    return TEMPLATE_ID_TO_VARIANT[templateId] || 'personal';
}

function MiniHeader({ progress }) {
    return (
        <header className="afmp-header">
            <h1 className="afmp-title">Job Application Form</h1>
            <p className="afmp-subtitle">Tell us about yourself</p>
            <div className="afmp-progress-bar">
                <div className="afmp-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="afmp-progress-text">{progress}% Complete</p>
        </header>
    );
}

function Field({ label, children, help }) {
    return (
        <div className="afmp-form-group">
            <label>{label}</label>
            {children}
            {help ? <span className="afmp-help">{help}</span> : null}
        </div>
    );
}

function SectionPersonal() {
    return (
        <>
            <h2 className="afmp-section-title">{VARIANT_META.personal.sectionTitle}</h2>
            <Field label="Full name">
                <input type="text" readOnly value="Jane Candidate" />
            </Field>
            <Field label="Email Address">
                <input type="email" readOnly value="jane@example.com" />
            </Field>
            <Field label="Phone Number">
                <input type="tel" readOnly value="+1 234 567 8900" />
            </Field>
            <Field label="Location">
                <input type="text" readOnly value="Baghdad" />
            </Field>
        </>
    );
}

function SectionProfessional() {
    return (
        <>
            <h2 className="afmp-section-title">{VARIANT_META.professional.sectionTitle}</h2>
            <Field
                label="Position Applied For"
                help="You can pick a suggested role or enter any title manually."
            >
                <input type="text" readOnly value="Senior Software Engineer" />
            </Field>
            <Field label="Company Applied To">
                <input type="text" readOnly value="EVAALO" />
            </Field>
            <Field label="Years of Experience">
                <input type="text" readOnly value="5–8 years" />
            </Field>
            <Field label="Current Company">
                <input type="text" readOnly value="Tech Corp" />
            </Field>
            <Field label="Highest Education Level">
                <input type="text" readOnly value="Bachelor's degree" />
            </Field>
            <Field label="LinkedIn Profile">
                <input type="url" readOnly value="https://linkedin.com/in/…" />
            </Field>
        </>
    );
}

function SectionExecutive() {
    return (
        <>
            <h2 className="afmp-section-title">{VARIANT_META.executive.sectionTitle}</h2>
            <Field
                label="Position Applied For"
                help="You can pick a suggested role or enter any title manually."
            >
                <input type="text" readOnly value="Director of Engineering" />
            </Field>
            <Field label="Years of Experience">
                <input type="text" readOnly value="10+ years" />
            </Field>
            <Field label="LinkedIn Profile">
                <input type="url" readOnly value="https://linkedin.com/in/…" />
            </Field>
        </>
    );
}

function SectionSkills() {
    return (
        <>
            <h2 className="afmp-section-title">{VARIANT_META.skills.sectionTitle}</h2>
            <div className="afmp-form-group">
                <label>Key Skills</label>
                <div className="afmp-input-row">
                    <input type="text" readOnly value="TypeScript" />
                    <span className="afmp-btn-add">Add</span>
                </div>
                <span className="afmp-help">Add at least 3 skills</span>
                <div className="afmp-tags">
                    <span className="afmp-tag">React</span>
                    <span className="afmp-tag">Node.js</span>
                    <span className="afmp-tag">System design</span>
                </div>
            </div>
            <Field label="Certifications">
                <textarea readOnly rows={3} value="AWS Solutions Architect — Professional" />
            </Field>
        </>
    );
}

function SectionAdditional() {
    return (
        <>
            <h2 className="afmp-section-title">{VARIANT_META.additional.sectionTitle}</h2>
            <Field label="Availability">
                <input type="text" readOnly value="Immediate" />
            </Field>
            <Field label="Expected Salary">
                <div className="afmp-salary">
                    <input type="number" readOnly value={7500} />
                    <select disabled value="USD">
                        <option value="USD">USD — دولار أمريكي ($)</option>
                    </select>
                </div>
            </Field>
            <Field label="Cover Letter / Why are you interested in this position?">
                <textarea
                    readOnly
                    rows={4}
                    value="I'm excited about the mission and how this role combines product impact with technical depth…"
                />
            </Field>
            <Field label="How did you hear about us?">
                <input type="text" readOnly value="LinkedIn" />
            </Field>
        </>
    );
}

function renderVariantBody(variant) {
    switch (variant) {
        case 'professional':
            return <SectionProfessional />;
        case 'executive':
            return <SectionExecutive />;
        case 'skills':
            return <SectionSkills />;
        case 'additional':
            return <SectionAdditional />;
        case 'personal':
        default:
            return <SectionPersonal />;
    }
}

/**
 * معاينة مصغّرة لشكل صفحة التقديم الحقيقية (نفس البطاقة البيضاء، الشريط، العناوين، الحقول).
 */
export default function ApplicationFormMiniPreview({ templateId, formPreviewVariant }) {
    const variant = formPreviewVariant || resolveFormPreviewVariant(templateId);
    const meta = VARIANT_META[variant] || VARIANT_META.personal;

    return (
        <div className="afmp-viewport" aria-hidden>
            <div className="afmp-scaler">
                <div className="afmp-card">
                    <MiniHeader progress={meta.progress} />
                    <div>{renderVariantBody(variant)}</div>
                    <div className="afmp-nav">
                        <button type="button" className="afmp-btn-primary">
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
