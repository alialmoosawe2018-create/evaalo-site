import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useInterviewTemplate } from '../contexts/InterviewTemplateContext';
import VapiWidget from '../components/VapiWidget';
import '../styles.css';

const Form = () => {
    const { t, currentLang } = useLanguage();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { templates, selectedTemplate } = useInterviewTemplate();
    const templateId = searchParams.get('template');
    const campaignId = searchParams.get('campaign'); // قراءة campaign ID من URL
    const [currentSection, setCurrentSection] = useState(0);
    
    // تحديد القالب المستخدم (من URL أو المختار في Context)
    const activeTemplate = templateId 
        ? templates.find(t => t.id === templateId) || selectedTemplate
        : selectedTemplate;
    const [formData, setFormData] = useState({
        // Personal Information
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        location: '',
        // Professional Details
        positionAppliedFor: '',
        yearsOfExperience: '',
        currentCompany: '',
        highestEducationLevel: '',
        linkedin: '',
        // Skills
        skills: [],
        languages: [],
        certifications: '',
        // Additional
        availability: '',
        salaryMin: '',
        salaryMax: '',
        salaryCurrency: 'USD',
        coverLetter: '',
        hearAboutUs: '',
        agreeToTerms: false
    });
    const [skills, setSkills] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const sections = ['personal', 'professional', 'skills', 'additional'];

    useEffect(() => {
        // Load saved form data from localStorage
        const savedData = localStorage.getItem('applicationFormData');
        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                setFormData(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error('Error loading saved form data:', e);
            }
        }
    }, []);

    // Save form data to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('applicationFormData', JSON.stringify(formData));
    }, [formData]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
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


    const addSkill = () => {
        const skillInput = document.getElementById('skillInput');
        if (skillInput && skillInput.value.trim()) {
            const newSkill = skillInput.value.trim();
            setSkills(prev => [...prev, newSkill]);
            setFormData(prev => ({
                ...prev,
                skills: [...prev.skills, newSkill]
            }));
            skillInput.value = '';
        }
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
        const langInput = document.getElementById('languageInput');
        const langLevel = document.getElementById('languageLevel');
        if (langInput && langInput.value.trim() && langLevel && langLevel.value) {
            const newLanguage = {
                name: langInput.value.trim(),
                level: langLevel.value
            };
            setLanguages(prev => [...prev, newLanguage]);
            setFormData(prev => ({
                ...prev,
                languages: [...prev.languages, newLanguage]
            }));
            langInput.value = '';
            langLevel.value = '';
        }
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
        
        if (sectionIndex === 0) { // Personal Information
            if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
            if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
            if (!formData.email.trim()) {
                newErrors.email = 'Email is required';
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
                newErrors.email = 'Invalid email format';
            }
            if (!formData.phone.trim()) newErrors.phone = 'Phone number is required';
        } else if (sectionIndex === 1) { // Professional Details
            if (!formData.positionAppliedFor.trim()) newErrors.positionAppliedFor = 'Position applied for is required';
            if (!formData.yearsOfExperience.trim()) newErrors.yearsOfExperience = 'Years of experience is required';
        } else if (sectionIndex === 2) { // Skills
            if (formData.skills.length < 3) newErrors.skills = 'Add at least 3 skills';
        } else if (sectionIndex === 3) { // Additional
            if (!formData.agreeToTerms) newErrors.agreeToTerms = 'You must agree to the Terms and Conditions';
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
            
            const response = await fetch('http://localhost:5000/api/candidates', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(dataToSend),
                signal: submitController.signal
            });
            
            clearTimeout(submitTimeoutId);

            // Check if response is ok before trying to parse JSON
            if (!response.ok) {
                let errorMessage = 'Failed to submit application';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorData.message || errorMessage;
                } catch (e) {
                    // If response is not JSON, use status text
                    errorMessage = response.statusText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();

            if (!result.success) {
                // Better error message based on error type
                let errorMsg = result.error || result.message || 'Failed to submit application';
                
                // Check if it's a database connection issue
                if (result.error === 'Database not connected' || result.message?.includes('database')) {
                    errorMsg = 'قاعدة البيانات غير متصلة. يرجى التحقق من اتصال قاعدة البيانات.';
                } else if (result.error === 'Email already exists') {
                    errorMsg = 'هذا البريد الإلكتروني مسجل بالفعل.';
                } else if (result.error === 'Missing required fields') {
                    errorMsg = 'يرجى ملء جميع الحقول المطلوبة.';
                }
                
                throw new Error(errorMsg);
            }

            console.log('Form submitted successfully:', result);
            
            // Show success message
            alert('Application submitted successfully!');
            
            // Clear form data
            localStorage.removeItem('applicationFormData');
            setFormData({
                firstName: '', lastName: '', email: '', phone: '', location: '',
                positionAppliedFor: '', yearsOfExperience: '', currentCompany: '',
                highestEducationLevel: '', linkedin: '',
                skills: [], languages: [], certifications: '',
                availability: '', salaryMin: '', salaryMax: '', salaryCurrency: 'USD',
                coverLetter: '', hearAboutUs: '', agreeToTerms: false
            });
            setSkills([]);
            setLanguages([]);
            setCurrentSection(0);
            
            // Navigate to home
            setTimeout(() => {
                navigate('/');
            }, 2000);
        } catch (error) {
            console.error('Error submitting form:', error);
            
            // Better error messages
            let errorMessage = 'خطأ في إرسال الطلب. يرجى المحاولة مرة أخرى.';
            
            if (error.name === 'AbortError') {
                errorMessage = 'انتهت مهلة الاتصال. يرجى التحقق من الاتصال والمحاولة مرة أخرى.';
            } else if (error.message && error.message.includes('Cannot connect')) {
                errorMessage = error.message;
            } else if (error.message && error.message.includes('Failed to fetch')) {
                errorMessage = 'لا يمكن الاتصال بالخادم. يرجى التأكد من أن الخادم الخلفي يعمل على http://localhost:5000';
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
            <h2 className="section-title">Personal Information</h2>
            <div>
                <div className="form-group">
                    <label htmlFor="firstName">First Name</label>
                    <input
                        type="text"
                        id="firstName"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        placeholder="Enter your first name"
                        className={errors.firstName ? 'error' : ''}
                        required
                    />
                    {errors.firstName && <span className="error-message">{errors.firstName}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="lastName">Last Name</label>
                    <input
                        type="text"
                        id="lastName"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        placeholder="Enter your last name"
                        className={errors.lastName ? 'error' : ''}
                        required
                    />
                    {errors.lastName && <span className="error-message">{errors.lastName}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="email">Email Address</label>
                    <input
                        type="email"
                        id="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        placeholder="your.email@example.com"
                        className={errors.email ? 'error' : ''}
                        required
                    />
                    {errors.email && <span className="error-message">{errors.email}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="phone">Phone Number</label>
                    <input
                        type="tel"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        placeholder="(123) 456-7890"
                        className={errors.phone ? 'error' : ''}
                        required
                    />
                    {errors.phone && <span className="error-message">{errors.phone}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="location">Location</label>
                    <input
                        type="text"
                        id="location"
                        name="location"
                        value={formData.location}
                        onChange={handleInputChange}
                        placeholder="City, State/Country"
                    />
                </div>
            </div>
        </div>
    );

    const renderProfessionalSection = () => (
        <div className="form-section">
            <h2 className="section-title">Professional Information</h2>
            <div>
                <div className="form-group">
                    <label htmlFor="positionAppliedFor">Position Applied For</label>
                    <select
                        id="positionAppliedFor"
                        name="positionAppliedFor"
                        value={formData.positionAppliedFor}
                        onChange={handleInputChange}
                        className={errors.positionAppliedFor ? 'error' : ''}
                        required
                    >
                        <option value="">Select a position</option>
                        <option value="software-engineer">Software Engineer</option>
                        <option value="frontend-developer">Frontend Developer</option>
                        <option value="backend-developer">Backend Developer</option>
                        <option value="fullstack-developer">Full Stack Developer</option>
                        <option value="data-scientist">Data Scientist</option>
                        <option value="product-manager">Product Manager</option>
                        <option value="designer">Designer</option>
                        <option value="other">Other</option>
                    </select>
                    {errors.positionAppliedFor && <span className="error-message">{errors.positionAppliedFor}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="yearsOfExperience">Years of Experience</label>
                    <select
                        id="yearsOfExperience"
                        name="yearsOfExperience"
                        value={formData.yearsOfExperience}
                        onChange={handleInputChange}
                        className={errors.yearsOfExperience ? 'error' : ''}
                        required
                    >
                        <option value="">Select years</option>
                        <option value="0-1">0-1 years</option>
                        <option value="2-3">2-3 years</option>
                        <option value="4-5">4-5 years</option>
                        <option value="6-10">6-10 years</option>
                        <option value="10+">10+ years</option>
                    </select>
                    {errors.yearsOfExperience && <span className="error-message">{errors.yearsOfExperience}</span>}
                </div>

                <div className="form-group">
                    <label htmlFor="currentCompany">Current Company</label>
                    <input
                        type="text"
                        id="currentCompany"
                        name="currentCompany"
                        value={formData.currentCompany}
                        onChange={handleInputChange}
                        placeholder="Your current employer (optional)"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="highestEducationLevel">Highest Education Level</label>
                    <select
                        id="highestEducationLevel"
                        name="highestEducationLevel"
                        value={formData.highestEducationLevel}
                        onChange={handleInputChange}
                    >
                        <option value="">Select education level</option>
                        <option value="high-school">High School</option>
                        <option value="bachelor">Bachelor's Degree</option>
                        <option value="master">Master's Degree</option>
                        <option value="phd">PhD</option>
                        <option value="other">Other</option>
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="linkedin">LinkedIn Profile</label>
                    <input
                        type="url"
                        id="linkedin"
                        name="linkedin"
                        value={formData.linkedin}
                        onChange={handleInputChange}
                        placeholder="https://linkedin.com/in/yourprofile"
                    />
                </div>
            </div>
        </div>
    );

    const renderSkillsSection = () => (
        <div className="form-section">
            <h2 className="section-title">Skills & Qualifications</h2>
            
            <div className="form-group">
                <label>Key Skills</label>
                <div className="input-with-button">
                    <input
                        type="text"
                        id="skillInput"
                        placeholder="Type a skill and press Enter or click Add"
                        onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                addSkill();
                            }
                        }}
                    />
                    <button type="button" className="btn btn-secondary" onClick={addSkill}>
                        Add
                    </button>
                </div>
                {errors.skills && <span className="error-message">{errors.skills}</span>}
                {!errors.skills && formData.skills.length < 3 && (
                    <span className="help-text">Add at least 3 skills</span>
                )}
                <div className="tags-container">
                    {skills.map((skill, index) => (
                        <span key={index} className="tag">
                            {skill}
                            <button type="button" className="tag-remove" onClick={() => removeSkill(index)}>×</button>
                        </span>
                    ))}
                </div>
            </div>

            <div className="form-group">
                <label>Languages Spoken</label>
                <div className="input-with-button">
                    <input
                        type="text"
                        id="languageInput"
                        placeholder="Language (e.g., English, Spanish)"
                        style={{ flex: 1, marginRight: '10px' }}
                    />
                    <select id="languageLevel" style={{ marginRight: '10px' }}>
                        <option value="">Level</option>
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                        <option value="native">Native</option>
                    </select>
                    <button type="button" className="btn btn-secondary" onClick={addLanguage}>
                        Add
                    </button>
                </div>
                <div className="tags-container">
                    {languages.map((lang, index) => (
                        <span key={index} className="tag">
                            {lang.name} ({lang.level})
                            <button type="button" className="tag-remove" onClick={() => removeLanguage(index)}>×</button>
                        </span>
                    ))}
                </div>
            </div>

            <div className="form-group">
                <label htmlFor="certifications">Certifications</label>
                <textarea
                    id="certifications"
                    name="certifications"
                    value={formData.certifications}
                    onChange={handleInputChange}
                    rows="4"
                    placeholder="List any professional certifications you hold..."
                />
            </div>
        </div>
    );

    const renderAdditionalSection = () => (
        <div className="form-section">
            <h2 className="section-title">Additional Information</h2>
            
            <div className="form-group">
                <label htmlFor="availability">Availability</label>
                <select
                    id="availability"
                    name="availability"
                    value={formData.availability}
                    onChange={handleInputChange}
                >
                    <option value="">Select availability</option>
                    <option value="immediate">Immediate</option>
                    <option value="1-week">1 Week</option>
                    <option value="2-weeks">2 Weeks</option>
                    <option value="1-month">1 Month</option>
                    <option value="2-months">2+ Months</option>
                </select>
            </div>

            <div className="form-group">
                <label>Expected Salary Range</label>
                <div className="salary-range">
                    <input
                        type="number"
                        id="salaryMin"
                        name="salaryMin"
                        value={formData.salaryMin}
                        onChange={handleInputChange}
                        placeholder="Min"
                    />
                    <span className="range-separator">-</span>
                    <input
                        type="number"
                        id="salaryMax"
                        name="salaryMax"
                        value={formData.salaryMax}
                        onChange={handleInputChange}
                        placeholder="Max"
                    />
                    <select
                        id="salaryCurrency"
                        name="salaryCurrency"
                        value={formData.salaryCurrency}
                        onChange={handleInputChange}
                    >
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                    </select>
                </div>
            </div>

            <div className="form-group">
                <label htmlFor="coverLetter">Cover Letter / Why are you interested in this position?</label>
                <textarea
                    id="coverLetter"
                    name="coverLetter"
                    value={formData.coverLetter}
                    onChange={handleInputChange}
                    rows="6"
                    maxLength={500}
                    placeholder="Tell us why you're interested in this role and what makes you a great fit..."
                />
                <span className="char-count">{formData.coverLetter.length}/500 characters</span>
            </div>

            <div className="form-group">
                <label htmlFor="hearAboutUs">How did you hear about us?</label>
                <select
                    id="hearAboutUs"
                    name="hearAboutUs"
                    value={formData.hearAboutUs}
                    onChange={handleInputChange}
                >
                    <option value="">Select source</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="job-board">Job Board</option>
                    <option value="company-website">Company Website</option>
                    <option value="referral">Referral</option>
                    <option value="social-media">Social Media</option>
                    <option value="other">Other</option>
                </select>
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
                            required
                        />
                        <span>I agree to the <a href="#" target="_blank">Terms and Conditions</a> and <a href="#" target="_blank">Privacy Policy</a> *</span>
                    </label>
                    {errors.agreeToTerms && <span className="error-message">{errors.agreeToTerms}</span>}
                </div>
            </div>
        </div>
    );

    return (
        <div className="container">
            <div className="language-selector-wrapper">
                <Link to="/" className="form-logo-link">
                    <img src="/images/last logo.png" alt="evaalo Logo" className="form-logo-image" />
                </Link>
            </div>

            <div className="form-wrapper">
                <header className="form-header">
                    <h1>{t('title') || 'Job Application Form'}</h1>
                    <p className="subtitle">{t('subtitle') || 'Tell us about yourself'}</p>
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${((currentSection + 1) / sections.length) * 100}%` }}></div>
                    </div>
                    <p className="progress-text">
                        <span>{Math.round(((currentSection + 1) / sections.length) * 100)}</span>
                        <span> {t('complete') || '% Complete'}</span>
                    </p>
                </header>

                <form id="applicationForm" onSubmit={handleSubmit} noValidate>
                    {currentSection === 0 && renderPersonalSection()}
                    {currentSection === 1 && renderProfessionalSection()}
                    {currentSection === 2 && renderSkillsSection()}
                    {currentSection === 3 && renderAdditionalSection()}

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
                                style={{
                                    backgroundColor: '#5B42F6',
                                    color: '#FFFFFF',
                                    border: 'none',
                                    backgroundImage: 'none'
                                }}
                            >
                                {t('next') || 'Next'}
                            </button>
                        ) : (
                            <button 
                                type="submit" 
                                className="btn btn-submit" 
                                disabled={isSubmitting}
                                style={{
                                    backgroundColor: '#5B42F6',
                                    color: '#FFFFFF',
                                    border: 'none',
                                    backgroundImage: 'none'
                                }}
                            >
                                {isSubmitting ? 'Submitting...' : (t('submit') || 'Submit Application')}
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* Vapi Widget - Voice Assistant */}
            <VapiWidget 
                apiKey="7c4dacd3-c0fe-4a6c-bf4f-d9601585f155"
                assistantId="fda09eb4-2275-47aa-a75c-8f2ac1976856"
                config={{
                    position: 'bottom-right',
                    theme: 'default',
                    greeting: 'Need help filling out the form? I can assist you!',
                }}
            />
        </div>
    );
};

export default Form;
