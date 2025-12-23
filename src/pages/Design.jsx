import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDesign } from '../contexts/DesignContext';
import { getTypeLabel, calculateEstimatedTime, formatTime, applyColorTheme, applyBackgroundColor, applyFontFamily, applyTextColor, loadGoogleFont } from '../utils/designUtils';
import { formColorOptions, textColorOptions } from '../utils/colorOptions';
import { fontOptions } from '../utils/fontOptions';
import '../design-styles.css';

const Design = () => {
    const navigate = useNavigate();
    const {
        questions,
        setQuestions,
        editingQuestionIndex,
        currentQuestionType,
        setCurrentQuestionType,
        showQuestionModal,
        setShowQuestionModal,
        showPreviewModal,
        setShowPreviewModal,
        showShareModal,
        setShowShareModal,
        toast,
        sidebarOpen,
        setSidebarOpen,
        settings,
        setSettings,
        addQuestion,
        editQuestion,
        updateQuestion,
        deleteQuestion,
        copyQuestion,
        clearAllQuestions,
        updateStats,
        showToast
    } = useDesign();

    const [questionsTitle, setQuestionsTitle] = useState('Interview Questions');
    const [colorDropdownOpen, setColorDropdownOpen] = useState(false);
    const [backgroundColorDropdownOpen, setBackgroundColorDropdownOpen] = useState(false);
    const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
    const [textColorDropdownOpen, setTextColorDropdownOpen] = useState(false);
    const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
    const [selectedFormColor, setSelectedFormColor] = useState('none');
    const [selectedBackgroundColor, setSelectedBackgroundColor] = useState('none');
    const [selectedFont, setSelectedFont] = useState('None');
    const [selectedTextColor, setSelectedTextColor] = useState('none');
    const [questionFormData, setQuestionFormData] = useState({});
    const [options, setOptions] = useState([]);
    const [shareLink, setShareLink] = useState('');

    const questionsListRef = useRef(null);
    const questionsTitleRef = useRef(null);

    // Load saved title and settings
    useEffect(() => {
        // Wait for DOM to be ready
        const timer = setTimeout(() => {
            const savedTitle = localStorage.getItem('questionsTitle');
            if (savedTitle) {
                setQuestionsTitle(savedTitle);
            }
            
            // Load saved form color theme
            const savedFormColor = localStorage.getItem('formColorTheme') || 'none';
            setSelectedFormColor(savedFormColor);
            const formColorOption = formColorOptions.find(opt => opt.color === savedFormColor);
            if (formColorOption && savedFormColor !== 'none') {
                // Check if DOM is ready
                if (document.getElementById('questionsContainer')) {
                    applyColorTheme(formColorOption.primary, formColorOption.dark, savedFormColor);
                }
            }
            
            // Load saved question color
            const savedQuestionColor = localStorage.getItem('questionColorTheme') || 'none';
            setSelectedBackgroundColor(savedQuestionColor);
            const questionColorOption = formColorOptions.find(opt => opt.color === savedQuestionColor);
            if (questionColorOption && savedQuestionColor !== 'none') {
                if (document.getElementById('questionsContainer')) {
                    applyBackgroundColor(questionColorOption.primary, questionColorOption.dark, savedQuestionColor);
                }
            }
            
            // Load saved font
            const savedFont = localStorage.getItem('formFontFamily') || 'None';
            setSelectedFont(savedFont);
            const fontOption = fontOptions.find(opt => opt.font === savedFont);
            if (fontOption && savedFont !== 'None') {
                const savedFontFamily = localStorage.getItem('formFontFamilyValue') || fontOption.fontFamily;
                const savedFontUrl = localStorage.getItem('formFontUrl') || fontOption.fontUrl;
                if (savedFontUrl) {
                    loadGoogleFont(savedFontUrl);
                }
                if (document.getElementById('questionsContainer')) {
                    applyFontFamily(savedFontFamily, savedFont);
                }
            }
            
            // Load saved text color
            const savedTextColor = localStorage.getItem('formTextColor') || 'none';
            setSelectedTextColor(savedTextColor);
            const textColorOption = textColorOptions.find(opt => opt.color === savedTextColor);
            if (textColorOption && savedTextColor !== 'none') {
                if (document.querySelector('.questions-title')) {
                    applyTextColor(textColorOption.hex, savedTextColor);
                }
            }
        }, 100);
        
        return () => clearTimeout(timer);
    }, []);
    
    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (!e.target.closest('.custom-color-dropdown') && !e.target.closest('.custom-font-dropdown')) {
                setColorDropdownOpen(false);
                setBackgroundColorDropdownOpen(false);
                setFontDropdownOpen(false);
                setTextColorDropdownOpen(false);
                setCategoryDropdownOpen(false);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);
    
    // Handle form color selection
    const handleFormColorSelect = useCallback((colorOption) => {
        setSelectedFormColor(colorOption.color);
        setColorDropdownOpen(false);
        applyColorTheme(colorOption.primary, colorOption.dark, colorOption.color);
        
        if (colorOption.color === 'none') {
            localStorage.removeItem('formColorTheme');
        } else {
            localStorage.setItem('formColorTheme', colorOption.color);
        }
        
        showToast(`Form color changed to ${colorOption.label.replace(' (Default)', '')}!`);
    }, [showToast]);
    
    // Handle question color selection
    const handleQuestionColorSelect = useCallback((colorOption) => {
        setSelectedBackgroundColor(colorOption.color);
        setBackgroundColorDropdownOpen(false);
        applyBackgroundColor(colorOption.primary, colorOption.dark, colorOption.color);
        
        if (colorOption.color === 'none') {
            localStorage.removeItem('questionColorTheme');
        } else {
            localStorage.setItem('questionColorTheme', colorOption.color);
        }
        
        showToast(`Question color changed to ${colorOption.label.replace(' (Default)', '')}!`);
    }, [showToast]);
    
    // Handle font selection
    const handleFontSelect = useCallback((fontOption) => {
        setSelectedFont(fontOption.font);
        setFontDropdownOpen(false);
        
        if (fontOption.fontUrl && fontOption.font !== 'None') {
            loadGoogleFont(fontOption.fontUrl);
        }
        
        applyFontFamily(fontOption.fontFamily, fontOption.font);
        
        if (fontOption.font === 'None') {
            localStorage.removeItem('formFontFamily');
            localStorage.removeItem('formFontFamilyValue');
            localStorage.removeItem('formFontUrl');
        } else {
            localStorage.setItem('formFontFamily', fontOption.font);
            localStorage.setItem('formFontFamilyValue', fontOption.fontFamily);
            localStorage.setItem('formFontUrl', fontOption.fontUrl || '');
        }
        
        showToast(`Font changed to ${fontOption.font}!`);
    }, [showToast]);
    
    // Handle text color selection
    const handleTextColorSelect = useCallback((textColorOption) => {
        setSelectedTextColor(textColorOption.color);
        setTextColorDropdownOpen(false);
        applyTextColor(textColorOption.hex, textColorOption.color);
        
        if (textColorOption.color === 'none') {
            localStorage.removeItem('formTextColor');
        } else {
            localStorage.setItem('formTextColor', textColorOption.color);
            localStorage.setItem('formTextColorHex', textColorOption.hex);
        }
        
        showToast(`Text color changed to ${textColorOption.label.replace(' (Default)', '')}!`);
    }, [showToast]);

    // Save title
    const handleTitleBlur = useCallback((e) => {
        const titleText = e.target.textContent.trim();
        if (titleText) {
            setQuestionsTitle(titleText);
            localStorage.setItem('questionsTitle', titleText);
        } else {
            const placeholder = e.target.dataset.placeholder || 'Interview Questions';
            e.target.textContent = placeholder;
            setQuestionsTitle(placeholder);
            localStorage.setItem('questionsTitle', placeholder);
        }
    }, []);

    const handleTitleKeyDown = useCallback((e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    }, []);

    const handleTitlePaste = useCallback((e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const plainText = text.replace(/\n/g, ' ').trim();
        document.execCommand('insertText', false, plainText);
    }, []);

    // Stats calculation
    const stats = updateStats();
    const estimatedTimeFormatted = formatTime(stats.estimatedTime);

    // Open question modal
    const handleOpenQuestionModal = useCallback((type) => {
        setCurrentQuestionType(type);
        setShowQuestionModal(true);
        setQuestionFormData({});
        setOptions([]);
    }, [setCurrentQuestionType, setShowQuestionModal]);

    // Save question
    const handleSaveQuestion = useCallback(() => {
        const questionData = {
            type: currentQuestionType,
            text: questionFormData.text || '',
            timeLimit: parseInt(questionFormData.timeLimit) || 0,
            points: parseInt(questionFormData.points) || 10,
            required: questionFormData.required || false,
            ...questionFormData
        };

        if (currentQuestionType === 'multiple' || currentQuestionType === 'checkbox' || currentQuestionType === 'dropdown') {
            questionData.options = options;
        }

        if (editingQuestionIndex !== null) {
            updateQuestion(editingQuestionIndex, { ...questions[editingQuestionIndex], ...questionData });
        } else {
            addQuestion(questionData);
        }
        
        setShowQuestionModal(false);
        setQuestionFormData({});
        setOptions([]);
    }, [currentQuestionType, questionFormData, options, editingQuestionIndex, questions, addQuestion, updateQuestion, setShowQuestionModal]);

    // Add option for multiple choice
    const handleAddOption = useCallback(() => {
        const optionText = questionFormData.optionInput?.trim();
        if (optionText) {
            setOptions(prev => [...prev, { text: optionText, correct: false }]);
            setQuestionFormData(prev => ({ ...prev, optionInput: '' }));
        }
    }, [questionFormData.optionInput]);

    // Delete option
    const handleDeleteOption = useCallback((index) => {
        setOptions(prev => prev.filter((_, i) => i !== index));
    }, []);

    // Toggle correct option
    const handleToggleCorrect = useCallback((index) => {
        setOptions(prev => prev.map((opt, i) => i === index ? { ...opt, correct: !opt.correct } : opt));
    }, []);

    // Preview
    const handlePreview = useCallback(() => {
        if (questions.length === 0) {
            alert('Add at least one question to preview');
            return;
        }
        setShowPreviewModal(true);
    }, [questions, setShowPreviewModal]);

    // Share
    const handleShare = useCallback(() => {
        if (questions.length === 0) {
            alert('Add at least one question before sharing');
            return;
        }
        
        const interviewData = {
            title: settings.title || 'Untitled Interview',
            questions: questions,
            settings: settings,
            createdAt: new Date().toISOString()
        };

        const formId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36).substring(2, 8);
        const currentUrl = window.location.origin + window.location.pathname.replace('/design', '');
        const shareUrl = `${currentUrl}/form-preview?id=${formId}`;
        
        setShareLink(shareUrl);
        setShowShareModal(true);
    }, [questions, settings, setShowShareModal]);

    // Copy share link
    const handleCopyShareLink = useCallback(() => {
        navigator.clipboard.writeText(shareLink);
        showToast('Link copied to clipboard!');
    }, [shareLink, showToast]);

    // Save interview
    const handleSaveInterview = useCallback(() => {
        if (questions.length === 0) {
            alert('Add at least one question before saving');
            return;
        }
        showToast('Interview saved successfully!');
    }, [questions, showToast]);

    // Render question item
    const renderQuestionItem = useCallback((question, index) => {
        const typeLabel = getTypeLabel(question.type);
        const timeInfo = question.timeLimit ? `${question.timeLimit}s` : 'No limit';
        const pointsInfo = question.points ? `${question.points} pts` : '';

        return (
            <div key={question.id || index} className="question-item" data-index={index} data-question-id={question.id}>
                <div className="question-item-header">
                    <div>
                        <div className="question-item-title">{question.text}</div>
                        <div className="question-item-type">{typeLabel}</div>
                    </div>
                    <div className="question-item-actions">
                        <button className="question-item-btn edit-question" onClick={() => editQuestion(index)} aria-label="Edit question">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M11.333 2.667a2.667 2.667 0 0 1 3.774 3.774L5.333 15.333H2v-3.333l9.333-9.333Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </button>
                        <button className="question-item-btn copy-question" onClick={() => copyQuestion(index)} aria-label="Duplicate question">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10.667 10.667h2.666a1.333 1.333 0 0 0 1.334-1.334V2.667a1.333 1.333 0 0 0-1.334-1.334H6.667A1.333 1.333 0 0 0 5.333 2.667v2.666M10.667 5.333H3.333a1.333 1.333 0 0 0-1.333 1.334v6.666a1.333 1.333 0 0 0 1.333 1.334h7.334a1.333 1.333 0 0 0 1.333-1.334V6.667a1.333 1.333 0 0 0-1.333-1.334Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </button>
                        <button className="question-item-btn delete-question" onClick={() => deleteQuestion(index)} aria-label="Delete question">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2 4h12M6 4V2.667a1.333 1.333 0 0 1 1.333-1.334h1.334A1.333 1.333 0 0 1 10.667 2.667V4m2 0v9.333a1.333 1.333 0 0 1-1.333 1.334H5.333A1.333 1.333 0 0 1 4 13.333V4h8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="question-item-meta">
                    <span className="question-meta-item">{timeInfo}</span>
                    {pointsInfo && <span className="question-meta-item">{pointsInfo}</span>}
                    {question.options && <span className="question-meta-item">{question.options.length} options</span>}
                </div>
            </div>
        );
    }, [editQuestion, copyQuestion, deleteQuestion]);

    // Question types data
    const questionTypes = {
        text: [
            { type: 'short-text', label: 'Short Answer', icon: 'M4 7h16M4 12h10' },
            { type: 'long-text', label: 'Paragraph', icon: 'M4 7h16M4 12h16M4 17h12' }
        ],
        choice: [
            { type: 'multiple', label: 'Multiple Choice', icon: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM14 8h6M14 16h6' },
            { type: 'checkbox', label: 'Checkboxes', icon: 'M3 5h6v6H3zM3 13h6v6H3zM5 8l1 1 2-2M5 16l1 1 2-2M14 8h6M14 16h6' },
            { type: 'dropdown', label: 'Dropdown', icon: 'M4 8h16v3H4zM8 14l4 4 4-4' },
            { type: 'yes-no', label: 'Yes/No', icon: 'M9 12l2 2 4-4m6 2c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z' }
        ],
        scale: [
            { type: 'rating', label: 'Rating Scale', icon: 'M12 2l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 9l6-1 3-6z' },
            { type: 'linear-scale', label: 'Linear Scale', icon: 'M6 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 12h16' }
        ],
        dateTime: [
            { type: 'date', label: 'Date', icon: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18' },
            { type: 'time', label: 'Time', icon: 'M12 12a9 9 0 1 0 0 0 9 9 0 0 0 0 0zM12 6v6l4 2' }
        ],
        input: [
            { type: 'email', label: 'Email', icon: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z' },
            { type: 'phone', label: 'Phone Number', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z' },
            { type: 'number', label: 'Number', icon: 'M4 9h16M9 4v16M7 7h10v10H7z' },
            { type: 'url', label: 'Website URL', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }
        ],
        media: [
            { type: 'file', label: 'File Upload', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12' },
            { type: 'voice', label: 'Voice Recording', icon: 'M10 5h4v10h-4zM7 13v1a5 5 0 0 0 10 0v-1M12 19v3' },
            { type: 'video', label: 'Video Recording', icon: 'M2 6h14v12H2zM16 10l6-4v12l-6-4z', comingSoon: true }
        ]
    };

    return (
        <div className="design-page">
            <div className="design-background">
                <div className="gradient-orb design-orb-1"></div>
                <div className="gradient-orb design-orb-2"></div>
                <div className="gradient-orb design-orb-3"></div>
            </div>

            <div className="design-container">
                {/* Header */}
                <div className="design-header">
                    <div className="header-content">
                        <h1 className="design-title">Interview Designer</h1>
                        <p className="design-subtitle">Create and customize your AI-powered interview</p>
                    </div>
                    <div className="header-actions">
                        <button className="btn btn-secondary" onClick={() => showToast('Model settings coming soon!')}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 2.5L12.5 7.5L17.5 8.75L14.5 12.5L15.5 17.5L10 15L4.5 17.5L5.5 12.5L2.5 8.75L7.5 7.5L10 2.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
                            </svg>
                            <span className="btn-text">Model</span>
                        </button>
                        <button className="btn btn-secondary" onClick={() => navigate('/workflow')}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="3" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
                                <rect x="12" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
                                <rect x="3" y="12" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
                                <rect x="12" y="12" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
                                <path d="M8 5.5H12M8 14.5H12M5.5 8V12M14.5 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                            <span className="btn-text">Workflow</span>
                        </button>
                        <button className="btn btn-secondary" onClick={() => showToast('Connect integrations coming soon!')}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 13.3333C11.8409 13.3333 13.3333 11.8409 13.3333 10C13.3333 8.15905 11.8409 6.66667 10 6.66667C8.15905 6.66667 6.66667 8.15905 6.66667 10C6.66667 11.8409 8.15905 13.3333 10 13.3333Z" stroke="currentColor" strokeWidth="2"/>
                                <path d="M3.33333 10C3.33333 10 5.83333 7.5 10 7.5C14.1667 7.5 16.6667 10 16.6667 10C16.6667 10 14.1667 12.5 10 12.5C5.83333 12.5 3.33333 10 3.33333 10Z" stroke="currentColor" strokeWidth="2"/>
                                <path d="M10 2.5V5.83333M10 14.1667V17.5M17.5 10H14.1667M5.83333 10H2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                            <span className="btn-text">Connect</span>
                        </button>
                        <button className="btn btn-secondary" onClick={handlePreview}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 3.33334C5.83337 3.33334 2.27504 5.73334 0.833374 9.16668C2.27504 12.6 5.83337 15 10 15C14.1667 15 17.725 12.6 19.1667 9.16668C17.725 5.73334 14.1667 3.33334 10 3.33334Z" stroke="currentColor" strokeWidth="2"/>
                                <circle cx="10" cy="9.16668" r="2.5" stroke="currentColor" strokeWidth="2"/>
                            </svg>
                            <span className="btn-text">Preview</span>
                        </button>
                        <button className="btn btn-share" onClick={handleShare}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M15 6.66667C16.3807 6.66667 17.5 5.54738 17.5 4.16667C17.5 2.78595 16.3807 1.66667 15 1.66667C13.6193 1.66667 12.5 2.78595 12.5 4.16667C12.5 5.54738 13.6193 6.66667 15 6.66667Z" stroke="currentColor" strokeWidth="2"/>
                                <path d="M5 12.5C6.38071 12.5 7.5 11.3807 7.5 10C7.5 8.61929 6.38071 7.5 5 7.5C3.61929 7.5 2.5 8.61929 2.5 10C2.5 11.3807 3.61929 12.5 5 12.5Z" stroke="currentColor" strokeWidth="2"/>
                                <path d="M15 18.3333C16.3807 18.3333 17.5 17.214 17.5 15.8333C17.5 14.4526 16.3807 13.3333 15 13.3333C13.6193 13.3333 12.5 14.4526 12.5 15.8333C12.5 17.214 13.6193 18.3333 15 18.3333Z" stroke="currentColor" strokeWidth="2"/>
                                <path d="M7.15833 11.175L12.85 14.6583M12.8417 5.34167L7.15833 8.825" stroke="currentColor" strokeWidth="2"/>
                            </svg>
                            <span className="btn-text">Share</span>
                        </button>
                        <button className="btn btn-primary" onClick={handleSaveInterview}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M15.8333 17.5H4.16667C3.25 17.5 2.5 16.75 2.5 15.8333V4.16667C2.5 3.25 3.25 2.5 4.16667 2.5H13.3333L17.5 6.66667V15.8333C17.5 16.75 16.75 17.5 15.8333 17.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M13.3333 17.5V11.6667H6.66667V17.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M6.66667 2.5V6.66667H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="btn-text">Save</span>
                        </button>
                        {questions.length > 0 && (
                            <button className="btn btn-clear-all" onClick={clearAllQuestions}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M10 1.66667C5.39783 1.66667 1.66667 5.39783 1.66667 10C1.66667 14.6022 5.39783 18.3333 10 18.3333C14.6022 18.3333 18.3333 14.6022 18.3333 10C18.3333 5.39783 14.6022 1.66667 10 1.66667Z" stroke="currentColor" strokeWidth="1.5"/>
                                </svg>
                                <span className="btn-text">Clear All</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Main Content */}
                <div className="design-content">
                    {/* Questions Container */}
                    <div className="questions-container" id="questionsContainer">
                        <div className="questions-header">
                            <h2 
                                className="questions-title" 
                                contentEditable 
                                suppressContentEditableWarning
                                ref={questionsTitleRef}
                                onBlur={handleTitleBlur}
                                onKeyDown={handleTitleKeyDown}
                                onPaste={handleTitlePaste}
                                data-placeholder="Interview Questions"
                            >
                                {questionsTitle}
                            </h2>
                        </div>
                        <div className="questions-list" ref={questionsListRef} id="questionsList">
                            {questions.length === 0 ? (
                                <div className="empty-questions-state" onClick={() => handleOpenQuestionModal('short-text')}>
                                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2.5" opacity="0.3"/>
                                        <path d="M32 18V46M18 32H46" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <p className="empty-message">No questions added yet</p>
                                    <p className="empty-hint">Click the plus icon to add your first question</p>
                                </div>
                            ) : (
                                questions.map((question, index) => renderQuestionItem(question, index))
                            )}
                        </div>
                    </div>

                    {/* Mobile Sidebar Overlay */}
                    <div 
                        className={`mobile-sidebar-overlay ${sidebarOpen ? 'active' : ''}`}
                        onClick={() => setSidebarOpen(false)}
                    />

                    {/* Sidebar */}
                    <div className={`design-sidebar ${sidebarOpen ? 'mobile-open' : ''}`} id="designSidebar">
                        <button 
                            className="mobile-sidebar-close" 
                            onClick={() => setSidebarOpen(false)}
                            aria-label="Close Settings"
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                        </button>

                        <div className="sidebar-section">
                            <h3 className="sidebar-title">Interview Settings</h3>
                            
                            <div className="form-group">
                                <label className="form-label">Interview Title</label>
                                <input 
                                    type="text" 
                                    className="form-input" 
                                    placeholder="Title" 
                                    value={settings.title}
                                    onChange={(e) => setSettings(prev => ({ ...prev, title: e.target.value }))}
                                />
                            </div>

                            {/* Form Color Theme Dropdown */}
                            <div className="form-group">
                                <label className="form-label">Form Color Theme</label>
                                <div className="custom-color-dropdown" id="colorDropdown">
                                    <div 
                                        className={`color-dropdown-selected ${colorDropdownOpen ? 'open' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); setColorDropdownOpen(!colorDropdownOpen); }}
                                    >
                                        <div className="color-box" style={{ background: formColorOptions.find(opt => opt.color === selectedFormColor)?.gradient || formColorOptions[0].gradient }}></div>
                                        <span>{formColorOptions.find(opt => opt.color === selectedFormColor)?.label || 'None'}</span>
                                        <svg className="dropdown-arrow" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </div>
                                    {colorDropdownOpen && (
                                        <div className="color-dropdown-menu open" id="colorDropdownMenu">
                                            {formColorOptions.map((option) => (
                                                <div
                                                    key={option.color}
                                                    className={`color-dropdown-item ${selectedFormColor === option.color ? 'active' : ''}`}
                                                    onClick={(e) => { e.stopPropagation(); handleFormColorSelect(option); }}
                                                >
                                                    <div className="color-box" style={{ background: option.gradient, border: option.color === 'white' ? '1px solid #64748B' : 'none' }}></div>
                                                    <span>{option.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Question Color Dropdown */}
                            <div className="form-group">
                                <label className="form-label">Question Color</label>
                                <div className="custom-color-dropdown" id="backgroundColorDropdown">
                                    <div 
                                        className={`color-dropdown-selected ${backgroundColorDropdownOpen ? 'open' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); setBackgroundColorDropdownOpen(!backgroundColorDropdownOpen); }}
                                    >
                                        <div className="color-box" style={{ background: formColorOptions.find(opt => opt.color === selectedBackgroundColor)?.gradient || formColorOptions[0].gradient }}></div>
                                        <span>{formColorOptions.find(opt => opt.color === selectedBackgroundColor)?.label || 'None'}</span>
                                        <svg className="dropdown-arrow" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </div>
                                    {backgroundColorDropdownOpen && (
                                        <div className="color-dropdown-menu open" id="backgroundColorDropdownMenu">
                                            {formColorOptions.map((option) => (
                                                <div
                                                    key={option.color}
                                                    className={`color-dropdown-item ${selectedBackgroundColor === option.color ? 'active' : ''}`}
                                                    onClick={(e) => { e.stopPropagation(); handleQuestionColorSelect(option); }}
                                                >
                                                    <div className="color-box" style={{ background: option.gradient, border: option.color === 'white' ? '1px solid #64748B' : 'none' }}></div>
                                                    <span>{option.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Font Dropdown */}
                            <div className="form-group">
                                <label className="form-label">Font</label>
                                <div className="custom-font-dropdown" id="fontDropdown">
                                    <div 
                                        className={`font-dropdown-selected ${fontDropdownOpen ? 'open' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); setFontDropdownOpen(!fontDropdownOpen); }}
                                    >
                                        <span style={{ fontFamily: fontOptions.find(opt => opt.font === selectedFont)?.fontFamily || fontOptions[0].fontFamily }}>
                                            {fontOptions.find(opt => opt.font === selectedFont)?.label || 'None'}
                                        </span>
                                        <svg className="dropdown-arrow" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </div>
                                    {fontDropdownOpen && (
                                        <div className="font-dropdown-menu open" id="fontDropdownMenu">
                                            {fontOptions.map((option) => (
                                                <div
                                                    key={option.font}
                                                    className={`font-dropdown-item ${selectedFont === option.font ? 'active' : ''}`}
                                                    onClick={(e) => { e.stopPropagation(); handleFontSelect(option); }}
                                                >
                                                    <span style={{ fontFamily: option.fontFamily }}>{option.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Text Color Dropdown */}
                            <div className="form-group">
                                <label className="form-label">Text Color</label>
                                <div className="custom-color-dropdown" id="textColorDropdown">
                                    <div 
                                        className={`color-dropdown-selected ${textColorDropdownOpen ? 'open' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); setTextColorDropdownOpen(!textColorDropdownOpen); }}
                                    >
                                        <div className="color-box" style={{ background: textColorOptions.find(opt => opt.color === selectedTextColor)?.hex || textColorOptions.find(opt => opt.color === selectedTextColor)?.gradient || textColorOptions[0].gradient }}></div>
                                        <span>{textColorOptions.find(opt => opt.color === selectedTextColor)?.label || 'None'}</span>
                                        <svg className="dropdown-arrow" width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </div>
                                    {textColorDropdownOpen && (
                                        <div className="color-dropdown-menu open" id="textColorDropdownMenu">
                                            {textColorOptions.map((option) => (
                                                <div
                                                    key={option.color}
                                                    className={`color-dropdown-item ${selectedTextColor === option.color ? 'active' : ''}`}
                                                    onClick={(e) => { e.stopPropagation(); handleTextColorSelect(option); }}
                                                >
                                                    <div className="color-box" style={{ background: option.hex || option.gradient }}></div>
                                                    <span>{option.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Time Limit (minutes)</label>
                                <input 
                                    type="number" 
                                    className="form-input" 
                                    placeholder="30" 
                                    min="5" 
                                    max="180"
                                    value={settings.timeLimit}
                                    onChange={(e) => setSettings(prev => ({ ...prev, timeLimit: e.target.value }))}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Passing Score (%)</label>
                                <input 
                                    type="number" 
                                    className="form-input" 
                                    placeholder="70" 
                                    min="0" 
                                    max="100"
                                    value={settings.passingScore}
                                    onChange={(e) => setSettings(prev => ({ ...prev, passingScore: e.target.value }))}
                                />
                            </div>

                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input 
                                        type="checkbox" 
                                        checked={settings.randomizeQuestions}
                                        onChange={(e) => setSettings(prev => ({ ...prev, randomizeQuestions: e.target.checked }))}
                                    />
                                    <span className="checkmark"></span>
                                    <span>Randomize Questions</span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input 
                                        type="checkbox" 
                                        checked={settings.showResults}
                                        onChange={(e) => setSettings(prev => ({ ...prev, showResults: e.target.checked }))}
                                    />
                                    <span className="checkmark"></span>
                                    <span>Show Results to Candidate</span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input 
                                        type="checkbox" 
                                        checked={settings.enableAIAnalysis}
                                        onChange={(e) => setSettings(prev => ({ ...prev, enableAIAnalysis: e.target.checked }))}
                                    />
                                    <span className="checkmark"></span>
                                    <span>Enable AI Analysis</span>
                                </label>
                            </div>
                        </div>

                        <div className="sidebar-section">
                            <h3 className="sidebar-title">Question Types</h3>
                            <div className="question-types">
                                {/* Text Questions */}
                                <div className="question-type-category">
                                    <h4 className="question-type-category-title">Text Questions</h4>
                                    <div className="question-type-category-items">
                                        {questionTypes.text.map(qt => (
                                            <button 
                                                key={qt.type}
                                                className="question-type-btn" 
                                                onClick={() => handleOpenQuestionModal(qt.type)}
                                            >
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d={qt.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                </svg>
                                                <span>{qt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Choice Questions */}
                                <div className="question-type-category">
                                    <h4 className="question-type-category-title">Choice Questions</h4>
                                    <div className="question-type-category-items">
                                        {questionTypes.choice.map(qt => (
                                            <button 
                                                key={qt.type}
                                                className="question-type-btn" 
                                                onClick={() => handleOpenQuestionModal(qt.type)}
                                            >
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d={qt.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                </svg>
                                                <span>{qt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Scale Questions */}
                                <div className="question-type-category">
                                    <h4 className="question-type-category-title">Scale Questions</h4>
                                    <div className="question-type-category-items">
                                        {questionTypes.scale.map(qt => (
                                            <button 
                                                key={qt.type}
                                                className="question-type-btn" 
                                                onClick={() => handleOpenQuestionModal(qt.type)}
                                            >
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d={qt.icon} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                                                </svg>
                                                <span>{qt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Date & Time */}
                                <div className="question-type-category">
                                    <h4 className="question-type-category-title">Date & Time</h4>
                                    <div className="question-type-category-items">
                                        {questionTypes.dateTime.map(qt => (
                                            <button 
                                                key={qt.type}
                                                className="question-type-btn" 
                                                onClick={() => handleOpenQuestionModal(qt.type)}
                                            >
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d={qt.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                </svg>
                                                <span>{qt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Input Fields */}
                                <div className="question-type-category">
                                    <h4 className="question-type-category-title">Input Fields</h4>
                                    <div className="question-type-category-items">
                                        {questionTypes.input.map(qt => (
                                            <button 
                                                key={qt.type}
                                                className="question-type-btn" 
                                                onClick={() => handleOpenQuestionModal(qt.type)}
                                            >
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d={qt.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                </svg>
                                                <span>{qt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Media Questions */}
                                <div className="question-type-category">
                                    <h4 className="question-type-category-title">Media Questions</h4>
                                    <div className="question-type-category-items">
                                        {questionTypes.media.map(qt => (
                                            <button 
                                                key={qt.type}
                                                className="question-type-btn" 
                                                onClick={() => !qt.comingSoon && handleOpenQuestionModal(qt.type)}
                                                disabled={qt.comingSoon}
                                            >
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d={qt.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                                <span>{qt.label}</span>
                                                {qt.comingSoon && <span className="badge-coming-soon">Soon</span>}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="sidebar-stats">
                            <div className="stat-item">
                                <span className="stat-label">Questions</span>
                                <span className="stat-value">{stats.questionCount}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Est. Time</span>
                                <span className="stat-value">{estimatedTimeFormatted}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Question Modal */}
            {showQuestionModal && (
                <div className="modal show" onClick={(e) => e.target.classList.contains('modal') && setShowQuestionModal(false)}>
                    <div className="modal-content large">
                        <div className="modal-header">
                            <h2 className="modal-title">{editingQuestionIndex !== null ? 'Edit Question' : 'Add Question'}</h2>
                            <button className="modal-close" onClick={() => setShowQuestionModal(false)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="modal-form-group">
                                <label>Question Text *</label>
                                <textarea 
                                    placeholder="Enter your question here..." 
                                    required
                                    value={questionFormData.text || ''}
                                    onChange={(e) => setQuestionFormData(prev => ({ ...prev, text: e.target.value }))}
                                />
                            </div>
                            
                            {(currentQuestionType === 'multiple' || currentQuestionType === 'checkbox' || currentQuestionType === 'dropdown') && (
                                <>
                                    <div className="modal-form-group">
                                        <label>Answer Options</label>
                                        <div className="options-builder">
                                            <div className="option-input-group">
                                                <input 
                                                    type="text" 
                                                    placeholder="Enter an option..."
                                                    value={questionFormData.optionInput || ''}
                                                    onChange={(e) => setQuestionFormData(prev => ({ ...prev, optionInput: e.target.value }))}
                                                    onKeyPress={(e) => e.key === 'Enter' && handleAddOption()}
                                                />
                                                <button type="button" className="btn btn-secondary" onClick={handleAddOption}>
                                                    Add Option
                                                </button>
                                            </div>
                                            <div>
                                                {options.map((opt, idx) => (
                                                    <div key={idx} className={`option-item ${opt.correct ? 'correct' : ''}`}>
                                                        <span className="option-text">{opt.text}</span>
                                                        <div className="option-actions">
                                                            <button 
                                                                type="button" 
                                                                className="option-btn" 
                                                                onClick={() => handleToggleCorrect(idx)}
                                                                title="Mark as correct"
                                                            >
                                                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                    <path d="M13.3333 4L6 11.3333L2.66667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                                </svg>
                                                            </button>
                                                            <button 
                                                                type="button" 
                                                                className="option-btn delete" 
                                                                onClick={() => handleDeleteOption(idx)}
                                                                title="Delete option"
                                                            >
                                                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                    <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="modal-form-group">
                                <label>Time Limit (seconds)</label>
                                <input 
                                    type="number" 
                                    placeholder="e.g., 120" 
                                    min="10" 
                                    max="600"
                                    value={questionFormData.timeLimit || ''}
                                    onChange={(e) => setQuestionFormData(prev => ({ ...prev, timeLimit: e.target.value }))}
                                />
                            </div>

                            <div className="modal-form-group">
                                <label>Points</label>
                                <input 
                                    type="number" 
                                    placeholder="e.g., 10" 
                                    min="1" 
                                    max="100" 
                                    value={questionFormData.points || 10}
                                    onChange={(e) => setQuestionFormData(prev => ({ ...prev, points: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowQuestionModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleSaveQuestion}>
                                {editingQuestionIndex !== null ? 'Update Question' : 'Add Question'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {showPreviewModal && (
                <div className="modal show" onClick={(e) => e.target.classList.contains('modal') && setShowPreviewModal(false)}>
                    <div className="modal-content large">
                        <div className="modal-header">
                            <h2 className="modal-title">Interview Preview</h2>
                            <button className="modal-close" onClick={() => setShowPreviewModal(false)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                                <h2 style={{ color: '#fff', fontSize: '28px', marginBottom: '10px' }}>
                                    {settings.title || 'Untitled Interview'}
                                </h2>
                                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }}>
                                    Total Questions: {questions.length}
                                </p>
                            </div>
                            {questions.map((q, index) => (
                                <div key={index} style={{ marginBottom: '30px', padding: '25px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '15px' }}>
                                        <span style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', borderRadius: '8px', color: '#fff', fontWeight: '700', fontSize: '13px' }}>
                                            Q{index + 1}
                                        </span>
                                        <span style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', color: '#60A5FA', fontWeight: '600', fontSize: '12px' }}>
                                            {getTypeLabel(q.type)}
                                        </span>
                                    </div>
                                    <p style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: '600', marginBottom: '15px', lineHeight: '1.6' }}>
                                        {q.text}
                                    </p>
                                    {(q.timeLimit || q.points) && (
                                        <p style={{ color: '#94A3B8', fontSize: '14px', marginTop: '10px' }}>
                                            {q.timeLimit ? `⏱️ ${q.timeLimit}s` : ''} {q.points ? `⭐ ${q.points} points` : ''}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-primary" onClick={() => setShowPreviewModal(false)}>
                                Close Preview
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Share Modal */}
            {showShareModal && (
                <div className="modal show" onClick={(e) => e.target.classList.contains('modal') && setShowShareModal(false)}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2 className="modal-title">Share Interview</h2>
                            <button className="modal-close" onClick={() => setShowShareModal(false)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '20px' }}>
                                Share this interview with candidates or colleagues
                            </p>
                            <div className="share-link-container">
                                <input 
                                    type="text" 
                                    className="share-input" 
                                    value={shareLink}
                                    readOnly
                                />
                                <button className="btn btn-secondary" onClick={handleCopyShareLink}>
                                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M15 6.75H8.25C7.42157 6.75 6.75 7.42157 6.75 8.25V15C6.75 15.8284 7.42157 16.5 8.25 16.5H15C15.8284 16.5 16.5 15.8284 16.5 15V8.25C16.5 7.42157 15.8284 6.75 15 6.75Z" stroke="currentColor" strokeWidth="2"/>
                                        <path d="M3.75 11.25H3C2.60218 11.25 2.22064 11.092 1.93934 10.8107C1.65804 10.5294 1.5 10.1478 1.5 9.75V3C1.5 2.60218 1.65804 2.22064 1.93934 1.93934C2.22064 1.65804 2.60218 1.5 3 1.5H9.75C10.1478 1.5 10.5294 1.65804 10.8107 1.93934C11.092 2.22064 11.25 2.60218 11.25 3V3.75" stroke="currentColor" strokeWidth="2"/>
                                    </svg>
                                    Copy
                                </button>
                            </div>
                            <div className="share-options">
                                <button className="share-option-btn" onClick={() => {
                                    const title = settings.title || 'Interview';
                                    const subject = encodeURIComponent(`${title} - Interview Link`);
                                    const body = encodeURIComponent(`You've been invited to take an interview. Click here: ${shareLink}`);
                                    window.open(`mailto:?subject=${subject}&body=${body}`);
                                }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2"/>
                                        <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="2"/>
                                    </svg>
                                    <span>Email</span>
                                </button>
                                <button className="share-option-btn" onClick={() => showToast('QR Code generation coming soon!')}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="2"/>
                                        <rect x="13" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="2"/>
                                        <rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="2"/>
                                        <rect x="13" y="13" width="3" height="3" fill="currentColor"/>
                                        <rect x="18" y="13" width="3" height="3" fill="currentColor"/>
                                        <rect x="13" y="18" width="3" height="3" fill="currentColor"/>
                                        <rect x="18" y="18" width="3" height="3" fill="currentColor"/>
                                    </svg>
                                    <span>QR Code</span>
                                </button>
                                <button className="share-option-btn" onClick={() => {
                                    const interviewData = {
                                        title: settings.title || 'Untitled Interview',
                                        questions: questions,
                                        createdAt: new Date().toISOString()
                                    };
                                    const dataStr = JSON.stringify(interviewData, null, 2);
                                    const dataBlob = new Blob([dataStr], { type: 'application/json' });
                                    const url = URL.createObjectURL(dataBlob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = `${interviewData.title.replace(/\s+/g, '_')}_${Date.now()}.json`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    URL.revokeObjectURL(url);
                                    showToast('Interview downloaded successfully!');
                                    setShowShareModal(false);
                                }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <span>Download</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast.show && (
                <div className="toast show">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" stroke="#22C55E" strokeWidth="2"/>
                        <path d="M8 12l2 2 4-4" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>{toast.message}</span>
                </div>
            )}
        </div>
    );
};

export default Design;
