import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import Navigation from '../components/Navigation';
import NewInterviewSidebar from '../components/NewInterviewSidebar';
import API_CONFIG from '../config/api';

const Dashboard = () => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const chartContainerRef = useRef(null);
    const [chartWidth, setChartWidth] = useState(1000);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [recentInterviews, setRecentInterviews] = useState([]);
    const [loadingInterviews, setLoadingInterviews] = useState(true);
    const [stats, setStats] = useState([
        { icon: '📊', value: '0', label: 'Total Interviews', color: 'linear-gradient(135deg, #3B82F6 0%, #0EA5E9 50%, #06B6D4 100%)', bgColor: 'rgba(59, 130, 246, 0.15)' },
        { icon: '✅', value: '0', label: 'Completed', color: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', bgColor: 'rgba(16, 185, 129, 0.15)' },
        { icon: '⏳', value: '0', label: 'In Progress', color: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', bgColor: 'rgba(245, 158, 11, 0.15)' },
        { icon: '📈', value: '0%', label: 'Success Rate', color: 'linear-gradient(135deg, #0EA5E9 0%, #06B6D4 100%)', bgColor: 'rgba(14, 165, 233, 0.15)' }
    ]);
    const [loadingStats, setLoadingStats] = useState(true);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);

    useEffect(() => {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/c523ff2f-71ad-4967-831d-33b661a300a0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Dashboard.jsx:8',message:'Dashboard page loaded',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'dashboard-load',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        // Calculate chart width based on container
        const updateChartWidth = () => {
            if (chartContainerRef.current) {
                const containerWidth = chartContainerRef.current.offsetWidth;
                setChartWidth(Math.max(800, containerWidth - 80));
            }
        };
        
        updateChartWidth();
        
        const handleResize = () => {
            updateChartWidth();
            setWindowWidth(window.innerWidth);
        };
        
        window.addEventListener('resize', handleResize);
        
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // جلب إحصائيات Dashboard من API
    useEffect(() => {
        const fetchDashboardStats = async () => {
            try {
                setLoadingStats(true);
                const response = await fetch(API_CONFIG.ENDPOINTS.STATS);
                const result = await response.json();
                
                if (result.success && result.data) {
                    const data = result.data;
                    setStats([
                        { 
                            icon: '📊', 
                            value: data.totalInterviews?.toLocaleString() || '0', 
                            label: 'Total Interviews',
                            color: 'linear-gradient(135deg, #3B82F6 0%, #0EA5E9 50%, #06B6D4 100%)',
                            bgColor: 'rgba(59, 130, 246, 0.15)'
                        },
                        { 
                            icon: '✅', 
                            value: data.completed?.toLocaleString() || '0', 
                            label: 'Completed',
                            color: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                            bgColor: 'rgba(16, 185, 129, 0.15)'
                        },
                        { 
                            icon: '⏳', 
                            value: data.inProgress?.toLocaleString() || '0', 
                            label: 'In Progress',
                            color: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                            bgColor: 'rgba(245, 158, 11, 0.15)'
                        },
                        { 
                            icon: '📈', 
                            value: `${data.successRate || 0}%`, 
                            label: 'Success Rate',
                            color: 'linear-gradient(135deg, #0EA5E9 0%, #06B6D4 100%)',
                            bgColor: 'rgba(14, 165, 233, 0.15)'
                        }
                    ]);
                }
            } catch (error) {
                console.error('Error fetching dashboard stats:', error);
            } finally {
                setLoadingStats(false);
            }
        };

        fetchDashboardStats();
    }, []);

    // جلب بيانات المرشحين من API
    useEffect(() => {
        const fetchRecentInterviews = async () => {
            try {
                setLoadingInterviews(true);
                const response = await fetch(API_CONFIG.ENDPOINTS.CANDIDATES);
                const result = await response.json();
                
                if (result.success && result.data) {
                    // تحويل البيانات إلى تنسيق Recent Interviews
                    const interviews = result.data
                        .map((candidate) => {
                            const name = candidate.firstName && candidate.lastName
                                ? `${candidate.firstName} ${candidate.lastName}`
                                : candidate.candidate || candidate.email?.split('@')[0] || 'Unknown';
                            
                            // تحديد حالة المقابلة بناءً على status
                            let interviewStatus = 'pending';
                            if (candidate.status === 'accepted') {
                                interviewStatus = 'completed';
                            } else if (candidate.status === 'rejected') {
                                interviewStatus = 'completed';
                            } else if (candidate.status === 'pending') {
                                interviewStatus = 'in-progress';
                            }
                            
                            return {
                                id: candidate._id || candidate.id,
                                candidate: name,
                                position: candidate.positionAppliedFor || 'N/A',
                                status: interviewStatus,
                                date: candidate.interviewDate || candidate.createdAt || new Date().toISOString().split('T')[0],
                                originalStatus: candidate.status,
                                email: candidate.email
                            };
                        })
                        .sort((a, b) => {
                            // ترتيب حسب التاريخ (الأحدث أولاً)
                            return new Date(b.date) - new Date(a.date);
                        })
                        .slice(0, 4); // آخر 4 مقابلات
                    
                    setRecentInterviews(interviews);
                } else {
                    // Fallback data إذا لم تكن هناك بيانات
                    setRecentInterviews([
                        { id: 1, candidate: 'Ahmed Al-Mansouri', position: 'Software Engineer', status: 'completed', date: '2025-01-15' },
                        { id: 2, candidate: 'Sarah Johnson', position: 'Product Manager', status: 'in-progress', date: '2025-01-14' },
                        { id: 3, candidate: 'Mohammed Hassan', position: 'Data Analyst', status: 'pending', date: '2025-01-13' },
                        { id: 4, candidate: 'Emily Chen', position: 'UX Designer', status: 'completed', date: '2025-01-12' }
                    ]);
                }
            } catch (error) {
                console.error('Error fetching recent interviews:', error);
                // Fallback data في حالة الخطأ
                setRecentInterviews([
                    { id: 1, candidate: 'Ahmed Al-Mansouri', position: 'Software Engineer', status: 'completed', date: '2025-01-15' },
                    { id: 2, candidate: 'Sarah Johnson', position: 'Product Manager', status: 'in-progress', date: '2025-01-14' },
                    { id: 3, candidate: 'Mohammed Hassan', position: 'Data Analyst', status: 'pending', date: '2025-01-13' },
                    { id: 4, candidate: 'Emily Chen', position: 'UX Designer', status: 'completed', date: '2025-01-12' }
                ]);
            } finally {
                setLoadingInterviews(false);
            }
        };

        fetchRecentInterviews();
    }, []);

    // Services - 9 containers
    const services = [
        {
            icon: '➕',
            title: 'New Interview',
            description: '',
            status: 'Active'
        },
        {
            icon: '📋',
            title: 'View Reports',
            description: '',
            status: 'Active'
        },
        {
            icon: '👥',
            title: 'Candidates',
            description: '',
            status: 'Active'
        },
        {
            icon: '✍️',
            title: 'Written Interview',
            description: '',
            status: 'Active'
        },
        {
            icon: '🎤',
            title: 'Voice Interview',
            description: '',
            status: 'Active'
        },
        {
            icon: '📹',
            title: 'Video Interview',
            description: '',
            status: 'Active'
        },
        {
            icon: '⚙️',
            title: 'Settings',
            description: '',
            status: 'Active'
        },
        {
            icon: '📝',
            title: 'Interview Templates',
            description: '',
            status: 'Active'
        },
        {
            icon: '👤',
            title: 'Account',
            description: '',
            status: 'Active'
        }
    ];

    // Recent Interviews - يتم جلبها من API الآن (تم نقلها إلى useEffect)

    // Quick Actions
    const quickActions = [
        { icon: '➕', label: 'New Interview', action: () => setIsSidebarOpen(true) },
        { icon: '📋', label: 'View Reports', action: () => navigate('/reports') },
        { icon: '✍️', label: 'Written Interview', action: () => navigate('/written-interview') },
        { icon: '⚙️', label: 'Settings', action: () => console.log('Settings') },
        { icon: '👥', label: 'Candidates', action: () => navigate('/candidates') }
    ];

    // Handle sidebar option selection
    const handleSidebarOption = (optionId) => {
        console.log('Selected option:', optionId);
        switch(optionId) {
            case 'start-process':
                // Navigate to start process page or show form
                console.log('Start Process selected');
                break;
            case 'video-interview':
                // Navigate to video interview page
                console.log('Video Interview selected');
                break;
            case 'audio-interview':
                // Navigate to audio interview page
                console.log('Audio Interview selected');
                break;
            default:
                break;
        }
    };

    // Chart Data - Monthly Hiring Performance (Last 6 months)
    const chartData = [
        { month: 'Jul', interviews: 142, hired: 28, conversionRate: 19.7 },
        { month: 'Aug', interviews: 158, hired: 32, conversionRate: 20.3 },
        { month: 'Sep', interviews: 165, hired: 35, conversionRate: 21.2 },
        { month: 'Oct', interviews: 178, hired: 38, conversionRate: 21.3 },
        { month: 'Nov', interviews: 192, hired: 42, conversionRate: 21.9 },
        { month: 'Dec', interviews: 205, hired: 48, conversionRate: 23.4 }
    ];

    // Key Performance Indicators
    const kpiMetrics = {
        monthlyHiringRate: 23.4, // Current month hiring rate
        averageTimeToHire: 18, // Days
        totalHired: 223, // Total hired this year
        offerAcceptanceRate: 87.5, // Percentage
        candidateSatisfaction: 4.6, // Out of 5
        interviewCompletionRate: 94.2 // Percentage
    };

    // Calculate chart dimensions and scaling
    const chartHeight = 300;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const graphWidth = chartWidth - padding.left - padding.right;
    const graphHeight = chartHeight - padding.top - padding.bottom;
    
    const maxValue = Math.max(...chartData.flatMap(d => [d.interviews, d.hired]));
    const yScale = graphHeight / maxValue;
    const xScale = graphWidth / (chartData.length - 1);

    // Generate path for line chart
    const generatePath = (dataKey) => {
        return chartData.map((point, index) => {
            const x = padding.left + index * xScale;
            const y = padding.top + graphHeight - (point[dataKey] * yScale);
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');
    };

    // Calculate growth percentage
    const calculateGrowth = (current, previous) => {
        if (previous === 0) return 0;
        return ((current - previous) / previous * 100).toFixed(1);
    };

    const currentMonthHired = chartData[chartData.length - 1].hired;
    const previousMonthHired = chartData[chartData.length - 2].hired;
    const hiringGrowth = calculateGrowth(currentMonthHired, previousMonthHired);

    // Generate area path
    const generateAreaPath = (dataKey) => {
        const path = generatePath(dataKey);
        const lastPoint = chartData[chartData.length - 1];
        const firstPoint = chartData[0];
        const lastX = padding.left + (chartData.length - 1) * xScale;
        const firstX = padding.left;
        const bottomY = padding.top + graphHeight;
        return `${path} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
    };

    return (
        <>
            <Navigation />
        <div className="dashboard-page" style={{ 
            minHeight: '100vh', 
                padding: '70px 20px 40px',
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
                    maxWidth: '1400px', 
                    margin: '0 auto', 
                    position: 'relative', 
                    zIndex: 1,
                    minHeight: 'calc(100vh - 250px)'
                }}>
                    {/* Header */}
                    <div className="design-header" style={{ marginBottom: '40px' }}>
                        <div style={{ width: '100%' }}>
                            <h1 className="design-title" style={{ marginBottom: '8px' }}>
                    Dashboard
                </h1>
                            <p className="design-subtitle">
                                Welcome back! Manage your interviews and track your progress with AI-powered insights.
                            </p>
                            
                            {/* Stats Cards - داخل كونتنر Dashboard */}
                            <div className="dashboard-stats" style={{ 
                                marginTop: '24px',
                                display: 'grid',
                                gridTemplateColumns: windowWidth < 768 ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
                                gap: '12px'
                            }}>
                                {stats.map((stat, index) => (
                                    <div key={index} className="stat-card" style={{
                                        padding: '12px 16px',
                                        minHeight: 'auto',
                                        transition: 'all 0.3s ease',
                                        cursor: 'pointer',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '12px'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                        e.currentTarget.style.borderColor = '#06B6D4';
                                        e.currentTarget.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.5)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}>
                                        <div className="stat-icon" style={{ 
                                            background: stat.bgColor,
                                            border: `1px solid ${stat.color.split(' ')[0].replace('linear-gradient(135deg,', '').replace('0%,', '').trim()}`,
                                            width: '40px',
                                            height: '40px',
                                            fontSize: '20px'
                                        }}>
                                            <span style={{ fontSize: '20px' }}>{stat.icon}</span>
                                        </div>
                                        <div className="stat-content">
                                            <div className="stat-value" style={{ 
                                                background: stat.color, 
                                                WebkitBackgroundClip: 'text', 
                                                WebkitTextFillColor: 'transparent', 
                                                backgroundClip: 'text',
                                                fontSize: windowWidth < 768 ? '18px' : '20px',
                                                fontWeight: 700
                                            }}>
                                                {loadingStats ? '...' : stat.value}
                                            </div>
                                            <div className="stat-label" style={{ fontSize: windowWidth < 768 ? '10px' : '11px', marginTop: '4px' }}>{stat.label}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Main Content Grid */}
                    <div className="dashboard-grid" style={{ marginBottom: '40px' }}>
                        {/* Our Services */}
                        <div className="dashboard-card platform-features-card">
                            <div className="dashboard-card-header">
                                <h2 className="dashboard-card-title">Our Services</h2>
                            </div>
                            <div className="dashboard-card-body">
                                {/* 9 containers in 3x3 grid */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: windowWidth < 768 ? 'repeat(2, 1fr)' : windowWidth < 1024 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                                    gap: '20px'
                                }}
                                className="platform-features-grid">
                                    {services.map((service, index) => {
                                        const serviceColors = {
                                            'New Interview': '#3B82F6',
                                            'View Reports': '#22d3ee',
                                            'Settings': '#10B981',
                                            'Written Interview': '#F59E0B',
                                            'Voice Interview': '#EC4899',
                                            'Video Interview': '#06B6D4',
                                            'Account': '#8B5CF6',
                                            'Candidates': '#F59E0B',
                                            'Interview Templates': '#06B6D4'
                                        };
                                        const serviceColor = serviceColors[service.title] || '#3B82F6';
                                        
                                        // تحديد action لكل بطاقة
                                        const handleClick = () => {
                                            switch(service.title) {
                                                case 'New Interview':
                                                    setIsSidebarOpen(true);
                                                    break;
                                                case 'View Reports':
                                                    navigate('/reports');
                                                    break;
                                                case 'Settings':
                                                    console.log('Settings');
                                                    break;
                                                case 'Written Interview':
                                                    navigate('/written-interview');
                                                    break;
                                                case 'Voice Interview':
                                                    console.log('Voice Interview');
                                                    break;
                                                case 'Video Interview':
                                                    console.log('Video Interview');
                                                    break;
                                                case 'Account':
                                                    console.log('Account');
                                                    break;
                                                case 'Candidates':
                                                    navigate('/candidates');
                                                    break;
                                                case 'Interview Templates':
                                                    navigate('/interview-templates');
                                                    break;
                                                default:
                                                    break;
                                            }
                                        };
                                        
                                        return (
                                            <div key={index} style={{
                                                padding: '20px',
                                                background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
                                                backdropFilter: 'blur(20px)',
                                                borderRadius: '12px',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                transition: 'all 0.3s ease',
                                                cursor: 'pointer'
                                            }}
                                            onClick={handleClick}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'translateY(-4px)';
                                                e.currentTarget.style.borderColor = '#06B6D4';
                                                e.currentTarget.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.5)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                                e.currentTarget.style.boxShadow = 'none';
                                            }}>
                                                <div style={{
                                                    width: '56px', 
                                                    height: '56px', 
                                                    borderRadius: '12px',
                                                    background: `linear-gradient(135deg, ${serviceColor}20, ${serviceColor}10)`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    marginBottom: '16px',
                                                    border: `1px solid ${serviceColor}40`,
                                                    fontSize: '32px'
                                                }}>
                                                    {service.icon}
                                                </div>
                                                <h3 style={{ 
                                                    fontSize: '18px', 
                                                    fontWeight: 700, 
                                                    color: '#fff', 
                                                    marginBottom: service.description ? '8px' : '16px'
                                                }}>
                                                    {service.title}
                                                </h3>
                                                {service.description && (
                                                    <p style={{ 
                                                        fontSize: '14px', 
                                                        color: '#94A3B8', 
                                                        lineHeight: '1.6',
                                                        margin: '0 0 12px 0'
                                                    }}>
                                                        {service.description}
                                                    </p>
                                                )}
                                                <span className={`status-badge ${
                                                    service.status === 'Active' ? 'status-active' : 
                                                    service.status === 'Coming Soon' ? 'status-pending' : 
                                                    'status-completed'
                                                }`} style={{
                                                    display: 'inline-block',
                                                    marginTop: service.description ? '8px' : '0'
                                                }}>
                                                    {service.status}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Recent Interviews */}
                        <div className="dashboard-card">
                            <div className="dashboard-card-header">
                                <h2 className="dashboard-card-title">Recent Interviews</h2>
                                <button 
                                    className="btn-small"
                                    onClick={() => navigate('/candidates')}
                                    style={{ cursor: 'pointer' }}
                                >
                                    View All
                                </button>
                            </div>
                            <div className="dashboard-card-body">
                                {loadingInterviews ? (
                                    <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                        Loading interviews...
                                    </div>
                                ) : recentInterviews.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '40px', color: '#94A3B8' }}>
                                        No recent interviews found
                                    </div>
                                ) : (
                                    <div className="interview-list">
                                        {recentInterviews.map((interview) => (
                                        <div key={interview.id} className="interview-item" style={{
                                            transition: 'all 0.3s ease',
                                            cursor: 'pointer',
                                            border: '1px solid rgba(255, 255, 255, 0.1)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateX(4px)';
                                            e.currentTarget.style.borderColor = '#06B6D4';
                                            e.currentTarget.style.boxShadow = '0 0 15px rgba(6, 182, 212, 0.4)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateX(0)';
                                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }}>
                                            <div style={{ flex: 1 }}>
                                                <div className="interview-title">{interview.candidate}</div>
                                                <div className="interview-meta">
                                                    {interview.position} • {new Date(interview.date).toLocaleDateString()}
                                                </div>
                                            </div>
                                            <span className={`status-badge ${
                                                interview.status === 'completed' ? 'status-completed' : 
                                                interview.status === 'in-progress' ? 'status-active' : 
                                                'status-pending'
                                            }`}>
                                                {interview.status}
                                            </span>
                                        </div>
                                    ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    {/* Analytics Chart */}
                    <div style={{ marginBottom: '40px', width: '100%' }}>
                        {/* Analytics Chart */}
                        <div className="dashboard-card" style={{ 
                            width: '100%',
                            transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#06B6D4';
                            e.currentTarget.style.boxShadow = '0 0 25px rgba(6, 182, 212, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}>
                            <div className="dashboard-card-header">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '20px' }}>
                                    <div>
                                        <h2 className="dashboard-card-title" style={{ marginBottom: '8px' }}>Hiring Performance Analytics</h2>
                                        <p style={{ fontSize: '14px', color: '#94A3B8', margin: 0 }}>Monthly hiring trends and conversion metrics</p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#3B82F6' }}></div>
                                            <span style={{ fontSize: '14px', color: '#94A3B8' }}>Interviews</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#10B981' }}></div>
                                            <span style={{ fontSize: '14px', color: '#94A3B8' }}>Hired</span>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* KPI Metrics Row */}
                                <div style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: 'repeat(3, 1fr)', 
                                    gap: '16px',
                                    marginTop: '20px',
                                    padding: '16px',
                                    background: 'rgba(6, 182, 212, 0.05)',
                                    borderRadius: '12px',
                                    border: '1px solid rgba(6, 182, 212, 0.2)'
                                }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>Monthly Hiring Rate</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, background: 'linear-gradient(135deg, #10B981, #059669)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                                            {kpiMetrics.monthlyHiringRate}%
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#10B981', marginTop: '4px' }}>
                                            ↑ {hiringGrowth}% vs last month
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>Avg. Time to Hire</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, background: 'linear-gradient(135deg, #3B82F6, #0EA5E9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                                            {kpiMetrics.averageTimeToHire} days
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
                                            Industry avg: 24 days
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>Total Hired (YTD)</div>
                                        <div style={{ fontSize: '24px', fontWeight: 700, background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                                            {kpiMetrics.totalHired}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#10B981', marginTop: '4px' }}>
                                            ↑ 15% vs last year
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="dashboard-card-body">
                                <div ref={chartContainerRef} className="chart-container" style={{ 
                                    height: '350px', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                    width: '100%'
                                }}>
                                    <svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible' }}>
                                        {/* Grid lines */}
                                        {[0, 1, 2, 3, 4].map((i) => {
                                            const y = padding.top + (graphHeight / 4) * i;
                                            return (
                                                <line
                                                    key={i}
                                                    x1={padding.left}
                                                    y1={y}
                                                    x2={padding.left + graphWidth}
                                                    y2={y}
                                                    stroke="rgba(255, 255, 255, 0.05)"
                                                    strokeWidth="1"
                                                />
                                            );
                                        })}

                                        {/* Y-axis labels */}
                                        {[0, 1, 2, 3, 4].map((i) => {
                                            const value = Math.round((maxValue / 4) * (4 - i));
                                            const y = padding.top + (graphHeight / 4) * i;
                                            return (
                                                <text
                                                    key={i}
                                                    x={padding.left - 10}
                                                    y={y + 4}
                                                    fill="#94A3B8"
                                                    fontSize="12"
                                                    textAnchor="end"
                                                >
                                                    {value}
                                                </text>
                                            );
                                        })}

                                        {/* Area for Total Interviews */}
                                        <path
                                            d={generateAreaPath('interviews')}
                                            fill="url(#gradientTotal)"
                                            opacity="0.2"
                                        />

                                        {/* Area for Hired */}
                                        <path
                                            d={generateAreaPath('hired')}
                                            fill="url(#gradientCompleted)"
                                            opacity="0.2"
                                        />

                                        {/* Line for Total Interviews */}
                                        <path
                                            d={generatePath('interviews')}
                                            fill="none"
                                            stroke="#3B82F6"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />

                                        {/* Line for Hired */}
                                        <path
                                            d={generatePath('hired')}
                                            fill="none"
                                            stroke="#10B981"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />

                                        {/* Data points for Total */}
                                        {chartData.map((point, index) => {
                                            const x = padding.left + index * xScale;
                                            const y = padding.top + graphHeight - (point.interviews * yScale);
                                            return (
                                                <g key={`total-${index}`}>
                                                    <circle
                                                        cx={x}
                                                        cy={y}
                                                        r="5"
                                                        fill="#3B82F6"
                                                        stroke="#0a0e1a"
                                                        strokeWidth="2"
                                                    />
                                                </g>
                                            );
                                        })}

                                        {/* Data points for Hired */}
                                        {chartData.map((point, index) => {
                                            const x = padding.left + index * xScale;
                                            const y = padding.top + graphHeight - (point.hired * yScale);
                                            return (
                                                <g key={`hired-${index}`}>
                                                    <circle
                                                        cx={x}
                                                        cy={y}
                                                        r="5"
                                                        fill="#10B981"
                                                        stroke="#0a0e1a"
                                                        strokeWidth="2"
                                                    />
                                                </g>
                                            );
                                        })}

                                        {/* X-axis labels */}
                                        {chartData.map((point, index) => {
                                            const x = padding.left + index * xScale;
                                            return (
                                                <g key={index}>
                                                    <text
                                                        x={x}
                                                        y={chartHeight - padding.bottom + 20}
                                                        fill="#94A3B8"
                                                        fontSize="12"
                                                        textAnchor="middle"
                                                    >
                                                        {point.month}
                                                    </text>
                                                    {/* Conversion rate below month */}
                                                    <text
                                                        x={x}
                                                        y={chartHeight - padding.bottom + 35}
                                                        fill="#06B6D4"
                                                        fontSize="10"
                                                        textAnchor="middle"
                                                        fontWeight="600"
                                                    >
                                                        {point.conversionRate}%
                                                    </text>
                                                </g>
                                            );
                                        })}

                                        {/* Gradients */}
                                        <defs>
                                            <linearGradient id="gradientTotal" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.4" />
                                                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                                            </linearGradient>
                                            <linearGradient id="gradientCompleted" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
                                                <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
                                            </linearGradient>
                                        </defs>
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* New Interview Sidebar */}
            <NewInterviewSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onSelectOption={handleSidebarOption}
            />
        </>
    );
};

export default Dashboard;
