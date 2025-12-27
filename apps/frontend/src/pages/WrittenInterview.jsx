import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navigation from '../components/Navigation';

const WrittenInterview = () => {
    const navigate = useNavigate();
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, hire, consider, reject

    useEffect(() => {
        fetchCandidates();
    }, []);

    const fetchCandidates = async () => {
        try {
            setLoading(true);
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            const response = await fetch(`${apiUrl}/api/candidates`);
            const result = await response.json();
            
            console.log('📥 Fetched candidates:', result);
            
            if (result.success && result.data) {
                // تصفية المرشحين الذين لديهم writtenInterviewEvaluation
                const candidatesWithEvaluation = result.data.filter(
                    candidate => {
                        const hasEvaluation = candidate.writtenInterviewEvaluation;
                        if (hasEvaluation) {
                            console.log('✅ Candidate with evaluation:', candidate.firstName, candidate.lastName, candidate.writtenInterviewEvaluation);
                        }
                        return hasEvaluation;
                    }
                );
                
                console.log('📊 Candidates with Written Interview Evaluation:', candidatesWithEvaluation.length);
                console.log('📋 All candidates:', result.data.length);
                
                setCandidates(candidatesWithEvaluation);
            } else {
                console.warn('⚠️ No candidates data received');
            }
        } catch (error) {
            console.error('❌ Error fetching candidates:', error);
        } finally {
            setLoading(false);
        }
    };

    const getRecommendationColor = (recommendation) => {
        switch (recommendation) {
            case 'Hire':
                return { bg: 'rgba(16, 185, 129, 0.2)', border: 'rgba(16, 185, 129, 0.4)', text: '#10B981' };
            case 'Consider':
                return { bg: 'rgba(245, 158, 11, 0.2)', border: 'rgba(245, 158, 11, 0.4)', text: '#F59E0B' };
            case 'Reject':
                return { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.4)', text: '#EF4444' };
            default:
                return { bg: 'rgba(148, 163, 184, 0.2)', border: 'rgba(148, 163, 184, 0.4)', text: '#94A3B8' };
        }
    };

    const getScoreColor = (score) => {
        if (score >= 80) return { bg: 'rgba(16, 185, 129, 0.2)', text: '#10B981' };
        if (score >= 60) return { bg: 'rgba(245, 158, 11, 0.2)', text: '#F59E0B' };
        return { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444' };
    };

    const handleShare = async (candidate) => {
        // إنشاء رابط المقابلة الصوتية
        const candidateId = candidate._id || candidate.id;
        const baseUrl = window.location.origin;
        const interviewLink = `${baseUrl}/#/interview/${candidateId}`;
        
        const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.email?.split('@')[0] || 'Unknown';
        const candidateEmail = candidate.email || 'N/A';
        
        const shareText = `🎤 مقابلة صوتية ذكية\n\n` +
            `مرحباً ${candidateName},\n\n` +
            `تم دعوتك لإجراء مقابلة صوتية ذكية.\n\n` +
            `🔗 رابط المقابلة:\n${interviewLink}\n\n` +
            `يرجى الضغط على الرابط أعلاه لبدء المقابلة.\n\n` +
            `مع تحياتنا،\nفريق التوظيف`;

        const shareData = {
            title: `مقابلة صوتية - ${candidateName}`,
            text: shareText,
            url: interviewLink
        };

        // Try Web Share API first (mobile/desktop)
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return;
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error sharing:', err);
                }
            }
        }

        // Fallback: Copy link to clipboard
        try {
            await navigator.clipboard.writeText(interviewLink);
            alert(`✅ تم نسخ رابط المقابلة الصوتية إلى الحافظة!\n\nالرابط:\n${interviewLink}\n\nيمكنك إرساله إلى: ${candidateEmail}`);
        } catch (err) {
            console.error('Failed to copy:', err);
            // Fallback: Show link in a prompt
            prompt(`رابط المقابلة الصوتية للمرشح ${candidateName}:\n(انسخ الرابط وأرسله إلى ${candidateEmail})`, interviewLink);
        }
    };

    const filteredCandidates = filter === 'all' 
        ? candidates 
        : candidates.filter(c => c.writtenInterviewEvaluation?.recommendation === filter);

    return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)' }}>
            <Navigation />
            
            <div style={{
                padding: '120px 20px 40px',
                maxWidth: '1400px',
                margin: '0 auto'
            }}>
                {/* Header */}
                <div style={{
                    marginBottom: '40px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '20px'
                }}>
                    <div>
                        <h1 style={{
                            fontSize: '36px',
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, #60A5FA, #3B82F6)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            marginBottom: '10px'
                        }}>
                            Written Interview Evaluations
                        </h1>
                        <p style={{ color: '#94A3B8', fontSize: '16px' }}>
                            تقييمات المقابلات الكتابية للمرشحين
                        </p>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                            onClick={fetchCandidates}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: '1px solid rgba(96, 165, 250, 0.4)',
                                background: 'rgba(96, 165, 250, 0.2)',
                                color: '#60A5FA',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 600,
                                transition: 'all 0.3s ease'
                            }}
                        >
                            🔄 تحديث
                        </button>
                        
                        {/* Filter Buttons */}
                        {['all', 'Hire', 'Consider', 'Reject'].map((filterOption) => {
                            const isActive = filter === filterOption.toLowerCase();
                            const colors = filterOption === 'all' 
                                ? { bg: 'rgba(96, 165, 250, 0.2)', border: 'rgba(96, 165, 250, 0.4)', text: '#60A5FA' }
                                : getRecommendationColor(filterOption);
                            
                            return (
                                <button
                                    key={filterOption}
                                    onClick={() => setFilter(filterOption.toLowerCase())}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: `1px solid ${isActive ? colors.border : 'rgba(148, 163, 184, 0.3)'}`,
                                        background: isActive ? colors.bg : 'transparent',
                                        color: isActive ? colors.text : '#94A3B8',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: isActive ? 600 : 400,
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    {filterOption === 'all' ? 'All' : filterOption}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>
                        Loading...
                    </div>
                ) : filteredCandidates.length === 0 ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '60px', 
                        color: '#94A3B8',
                        background: 'rgba(15, 23, 42, 0.5)',
                        borderRadius: '12px',
                        border: '1px solid rgba(148, 163, 184, 0.1)'
                    }}>
                        <div style={{ marginBottom: '20px', fontSize: '48px' }}>📋</div>
                        <div style={{ fontSize: '18px', marginBottom: '10px', color: '#CBD5E1' }}>
                            {filter === 'all' 
                                ? 'لا توجد تقييمات مقابلات كتابية'
                                : `لا يوجد مرشحون بتوصية "${filter}"`
                            }
                        </div>
                        <div style={{ fontSize: '14px', color: '#94A3B8', marginTop: '10px', marginBottom: '20px' }}>
                            {filter === 'all' 
                                ? 'تأكد من إرسال البيانات من n8n مع حقل writtenInterviewEvaluation'
                                : 'جرب تغيير الفلتر أو تحديث الصفحة'
                            }
                        </div>
                        <button
                            onClick={fetchCandidates}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: '1px solid rgba(96, 165, 250, 0.4)',
                                background: 'rgba(96, 165, 250, 0.2)',
                                color: '#60A5FA',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 600
                            }}
                        >
                            🔄 تحديث البيانات
                        </button>
                    </div>
                ) : (
                    <div style={{
                        background: 'rgba(15, 23, 42, 0.5)',
                        borderRadius: '12px',
                        border: '1px solid rgba(148, 163, 184, 0.1)',
                        overflow: 'hidden'
                    }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ 
                                        background: 'rgba(30, 41, 59, 0.8)',
                                        borderBottom: '2px solid rgba(148, 163, 184, 0.2)'
                                    }}>
                                        <th style={{ padding: '16px', textAlign: 'left', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Candidate</th>
                                        <th style={{ padding: '16px', textAlign: 'center', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Overall Score</th>
                                        <th style={{ padding: '16px', textAlign: 'left', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Fit for Role</th>
                                        <th style={{ padding: '16px', textAlign: 'left', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Strengths</th>
                                        <th style={{ padding: '16px', textAlign: 'left', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Weaknesses</th>
                                        <th style={{ padding: '16px', textAlign: 'left', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Red Flags</th>
                                        <th style={{ padding: '16px', textAlign: 'center', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Recommendation</th>
                                        <th style={{ padding: '16px', textAlign: 'left', color: '#CBD5E1', fontWeight: 600, fontSize: '14px' }}>Summary</th>
                                        <th style={{ padding: '16px', textAlign: 'center', color: '#CBD5E1', fontWeight: 600, fontSize: '14px', width: '80px' }}>Share</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCandidates.map((candidate, index) => {
                                        const evaluation = candidate.writtenInterviewEvaluation;
                                        const scoreColors = getScoreColor(evaluation?.overall_score || 0);
                                        const recColors = getRecommendationColor(evaluation?.recommendation);
                                        
                                        return (
                                            <tr 
                                                key={candidate._id || candidate.id}
                                                style={{
                                                    borderBottom: index < filteredCandidates.length - 1 ? '1px solid rgba(148, 163, 184, 0.1)' : 'none',
                                                    transition: 'background 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.3)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                {/* Candidate Name */}
                                                <td style={{ padding: '16px' }}>
                                                    <div>
                                                        <div style={{ color: '#F1F5F9', fontWeight: 600, marginBottom: '4px' }}>
                                                            {candidate.firstName && candidate.lastName
                                                                ? `${candidate.firstName} ${candidate.lastName}`
                                                                : candidate.email?.split('@')[0] || 'Unknown'
                                                            }
                                                        </div>
                                                        <div style={{ color: '#94A3B8', fontSize: '12px' }}>
                                                            {candidate.positionAppliedFor || 'N/A'}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Overall Score */}
                                                <td style={{ padding: '16px', textAlign: 'center' }}>
                                                    <div style={{
                                                        display: 'inline-block',
                                                        padding: '8px 16px',
                                                        borderRadius: '8px',
                                                        background: scoreColors.bg,
                                                        color: scoreColors.text,
                                                        fontWeight: 700,
                                                        fontSize: '18px'
                                                    }}>
                                                        {evaluation?.overall_score || 0}%
                                                    </div>
                                                </td>

                                                {/* Fit for Role */}
                                                <td style={{ padding: '16px', color: '#CBD5E1', fontSize: '14px' }}>
                                                    {evaluation?.fit_for_role || 'N/A'}
                                                </td>

                                                {/* Strengths */}
                                                <td style={{ padding: '16px', maxWidth: '200px' }}>
                                                    {evaluation?.strengths && evaluation.strengths.length > 0 ? (
                                                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#10B981', fontSize: '13px' }}>
                                                            {evaluation.strengths.map((strength, i) => (
                                                                <li key={i} style={{ marginBottom: '4px' }}>{strength}</li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <span style={{ color: '#94A3B8', fontSize: '13px' }}>None</span>
                                                    )}
                                                </td>

                                                {/* Weaknesses */}
                                                <td style={{ padding: '16px', maxWidth: '200px' }}>
                                                    {evaluation?.weaknesses && evaluation.weaknesses.length > 0 ? (
                                                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#F59E0B', fontSize: '13px' }}>
                                                            {evaluation.weaknesses.map((weakness, i) => (
                                                                <li key={i} style={{ marginBottom: '4px' }}>{weakness}</li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <span style={{ color: '#94A3B8', fontSize: '13px' }}>None</span>
                                                    )}
                                                </td>

                                                {/* Red Flags */}
                                                <td style={{ padding: '16px', maxWidth: '200px' }}>
                                                    {evaluation?.red_flags && evaluation.red_flags.length > 0 ? (
                                                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#EF4444', fontSize: '13px' }}>
                                                            {evaluation.red_flags.map((flag, i) => (
                                                                <li key={i} style={{ marginBottom: '4px' }}>{flag}</li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <span style={{ color: '#94A3B8', fontSize: '13px' }}>None</span>
                                                    )}
                                                </td>

                                                {/* Recommendation */}
                                                <td style={{ padding: '16px', textAlign: 'center' }}>
                                                    <div style={{
                                                        display: 'inline-block',
                                                        padding: '6px 12px',
                                                        borderRadius: '6px',
                                                        background: recColors.bg,
                                                        border: `1px solid ${recColors.border}`,
                                                        color: recColors.text,
                                                        fontWeight: 600,
                                                        fontSize: '13px'
                                                    }}>
                                                        {evaluation?.recommendation || 'N/A'}
                                                    </div>
                                                </td>

                                                {/* Summary */}
                                                <td style={{ padding: '16px', maxWidth: '300px', color: '#CBD5E1', fontSize: '13px', lineHeight: '1.5' }}>
                                                    {evaluation?.summary || 'No summary available'}
                                                </td>

                                                {/* Share Button */}
                                                <td style={{ padding: '16px', textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => handleShare(candidate)}
                                                        title="مشاركة رابط المقابلة الصوتية"
                                                        style={{
                                                            width: '48px',
                                                            height: '48px',
                                                            borderRadius: '12px',
                                                            border: 'none',
                                                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                            color: '#fff',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: '22px',
                                                            fontWeight: 'bold',
                                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3), 0 0 0 1px rgba(16, 185, 129, 0.2)',
                                                            position: 'relative',
                                                            overflow: 'hidden'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1.15) translateY(-2px)';
                                                            e.currentTarget.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
                                                            e.currentTarget.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.5), 0 0 0 2px rgba(16, 185, 129, 0.4)';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1) translateY(0)';
                                                            e.currentTarget.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3), 0 0 0 1px rgba(16, 185, 129, 0.2)';
                                                        }}
                                                        onMouseDown={(e) => {
                                                            e.currentTarget.style.transform = 'scale(0.9) translateY(0)';
                                                        }}
                                                        onMouseUp={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1.15) translateY(-2px)';
                                                        }}
                                                    >
                                                        <span style={{
                                                            display: 'inline-block',
                                                            transition: 'transform 0.3s ease',
                                                            filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))'
                                                        }}>
                                                            📤
                                                        </span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Stats */}
                {!loading && candidates.length > 0 && (
                    <div style={{
                        marginTop: '30px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '20px'
                    }}>
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.5)',
                            padding: '20px',
                            borderRadius: '12px',
                            border: '1px solid rgba(148, 163, 184, 0.1)'
                        }}>
                            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>Total Evaluations</div>
                            <div style={{ color: '#F1F5F9', fontSize: '28px', fontWeight: 700 }}>{candidates.length}</div>
                        </div>
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.5)',
                            padding: '20px',
                            borderRadius: '12px',
                            border: '1px solid rgba(148, 163, 184, 0.1)'
                        }}>
                            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>Hire</div>
                            <div style={{ color: '#10B981', fontSize: '28px', fontWeight: 700 }}>
                                {candidates.filter(c => c.writtenInterviewEvaluation?.recommendation === 'Hire').length}
                            </div>
                        </div>
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.5)',
                            padding: '20px',
                            borderRadius: '12px',
                            border: '1px solid rgba(148, 163, 184, 0.1)'
                        }}>
                            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>Consider</div>
                            <div style={{ color: '#F59E0B', fontSize: '28px', fontWeight: 700 }}>
                                {candidates.filter(c => c.writtenInterviewEvaluation?.recommendation === 'Consider').length}
                            </div>
                        </div>
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.5)',
                            padding: '20px',
                            borderRadius: '12px',
                            border: '1px solid rgba(148, 163, 184, 0.1)'
                        }}>
                            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>Reject</div>
                            <div style={{ color: '#EF4444', fontSize: '28px', fontWeight: 700 }}>
                                {candidates.filter(c => c.writtenInterviewEvaluation?.recommendation === 'Reject').length}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WrittenInterview;

