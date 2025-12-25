import React, { createContext, useContext, useState, useEffect } from 'react';

const InterviewTemplateContext = createContext();

export const useInterviewTemplate = () => {
    const context = useContext(InterviewTemplateContext);
    if (!context) {
        throw new Error('useInterviewTemplate must be used within InterviewTemplateProvider');
    }
    return context;
};

export const InterviewTemplateProvider = ({ children }) => {
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [selectedVideoTemplate, setSelectedVideoTemplate] = useState(null);
    const [selectedAudioTemplate, setSelectedAudioTemplate] = useState(null);
    const [templates, setTemplates] = useState([
        // Process Templates
        {
            id: 'template-1',
            name: 'Standard Application Form',
            description: 'Basic application form with personal and professional information',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor', 'yearsOfExperience', 'coverLetter'],
            type: 'process',
            isDefault: true
        },
        {
            id: 'template-2',
            name: 'Comprehensive Application Form',
            description: 'Detailed form with all sections including skills, languages, and certifications',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor', 'yearsOfExperience', 'currentCompany', 'highestEducationLevel', 'skills', 'languages', 'certifications', 'coverLetter'],
            type: 'process',
            isDefault: false
        },
        {
            id: 'template-3',
            name: 'Quick Application Form',
            description: 'Minimal form with essential information only',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor', 'coverLetter'],
            type: 'process',
            isDefault: false
        },
        // Video Interview Templates
        {
            id: 'video-template-1',
            name: 'Standard Video Interview',
            description: 'Basic video interview template with essential questions',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor'],
            type: 'video',
            isDefault: true
        },
        {
            id: 'video-template-2',
            name: 'Technical Video Interview',
            description: 'Technical-focused video interview for technical positions',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor', 'yearsOfExperience', 'skills'],
            type: 'video',
            isDefault: false
        },
        {
            id: 'video-template-3',
            name: 'Behavioral Video Interview',
            description: 'Behavioral questions focused video interview',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor', 'coverLetter'],
            type: 'video',
            isDefault: false
        },
        // Audio Interview Templates
        {
            id: 'audio-template-1',
            name: 'Standard Audio Interview',
            description: 'Basic audio interview template with essential questions',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor'],
            type: 'audio',
            isDefault: true
        },
        {
            id: 'audio-template-2',
            name: 'Quick Audio Interview',
            description: 'Short audio interview for quick screening',
            fields: ['firstName', 'lastName', 'email', 'positionAppliedFor'],
            type: 'audio',
            isDefault: false
        },
        {
            id: 'audio-template-3',
            name: 'Detailed Audio Interview',
            description: 'Comprehensive audio interview with detailed questions',
            fields: ['firstName', 'lastName', 'email', 'phone', 'positionAppliedFor', 'yearsOfExperience', 'skills', 'coverLetter'],
            type: 'audio',
            isDefault: false
        }
    ]);

    // تحميل القوالب المختارة من localStorage عند التحميل
    useEffect(() => {
        const savedTemplate = localStorage.getItem('selectedInterviewTemplate');
        const savedVideoTemplate = localStorage.getItem('selectedVideoTemplate');
        const savedAudioTemplate = localStorage.getItem('selectedAudioTemplate');
        
        if (savedTemplate) {
            try {
                const parsed = JSON.parse(savedTemplate);
                setSelectedTemplate(parsed);
            } catch (error) {
                console.error('Error loading saved template:', error);
            }
        } else {
            const defaultTemplate = templates.find(t => t.type === 'process' && t.isDefault);
            if (defaultTemplate) {
                setSelectedTemplate(defaultTemplate);
            }
        }
        
        if (savedVideoTemplate) {
            try {
                const parsed = JSON.parse(savedVideoTemplate);
                setSelectedVideoTemplate(parsed);
            } catch (error) {
                console.error('Error loading saved video template:', error);
            }
        } else {
            const defaultVideoTemplate = templates.find(t => t.type === 'video' && t.isDefault);
            if (defaultVideoTemplate) {
                setSelectedVideoTemplate(defaultVideoTemplate);
            }
        }
        
        if (savedAudioTemplate) {
            try {
                const parsed = JSON.parse(savedAudioTemplate);
                setSelectedAudioTemplate(parsed);
            } catch (error) {
                console.error('Error loading saved audio template:', error);
            }
        } else {
            const defaultAudioTemplate = templates.find(t => t.type === 'audio' && t.isDefault);
            if (defaultAudioTemplate) {
                setSelectedAudioTemplate(defaultAudioTemplate);
            }
        }
    }, []);

    // حفظ القالب المختار في localStorage
    const selectTemplate = (template) => {
        if (template.type === 'video') {
            setSelectedVideoTemplate(template);
            localStorage.setItem('selectedVideoTemplate', JSON.stringify(template));
        } else if (template.type === 'audio') {
            setSelectedAudioTemplate(template);
            localStorage.setItem('selectedAudioTemplate', JSON.stringify(template));
        } else {
            setSelectedTemplate(template);
            localStorage.setItem('selectedInterviewTemplate', JSON.stringify(template));
        }
    };
    
    // الحصول على القالب المختار حسب النوع
    const getSelectedTemplateByType = (type) => {
        if (type === 'video') {
            return selectedVideoTemplate;
        } else if (type === 'audio') {
            return selectedAudioTemplate;
        }
        return selectedTemplate;
    };

    // إنشاء رابط مشاركة للاستمارة
    const generateFormLink = (templateId) => {
        const baseUrl = window.location.origin;
        return `${baseUrl}/form?template=${templateId}`;
    };

    // الحصول على رابط الاستمارة الحالية
    const getCurrentFormLink = (type = 'process') => {
        const template = getSelectedTemplateByType(type);
        if (template) {
            return generateFormLink(template.id);
        }
        return null;
    };

    const value = {
        templates,
        selectedTemplate,
        selectedVideoTemplate,
        selectedAudioTemplate,
        selectTemplate,
        generateFormLink,
        getCurrentFormLink,
        getSelectedTemplateByType,
        setTemplates
    };

    return (
        <InterviewTemplateContext.Provider value={value}>
            {children}
        </InterviewTemplateContext.Provider>
    );
};

