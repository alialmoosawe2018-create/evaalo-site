// Utility functions for Design page

export const getTypeLabel = (type) => {
    const labels = {
        'short-text': 'Short Answer',
        'long-text': 'Paragraph',
        'multiple': 'Multiple Choice',
        'checkbox': 'Checkboxes',
        'dropdown': 'Dropdown',
        'yes-no': 'Yes/No',
        'rating': 'Rating Scale',
        'linear-scale': 'Linear Scale',
        'date': 'Date',
        'time': 'Time',
        'email': 'Email',
        'phone': 'Phone Number',
        'number': 'Number',
        'url': 'Website URL',
        'file': 'File Upload',
        'voice': 'Voice Recording',
        'video': 'Video Recording',
        'matrix': 'Matrix/Grid',
        'slider': 'Slider',
        'contact-info': 'Contact Info',
        'address': 'Address',
        'picture-choice': 'Picture Choice',
        'legal': 'Legal',
        'clarify-ai': 'Clarify with AI',
        'faq-ai': 'FAQ with AI',
        'hubspot': 'HubSpot',
        'salesforce': 'Salesforce',
        'browse-apps': 'Browse all apps',
        'stripe': 'Stripe',
        'google-drive': 'Google Drive',
        'calendly': 'Calendly',
        'nps': 'Net Promoter Score',
        'opinion-scale': 'Opinion Scale',
        'welcome-screen': 'Welcome Screen',
        'partial-submit': 'Partial Submit Point',
        'statement': 'Statement',
        'question-group': 'Question Group',
        'end-screen': 'End Screen',
        'redirect': 'Redirect to URL'
    };
    return labels[type] || type;
};

export const calculateEstimatedTime = (questions) => {
    return questions.reduce((total, q) => total + (q.timeLimit || 0), 0);
};

export const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) return `${minutes} min`;
    return `${minutes} min ${remainingSeconds} sec`;
};

// Load Google Font dynamically
export const loadGoogleFont = (fontUrl) => {
    if (!fontUrl) return;
    const existingLink = document.querySelector(`link[href="${fontUrl}"]`);
    if (!existingLink) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = fontUrl;
        document.head.appendChild(link);
    }
};

// Apply Color Theme - Apply to the ENTIRE form/question form completely (but NOT question items)
export const applyColorTheme = (primary, dark, name) => {
    // Check if DOM is ready
    if (typeof document === 'undefined') return;
    
    // If "None" is selected, remove custom theme and restore default
    if (name === 'none' || primary === '' || !primary) {
        const designMain = document.querySelector('.design-main');
        const questionsContainer = document.getElementById('questionsContainer');
        
        // Remove inline styles to restore CSS defaults
        if (questionsContainer) {
            questionsContainer.style.background = '';
            questionsContainer.style.borderColor = '';
            questionsContainer.style.boxShadow = '';
        }
        
        if (designMain) {
            designMain.style.background = '';
            designMain.style.borderColor = '';
            designMain.style.boxShadow = '';
        }
        
        // Remove dynamic theme style
        const style = document.getElementById('dynamic-theme-style');
        if (style) {
            style.remove();
        }
        
        const questionsSubtitle = questionsContainer?.querySelector('.questions-subtitle');
        if (questionsSubtitle) {
            questionsSubtitle.style.color = '';
        }
        
        return;
    }
    
    const designMain = document.querySelector('.design-main');
    const questionsContainer = document.getElementById('questionsContainer');
    
    // If container doesn't exist yet, return
    if (!questionsContainer) return;
    
    // Check if color is white - use true white
    const isWhite = primary === '#FFFFFF' || primary === '#ffffff';
    const isLightColor = primary === '#FFFFFF' || primary === '#E5E7EB' || primary === '#F8FAFC';
    
    // Apply to the entire questions container (the form) - but NOT the question items inside
    if (questionsContainer) {
        if (isWhite) {
            questionsContainer.style.background = '#FFFFFF';
            questionsContainer.style.borderColor = '#E5E7EB';
            questionsContainer.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.1)';
        } else if (isLightColor) {
            questionsContainer.style.background = `linear-gradient(135deg, ${primary} 0%, ${dark} 100%)`;
            questionsContainer.style.borderColor = dark;
            questionsContainer.style.boxShadow = `0 8px 32px ${primary}30`;
        } else {
            questionsContainer.style.background = `linear-gradient(135deg, ${primary}50 0%, ${dark}40 100%)`;
            questionsContainer.style.borderColor = `${primary}90`;
            questionsContainer.style.boxShadow = `0 8px 32px ${primary}50`;
        }
        
        // Update questions subtitle
        const questionsSubtitle = questionsContainer.querySelector('.questions-subtitle');
        if (questionsSubtitle) {
            if (isWhite) {
                questionsSubtitle.style.color = '#64748B';
            } else {
                questionsSubtitle.style.color = `${primary}CC`;
            }
        }
    }
    
    // Update form editor area if it exists
    if (designMain) {
        if (isWhite) {
            designMain.style.background = '#FFFFFF';
            designMain.style.borderColor = '#E5E7EB';
            designMain.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.1)';
        } else if (isLightColor) {
            designMain.style.background = `linear-gradient(135deg, ${primary} 0%, ${dark} 100%)`;
            designMain.style.borderColor = dark;
            designMain.style.boxShadow = `0 8px 32px ${primary}30`;
        } else {
            designMain.style.background = `linear-gradient(135deg, ${primary}50 0%, ${dark}40 100%)`;
            designMain.style.borderColor = `${primary}90`;
            designMain.style.boxShadow = `0 8px 32px ${primary}50`;
        }
    }
    
    // Update question badges and form elements - DO NOT affect .question-item (those are handled by question color)
    const style = document.getElementById('dynamic-theme-style') || document.createElement('style');
    style.id = 'dynamic-theme-style';
    style.textContent = `
        .question-badge {
            background: linear-gradient(135deg, ${primary} 0%, ${dark} 100%) !important;
        }
        .question-type-label {
            background: ${primary}33 !important;
            border-color: ${primary}4D !important;
            color: ${primary} !important;
        }
        .question-card {
            background: ${primary}05 !important;
            border-color: ${primary}1A !important;
        }
        .question-card:hover {
            border-color: ${primary}80 !important;
            box-shadow: 0 8px 24px ${primary}33 !important;
        }
        .toolbar-btn {
            background: ${primary}1A !important;
            border-color: ${primary}4D !important;
        }
        .toolbar-btn:hover {
            background: ${primary}33 !important;
            border-color: ${primary} !important;
            box-shadow: 0 4px 12px ${primary}33 !important;
        }
        .toolbar-btn svg {
            color: ${primary} !important;
        }
        .stat-value {
            color: ${primary} !important;
        }
        .editor-toolbar {
            border-bottom-color: ${primary}1A !important;
        }
        .empty-questions-state {
            color: ${isWhite ? '#64748B' : `${primary}80`} !important;
        }
        .empty-message {
            color: ${isWhite ? '#1E293B' : `${primary}CC`} !important;
        }
        .empty-hint {
            color: ${isWhite ? '#94A3B8' : `${primary}99`} !important;
        }
        #questionsList .question-item {
            /* Reset any form theme styles - question color will override */
        }
        #questionsList .question-item .question-item-actions {
            background: transparent !important;
        }
        #questionsList .question-item .question-item-btn,
        #questionsList .question-item .edit-question,
        #questionsList .question-item .copy-question,
        #questionsList .question-item .delete-question {
            background: rgba(15, 23, 42, 0.8) !important;
            backdrop-filter: blur(10px) !important;
            -webkit-backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(34, 211, 238, 0.3) !important;
            color: rgba(255, 255, 255, 0.95) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(34, 211, 238, 0) !important;
        }
        #questionsList .question-item .question-item-btn:hover,
        #questionsList .question-item .edit-question:hover,
        #questionsList .question-item .copy-question:hover,
        #questionsList .question-item .delete-question:hover {
            background: rgba(15, 23, 42, 0.95) !important;
            border-color: rgba(34, 211, 238, 0.6) !important;
            color: #ffffff !important;
            transform: translateY(-2px) !important;
            box-shadow: 0 4px 16px rgba(34, 211, 238, 0.3), 0 0 20px rgba(34, 211, 238, 0.2) !important;
        }
        #questionsList .question-item .question-item-btn svg,
        #questionsList .question-item .edit-question svg,
        #questionsList .question-item .copy-question svg {
            color: rgba(34, 211, 238, 0.9) !important;
            filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.3)) !important;
        }
        #questionsList .question-item .question-item-btn:hover svg,
        #questionsList .question-item .edit-question:hover svg,
        #questionsList .question-item .copy-question:hover svg {
            color: rgba(34, 211, 238, 1) !important;
            filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.6)) !important;
            transform: scale(1.1) !important;
        }
        #questionsList .question-item .delete-question svg {
            color: rgba(239, 68, 68, 0.9) !important;
            filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.3)) !important;
        }
        #questionsList .question-item .delete-question:hover svg {
            color: rgba(239, 68, 68, 1) !important;
            filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6)) !important;
            transform: scale(1.1) !important;
        }
    `;
    if (!document.getElementById('dynamic-theme-style')) {
        document.head.appendChild(style);
    }
};

// Apply Question Color - Only to question boxes (not the entire form)
export const applyBackgroundColor = (primary, dark, name) => {
    // Check if DOM is ready
    if (typeof document === 'undefined') return;
    
    // If "None" is selected, remove custom color and restore default
    if (name === 'none' || primary === '' || !primary) {
        const style = document.getElementById('dynamic-question-color-style');
        if (style) {
            style.remove();
        }
        return;
    }
    
    // Check if container exists
    const questionsContainer = document.getElementById('questionsContainer');
    if (!questionsContainer) return;
    
    // Check if color is white - use true white
    const isWhite = primary === '#FFFFFF' || primary === '#ffffff';
    const isLightColor = primary === '#FFFFFF' || primary === '#E5E7EB' || primary === '#F8FAFC';
    
    // For white/light colors, use true colors with proper contrast
    let questionBg, questionBorder, questionHoverBg, questionHoverBorder, questionTypeBg, questionTypeBorder, questionTypeColor;
    
    if (isWhite) {
        questionBg = '#FFFFFF';
        questionBorder = '#E5E7EB';
        questionHoverBg = '#F8FAFC';
        questionHoverBorder = '#CBD5E1';
        questionTypeBg = '#F1F5F9';
        questionTypeBorder = '#CBD5E1';
        questionTypeColor = '#1E293B';
    } else if (isLightColor) {
        questionBg = primary;
        questionBorder = dark;
        questionHoverBg = primary;
        questionHoverBorder = dark;
        questionTypeBg = `${primary}E6`;
        questionTypeBorder = dark;
        questionTypeColor = dark;
    } else {
        // For dark colors, use stronger opacity for better visibility
        questionBg = `linear-gradient(135deg, ${primary}50 0%, ${dark}40 100%)`;
        questionBorder = `${primary}90`;
        questionHoverBg = `linear-gradient(135deg, ${primary}60 0%, ${dark}50 100%)`;
        questionHoverBorder = `${primary}`;
        questionTypeBg = `${primary}50`;
        questionTypeBorder = `${primary}80`;
        questionTypeColor = primary;
    }
    
    // Apply color ONLY to question items (the boxes), NOT the container or form
    const style = document.getElementById('dynamic-question-color-style') || document.createElement('style');
    style.id = 'dynamic-question-color-style';
    style.textContent = `
        #questionsContainer #questionsList .question-item {
            background: ${questionBg} !important;
            border-color: ${questionBorder} !important;
        }
        #questionsContainer #questionsList .question-item:hover {
            background: ${questionHoverBg} !important;
            border-color: ${questionHoverBorder} !important;
            box-shadow: 0 4px 12px ${isWhite ? 'rgba(0, 0, 0, 0.1)' : `${primary}40`} !important;
        }
        #questionsContainer #questionsList .question-item .question-item-type {
            background: ${questionTypeBg} !important;
            border-color: ${questionTypeBorder} !important;
            color: ${questionTypeColor} !important;
        }
        #questionsContainer #questionsList .question-item .question-item-actions {
            background: transparent !important;
        }
        #questionsContainer #questionsList .question-item .question-item-btn,
        #questionsContainer #questionsList .question-item .edit-question,
        #questionsContainer #questionsList .question-item .copy-question,
        #questionsContainer #questionsList .question-item .delete-question {
            background: rgba(15, 23, 42, 0.8) !important;
            backdrop-filter: blur(10px) !important;
            -webkit-backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(34, 211, 238, 0.3) !important;
            color: rgba(255, 255, 255, 0.95) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(34, 211, 238, 0) !important;
        }
        #questionsContainer #questionsList .question-item .question-item-btn:hover,
        #questionsContainer #questionsList .question-item .edit-question:hover,
        #questionsList .question-item .copy-question:hover,
        #questionsList .question-item .delete-question:hover {
            background: rgba(15, 23, 42, 0.95) !important;
            border-color: rgba(34, 211, 238, 0.6) !important;
            color: #ffffff !important;
            transform: translateY(-2px) !important;
            box-shadow: 0 4px 16px rgba(34, 211, 238, 0.3), 0 0 20px rgba(34, 211, 238, 0.2) !important;
        }
        #questionsContainer #questionsList .question-item .question-item-btn svg,
        #questionsContainer #questionsList .question-item .edit-question svg,
        #questionsContainer #questionsList .question-item .copy-question svg {
            color: rgba(34, 211, 238, 0.9) !important;
            filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.3)) !important;
        }
        #questionsContainer #questionsList .question-item .question-item-btn:hover svg,
        #questionsContainer #questionsList .question-item .edit-question:hover svg,
        #questionsContainer #questionsList .question-item .copy-question:hover svg {
            color: rgba(34, 211, 238, 1) !important;
            filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.6)) !important;
            transform: scale(1.1) !important;
        }
        #questionsContainer #questionsList .question-item .delete-question svg {
            color: rgba(239, 68, 68, 0.9) !important;
            filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.3)) !important;
        }
        #questionsContainer #questionsList .question-item .delete-question:hover svg {
            color: rgba(239, 68, 68, 1) !important;
            filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6)) !important;
            transform: scale(1.1) !important;
        }
    `;
    if (!document.getElementById('dynamic-question-color-style')) {
        document.head.appendChild(style);
    } else {
        const existingStyle = document.getElementById('dynamic-question-color-style');
        if (existingStyle) {
            existingStyle.textContent = style.textContent;
        }
    }
};

// Apply Font Family
export const applyFontFamily = (fontFamily, fontName) => {
    // Check if DOM is ready
    if (typeof document === 'undefined') return;
    
    // If "None" is selected, remove custom font and restore default
    if (fontName === 'None' || fontFamily === 'None') {
        const questionsContainer = document.getElementById('questionsContainer');
        const designMain = document.querySelector('.design-main');
        
        // Remove inline styles
        if (questionsContainer) {
            questionsContainer.style.fontFamily = '';
        }
        if (designMain) {
            designMain.style.fontFamily = '';
        }
        
        // Remove dynamic font style
        const style = document.getElementById('dynamic-font-style');
        if (style) {
            style.remove();
        }
        
        // Remove Google Fonts link if exists
        const fontLink = document.querySelector('link[data-font-link]');
        if (fontLink) {
            fontLink.remove();
        }
        
        return;
    }
    
    const questionsContainer = document.getElementById('questionsContainer');
    const designMain = document.querySelector('.design-main');
    
    // Apply font to form container
    if (questionsContainer) {
        questionsContainer.style.fontFamily = fontFamily;
    }
    
    if (designMain) {
        designMain.style.fontFamily = fontFamily;
    }
    
    // Apply font to all form elements via CSS
    const style = document.getElementById('dynamic-font-style') || document.createElement('style');
    style.id = 'dynamic-font-style';
    style.textContent = `
        #questionsContainer,
        #questionsContainer *,
        .questions-title,
        .questions-subtitle,
        .question-item,
        .question-item *,
        .design-main,
        .design-main * {
            font-family: ${fontFamily} !important;
        }
    `;
    if (!document.getElementById('dynamic-font-style')) {
        document.head.appendChild(style);
    }
};

// Apply Text Color
export const applyTextColor = (hex, name) => {
    // Check if DOM is ready
    if (typeof document === 'undefined') return;
    
    // If "None" is selected, remove custom color and restore default
    if (name === 'none' || hex === '' || !hex) {
        const style = document.getElementById('dynamic-text-color-style');
        if (style) {
            style.remove();
        }
        return;
    }
    
    // Check if title exists
    const questionsTitle = document.querySelector('.questions-title');
    if (!questionsTitle) return;
    
    // Apply text color to questions title and subtitle
    const style = document.getElementById('dynamic-text-color-style') || document.createElement('style');
    style.id = 'dynamic-text-color-style';
    style.textContent = `
        .questions-title {
            color: ${hex} !important;
        }
        .questions-subtitle {
            color: ${hex}CC !important;
        }
    `;
    if (!document.getElementById('dynamic-text-color-style')) {
        document.head.appendChild(style);
    }
};

