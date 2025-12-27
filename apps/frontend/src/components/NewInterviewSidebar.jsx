import React, { useState } from 'react';
import { useInterviewTemplate } from '../contexts/InterviewTemplateContext';

const NewInterviewSidebar = ({ isOpen, onClose, onSelectOption }) => {
    const { selectedTemplate, selectedVideoTemplate, selectedAudioTemplate, getCurrentFormLink, getSelectedTemplateByType } = useInterviewTemplate();
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [currentTemplateType, setCurrentTemplateType] = useState('process');
    const [showJobDetailsForm, setShowJobDetailsForm] = useState(true);
    const [showFormLink, setShowFormLink] = useState(false);
    const [selectedInterviewType, setSelectedInterviewType] = useState(null);
    const [sendingToN8N, setSendingToN8N] = useState(false);
    const [sendSuccess, setSendSuccess] = useState(false);
    const [campaignId, setCampaignId] = useState(null);
    const [formLinkWithCampaign, setFormLinkWithCampaign] = useState(null);
    
    // قائمة المعايير المتاحة
    const availableCriteria = [
        { id: 'position', label: 'Position', placeholder: 'Enter position (e.g., Software Engineer)', type: 'text' },
        { id: 'location', label: 'Location', placeholder: 'Enter location (e.g., Remote, Dubai)', type: 'text' },
        { id: 'job', label: 'Job Title', placeholder: 'Enter job title', type: 'text' },
        { id: 'company', label: 'Company', placeholder: 'Enter company name', type: 'text' },
        { id: 'age', label: 'Age Range', placeholder: 'Enter age range (e.g., 25-35)', type: 'text' },
        { id: 'gender', label: 'Gender', placeholder: 'Enter gender preference', type: 'text' },
        { id: 'educationLevel', label: 'Education Level', placeholder: 'Enter education level (e.g., Bachelor, Master)', type: 'text' },
        { id: 'experienceYears', label: 'Experience Years', placeholder: 'Enter years of experience (e.g., 3-5)', type: 'text' },
        { id: 'salaryMin', label: 'Salary Min', placeholder: 'Enter minimum salary', type: 'text' },
        { id: 'salaryMax', label: 'Salary Max', placeholder: 'Enter maximum salary', type: 'text' },
        { id: 'salaryCurrency', label: 'Salary Currency', placeholder: 'Enter currency (e.g., USD, AED)', type: 'text' },
        { id: 'skills', label: 'Required Skills', placeholder: 'Enter required skills (comma separated)', type: 'text' },
        { id: 'languages', label: 'Required Languages', placeholder: 'Enter required languages (comma separated)', type: 'text' },
        { id: 'certifications', label: 'Certifications', placeholder: 'Enter required certifications', type: 'text' },
        { id: 'availability', label: 'Availability', placeholder: 'Enter availability (e.g., Full-time, Part-time)', type: 'text' }
    ];
    
    // حالة المعايير المختارة
    const [selectedCriteria, setSelectedCriteria] = useState({});
    const [jobDetails, setJobDetails] = useState({});
    const [errors, setErrors] = useState({});

    if (!isOpen) return null;

    const options = [
        {
            id: 'start-process',
            icon: '🚀',
            title: 'Start Process',
            description: 'Begin a new interview process',
            color: '#3B82F6',
            gradient: 'linear-gradient(135deg, #3B82F6 0%, #0EA5E9 50%, #06B6D4 100%)'
        },
        {
            id: 'video-interview',
            icon: '📹',
            title: 'Video Interview',
            description: 'Conduct a video interview',
            color: '#06B6D4',
            gradient: 'linear-gradient(135deg, #06B6D4 0%, #22d3ee 100%)'
        },
        {
            id: 'audio-interview',
            icon: '🎤',
            title: 'Audio Interview',
            description: 'Conduct an audio interview',
            color: '#EC4899',
            gradient: 'linear-gradient(135deg, #EC4899 0%, #F472B6 100%)'
        }
    ];

    // تفعيل/إلغاء تفعيل معيار
    const toggleCriterion = (criterionId) => {
        setSelectedCriteria(prev => {
            const newSelected = { ...prev };
            if (newSelected[criterionId]) {
                // إلغاء التفعيل - حذف القيمة
                delete newSelected[criterionId];
                setJobDetails(prevDetails => {
                    const newDetails = { ...prevDetails };
                    delete newDetails[criterionId];
                    return newDetails;
                });
            } else {
                // تفعيل - إضافة المعيار بقيمة فارغة
                newSelected[criterionId] = true;
                setJobDetails(prevDetails => ({
                    ...prevDetails,
                    [criterionId]: ''
                }));
            }
            return newSelected;
        });
    };

    const handleInputChange = (field, value) => {
        setJobDetails(prev => ({
            ...prev,
            [field]: value
        }));
        // حذف الخطأ عند البدء بالكتابة
        if (errors[field]) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    const validateForm = () => {
        const newErrors = {};
        // التحقق من أن جميع المعايير المختارة لها قيم
        Object.keys(selectedCriteria).forEach(criterionId => {
            if (selectedCriteria[criterionId] && (!jobDetails[criterionId] || !jobDetails[criterionId].trim())) {
                const criterion = availableCriteria.find(c => c.id === criterionId);
                newErrors[criterionId] = `${criterion?.label || criterionId} is required`;
            }
        });
        
        // التحقق من أن هناك معيار واحد على الأقل مختار
        if (Object.keys(selectedCriteria).length === 0) {
            newErrors.general = 'Please select at least one criterion';
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = async () => {
        if (validateForm()) {
            // حفظ المعايير في قاعدة البيانات وإنشاء campaign ID
            setSendingToN8N(true);
            try {
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
                const response = await fetch(`${apiUrl}/api/recruitment-campaigns`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        ...jobDetails
                    })
                });
                
                const result = await response.json();
                
                if (result.success && result.campaignId) {
                    console.log('✅ Campaign created:', result.campaignId);
                    
                    // حفظ campaign ID
                    setCampaignId(result.campaignId);
                    
                    // إنشاء رابط الاستمارة مع campaign ID
                    const baseUrl = window.location.origin;
                    const templateId = selectedTemplate?.id || 'template-1';
                    const formLink = `${baseUrl}/form?template=${templateId}&campaign=${result.campaignId}`;
                    setFormLinkWithCampaign(formLink);
                    
                    // عرض رابط الاستمارة مباشرة
            setShowJobDetailsForm(false);
                    setShowFormLink(true);
                    setSendSuccess(true);
                    setTimeout(() => setSendSuccess(false), 3000);
                } else {
                    console.warn('⚠️ Failed to create campaign:', result);
                    alert('Failed to create campaign. Please try again.');
                }
            } catch (error) {
                console.error('❌ Error creating campaign:', error);
                alert('Error creating campaign. Please try again.');
            } finally {
                setSendingToN8N(false);
            }
        }
    };

    const handleOptionClick = async (optionId) => {
        // لم نعد بحاجة لهذه الوظيفة - الرابط يظهر مباشرة بعد Continue
        // هذه الدالة يمكن استخدامها لاحقاً إذا لزم الأمر
        return;
        let templateType = 'process';
        let selectedTemplateForType = selectedTemplate;
        let interviewType = 'process';
        
        if (optionId === 'start-process') {
            templateType = 'process';
            interviewType = 'process';
            selectedTemplateForType = selectedTemplate;
        } else if (optionId === 'video-interview') {
            templateType = 'video';
            interviewType = 'video';
            selectedTemplateForType = selectedVideoTemplate;
        } else if (optionId === 'audio-interview') {
            templateType = 'audio';
            interviewType = 'audio';
            selectedTemplateForType = selectedAudioTemplate;
        }
        
        // التحقق من وجود قالب مختار
        if (!selectedTemplateForType) {
            const templateTypeName = templateType === 'video' ? 'فيديو' : templateType === 'audio' ? 'صوتي' : 'العملية';
            alert(`يرجى اختيار قالب الاستمارة ${templateTypeName} أولاً من صفحة Interview Templates`);
            return;
        }
        
        // إرسال معلومات حملة التوظيف (المعايير + نوع المقابلة) إلى n8n للتحليل
        setSendingToN8N(true);
        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            const response = await fetch(`${apiUrl}/api/recruitment-campaigns`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...jobDetails, // المعايير (Position, Location, Job, Company, Age) - المرجع للفلترة والتقييم
                    interviewType: interviewType,
                    templateType: templateType,
                    templateName: selectedTemplateForType?.name || null,
                    timestamp: new Date().toISOString(),
                    step: 'interview_type_selected' // إضافة خطوة لتوضيح أن نوع المقابلة تم اختياره
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('✅ Recruitment campaign (criteria + interview type) sent to n8n for analysis:', result);
                setSendSuccess(true);
                setTimeout(() => setSendSuccess(false), 3000);
            } else {
                console.warn('⚠️ Failed to send recruitment campaign:', result);
            }
        } catch (error) {
            console.error('❌ Error sending recruitment campaign:', error);
            // لا نمنع المستخدم من المتابعة حتى لو فشل الإرسال
        } finally {
            setSendingToN8N(false);
        }
        
        // الحصول على رابط الاستمارة وعرضه
        setCurrentTemplateType(templateType);
        setSelectedInterviewType(interviewType);
        const formLink = getCurrentFormLink(templateType);
        if (formLink) {
            setShowFormLink(true);
            // يمكن أيضاً عرض Modal إذا أردت
            // setShowLinkModal(true);
        } else {
            alert('حدث خطأ في إنشاء رابط الاستمارة');
        }
    };

    const handleCopyLink = () => {
        const formLink = getCurrentFormLink(currentTemplateType);
        if (formLink) {
            navigator.clipboard.writeText(formLink).then(() => {
                setCopiedLink(true);
                setTimeout(() => {
                    setCopiedLink(false);
                    setShowLinkModal(false);
                    onClose();
                }, 2000);
            });
        }
    };

    const handleCloseModal = () => {
        setShowLinkModal(false);
        onClose();
    };

    return (
        <>
            {/* Overlay */}
            <div
                className="modal-overlay"
                onClick={onClose}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(8px)',
                    zIndex: 10001,
                    animation: 'fadeIn 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            />

            {/* Modal - Centered */}
            <div
                className="new-interview-modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '85%',
                    maxWidth: '700px',
                    maxHeight: '85vh',
                    background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '20px',
                    boxShadow: '0 25px 70px rgba(0, 0, 0, 0.8)',
                    zIndex: 10002,
                    padding: '28px',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    animation: 'modalFadeIn 0.3s ease',
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                {/* Header */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h2 style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, #38bdf8 0%, #22d3ee 25%, #c084fc 50%, #c084fc 75%, #38bdf8 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            margin: 0
                        }}>
                            {showJobDetailsForm ? 'Job Criteria' : 'New Interview'}
                        </h2>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                width: '36px',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                color: '#fff',
                                fontSize: '20px',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                                e.currentTarget.style.borderColor = '#06B6D4';
                                e.currentTarget.style.transform = 'rotate(90deg)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                e.currentTarget.style.transform = 'rotate(0deg)';
                            }}
                        >
                            ×
                        </button>
                    </div>
                    <p style={{
                        fontSize: '13px',
                        color: '#94A3B8',
                        margin: 0,
                        lineHeight: '1.5'
                    }}>
                        {showJobDetailsForm 
                            ? 'Select and configure criteria for candidate evaluation'
                            : showFormLink
                            ? 'Form link is ready! Share it with candidates'
                            : 'Choose the type of interview you want to start'
                        }
                    </p>
                    {/* Success Message */}
                    {sendSuccess && (
                        <div style={{
                            marginTop: '12px',
                            padding: '10px 16px',
                            background: 'rgba(16, 185, 129, 0.2)',
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            borderRadius: '8px',
                            color: '#10B981',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>✓</span>
                            <span>Data sent to n8n successfully for analysis</span>
                        </div>
                    )}
                    {/* Loading Message */}
                    {sendingToN8N && (
                        <div style={{
                            marginTop: '12px',
                            padding: '10px 16px',
                            background: 'rgba(59, 130, 246, 0.2)',
                            border: '1px solid rgba(59, 130, 246, 0.4)',
                            borderRadius: '8px',
                            color: '#3B82F6',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>⏳</span>
                            <span>Sending data to n8n...</span>
                        </div>
                    )}
                </div>

                {/* Job Details Form - Dynamic Criteria Selection */}
                {showJobDetailsForm ? (
                    <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        minHeight: 0,
                        overflowY: 'auto',
                        overflowX: 'hidden'
                    }}>
                        {/* Instructions */}
                        <div style={{
                            padding: '12px 16px',
                            background: 'rgba(6, 182, 212, 0.08)',
                            borderRadius: '10px',
                            border: '1px solid rgba(6, 182, 212, 0.25)',
                            marginBottom: '18px'
                        }}>
                            <p style={{
                                    fontSize: '12px',
                                    color: '#CBD5E1',
                                margin: 0,
                                lineHeight: '1.5'
                            }}>
                                📋 <strong>Select criteria</strong> by toggling each item, then fill in the values below.
                            </p>
                        </div>

                        {/* General Error */}
                        {errors.general && (
                            <div style={{
                                padding: '12px',
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                        borderRadius: '8px',
                                marginBottom: '16px'
                            }}>
                                <span style={{ color: '#EF4444', fontSize: '12px' }}>{errors.general}</span>
                            </div>
                        )}

                        {/* Criteria List - Compact Grid Layout */}
                        <div style={{ 
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                            gap: '12px',
                            flex: '0 0 auto',
                            paddingBottom: '16px'
                        }}>
                            {availableCriteria.map((criterion) => {
                                const isSelected = selectedCriteria[criterion.id];
                                const value = jobDetails[criterion.id] || '';
                                const hasError = errors[criterion.id];
                                
                                return (
                                    <div key={criterion.id} style={{
                                        padding: '12px',
                                        background: isSelected ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                        borderRadius: '10px',
                                        border: `1px solid ${isSelected ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                                        transition: 'all 0.3s ease',
                                        animation: 'slideIn 0.3s ease'
                                    }}>
                                        {/* Toggle Switch */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            marginBottom: isSelected ? '10px' : '0'
                                        }}>
                                <label style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: '#CBD5E1',
                                                cursor: 'pointer',
                                                flex: 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleCriterion(criterion.id)}
                                    style={{
                                                        width: '16px',
                                                        height: '16px',
                                                        cursor: 'pointer',
                                                        accentColor: '#06B6D4',
                                                        flexShrink: 0
                                                    }}
                                                />
                                                <span style={{ fontSize: '12px' }}>{criterion.label}</span>
                                            </label>
                            </div>

                                        {/* Input Field - Shows when selected */}
                                        {isSelected && (
                                            <div style={{
                                                animation: 'slideIn 0.3s ease',
                                                marginTop: '10px'
                                            }}>
                                <input
                                                    type={criterion.type}
                                                    value={value}
                                                    onChange={(e) => handleInputChange(criterion.id, e.target.value)}
                                                    placeholder={criterion.placeholder}
                                    style={{
                                        width: '100%',
                                                        padding: '8px 12px',
                                                        background: 'rgba(0, 0, 0, 0.4)',
                                                        border: `1px solid ${hasError ? '#EF4444' : 'rgba(255, 255, 255, 0.2)'}`,
                                                        borderRadius: '6px',
                                        color: '#fff',
                                                        fontSize: '12px',
                                        outline: 'none',
                                        transition: 'all 0.3s ease',
                                        boxSizing: 'border-box'
                                    }}
                                    onFocus={(e) => {
                                        e.currentTarget.style.borderColor = '#06B6D4';
                                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(6, 182, 212, 0.1)';
                                    }}
                                    onBlur={(e) => {
                                                        e.currentTarget.style.borderColor = hasError ? '#EF4444' : 'rgba(255, 255, 255, 0.2)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                />
                                                {hasError && (
                                                    <span style={{ color: '#EF4444', fontSize: '10px', marginTop: '4px', display: 'block' }}>
                                                        {hasError}
                                    </span>
                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            </div>

                        {/* Continue Button */}
                        <div style={{ 
                            marginTop: '20px',
                            paddingTop: '20px',
                            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                            flexShrink: 0
                        }}>
                            <button
                                onClick={handleContinue}
                                    style={{
                                        width: '100%',
                                    padding: '12px 24px',
                                    background: 'linear-gradient(135deg, #3B82F6, #0EA5E9)',
                                    border: 'none',
                                    borderRadius: '10px',
                                        color: '#fff',
                                        fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                        transition: 'all 0.3s ease',
                                    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                                    display: 'block'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.5)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
                                }}
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                ) : showFormLink ? (
                    <>
                        {/* Form Link Display */}
                        <div style={{ 
                            flex: 1, 
                            display: 'flex', 
                            flexDirection: 'column',
                            gap: '20px'
                        }}>
                            {/* Job Criteria Summary */}
                            <div style={{
                                padding: '20px',
                                background: 'rgba(6, 182, 212, 0.1)',
                                borderRadius: '12px',
                                border: '1px solid rgba(6, 182, 212, 0.3)'
                            }}>
                                <h3 style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#06B6D4',
                                    marginBottom: '12px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px'
                                }}>
                                    📋 Job Criteria (Reference for n8n Analysis)
                                </h3>
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    fontSize: '13px',
                                    color: '#CBD5E1'
                                }}>
                                    <div><strong>Position:</strong> {jobDetails.position}</div>
                                    <div><strong>Location:</strong> {jobDetails.location}</div>
                                    <div><strong>Job:</strong> {jobDetails.job}</div>
                                    <div><strong>Company:</strong> {jobDetails.company}</div>
                                    <div><strong>Age Range:</strong> {jobDetails.age}</div>
                                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(6, 182, 212, 0.2)' }}>
                                        <strong>Interview Type:</strong> <span style={{ color: '#06B6D4' }}>{selectedInterviewType === 'process' ? 'Written Interview' : selectedInterviewType === 'video' ? 'Video Interview' : 'Audio Interview'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Form Link */}
                            <div style={{
                                padding: '20px',
                                background: 'rgba(0, 0, 0, 0.3)',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.1)'
                            }}>
                                <h3 style={{
                                    fontSize: '16px',
                                    fontWeight: 600,
                                    color: '#fff',
                                    marginBottom: '12px'
                                }}>
                                    🔗 Form Link
                                </h3>
                                <p style={{
                                    fontSize: '12px',
                                    color: '#94A3B8',
                                    marginBottom: '12px'
                                }}>
                                    Share this link with candidates. They will fill the form, and n8n will analyze their responses based on the criteria above.
                                </p>
                                <div style={{
                                    padding: '12px',
                                    background: 'rgba(6, 182, 212, 0.1)',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(6, 182, 212, 0.3)',
                                    marginBottom: '12px'
                                }}>
                                    <div style={{
                                        fontSize: '11px',
                                        color: '#94A3B8',
                                        marginBottom: '6px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px'
                                }}>
                                        Form URL:
                                    </div>
                                    <div style={{
                                        fontSize: '13px',
                                        color: '#06B6D4',
                                        wordBreak: 'break-all',
                                        fontFamily: 'monospace',
                                        padding: '8px',
                                        background: 'rgba(0, 0, 0, 0.3)',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(6, 182, 212, 0.2)'
                                    }}>
                                        {formLinkWithCampaign || getCurrentFormLink(currentTemplateType)}
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        const formLink = formLinkWithCampaign || getCurrentFormLink(currentTemplateType);
                                        if (formLink) {
                                            navigator.clipboard.writeText(formLink).then(() => {
                                                setCopiedLink(true);
                                                setTimeout(() => setCopiedLink(false), 2000);
                                            });
                                        }
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '12px 24px',
                                        background: copiedLink
                                            ? 'linear-gradient(135deg, #10B981, #059669)'
                                            : 'linear-gradient(135deg, #3B82F6, #0EA5E9)',
                                        border: 'none',
                                        borderRadius: '8px',
                                        color: '#fff',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    {copiedLink ? '✓ Link Copied!' : '📋 Copy Link'}
                                </button>
                        </div>

                            {/* Action Buttons */}
                            <div style={{
                                display: 'flex',
                                gap: '12px',
                                marginTop: 'auto'
                            }}>
                            <button
                                    onClick={() => {
                                        setShowFormLink(false);
                                        setSelectedInterviewType(null);
                                    }}
                                style={{
                                        flex: 1,
                                        padding: '12px 24px',
                                        background: 'rgba(255, 255, 255, 0.1)',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        borderRadius: '8px',
                                        color: '#fff',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    ← Back
                                </button>
                                <button
                                    onClick={() => {
                                        setShowFormLink(false);
                                        setShowJobDetailsForm(true);
                                        setSelectedInterviewType(null);
                                        setJobDetails({
                                            position: '',
                                            location: '',
                                            job: '',
                                            company: '',
                                            age: ''
                                        });
                                    }}
                                    style={{
                                        flex: 1,
                                    padding: '12px 24px',
                                    background: 'linear-gradient(135deg, #3B82F6, #0EA5E9)',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: '#fff',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease'
                                }}
                                >
                                    New Campaign
                            </button>
                        </div>
                    </div>
                    </>
                ) : (
                    <>
                        {/* Options */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {options.map((option) => (
                        <div
                            key={option.id}
                            onClick={() => handleOptionClick(option.id)}
                            style={{
                                padding: '20px',
                                background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
                                backdropFilter: 'blur(20px)',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease',
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateX(4px)';
                                e.currentTarget.style.borderColor = option.color;
                                e.currentTarget.style.boxShadow = `0 0 25px ${option.color}40`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateX(0)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        >
                            {/* Background gradient effect */}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100px',
                                height: '100px',
                                background: `radial-gradient(circle, ${option.color}20 0%, transparent 70%)`,
                                borderRadius: '50%',
                                filter: 'blur(40px)',
                                pointerEvents: 'none'
                            }} />

                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', position: 'relative', zIndex: 1 }}>
                                {/* Icon */}
                                <div style={{
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '12px',
                                    background: `linear-gradient(135deg, ${option.color}20, ${option.color}10)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: `1px solid ${option.color}40`,
                                    fontSize: '28px',
                                    flexShrink: 0
                                }}>
                                    {option.icon}
                                </div>

                                {/* Content */}
                                <div style={{ flex: 1 }}>
                                    <h3 style={{
                                        fontSize: '18px',
                                        fontWeight: 700,
                                        color: '#fff',
                                        marginBottom: '6px',
                                        background: option.gradient,
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        backgroundClip: 'text'
                                    }}>
                                        {option.title}
                                    </h3>
                                    <p style={{
                                        fontSize: '13px',
                                        color: '#94A3B8',
                                        margin: 0,
                                        lineHeight: '1.5'
                                    }}>
                                        {option.description}
                                    </p>
                                </div>

                                {/* Arrow */}
                                <div style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    background: `rgba(${option.color === '#3B82F6' ? '59, 130, 246' : option.color === '#06B6D4' ? '6, 182, 212' : '236, 72, 153'}, 0.2)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: option.color,
                                    fontSize: '16px',
                                    flexShrink: 0,
                                    transition: 'all 0.3s ease'
                                }}>
                                    →
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div style={{
                    marginTop: 'auto',
                    paddingTop: '24px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    <div style={{
                        padding: '10px',
                        background: 'rgba(6, 182, 212, 0.05)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        marginBottom: '12px'
                    }}>
                        <div style={{
                            fontSize: '10px',
                            color: '#94A3B8',
                            fontWeight: 600,
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                        }}>
                            القوالب المختارة:
                        </div>
                        <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.6' }}>
                            <div>🚀 Process: {selectedTemplate ? <span style={{ color: '#06B6D4' }}>{selectedTemplate.name}</span> : <span style={{ color: '#F59E0B' }}>غير محدد</span>}</div>
                            <div>📹 Video: {selectedVideoTemplate ? <span style={{ color: '#06B6D4' }}>{selectedVideoTemplate.name}</span> : <span style={{ color: '#F59E0B' }}>غير محدد</span>}</div>
                            <div>🎤 Audio: {selectedAudioTemplate ? <span style={{ color: '#06B6D4' }}>{selectedAudioTemplate.name}</span> : <span style={{ color: '#F59E0B' }}>غير محدد</span>}</div>
                        </div>
                    </div>
                    <p style={{
                        fontSize: '11px',
                        color: '#64748B',
                        textAlign: 'center',
                        margin: 0
                    }}>
                        Select an option to begin your interview process
                    </p>
                </div>
                    </>
                )}
            </div>

            {/* Link Modal */}
            {showLinkModal && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'rgba(0, 0, 0, 0.8)',
                            backdropFilter: 'blur(8px)',
                            zIndex: 10003,
                            animation: 'fadeIn 0.3s ease'
                        }}
                        onClick={handleCloseModal}
                    />
                    <div
                        style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '90%',
                            maxWidth: '500px',
                            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%)',
                            backdropFilter: 'blur(20px)',
                            borderRadius: '16px',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                            zIndex: 10004,
                            padding: '32px',
                            animation: 'fadeIn 0.3s ease'
                        }}
                    >
                        <div style={{ marginBottom: '24px' }}>
                            <h3 style={{
                                fontSize: '24px',
                                fontWeight: 700,
                                background: 'linear-gradient(135deg, #38bdf8 0%, #22d3ee 25%, #c084fc 50%, #c084fc 75%, #38bdf8 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                marginBottom: '8px'
                            }}>
                                رابط الاستمارة جاهز!
                            </h3>
                            <p style={{
                                fontSize: '14px',
                                color: '#94A3B8',
                                margin: 0
                            }}>
                                القالب المختار: <strong style={{ color: '#06B6D4' }}>{getSelectedTemplateByType(currentTemplateType)?.name}</strong>
                            </p>
                        </div>

                        <div style={{
                            marginBottom: '24px',
                            padding: '16px',
                            background: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '8px',
                            border: '1px solid rgba(6, 182, 212, 0.3)'
                        }}>
                            <div style={{
                                fontSize: '12px',
                                color: '#94A3B8',
                                marginBottom: '8px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                رابط المشاركة:
                            </div>
                            <div style={{
                                fontSize: '13px',
                                color: '#06B6D4',
                                wordBreak: 'break-all',
                                fontFamily: 'monospace',
                                padding: '8px',
                                background: 'rgba(6, 182, 212, 0.1)',
                                borderRadius: '6px',
                                border: '1px solid rgba(6, 182, 212, 0.2)'
                            }}>
                                {getCurrentFormLink(currentTemplateType)}
                            </div>
                        </div>

                        <div style={{
                            display: 'flex',
                            gap: '12px'
                        }}>
                            <button
                                onClick={handleCopyLink}
                                style={{
                                    flex: 1,
                                    padding: '12px 24px',
                                    background: copiedLink
                                        ? 'linear-gradient(135deg, #10B981, #059669)'
                                        : 'linear-gradient(135deg, #3B82F6, #0EA5E9)',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: '#fff',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease'
                                }}
                                onMouseEnter={(e) => {
                                    if (!copiedLink) {
                                        e.currentTarget.style.transform = 'scale(1.02)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                }}
                            >
                                {copiedLink ? '✓ تم النسخ!' : 'نسخ الرابط'}
                            </button>
                            <button
                                onClick={handleCloseModal}
                                style={{
                                    padding: '12px 24px',
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                    borderRadius: '8px',
                                    color: '#fff',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                }}
                            >
                                إغلاق
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* CSS Animations */}
            <style>{`
                @keyframes fadeIn {
                    from {
                        opacity: 0;
                    }
                    to {
                        opacity: 1;
                    }
                }

                @keyframes modalFadeIn {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -48%);
                        scale: 0.95;
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%);
                        scale: 1;
                    }
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                @media (max-width: 768px) {
                    .new-interview-modal {
                        width: 92% !important;
                        max-width: 92% !important;
                        padding: 20px !important;
                        max-height: 90vh !important;
                    }
                }
                
                @media (max-width: 480px) {
                    .new-interview-modal {
                        width: 95% !important;
                        max-width: 95% !important;
                        padding: 16px !important;
                        max-height: 92vh !important;
                    }
                }

                .new-interview-modal::-webkit-scrollbar {
                    width: 8px;
                }

                .new-interview-modal::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 4px;
                }

                .new-interview-modal::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 4px;
                }

                .new-interview-modal::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.3);
                }
            `}</style>
        </>
    );
};

export default NewInterviewSidebar;

