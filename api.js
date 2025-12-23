// API Configuration
// Use environment variable or fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 
                     import.meta.env.VITE_BACKEND_URL || 
                     (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                        ? 'http://localhost:5000' 
                        : 'https://evaalo-backend.onrender.com');

export const API_CONFIG = {
    BASE_URL: API_BASE_URL,
    ENDPOINTS: {
        CANDIDATES: `${API_BASE_URL}/api/candidates`,
        RECRUITMENT_CAMPAIGNS: `${API_BASE_URL}/api/recruitment-campaigns`,
        SEND_INTERVIEW_LINK: (candidateId) => `${API_BASE_URL}/api/candidates/${candidateId}/send-interview-link`,
        STATS: `${API_BASE_URL}/api/dashboard/stats`,
        HEALTH: `${API_BASE_URL}/health`
    }
};

export default API_CONFIG;

