import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import { InterviewTemplateProvider } from './contexts/InterviewTemplateContext';
import { DesignProvider } from './contexts/DesignContext';
import Navigation from './components/Navigation';
import Home from './pages/Home';
import Design from './pages/Design';
import Form from './pages/Form';
import Interview from './pages/Interview';
import Dashboard from './pages/Dashboard';
import Workflow from './pages/Workflow';
import Candidates from './pages/Candidates';
import InterviewTemplates from './pages/InterviewTemplates';
import WrittenInterview from './pages/WrittenInterview';

function App() {
    useEffect(() => {
        // Page load animation
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.5s ease';
        
        const timer = setTimeout(() => {
            document.body.style.opacity = '1';
        }, 100);
        
        // Scroll indicator hide on scroll
        const handleScroll = () => {
            const scrollIndicator = document.querySelector('.scroll-indicator');
            if (scrollIndicator) {
                if (window.scrollY > 100) {
                    scrollIndicator.style.opacity = '0';
                    scrollIndicator.style.pointerEvents = 'none';
                } else {
                    scrollIndicator.style.opacity = '1';
                    scrollIndicator.style.pointerEvents = 'auto';
                }
            }
        };
        
        window.addEventListener('scroll', handleScroll);
        
        return () => {
            clearTimeout(timer);
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    return (
        <LanguageProvider>
            <InterviewTemplateProvider>
                <DesignProvider>
                    <Router>
                        <Navigation />
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/design" element={<Design />} />
                            <Route path="/form" element={<Form />} />
                            <Route path="/interview" element={<Interview />} />
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/workflow" element={<Workflow />} />
                            <Route path="/candidates" element={<Candidates />} />
                            <Route path="/interview-templates" element={<InterviewTemplates />} />
                            <Route path="/written-interview" element={<WrittenInterview />} />
                        </Routes>
                    </Router>
                </DesignProvider>
            </InterviewTemplateProvider>
        </LanguageProvider>
    );
}

export default App;
