import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navigation from '../components/Navigation';

const Candidates = () => {
    const navigate = useNavigate();
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedCandidates, setSelectedCandidates] = useState([]);

    // جلب البيانات من API
    useEffect(() => {
        const fetchCandidates = async () => {
            try {
                setLoading(true);
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
                const response = await fetch(`${apiUrl}/api/candidates`);
                const result = await response.json();
                
                if (result.success) {
                    setCandidates(result.data || []);
                } else {
                    setError(result.error || 'Failed to fetch candidates');
                }
            } catch (err) {
                console.error('Error fetching candidates:', err);
                setError(err.message || 'Failed to fetch candidates');
            } finally {
                setLoading(false);
            }
        };

        fetchCandidates();
    }, []);

    // Sample candidates data - للاستخدام كـ fallback إذا لم تكن هناك بيانات
    const sampleCandidates = [
        {
            id: 1,
            firstName: 'Ahmed',
            lastName: 'Al-Mansouri',
            email: 'ahmed.almansouri@example.com',
            phone: '+966 50 123 4567',
            positionAppliedFor: 'Software Engineer',
            yearsOfExperience: '5',
            currentCompany: 'Tech Corp',
            highestEducationLevel: "Bachelor's Degree",
            skills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
            languages: ['Arabic', 'English'],
            coverLetter: 'Experienced software engineer with 5 years of experience in web development...',
            aiEvaluation: {
                score: 85,
                communication: 90,
                technical: 88,
                problemSolving: 82,
                confidence: 87,
                feedback: 'Strong technical skills and excellent communication. Shows good problem-solving abilities.'
            },
            status: 'accepted',
            interviewDate: '2025-01-15'
        },
        {
            id: 2,
            candidate: 'Sarah Johnson',
            email: 'sarah.johnson@example.com',
            phone: '+1 555 123 4567',
            positionAppliedFor: 'Product Manager',
            yearsOfExperience: '7',
            currentCompany: 'StartupXYZ',
            highestEducationLevel: "Master's Degree",
            skills: ['Product Management', 'Agile', 'Data Analysis'],
            languages: ['English'],
            coverLetter: 'Product manager with extensive experience in agile methodologies...',
            aiEvaluation: {
                score: 78,
                communication: 85,
                technical: 72,
                problemSolving: 80,
                confidence: 75,
                feedback: 'Good communication skills but needs improvement in technical areas.'
            },
            status: 'pending',
            interviewDate: '2025-01-14'
        },
        {
            id: 3,
            firstName: 'Mohammed',
            lastName: 'Hassan',
            email: 'mohammed.hassan@example.com',
            phone: '+971 50 987 6543',
            positionAppliedFor: 'Data Analyst',
            yearsOfExperience: '3',
            currentCompany: 'Data Solutions Inc',
            highestEducationLevel: "Bachelor's Degree",
            skills: ['Python', 'SQL', 'Tableau', 'Excel'],
            languages: ['Arabic', 'English', 'French'],
            coverLetter: 'Data analyst passionate about turning data into insights...',
            aiEvaluation: {
                score: 92,
                communication: 88,
                technical: 95,
                problemSolving: 90,
                confidence: 93,
                feedback: 'Excellent technical skills and strong analytical thinking. Highly recommended.'
            },
            status: 'accepted',
            interviewDate: '2025-01-13'
        },
        {
            id: 4,
            firstName: 'Emily',
            lastName: 'Chen',
            email: 'emily.chen@example.com',
            phone: '+86 138 0013 8000',
            positionAppliedFor: 'UX Designer',
            yearsOfExperience: '4',
            currentCompany: 'Design Studio',
            highestEducationLevel: "Bachelor's Degree",
            skills: ['Figma', 'Adobe XD', 'User Research', 'Prototyping'],
            languages: ['English', 'Mandarin'],
            coverLetter: 'Creative UX designer focused on user-centered design...',
            aiEvaluation: {
                score: 65,
                communication: 70,
                technical: 60,
                problemSolving: 65,
                confidence: 65,
                feedback: 'Needs improvement in technical skills and communication clarity.'
            },
            status: 'rejected',
            interviewDate: '2025-01-12'
        }
    ];

    // استخدام البيانات من API أو البيانات الافتراضية
    const displayCandidates = candidates.length > 0 ? candidates : sampleCandidates;

    // Form fields from Form.jsx
    const formFields = [
        { key: 'firstName', label: 'First Name', type: 'text' },
        { key: 'lastName', label: 'Last Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'positionAppliedFor', label: 'Position Applied For', type: 'text' },
        { key: 'yearsOfExperience', label: 'Years of Experience', type: 'text' },
        { key: 'currentCompany', label: 'Current Company', type: 'text' },
        { key: 'highestEducationLevel', label: 'Education Level', type: 'text' },
        { key: 'skills', label: 'Skills', type: 'array' },
        { key: 'languages', label: 'Languages', type: 'array' },
        { key: 'coverLetter', label: 'Cover Letter', type: 'textarea' }
    ];

    const getFieldValue = (candidate, fieldKey) => {
        if (fieldKey === 'skills' || fieldKey === 'languages') {
            return Array.isArray(candidate[fieldKey]) ? candidate[fieldKey].join(', ') : (candidate[fieldKey] || 'N/A');
        }
        return candidate[fieldKey] || candidate[fieldKey.toLowerCase()] || 'N/A';
    };

    const getStatusBadge = (status) => {
        const statusConfig = {
            accepted: { text: 'Accepted', class: 'status-accepted', color: '#10B981' },
            pending: { text: 'Pending', class: 'status-pending', color: '#F59E0B' },
            rejected: { text: 'Rejected', class: 'status-rejected', color: '#EF4444' }
        };
        const config = statusConfig[status] || statusConfig.pending;
        return (
            <span className={`status-badge ${config.class}`} style={{
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                background: `${config.color}20`,
                color: config.color,
                border: `1px solid ${config.color}40`
            }}>
                {config.text}
            </span>
        );
    };

    const sendSecondInterview = (candidateId) => {
        // Logic to send second interview link
        console.log('Sending second interview to candidate:', candidateId);
        alert(`Second interview link will be sent to candidate ${candidateId}`);
    };

    return (
        <>
            <Navigation />
            <div className="dashboard-page" style={{ 
                minHeight: '100vh', 
                padding: '75px 20px 40px',
                background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f3a 50%, #0d1117 100%)',
                color: '#ffffff',
                position: 'relative'
            }}>
                {/* Background Effects */}
                <div className="design-background">
                    <div className="design-orb-1"></div>
                    <div className="design-orb-2"></div>
                    <div className="design-orb-3"></div>
                </div>

                <div className="container" style={{ 
                    maxWidth: '1600px', 
                    margin: '0 auto', 
                    position: 'relative', 
                    zIndex: 1,
                    minHeight: 'calc(100vh - 250px)'
                }}>
                    {/* Header */}
                    <div className="design-header" style={{ marginBottom: '40px' }}>
                        <div>
                            <h1 className="design-title" style={{ marginBottom: '8px' }}>
                                Candidates
                            </h1>
                            <p className="design-subtitle">
                                View and manage all candidate applications and their interview results.
                            </p>
                        </div>
                    </div>

                    {/* Candidates Table */}
                    <div className="dashboard-card" style={{ width: '100%', overflow: 'hidden' }}>
                        <div className="dashboard-card-header">
                            <h2 className="dashboard-card-title">All Candidates</h2>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <button 
                                    className="btn-small"
                                    onClick={() => {
                                        if (selectedCandidates.length === displayCandidates.length) {
                                            setSelectedCandidates([]);
                                        } else {
                                            setSelectedCandidates(displayCandidates.map(c => c._id || c.id));
                                        }
                                    }}
                                    style={{ cursor: 'pointer' }}
                                >
                                    Select
                                </button>
                                {selectedCandidates.length > 0 && (
                                    <button 
                                        className="btn-small"
                                        onClick={() => {
                                            if (window.confirm(`Are you sure you want to delete ${selectedCandidates.length} candidate(s)?`)) {
                                                // TODO: إضافة وظيفة حذف المرشحين من API
                                                console.log('Deleting candidates:', selectedCandidates);
                                                setSelectedCandidates([]);
                                            }
                                        }}
                                        style={{ 
                                            cursor: 'pointer',
                                            background: 'rgba(239, 68, 68, 0.1)',
                                            borderColor: 'rgba(239, 68, 68, 0.3)',
                                            color: '#EF4444'
                                        }}
                                    >
                                        Delete All
                                    </button>
                                )}
                                <button className="btn-small">Export</button>
                                <button className="btn-small">Filter</button>
                            </div>
                        </div>
                        <div className="dashboard-card-body" style={{ 
                            padding: '0', 
                            overflowX: 'auto',
                            overflowY: 'visible',
                            scrollBehavior: 'smooth',
                            WebkitOverflowScrolling: 'touch',
                            cursor: 'grab'
                        }}
                        onMouseDown={(e) => {
                            const container = e.currentTarget;
                            const startX = e.pageX - container.offsetLeft;
                            const scrollLeft = container.scrollLeft;
                            let isDown = true;

                            const handleMouseMove = (e) => {
                                if (!isDown) return;
                                e.preventDefault();
                                const x = e.pageX - container.offsetLeft;
                                const walk = (x - startX) * 2;
                                container.scrollLeft = scrollLeft - walk;
                            };

                            const handleMouseUp = () => {
                                isDown = false;
                                container.style.cursor = 'grab';
                                document.removeEventListener('mousemove', handleMouseMove);
                                document.removeEventListener('mouseup', handleMouseUp);
                            };

                            container.style.cursor = 'grabbing';
                            document.addEventListener('mousemove', handleMouseMove);
                            document.addEventListener('mouseup', handleMouseUp);
                        }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                minWidth: '100%',
                                fontSize: '12px'
                            }}>
                                <thead>
                                    <tr style={{
                                        background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
                                        borderBottom: '2px solid rgba(255, 255, 255, 0.1)'
                                    }}>
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'center',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '50px'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedCandidates.length === displayCandidates.length && displayCandidates.length > 0}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedCandidates(displayCandidates.map(c => c._id || c.id));
                                                    } else {
                                                        setSelectedCandidates([]);
                                                    }
                                                }}
                                                style={{
                                                    width: '18px',
                                                    height: '18px',
                                                    cursor: 'pointer',
                                                    accentColor: '#06B6D4'
                                                }}
                                            />
                                        </th>
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '120px'
                                        }}>Name</th>
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '150px'
                                        }}>Contact</th>
                                        {formFields.map(field => (
                                            <th key={field.key} style={{
                                                padding: '10px 12px',
                                                textAlign: 'left',
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: '#fff',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                                whiteSpace: 'nowrap',
                                                width: field.type === 'textarea' ? '180px' : field.type === 'array' ? '140px' : '110px'
                                            }}>
                                                {field.label}
                                            </th>
                                        ))}
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '180px'
                                        }}>AI Evaluation</th>
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '100px'
                                        }}>Status</th>
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '160px'
                                        }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={16} style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                                Loading candidates...
                                            </td>
                                        </tr>
                                    ) : error ? (
                                        <tr>
                                            <td colSpan={16} style={{ textAlign: 'center', padding: '40px', color: '#EF4444' }}>
                                                Error: {error}
                                            </td>
                                        </tr>
                                    ) : displayCandidates.length === 0 ? (
                                        <tr>
                                            <td colSpan={16} style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                                No candidates found
                                            </td>
                                        </tr>
                                    ) : (
                                        displayCandidates.map((candidate) => {
                                            const candidateId = candidate._id || candidate.id;
                                            const isSelected = selectedCandidates.includes(candidateId);
                                            
                                            return (
                                            <tr key={candidateId} style={{
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                                transition: 'all 0.2s ease',
                                                background: isSelected ? 'rgba(6, 182, 212, 0.1)' : 'transparent'
                                        }}
                                        onMouseEnter={(e) => {
                                                if (!isSelected) {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                                                }
                                        }}
                                        onMouseLeave={(e) => {
                                                if (!isSelected) {
                                            e.currentTarget.style.background = 'transparent';
                                                }
                                            }}>
                                                {/* Checkbox */}
                                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedCandidates(prev => [...prev, candidateId]);
                                                            } else {
                                                                setSelectedCandidates(prev => prev.filter(id => id !== candidateId));
                                                            }
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        style={{
                                                            width: '18px',
                                                            height: '18px',
                                                            cursor: 'pointer',
                                                            accentColor: '#06B6D4'
                                                        }}
                                                    />
                                                </td>
                                            {/* Name */}
                                            <td style={{ padding: '10px 12px' }}>
                                                <div style={{ fontWeight: 600, color: '#fff', marginBottom: '2px', fontSize: '13px' }}>
                                                    {candidate.firstName && candidate.lastName 
                                                        ? `${candidate.firstName} ${candidate.lastName}`
                                                        : candidate.candidate || candidate.email?.split('@')[0] || 'N/A'}
                                                </div>
                                            </td>
                                            
                                            {/* Contact */}
                                            <td style={{ padding: '10px 12px' }}>
                                                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '2px' }}>
                                                    {candidate.email}
                                                </div>
                                                <div style={{ fontSize: '10px', color: '#64748B' }}>
                                                    {candidate.phone}
                                                </div>
                                            </td>

                                            {/* Form Fields */}
                                            {formFields.map(field => (
                                                <td key={field.key} style={{ padding: '10px 12px' }}>
                                                    <div style={{
                                                        fontSize: '11px',
                                                        color: '#CBD5E1',
                                                        maxWidth: field.type === 'textarea' ? '180px' : field.type === 'array' ? '140px' : '110px',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: field.type === 'textarea' ? 'normal' : 'nowrap',
                                                        lineHeight: '1.4'
                                                    }}>
                                                        {getFieldValue(candidate, field.key)}
                                                    </div>
                                                </td>
                                            ))}

                                            {/* AI Evaluation */}
                                            <td style={{ padding: '10px 12px' }}>
                                                {candidate.aiEvaluation ? (
                                                    <div style={{ marginBottom: '6px' }}>
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            marginBottom: '3px'
                                                        }}>
                                                            <span style={{
                                                                fontSize: '16px',
                                                                fontWeight: 700,
                                                                background: candidate.aiEvaluation.score >= 80 
                                                                    ? 'linear-gradient(135deg, #10B981, #059669)'
                                                                    : candidate.aiEvaluation.score >= 60
                                                                    ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                                                                    : 'linear-gradient(135deg, #EF4444, #DC2626)',
                                                                WebkitBackgroundClip: 'text',
                                                                WebkitTextFillColor: 'transparent',
                                                                backgroundClip: 'text'
                                                            }}>
                                                                {candidate.aiEvaluation.score}%
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '9px', color: '#94A3B8', marginBottom: '4px', lineHeight: '1.3' }}>
                                                            C:{candidate.aiEvaluation.communication}% T:{candidate.aiEvaluation.technical}% P:{candidate.aiEvaluation.problemSolving}%
                                                        </div>
                                                        <div style={{
                                                            fontSize: '10px',
                                                            color: '#CBD5E1',
                                                            fontStyle: 'italic',
                                                            maxWidth: '180px',
                                                            lineHeight: '1.3',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            display: '-webkit-box',
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient: 'vertical'
                                                        }}>
                                                            {candidate.aiEvaluation.feedback}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#94A3B8', fontSize: '12px' }}>Pending</span>
                                                )}
                                            </td>

                                            {/* Status */}
                                            <td style={{ padding: '10px 12px' }}>
                                                {getStatusBadge(candidate.status || 'pending')}
                                            </td>

                                            {/* Actions */}
                                            <td style={{ padding: '10px 12px' }}>
                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                    {candidate.status === 'accepted' && (
                                                        <button
                                                            onClick={() => sendSecondInterview(candidate.id)}
                                                            className="btn-small"
                                                            style={{
                                                                background: 'rgba(16, 185, 129, 0.2)',
                                                                borderColor: 'rgba(16, 185, 129, 0.4)',
                                                                color: '#10B981',
                                                                padding: '6px 10px',
                                                                fontSize: '11px'
                                                            }}
                                                        >
                                                            Send 2nd
                                                        </button>
                                                    )}
                                                    <button
                                                        className="btn-small"
                                                        onClick={() => navigate(`/candidates/${candidate.id}`)}
                                                        style={{
                                                            padding: '6px 10px',
                                                            fontSize: '11px'
                                                        }}
                                                    >
                                                        View
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Candidates;





