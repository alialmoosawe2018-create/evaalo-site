import { useState, useEffect, useCallback } from 'react';

export const useDesign = () => {
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
        
        console.log('useDesign: Loading from localStorage on mount');
        console.log('useDesign: savedQuestions:', savedQuestions);
        
        if (savedQuestions && savedQuestions !== 'null' && savedQuestions !== 'undefined') {
            try {
                const parsed = JSON.parse(savedQuestions);
                console.log('useDesign: Parsed questions on mount:', parsed);
                if (Array.isArray(parsed)) {
                    setQuestions(parsed);
                    console.log('useDesign: Set questions on mount, count:', parsed.length);
                }
            } catch (e) {
                console.error('useDesign: Error parsing questions on mount:', e);
            }
        }
        
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                if (parsed && typeof parsed === 'object') {
                    setSettings(parsed);
                }
            } catch (e) {
                console.error('useDesign: Error parsing settings on mount:', e);
            }
        }
    }, []);

    // Save to localStorage whenever questions or settings change
    useEffect(() => {
        console.log('useDesign: Saving questions to localStorage, count:', questions.length);
        console.log('useDesign: Questions data:', questions);
        localStorage.setItem('designerQuestions', JSON.stringify(questions));
        localStorage.setItem('designerSettings', JSON.stringify(settings));
        // Dispatch custom event to notify other components
        window.dispatchEvent(new Event('designerQuestionsUpdated'));
        console.log('useDesign: Event dispatched: designerQuestionsUpdated');
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
        setQuestions(prev => {
            const updated = [...prev, newQuestion];
            console.log('useDesign: Adding question, new count:', updated.length);
            console.log('useDesign: Updated questions:', updated);
            return updated;
        });
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
        // Calculate stats from questions
        const questionCount = questions.length;
        const estimatedTime = questions.reduce((total, q) => total + (q.timeLimit || 0), 0);
        return { questionCount, estimatedTime };
    }, [questions]);

    return {
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
};

