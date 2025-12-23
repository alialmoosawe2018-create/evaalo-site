import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navigation from '../components/Navigation';

const Reports = () => {
    const navigate = useNavigate();
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // جلب البيانات من API
    useEffect(() => {
        const fetchCandidates = async () => {
            try {
                setLoading(true);
                const response = await fetch('http://localhost:5000/api/candidates');
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

    // Sample candidates data - للاستخدام كـ fallback
    const sampleCandidates = [
        {
            id: 1,
            firstName: 'Ahmed',
            lastName: 'Al-Mansouri',
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
                                Reports
                            </h1>
                            <p className="design-subtitle">
                                View and analyze interview reports with AI evaluation results.
                            </p>
                        </div>
                    </div>

                    {/* Reports Table */}
                    <div className="dashboard-card" style={{ width: '100%', overflow: 'hidden' }}>
                        <div className="dashboard-card-header">
                            <h2 className="dashboard-card-title">Interview Reports</h2>
                            <div style={{ display: 'flex', gap: '12px' }}>
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
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '200px'
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
                                            width: '120px'
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
                                            width: '150px'
                                        }}>Date</th>
                                        <th style={{
                                            padding: '10px 12px',
                                            textAlign: 'left',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#fff',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap',
                                            width: '300px'
                                        }}>AI Evaluation</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                                Loading reports...
                                            </td>
                                        </tr>
                                    ) : error ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: '#EF4444' }}>
                                                Error: {error}
                                            </td>
                                        </tr>
                                    ) : displayCandidates.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                                No reports found
                                            </td>
                                        </tr>
                                    ) : (
                                        displayCandidates.map((candidate) => (
                                        <tr key={candidate.id} style={{
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'transparent';
                                        }}>
                                            {/* Name */}
                                            <td style={{ padding: '10px 12px' }}>
                                                <div style={{ fontWeight: 600, color: '#fff', marginBottom: '2px', fontSize: '13px' }}>
                                                    {candidate.firstName && candidate.lastName 
                                                        ? `${candidate.firstName} ${candidate.lastName}`
                                                        : candidate.candidate || candidate.email?.split('@')[0] || 'N/A'}
                                                </div>
                                            </td>
                                            
                                            {/* Status */}
                                            <td style={{ padding: '10px 12px' }}>
                                                {getStatusBadge(candidate.status || 'pending')}
                                            </td>

                                            {/* Date */}
                                            <td style={{ padding: '10px 12px' }}>
                                                <div style={{ fontSize: '11px', color: '#CBD5E1' }}>
                                                    {candidate.interviewDate 
                                                        ? new Date(candidate.interviewDate).toLocaleDateString()
                                                        : candidate.createdAt 
                                                        ? new Date(candidate.createdAt).toLocaleDateString()
                                                        : 'N/A'}
                                                </div>
                                            </td>

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
                                                            maxWidth: '300px',
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
                                        </tr>
                                        ))
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

export default Reports;





















