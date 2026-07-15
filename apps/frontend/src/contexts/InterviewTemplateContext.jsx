import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

const InterviewTemplateContext = createContext();

const SELECTED_TEMPLATE_STORAGE_KEY = 'evaalo_selected_form_template_v1';

export const DEFAULT_FORM_TEMPLATE = {
    id: 'template-remote',
    name: 'Standard',
    description:
        'Full professional profile: contact, experience, education, skills, and languages. Best for most roles.',
};

function readStoredSelectedTemplate() {
    if (typeof window === 'undefined') return DEFAULT_FORM_TEMPLATE;
    try {
        const raw = localStorage.getItem(SELECTED_TEMPLATE_STORAGE_KEY);
        if (!raw) return DEFAULT_FORM_TEMPLATE;
        const parsed = JSON.parse(raw);
        if (parsed?.id) return parsed;
    } catch {
        /* ignore */
    }
    return DEFAULT_FORM_TEMPLATE;
}

export const InterviewTemplateProvider = ({ children }) => {
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplateState] = useState(() => readStoredSelectedTemplate());
    const [selectedVideoTemplate, setSelectedVideoTemplate] = useState(null);
    const [selectedAudioTemplate, setSelectedAudioTemplate] = useState(null);

    useEffect(() => {
        if (!selectedTemplate?.id) return;
        try {
            localStorage.setItem(SELECTED_TEMPLATE_STORAGE_KEY, JSON.stringify(selectedTemplate));
        } catch {
            /* ignore quota / private mode */
        }
    }, [selectedTemplate]);

    const addTemplate = (template) => {
        setTemplates((prev) => [...prev, template]);
    };

    const updateTemplate = (id, updatedTemplate) => {
        setTemplates((prev) => prev.map((t) => (t.id === id ? updatedTemplate : t)));
    };

    const deleteTemplate = (id) => {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
    };

    const selectTemplate = (template) => {
        setSelectedTemplateState(template || DEFAULT_FORM_TEMPLATE);
    };

    const setSelectedTemplate = (template) => {
        setSelectedTemplateState(template || DEFAULT_FORM_TEMPLATE);
    };

    const getCurrentFormLink = useCallback(
        (type = 'process') => {
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
            let tid = selectedTemplate?.id || DEFAULT_FORM_TEMPLATE.id;
            if (type === 'audio' && selectedAudioTemplate?.id) {
                tid = selectedAudioTemplate.id;
            } else if (type === 'video' && selectedVideoTemplate?.id) {
                tid = selectedVideoTemplate.id;
            } else if (type === 'process') {
                tid = selectedTemplate?.id || DEFAULT_FORM_TEMPLATE.id;
            }
            return `${baseUrl}/form?template=${encodeURIComponent(tid)}`;
        },
        [selectedTemplate, selectedAudioTemplate, selectedVideoTemplate]
    );

    const getSelectedTemplateByType = useCallback(
        (type) => {
            if (type === 'audio') return selectedAudioTemplate || selectedTemplate;
            if (type === 'video') return selectedVideoTemplate || selectedTemplate;
            return selectedTemplate || DEFAULT_FORM_TEMPLATE;
        },
        [selectedAudioTemplate, selectedVideoTemplate, selectedTemplate]
    );

    const value = useMemo(
        () => ({
            templates,
            selectedTemplate,
            selectedVideoTemplate,
            selectedAudioTemplate,
            addTemplate,
            updateTemplate,
            deleteTemplate,
            selectTemplate,
            setTemplates,
            setSelectedTemplate,
            setSelectedVideoTemplate,
            setSelectedAudioTemplate,
            getCurrentFormLink,
            getSelectedTemplateByType,
        }),
        [
            templates,
            selectedTemplate,
            selectedVideoTemplate,
            selectedAudioTemplate,
            getCurrentFormLink,
            getSelectedTemplateByType,
        ]
    );

    return <InterviewTemplateContext.Provider value={value}>{children}</InterviewTemplateContext.Provider>;
};

export const useInterviewTemplate = () => {
    const context = useContext(InterviewTemplateContext);
    if (!context) {
        throw new Error('useInterviewTemplate must be used within InterviewTemplateProvider');
    }
    return context;
};
