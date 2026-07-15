import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isCandidateInterviewRoute } from '../utils/interviewShareLink.js';

/** Removes fixed-nav body padding on full-screen candidate interview pages. */
export default function CandidateInterviewBodyClass() {
    const { pathname } = useLocation();

    useEffect(() => {
        const active = isCandidateInterviewRoute(pathname);
        document.body.classList.toggle('candidate-interview-page', active);
        return () => {
            document.body.classList.remove('candidate-interview-page');
        };
    }, [pathname]);

    return null;
}
