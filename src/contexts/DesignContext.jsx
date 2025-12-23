import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DesignContext = createContext();

export const useDesign = () => {
    const context = useContext(DesignContext);
    if (!context) {
        throw new Error('useDesign must be used within DesignProvider');
    }
    return context;
};

export const DesignProvider = ({ children }) => {
    const [questions, setQuestions] = useState([]);
    const [editingQuestionIndex, setEditingQuestionIndex] = useState(null);
    const [currentQuestionType, setCurrentQuestionType] = useState('text');
    const [showQuestionModal, setShowQuestionModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [toast, setToast] = useState({ show: false, message: '' });
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [settings, setSettings] = useState({
        title: '',
        timeLimit: '',
        passingScore: '',
        randomizeQuestions: false,
        showResults: false,
        enableAIAnalysis: true
    });

    // Load from localStorage on mount
    useEffect(() => {
        const savedQuestions = localStorage.getItem('designerQuestions');
        const savedSettings = localStorage.getItem('designerSettings');
        
        if (savedQuestions && savedQuestions !== 'null' && savedQuestions !== 'undefined') {
            try {
                const parsed = JSON.parse(savedQuestions);
                if (Array.isArray(parsed)) {
                    setQuestions(parsed);
                }
            } catch (e) {
                console.error('Error parsing questions on mount:', e);
            }
        }
        
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                if (parsed && typeof parsed === 'object') {
                    setSettings(parsed);
                }
            } catch (e) {
                console.error('Error parsing settings on mount:', e);
            }
        }
    }, []);

    // Save to localStorage whenever questions or settings change
    useEffect(() => {
        localStorage.setItem('designerQuestions', JSON.stringify(questions));
        localStorage.setItem('designerSettings', JSON.stringify(settings));
    }, [questions, settings]);

    const showToast = useCallback((message) => {
        setToast({ show: true, message });
        setTimeout(() => setToast({ show: false, message: '' }), 3000);
    }, []);

    const addQuestion = useCallback((question) => {
        const newQuestion = {
            ...question,
            id: Date.now()
        };
        setQuestions(prev => [...prev, newQuestion]);
        showToast('Question added successfully!');
    }, [showToast]);

    const editQuestion = useCallback((index) => {
        setEditingQuestionIndex(index);
        setCurrentQuestionType(questions[index].type);
        setShowQuestionModal(true);
    }, [questions]);

    const updateQuestion = useCallback((index, updatedQuestion) => {
        setQuestions(prev => {
            const newQuestions = [...prev];
            newQuestions[index] = updatedQuestion;
            return newQuestions;
        });
        setShowQuestionModal(false);
        setEditingQuestionIndex(null);
        showToast('Question updated successfully!');
    }, [showToast]);

    const deleteQuestion = useCallback((index) => {
        if (window.confirm('Are you sure you want to delete this question?')) {
            setQuestions(prev => prev.filter((_, i) => i !== index));
            showToast('Question deleted successfully!');
        }
    }, [showToast]);

    const copyQuestion = useCallback((index) => {
        const questionToCopy = questions[index];
        const duplicatedQuestion = {
            ...JSON.parse(JSON.stringify(questionToCopy)),
            id: Date.now(),
            text: questionToCopy.text.includes('(Duplicate)') 
                ? questionToCopy.text 
                : questionToCopy.text + ' (Duplicate)'
        };
        setQuestions(prev => {
            const newQuestions = [...prev];
            newQuestions.splice(index + 1, 0, duplicatedQuestion);
            return newQuestions;
        });
        showToast('Question duplicated successfully!');
    }, [questions, showToast]);

    const clearAllQuestions = useCallback(() => {
        if (questions.length === 0) return;
        if (window.confirm('Are you sure you want to delete all questions? This action cannot be undone.')) {
            setQuestions([]);
            showToast('All questions cleared successfully!');
        }
    }, [questions, showToast]);

    const updateStats = useCallback(() => {
        const questionCount = questions.length;
        const estimatedTime = questions.reduce((total, q) => total + (q.timeLimit || 0), 0);
        return { questionCount, estimatedTime };
    }, [questions]);

    const value = {
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
    };

    return (
        <DesignContext.Provider value={value}>
            {children}
        </DesignContext.Provider>
    );
};










