import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useInterviewTemplate } from '../contexts/InterviewTemplateContext';
import DynamicApplicationForm from '../components/form/DynamicApplicationForm.jsx';
import { shouldUsePublicDynamicForm } from '../components/form/dynamicFormFeature.js';
import PositionSuggestCombobox from '../components/PositionSuggestCombobox.jsx';
import JobRoleFields from '../components/JobRoleFields.jsx';
import LanguageStyleSingleSelect from '../components/LanguageStyleSingleSelect.jsx';
import { applyRoleResolutionToState, mergeRoleResolution, roleResolutionCriteriaFields } from '../utils/jobCatalogRole.js';
import { resolveJobRole } from '@evaalo/job-catalog';
import { fillI18nTemplate } from '../utils/i18nTemplate.js';
import { parseInterviewUrlLanguage } from '../utils/interviewShareLink.js';
import {
    buildAvailabilityOptions,
    buildEducationOptions,
    buildExperienceOptions,
    buildGenderOptions,
    buildGovernorateSuggestions,
    buildHearAboutOptions,
    buildLanguageLevelOptions,
    buildLanguageSuggestionOptions,
    buildSkillSuggestionOptions,
    languageLevelLabel,
    SALARY_CURRENCY_OPTIONS,
} from '../utils/formSelectOptions.js';
import '../styles.css';
import apiClient, { ApiError } from '../services/apiClient.js';

const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const LegacyApplicationForm = () => {
    const { t, currentLang } = useLanguage();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { templates, selectedTemplate } = useInterviewTemplate();
    const templateId = searchParams.get('template');
    const campaignId = searchParams.get('campaign'); // قراءة campaign ID من URL
    const isPreviewMode = searchParams.get('preview') === '1';
    const formPageDir = currentLang === 'ar' || currentLang === 'ku' ? 'rtl' : 'ltr';

    const genderOptions = useMemo(() => buildGenderOptions(t), [t, currentLang]);
    const educationOptions = useMemo(() => buildEducationOptions(t), [t, currentLang]);
    const experienceOptions = useMemo(() => buildExperienceOptions(t), [t, currentLang]);
    const availabilityOptions = useMemo(() => buildAvailabilityOptions(t), [t, currentLang]);
    const hearAboutOptions = useMemo(() => buildHearAboutOptions(t), [t, currentLang]);
    const languageLevelOptions = useMemo(() => buildLanguageLevelOptions(t), [t, currentLang]);
    const governorateSuggestions = useMemo(
        () => buildGovernorateSuggestions(currentLang),
        [currentLang],
    );
    const skillSuggestionOptions = useMemo(
        () => buildSkillSuggestionOptions(currentLang),
        [currentLang],
    );
    const languageSuggestionOptions = useMemo(
        () => buildLanguageSuggestionOptions(currentLang),
        [currentLang],
    );

    const ft = (fieldId) => t(`formField_${fieldId}`);
    const fph = (fieldId) => t(`formField_${fieldId}_ph`);
    const requiredErr = (fieldId) =>
        fillI18nTemplate(t('formValidation_required'), { field: ft(fieldId) });

    const [currentSection, setCurrentSection] = useState(0);
    
    // تحديد القالب المستخدم (من URL أو المختار في Context)
    const activeTemplate = templateId 
        ? templates.find(t => t.id === templateId) || selectedTemplate
        : selectedTemplate;
    const [formData, setFormData] = useState({
        // Personal Information
        full_name: '',
        email: '',
        phone: '',
        location: '',
        gender: '',
        // Professional Details
        position_applied_for: '',
        roleKey: '',
        careerLevel: '',
        managementTrack: '',
        labelKey: '',
        roleMatchSource: '',
        researchDomain: '',
        company_applied_to: '',
        years_of_experience: '',
        current_company: '',
        highest_education_level: '',
        linkedin: '',
        // Skills
        skills: [],
        languages: [],
        certifications: '',
        // Additional
        availability: '',
        expectedSalary: '',
        salaryCurrency: 'USD',
        coverLetter: '',
        hearAboutUs: '',
        agreeToTerms: false
    });
    const [skills, setSkills] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [cvFile, setCvFile] = useState(null);
    const [photoFile, setPhotoFile] = useState(null);
    const [cvPreview, setCvPreview] = useState(null);
    const [photoPreview, setPhotoPreview] = useState(null);
    const [languageInputValue, setLanguageInputValue] = useState('');
    const [languageLevelDraft, setLanguageLevelDraft] = useState('');
    const [skillInputValue, setSkillInputValue] = useState('');
    const honeypotRef = useRef(null);

    const sections = ['personal', 'professional', 'skills', 'additional', 'files'];
    const progressPercent = isPreviewMode
        ? 100
        : Math.round(((currentSection + 1) / sections.length) * 100);
    const inputPreviewProps = isPreviewMode ? { readOnly: true, tabIndex: -1 } : {};

    useEffect(() => {
        if (isPreviewMode) return;
        // Load saved form data from localStorage
        const savedData = localStorage.getItem('applicationFormData');
        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                const legacyMap = [
                    ['fullName', 'full_name'],
                    ['positionAppliedFor', 'position_applied_for'],
                    ['companyAppliedTo', 'company_applied_to'],
                    ['yearsOfExperience', 'years_of_experience'],
                    ['currentCompany', 'current_company'],
                    ['highestEducationLevel', 'highest_education_level'],
                ];
                for (const [oldK, newK] of legacyMap) {
                    if ((parsed[newK] === undefined || parsed[newK] === '') && parsed[oldK] != null) {
                        parsed[newK] = parsed[oldK];
                    }
                    delete parsed[oldK];
                }
                if (!parsed.full_name && (parsed.firstName || parsed.lastName)) {
                    parsed.full_name = [parsed.firstName, parsed.lastName].filter(Boolean).join(' ').trim();
                    delete parsed.firstName;
                    delete parsed.lastName;
                }
                if (parsed.salaryMin != null || parsed.salaryMax != null) {
                    if (!parsed.expectedSalary && (parsed.salaryMin || parsed.salaryMax)) {
                        parsed.expectedSalary =
                            parsed.salaryMin && parsed.salaryMax
                                ? `${parsed.salaryMin}–${parsed.salaryMax}`
                                : String(parsed.salaryMin || parsed.salaryMax || '');
                    }
                    delete parsed.salaryMin;
                    delete parsed.salaryMax;
                }
                const allowedCurrency = ['USD', 'IQD'];
                if (parsed.salaryCurrency != null) {
                    const c = String(parsed.salaryCurrency).trim().toUpperCase();
                    parsed.salaryCurrency = allowedCurrency.includes(c) ? c : 'USD';
                }
                delete parsed.files;
                delete parsed.cv;
                delete parsed.photo;
                if (parsed.position_applied_for && !parsed.roleKey) {
                    const resolved = resolveJobRole(String(parsed.position_applied_for));
                    if (resolved.roleKey) {
                        parsed.roleKey = resolved.roleKey;
                        parsed.careerLevel = resolved.careerLevel ?? '';
                        parsed.managementTrack = resolved.managementTrack ?? '';
                        parsed.labelKey = resolved.labelKey ?? '';
                        parsed.roleMatchSource = resolved.matchSource ?? '';
                        parsed.position_applied_for = resolved.displayTitle || parsed.position_applied_for;
                    }
                }
                setFormData(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error('Error loading saved form data:', e);
            }
        }
    }, [isPreviewMode]);

    // Save form data to localStorage whenever it changes
    useEffect(() => {
        if (isPreviewMode) return;
        localStorage.setItem('applicationFormData', JSON.stringify(formData));
    }, [formData, isPreviewMode]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        const nextValue =
            name === 'salaryCurrency'
                ? ['USD', 'IQD'].includes(String(value).toUpperCase())
                    ? String(value).toUpperCase()
                    : 'USD'
                : value;
        setFormData(prev => ({
            ...prev,
            [name]: nextValue
        }));
        // Clear error for this field
        if (errors[name]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[name];
                return newErrors;
            });
        }
    };

    const handleRoleResolved = (resolution) => {
        setFormData((prev) =>
            applyRoleResolutionToState(
                { ...prev, position_applied_for: resolution?.displayTitle ?? prev.position_applied_for },
                resolution
            )
        );
    };

    const handleFileChange = (e, fileType) => {
        const file = e.target.files[0];
        if (!file) return;

        if (fileType === 'cv') {
            // Validate CV file type - PDF only
            const allowedTypes = ['application/pdf'];
            if (!allowedTypes.includes(file.type)) {
                setErrors(prev => ({
                    ...prev,
                    cvFile: fillI18nTemplate(t('formValidation_file'), { field: ft('cv') }),
                }));
                return;
            }
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                setErrors(prev => ({
                    ...prev,
                    cvFile: fillI18nTemplate(t('formValidation_maxFileSize'), { max: '5MB' }),
                }));
                return;
            }
            setCvFile(file);
            setCvPreview(file.name);
            if (errors.cvFile) {
                setErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors.cvFile;
                    return newErrors;
                });
            }
        } else if (fileType === 'photo') {
            // Validate photo file type
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
            if (!allowedTypes.includes(file.type)) {
                setErrors(prev => ({
                    ...prev,
                    photoFile: fillI18nTemplate(t('formValidation_file'), { field: ft('photo') }),
                }));
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                setErrors(prev => ({
                    ...prev,
                    photoFile: fillI18nTemplate(t('formValidation_maxFileSize'), { max: '2MB' }),
                }));
                return;
            }
            setPhotoFile(file);
            // Create preview URL
            const reader = new FileReader();
            reader.onloadend = () => {
                setPhotoPreview(reader.result);
            };
            reader.readAsDataURL(file);
            if (errors.photoFile) {
                setErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors.photoFile;
                    return newErrors;
                });
            }
        }
    };


    const addSkill = () => {
        if (!skillInputValue.trim()) return;
        const newSkill = skillInputValue.trim();
        setSkills(prev => [...prev, newSkill]);
        setFormData(prev => ({
            ...prev,
            skills: [...prev.skills, newSkill]
        }));
        setSkillInputValue('');
    };

    const removeSkill = (index) => {
        setSkills(prev => {
            const newSkills = prev.filter((_, i) => i !== index);
            setFormData(prev => ({
                ...prev,
                skills: newSkills
            }));
            return newSkills;
        });
    };

    const addLanguage = () => {
        if (!languageInputValue.trim() || !languageLevelDraft) return;
        const newLanguage = {
            name: languageInputValue.trim(),
            level: languageLevelDraft
        };
        setLanguages(prev => [...prev, newLanguage]);
        setFormData(prev => ({
            ...prev,
            languages: [...prev.languages, newLanguage]
        }));
        setLanguageInputValue('');
        setLanguageLevelDraft('');
    };

    const removeLanguage = (index) => {
        setLanguages(prev => {
            const newLanguages = prev.filter((_, i) => i !== index);
            setFormData(prev => ({
                ...prev,
                languages: newLanguages
            }));
            return newLanguages;
        });
    };


    const validateSection = (sectionIndex) => {
        const newErrors = {};
        
        if (sectionIndex === 0) {
            if (!formData.full_name.trim()) newErrors.full_name = requiredErr('full_name');
            if (!formData.email.trim()) {
                newErrors.email = requiredErr('email');
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
                newErrors.email = fillI18nTemplate(t('formValidation_invalidFormat'), {
                    field: ft('email'),
                });
            }
            if (!formData.phone.trim()) newErrors.phone = requiredErr('phone');
        } else if (sectionIndex === 1) {
            if (!String(formData.roleKey || formData.position_applied_for || '').trim()) {
                newErrors.position_applied_for = requiredErr('position_applied_for');
            }
            if (!formData.years_of_experience.trim()) {
                newErrors.years_of_experience = requiredErr('years_of_experience');
            }
        } else if (sectionIndex === 2) {
            if (formData.skills.length < 3) {
                newErrors.skills = fillI18nTemplate(t('formValidation_minItems'), {
                    min: 3,
                    field: ft('skills'),
                });
            }
        } else if (sectionIndex === 3) {
            if (!formData.agreeToTerms) {
                newErrors.agreeToTerms = fillI18nTemplate(t('formValidation_required'), {
                    field: t('formField_agreeToTerms'),
                });
            }
        } else if (sectionIndex === 4) {
            if (!cvFile) newErrors.cvFile = requiredErr('cv');
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateSection(currentSection)) {
            if (currentSection < sections.length - 1) {
                setCurrentSection(currentSection + 1);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }
    };

    const handlePrevious = () => {
        if (currentSection > 0) {
            setCurrentSection(currentSection - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isPreviewMode) return;
        
        // Validate all sections
        let isValid = true;
        for (let i = 0; i < sections.length; i++) {
            if (!validateSection(i)) {
                isValid = false;
                setCurrentSection(i);
                break;
            }
        }

        if (!isValid) {
            return;
        }

        const honeypotValue = honeypotRef.current?.value?.trim() || '';
        if (honeypotValue) {
            console.warn('Honeypot triggered — discarding submission');
            alert('Application submitted successfully!');
            return;
        }

        setIsSubmitting(true);
        
        // إرسال البيانات إلى Backend
        try {
            // Submit form data directly (health check removed as it was causing false positives)
            const submitController = new AbortController();
            const submitTimeoutId = setTimeout(() => submitController.abort(), 30000); // 30 seconds timeout
            
            // إضافة campaign ID إلى البيانات إذا كان موجوداً في URL
            const dataToSend = campaignId 
                ? { ...formData, campaignId }
                : formData;

            const roleMetaKeys = new Set([
                'roleKey',
                'careerLevel',
                'managementTrack',
                'labelKey',
                'roleMatchSource',
            ]);
            const skipBodyKeys = new Set([
                ...roleMetaKeys,
                'files',
                'cv',
                'photo',
            ]);

            // Create FormData for file uploads
            const formDataToSend = new FormData();
            
            // Add all form fields
            Object.keys(dataToSend).forEach(key => {
                if (skipBodyKeys.has(key)) return;
                if (key === 'skills' || key === 'languages') {
                    // Handle arrays
                    formDataToSend.append(key, JSON.stringify(dataToSend[key]));
                } else if (key === 'agreeToTerms') {
                    // Handle boolean
                    formDataToSend.append(key, dataToSend[key] ? 'true' : 'false');
                } else {
                    formDataToSend.append(key, dataToSend[key] || '');
                }
            });

            for (const [key, value] of Object.entries(roleResolutionCriteriaFields(dataToSend))) {
                formDataToSend.append(key, value);
            }

            // Add files if they exist
            if (cvFile) {
                formDataToSend.append('cv', cvFile);
            }
            if (photoFile) {
                formDataToSend.append('photo', photoFile);
            }
            formDataToSend.append('website', honeypotRef.current?.value ?? '');
            formDataToSend.append('evaluationLanguage', currentLang === 'en' ? 'en' : 'ar');
            
            const response = await apiClient.postForm('/api/candidates', formDataToSend, {
                signal: submitController.signal,
            });
            
            clearTimeout(submitTimeoutId);

            if (!response.success) {
                let errorMsg = response.error || response.message || 'Failed to submit application';
                if (Array.isArray(response.details) && response.details.length > 0) {
                    errorMsg =
                        response.details.map((d) => d.message).filter(Boolean).join('; ') ||
                        errorMsg;
                } else if (response.error === 'Email already exists') {
                    errorMsg = t('formSubmit_emailExists');
                }
                throw new Error(errorMsg);
            }

            console.log('Form submitted successfully:', response);
            
            setSubmitSuccess(true);
            
            // Clear form data
            localStorage.removeItem('applicationFormData');
            setFormData({
                full_name: '', email: '', phone: '', location: '', gender: '',
                position_applied_for: '', company_applied_to: '', years_of_experience: '', current_company: '',
                highest_education_level: '', linkedin: '',
                skills: [], languages: [], certifications: '',
                availability: '', expectedSalary: '', salaryCurrency: 'USD',
                coverLetter: '', hearAboutUs: '', agreeToTerms: false
            });
            setSkills([]);
            setLanguages([]);
            setLanguageInputValue('');
            setLanguageLevelDraft('');
            setSkillInputValue('');
            setCurrentSection(0);
            setCvFile(null);
            setPhotoFile(null);
            setCvPreview(null);
            setPhotoPreview(null);
            // Clear file inputs
            const cvInput = document.getElementById('cvFile');
            const photoInput = document.getElementById('photo');
            if (cvInput) cvInput.value = '';
            if (photoInput) photoInput.value = '';
            
            // التوجيه إلى Stage 1 — ملفات المرشح في جدول «بانتظار التقييم» أدناه
            setTimeout(() => {
                const screeningUrl = campaignId
                    ? `/screening?campaignId=${encodeURIComponent(campaignId)}`
                    : '/screening';
                navigate(screeningUrl);
            }, 1800);
        } catch (error) {
            console.error('Error submitting form:', error);
            
            // Better error messages
            let errorMessage = t('formSubmit_error');
            
            if (error instanceof ApiError) {
                if (error.data?.code === 'APPLICATION_VALIDATION_FAILED' && Array.isArray(error.data.details)) {
                    errorMessage =
                        error.data.details.map((d) => d.message).filter(Boolean).join('; ') ||
                        errorMessage;
                } else if (error.data?.error === 'Email already exists') {
                    errorMessage = t('formSubmit_emailExists');
                } else if (error.data?.error === 'Database not connected' || error.data?.message?.includes('database')) {
                    errorMessage = 'قاعدة البيانات غير متصلة. يرجى التحقق من اتصال قاعدة البيانات.';
                } else if (error.data?.error === 'Missing required fields') {
                    errorMessage = 'يرجى ملء جميع الحقول المطلوبة.';
                } else {
                    errorMessage = error.data?.message || error.data?.error || error.message || errorMessage;
                }
            } else if (error.name === 'AbortError') {
                errorMessage = 'انتهت مهلة الاتصال. يرجى التحقق من الاتصال والمحاولة مرة أخرى.';
            } else if (error.message && error.message.includes('Cannot connect')) {
                errorMessage = error.message;
            } else if (error.message && error.message.includes('Failed to fetch')) {
                errorMessage = `لا يمكن الاتصال بالخادم. يرجى التأكد من أن الخادم الخلفي يعمل على ${API_BASE}`;
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            alert(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderPersonalSection = () => (
        <div className="form-section">
            <h2 className="section-title">{t('formSection_personal')}</h2>
            <div>
                <div className="form-group">
                    <label htmlFor="full_name">{ft('full_name')}</label>
                    <input
                        type="text"
                        id="full_name"
                        name="full_name"
                        value={formData.full_name}
                        onChange={handleInputChange}
                        placeholder={fph('full_name')}
                        className={errors.full_name ? 'error' : ''}
                        required={!isPreviewMode}
                        {...inputPreviewProps}
                    />
                    {errors.full_name && <span className="error-message">{errors.full_name}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="email">{ft('email')}</label>
                    <input
                        type="email"
                        id="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        placeholder={fph('email')}
                        className={errors.email ? 'error' : ''}
                        required={!isPreviewMode}
                        {...inputPreviewProps}
                    />
                    {errors.email && <span className="error-message">{errors.email}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="phone">{ft('phone')}</label>
                    <input
                        type="tel"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        placeholder={fph('phone')}
                        className={errors.phone ? 'error' : ''}
                        required={!isPreviewMode}
                        {...inputPreviewProps}
                    />
                    {errors.phone && <span className="error-message">{errors.phone}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="location">{ft('location')}</label>
                    <PositionSuggestCombobox
                        id="location"
                        name="location"
                        value={formData.location}
                        onChange={handleInputChange}
                        placeholder={fph('location')}
                        suggestions={governorateSuggestions}
                        listboxId="form-location-suggestions"
                        disabled={isPreviewMode}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="gender">{ft('gender')}</label>
                    <LanguageStyleSingleSelect
                        id="gender"
                        value={formData.gender}
                        onChange={(val) =>
                            handleInputChange({ target: { name: 'gender', value: val } })
                        }
                        options={genderOptions}
                        placeholder={fph('gender')}
                        aria-label={ft('gender')}
                        listboxId="form-gender-menu"
                        disabled={isPreviewMode}
                    />
                </div>

                <div className="form-group">
                    <label>{ft('languages')}</label>
                    <div className="input-with-button">
                        <div
                        style={{ flex: 1, marginRight: '10px', minWidth: 0 }}>
                            <PositionSuggestCombobox
                                id="languageInput"
                                name="languageInput"
                                value={languageInputValue}
                                onChange={(e) => setLanguageInputValue(e.target.value)}
                                placeholder={fph('languages')}
                                suggestionOptions={languageSuggestionOptions}
                                listboxId="form-language-suggestions"
                                disabled={isPreviewMode}
                            />
                        </div>
                        <div
                        style={{ flex: 1, marginRight: '10px', minWidth: 0 }}>
                            <LanguageStyleSingleSelect
                                id="languageLevel"
                                value={languageLevelDraft}
                                onChange={setLanguageLevelDraft}
                                options={languageLevelOptions}
                                placeholder={t('formField_languageLevel_ph')}
                                aria-label={t('formField_languageLevel_ph')}
                                listboxId="form-language-level-menu"
                                disabled={isPreviewMode}
                            />
                        </div>
                        {!isPreviewMode && (
                        <button type="button" className="btn btn-secondary" onClick={addLanguage}>
                            {t('formAdd')}
                        </button>
                        )}
                    </div>
                    <div className="tags-container">
                        {languages.map((lang, index) => (
                            <span key={index} className="tag">
                                {lang.name} ({languageLevelLabel(t, lang.level)})
                                {!isPreviewMode && (
                                <button type="button" className="tag-remove" onClick={() => removeLanguage(index)}>×</button>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    const renderFilesSection = () => (
        <div className="form-section">
            <h2 className="section-title">{t('formSection_files')}</h2>
            <div>
                <div className="form-group">
                    <label htmlFor="photo">{ft('photo')}</label>
                    <div
                        className="form-upload-dropzone"
                        style={{
                        border: '2px dashed rgba(91, 66, 246, 0.4)',
                        borderRadius: '12px',
                        padding: '24px',
                        background: 'linear-gradient(135deg, rgba(91, 66, 246, 0.05), rgba(139, 92, 246, 0.05))',
                        transition: 'all 0.3s ease',
                        cursor: isPreviewMode ? 'default' : 'pointer',
                        position: 'relative'
                    }}
                    {...(!isPreviewMode && {
                        onMouseEnter: (e) => {
                            e.currentTarget.style.borderColor = 'rgba(91, 66, 246, 0.6)';
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(91, 66, 246, 0.1), rgba(139, 92, 246, 0.1))';
                        },
                        onMouseLeave: (e) => {
                            e.currentTarget.style.borderColor = 'rgba(91, 66, 246, 0.4)';
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(91, 66, 246, 0.05), rgba(139, 92, 246, 0.05))';
                        },
                        onClick: () => document.getElementById('photo').click(),
                    })}
                    >
                        {!photoPreview ? (
                            <div style={{ textAlign: 'center' }}>
                                <div className="form-upload-empty-icon">📷</div>
                                <div className="form-upload-empty-title">
                                    {t('formUpload_click')}
                                </div>
                                <div className="form-upload-empty-hint">
                                    {t('formUpload_photoHint')}
                                </div>
                            </div>
                        ) : (
                            <div className="form-upload-preview">
                                <img 
                                    src={photoPreview} 
                                    alt="Profile preview" 
                                    style={{ 
                                        width: '120px', 
                                        height: '120px', 
                                        borderRadius: '12px',
                                        border: '2px solid rgba(91, 66, 246, 0.3)',
                                        objectFit: 'cover',
                                        boxShadow: '0 4px 12px rgba(91, 66, 246, 0.2)'
                                    }} 
                                />
                                <div style={{ flex: 1 }}>
                                    <div className="form-upload-preview-title">
                                        {t('formUpload_photoDone')}
                                    </div>
                                    {!isPreviewMode && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setPhotoFile(null);
                                            setPhotoPreview(null);
                                            const photoInput = document.getElementById('photo');
                                            if (photoInput) photoInput.value = '';
                                        }}
                                        style={{
                                            padding: '8px 16px',
                                            background: 'linear-gradient(135deg, #EF4444, #DC2626)',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
                                            transition: 'all 0.3s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.3)';
                                        }}
                                    >
                                        {t('formUpload_remove')}
                                    </button>
                                    )}
                                </div>
                            </div>
                        )}
                        {!isPreviewMode && (
                        <input
                            type="file"
                            id="photo"
                            accept="image/jpeg,image/jpg,image/png,image/gif"
                            onChange={(e) => handleFileChange(e, 'photo')}
                            style={{ display: 'none' }}
                        />
                        )}
                        {errors.photoFile && (
                            <div
                        style={{ marginTop: '12px', color: '#EF4444', fontSize: '13px' }}>
                                {errors.photoFile}
                            </div>
                        )}
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="cvFile">{ft('cv')}</label>
                    <div
                        className="form-upload-dropzone"
                        style={{
                        border: '2px dashed rgba(6, 182, 212, 0.4)',
                        borderRadius: '12px',
                        padding: '24px',
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(59, 130, 246, 0.05))',
                        transition: 'all 0.3s ease',
                        cursor: isPreviewMode ? 'default' : 'pointer',
                        position: 'relative'
                    }}
                    {...(!isPreviewMode && {
                        onMouseEnter: (e) => {
                            e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.6)';
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(59, 130, 246, 0.1))';
                        },
                        onMouseLeave: (e) => {
                            e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(59, 130, 246, 0.05))';
                        },
                        onClick: () => document.getElementById('cvFile').click(),
                    })}
                    >
                        {!cvPreview ? (
                            <div style={{ textAlign: 'center' }}>
                                <div className="form-upload-empty-icon">📄</div>
                                <div className="form-upload-empty-title">
                                    {t('formUpload_click')}
                                </div>
                                <div className="form-upload-empty-hint">
                                    {t('formUpload_cvHint')}
                                </div>
                            </div>
                        ) : (
                            <div className="form-upload-preview">
                                <div
                                    style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '12px',
                                    background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '32px',
                                    boxShadow: '0 4px 12px rgba(6, 182, 212, 0.3)'
                                }}>
                                    📄
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div
                                        className="form-upload-preview-title"
                                        style={{ wordBreak: 'break-word', marginBottom: '4px' }}
                                    >
                                        {cvPreview}
                                    </div>
                                    <div className="form-upload-empty-hint" style={{ marginBottom: '8px' }}>
                                        {t('formUpload_cvDone')}
                                    </div>
                                    {!isPreviewMode && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCvFile(null);
                                            setCvPreview(null);
                                            const cvInput = document.getElementById('cvFile');
                                            if (cvInput) cvInput.value = '';
                                        }}
                                        style={{
                                            padding: '8px 16px',
                                            background: 'linear-gradient(135deg, #EF4444, #DC2626)',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
                                            transition: 'all 0.3s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.3)';
                                        }}
                                    >
                                        {t('formUpload_remove')}
                                    </button>
                                    )}
                                </div>
                            </div>
                        )}
                        {!isPreviewMode && (
                        <input
                            type="file"
                            id="cvFile"
                            accept=".pdf,application/pdf"
                            onChange={(e) => handleFileChange(e, 'cv')}
                            style={{ display: 'none' }}
                        />
                        )}
                        {errors.cvFile && (
                            <div
                        style={{ marginTop: '12px', color: '#EF4444', fontSize: '13px' }}>
                                {errors.cvFile}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    const renderProfessionalSection = () => (
        <div className="form-section">
            <h2 className="section-title">{t('formSection_professional')}</h2>
            <div>
                <div className="form-group">
                    <label htmlFor="position_applied_for">{ft('position_applied_for')}</label>
                    <JobRoleFields
                        roleKey={formData.roleKey || ''}
                        careerLevel={formData.careerLevel || ''}
                        researchDomain={formData.researchDomain || ''}
                        position={formData.position_applied_for || ''}
                        onRoleResolved={handleRoleResolved}
                        onStateChange={setFormData}
                        roleInputId="position_applied_for"
                        roleInputName="position_applied_for"
                        levelInputId="form-career-level"
                        levelInputName="careerLevel"
                        rolePlaceholder={fph('position_applied_for')}
                        levelPlaceholder={t('jobRole_level_placeholder')}
                        roleListboxId="legacy-form-position-suggestions"
                        disabled={isPreviewMode}
                        roleRequired={!isPreviewMode}
                        layout="stacked"
                        roleInputClassName={errors.position_applied_for ? 'error' : ''}
                        levelInputClassName={errors.position_applied_for ? 'error' : ''}
                        levelInputStyle={{ width: '100%', marginTop: '8px' }}
                    />
                    <span style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary, #64748b)' }}>
                        {t('formHelp_positionRole')}
                    </span>
                    {errors.position_applied_for && <span className="error-message">{errors.position_applied_for}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="company_applied_to">{ft('company_applied_to')}</label>
                    <input
                        type="text"
                        id="company_applied_to"
                        name="company_applied_to"
                        value={formData.company_applied_to}
                        onChange={handleInputChange}
                        placeholder={fph('company_applied_to')}
                        {...inputPreviewProps}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="years_of_experience">{ft('years_of_experience')}</label>
                    <PositionSuggestCombobox
                        id="years_of_experience"
                        name="years_of_experience"
                        value={formData.years_of_experience}
                        onChange={handleInputChange}
                        suggestionOptions={experienceOptions}
                        placeholder={fph('years_of_experience')}
                        className={errors.years_of_experience ? 'error' : ''}
                        required={!isPreviewMode}
                        listboxId="form-years-experience-suggestions"
                        disabled={isPreviewMode}
                    />
                    {errors.years_of_experience && <span className="error-message">{errors.years_of_experience}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="current_company">{ft('current_company')}</label>
                    <input
                        type="text"
                        id="current_company"
                        name="current_company"
                        value={formData.current_company}
                        onChange={handleInputChange}
                        placeholder={fph('current_company')}
                        {...inputPreviewProps}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="highest_education_level">{ft('highest_education_level')}</label>
                    <LanguageStyleSingleSelect
                        id="highest_education_level"
                        value={formData.highest_education_level}
                        onChange={(val) =>
                            handleInputChange({
                                target: { name: 'highest_education_level', value: val },
                            })
                        }
                        options={educationOptions}
                        placeholder={fph('highest_education_level')}
                        aria-label={ft('highest_education_level')}
                        listboxId="form-highest-education-menu"
                        disabled={isPreviewMode}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="linkedin">{ft('linkedin')}</label>
                    <input
                        type="url"
                        id="linkedin"
                        name="linkedin"
                        value={formData.linkedin}
                        onChange={handleInputChange}
                        placeholder={fph('linkedin')}
                        {...inputPreviewProps}
                    />
                </div>
            </div>
        </div>
    );

    const renderSkillsSection = () => (
        <div className="form-section">
            <h2 className="section-title">{t('formSection_skills')}</h2>
            
            <div className="form-group">
                <label>{ft('skills')}</label>
                <div className="input-with-button">
                    <div
                        style={{ flex: 1, minWidth: 0 }}>
                        <PositionSuggestCombobox
                            id="skillInput"
                            name="skillInput"
                            value={skillInputValue}
                            onChange={(e) => setSkillInputValue(e.target.value)}
                            suggestionOptions={skillSuggestionOptions}
                            placeholder={fph('skills')}
                            listboxId="form-key-skills-suggestions"
                            disabled={isPreviewMode}
                            onKeyDown={(e) => {
                                if (isPreviewMode) return;
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addSkill();
                                }
                            }}
                        />
                    </div>
                    {!isPreviewMode && (
                    <button type="button" className="btn btn-secondary" onClick={addSkill}>
                        {t('formAdd')}
                    </button>
                    )}
                </div>
                {errors.skills && <span className="error-message">{errors.skills}</span>}
                {!errors.skills && formData.skills.length < 3 && (
                    <span className="help-text">
                        {fillI18nTemplate(t('formValidation_minItems'), { min: 3, field: ft('skills') })}
                    </span>
                )}
                <div className="tags-container">
                    {skills.map((skill, index) => (
                        <span key={index} className="tag">
                            {skill}
                            {!isPreviewMode && (
                            <button type="button" className="tag-remove" onClick={() => removeSkill(index)}>×</button>
                            )}
                        </span>
                    ))}
                </div>
            </div>

            <div className="form-group">
                <label htmlFor="certifications">{ft('certifications')}</label>
                <textarea
                    id="certifications"
                    name="certifications"
                    value={formData.certifications}
                    onChange={handleInputChange}
                    rows="4"
                    placeholder={fph('certifications')}
                    {...inputPreviewProps}
                />
            </div>
        </div>
    );

    const renderAdditionalSection = () => (
        <div className="form-section">
            <h2 className="section-title">{t('formSection_additional')}</h2>
            
            <div className="form-group">
                <label htmlFor="availability">{ft('availability')}</label>
                <PositionSuggestCombobox
                    id="availability"
                    name="availability"
                    value={formData.availability}
                    onChange={handleInputChange}
                    suggestionOptions={availabilityOptions}
                    placeholder={fph('availability')}
                    listboxId="form-availability-suggestions"
                    disabled={isPreviewMode}
                />
            </div>

            <div className="form-group">
                <label htmlFor="expectedSalary">{ft('expectedSalary')}</label>
                <div className="salary-range">
                    <input
                        type="number"
                        id="expectedSalary"
                        name="expectedSalary"
                        value={formData.expectedSalary}
                        onChange={handleInputChange}
                        placeholder={fph('expectedSalary')}
                        min="0"
                        step="any"
                        {...inputPreviewProps}
                    />
                    <LanguageStyleSingleSelect
                        id="salaryCurrency"
                        className="salary-currency-select"
                        aria-label={ft('salaryCurrency')}
                        listboxId="form-salary-currency-menu"
                        value={
                            ['USD', 'IQD'].includes(String(formData.salaryCurrency || '').toUpperCase())
                                ? String(formData.salaryCurrency).trim().toUpperCase()
                                : 'USD'
                        }
                        onChange={(val) =>
                            handleInputChange({ target: { name: 'salaryCurrency', value: val } })
                        }
                        options={SALARY_CURRENCY_OPTIONS}
                        disabled={isPreviewMode}
                    />
                </div>
            </div>

            <div className="form-group">
                <label htmlFor="coverLetter">{ft('coverLetter')}</label>
                <textarea
                    id="coverLetter"
                    name="coverLetter"
                    value={formData.coverLetter}
                    onChange={handleInputChange}
                    rows="6"
                    maxLength={500}
                    placeholder={fph('coverLetter')}
                    {...inputPreviewProps}
                />
                <span className="char-count">
                    {fillI18nTemplate(t('formCharCount'), {
                        current: formData.coverLetter.length,
                        max: 500,
                    })}
                </span>
            </div>

            <div className="form-group">
                <label htmlFor="hearAboutUs">{t('formField_hearAboutUs')}</label>
                <LanguageStyleSingleSelect
                    id="hearAboutUs"
                    value={formData.hearAboutUs}
                    onChange={(val) =>
                        handleInputChange({ target: { name: 'hearAboutUs', value: val } })
                    }
                    options={hearAboutOptions}
                    placeholder={t('formField_hearAboutUs_ph')}
                    aria-label={t('formField_hearAboutUs')}
                    listboxId="form-hear-about-menu"
                    disabled={isPreviewMode}
                />
            </div>

            <div className="form-group">
                <div className="checkbox-group">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            id="agreeToTerms"
                            name="agreeToTerms"
                            checked={formData.agreeToTerms}
                            onChange={(e) => setFormData(prev => ({ ...prev, agreeToTerms: e.target.checked }))}
                            required={!isPreviewMode}
                            disabled={isPreviewMode}
                        />
                        <span>{t('formField_agreeToTerms')} *</span>
                    </label>
                    {errors.agreeToTerms && <span className="error-message">{errors.agreeToTerms}</span>}
                </div>
            </div>
        </div>
    );

    if (submitSuccess) {
        return (
            <div className="form-page" dir={formPageDir} lang={currentLang}>
                <div className="container">
                    <div className="form-wrapper">
                        <header className="form-header">
                            <h1>{t('title') || 'Job Application Form'}</h1>
                            <p className="subtitle" style={{ color: '#10B981', fontSize: '18px', lineHeight: 1.5 }}>
                                {t('formSubmit_success')}
                            </p>
                            <p className="subtitle" style={{ marginTop: '12px' }}>
                                {t('writtenInterviewSubtitle')}
                            </p>
                        </header>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`form-page${isPreviewMode ? ' form-page--preview' : ''}`}
            dir={formPageDir}
            lang={currentLang}
        >
        <div className="container">
            <div className="form-wrapper">
                <header className="form-header">
                    <h1>{t('title') || 'Job Application Form'}</h1>
                    <p className="subtitle">{t('subtitle') || 'Tell us about yourself'}</p>
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                    <p className="progress-text">
                        <span>{progressPercent}</span>
                        <span> {t('complete') || '% Complete'}</span>
                    </p>
                </header>

                <form id="applicationForm" onSubmit={handleSubmit} noValidate>
                    {!isPreviewMode && (
                        <input
                            ref={honeypotRef}
                            type="text"
                            name="website"
                            tabIndex={-1}
                            autoComplete="off"
                            aria-hidden="true"
                            defaultValue=""
                            style={{
                                position: 'absolute',
                                left: '-9999px',
                                width: '1px',
                                height: '1px',
                                opacity: 0,
                                pointerEvents: 'none',
                            }}
                        />
                    )}
                    {isPreviewMode ? (
                        <>
                            {renderPersonalSection()}
                            {renderProfessionalSection()}
                            {renderSkillsSection()}
                            {renderAdditionalSection()}
                            {renderFilesSection()}
                        </>
                    ) : (
                        <>
                            {currentSection === 0 && renderPersonalSection()}
                            {currentSection === 1 && renderProfessionalSection()}
                            {currentSection === 2 && renderSkillsSection()}
                            {currentSection === 3 && renderAdditionalSection()}
                            {currentSection === 4 && renderFilesSection()}
                        </>
                    )}

                    {!isPreviewMode && (
                    <div className="form-navigation">
                        {currentSection > 0 && (
                            <button 
                                type="button" 
                                className="btn btn-secondary" 
                                onClick={handlePrevious}
                                style={{
                                    backgroundColor: '#FFFFFF',
                                    color: '#000000',
                                    border: '1px solid #E5E7EB'
                                }}
                            >
                                {t('previous') || 'Previous'}
                            </button>
                        )}
                        {currentSection < sections.length - 1 ? (
                            <button 
                                type="button" 
                                className="btn btn-primary" 
                                onClick={handleNext}
                            >
                                {t('next') || 'Next'}
                            </button>
                        ) : (
                            <button 
                                type="submit" 
                                className="btn btn-submit" 
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? t('formSubmitting') : t('submit')}
                            </button>
                        )}
                    </div>
                    )}
                </form>
            </div>
        </div>
        </div>
    );
};

const Form = () => {
    const [searchParams] = useSearchParams();
    const { currentLang, changeLanguage } = useLanguage();

    useEffect(() => {
        const fromUrl = parseInterviewUrlLanguage(searchParams.get('language'));
        if (fromUrl && fromUrl !== currentLang) {
            changeLanguage(fromUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    if (shouldUsePublicDynamicForm(searchParams)) {
        return <DynamicApplicationForm pubToken={searchParams.get('pub').trim()} />;
    }
    return <LegacyApplicationForm />;
};

export default Form;
