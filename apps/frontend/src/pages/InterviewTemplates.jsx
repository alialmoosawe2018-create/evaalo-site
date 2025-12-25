import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navigation from '../components/Navigation';
import { useInterviewTemplate } from '../contexts/InterviewTemplateContext';

const InterviewTemplates = () => {
    const navigate = useNavigate();
    const { templates, selectedTemplate, selectedVideoTemplate, selectedAudioTemplate, selectTemplate, getSelectedTemplateByType } = useInterviewTemplate();
    const [copiedTemplateId, setCopiedTemplateId] = useState(null);
    const [activeSection, setActiveSection] = useState('process'); // 'process', 'written', 'voice', 'video'
    
    // تقسيم القوالب حسب النوع
    const processTemplates = templates.filter(t => t.type === 'process');
    const videoTemplates = templates.filter(t => t.type === 'video');
    const audioTemplates = templates.filter(t => t.type === 'audio');

    const handleSelectTemplate = (template) => {
        selectTemplate(template);
        alert(`تم اختيار القالب: ${template.name}`);
    };

    const handleCopyLink = (templateId, e) => {
        e.stopPropagation();
        const link = `${window.location.origin}/form?template=${templateId}`;
        navigator.clipboard.writeText(link).then(() => {
            setCopiedTemplateId(templateId);
            setTimeout(() => setCopiedTemplateId(null), 2000);
        });
    };

    const getFieldDisplayName = (field) => {
        const fieldNames = {
            firstName: 'First Name',
            lastName: 'Last Name',
            email: 'Email',
            phone: 'Phone',
            positionAppliedFor: 'Position',
            yearsOfExperience: 'Experience',
            currentCompany: 'Current Company',
            highestEducationLevel: 'Education',
            skills: 'Skills',
            languages: 'Languages',
            certifications: 'Certifications',
            coverLetter: 'Cover Letter'
        };
        return fieldNames[field] || field;
    };

    // مكون لعرض القوالب
    const TemplateCard = ({ template, isSelected, onSelect, onCopyLink, color }) => {
        return (
            <div
                onClick={() => onSelect(template)}
                style={{
                    padding: '16px',
                    background: isSelected
                        ? `linear-gradient(180deg, ${color}15 0%, rgba(15, 23, 42, 0.95) 100%)`
                        : 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
                    backdropFilter: 'blur(20px)',
                    borderRadius: '12px',
                    border: isSelected
                        ? `1px solid ${color}`
                        : '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    width: '220px',
                    minHeight: '240px',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: isSelected ? `0 0 20px ${color}50` : 'none'
                }}
                onMouseEnter={(e) => {
                    if (!isSelected) {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.borderColor = color;
                        e.currentTarget.style.boxShadow = `0 0 20px ${color}50`;
                    }
                }}
                onMouseLeave={(e) => {
                    if (!isSelected) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                    }
                }}
            >
                {isSelected && (
                    <div style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        padding: '2px 6px',
                        background: color,
                        borderRadius: '6px',
                        fontSize: '8px',
                        fontWeight: 700,
                        color: '#fff',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Selected
                    </div>
                )}

                {template.isDefault && !isSelected && (
                    <div style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        padding: '2px 6px',
                        background: 'rgba(16, 185, 129, 0.2)',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        borderRadius: '6px',
                        fontSize: '8px',
                        fontWeight: 600,
                        color: '#10B981',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Default
                    </div>
                )}


                <h3 style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#fff',
                    marginBottom: '4px',
                    background: isSelected
                        ? `linear-gradient(135deg, ${color}, ${color}dd)`
                        : 'none',
                    WebkitBackgroundClip: isSelected ? 'text' : 'none',
                    WebkitTextFillColor: isSelected ? 'transparent' : '#fff',
                    backgroundClip: isSelected ? 'text' : 'none',
                    lineHeight: '1.3'
                }}>
                    {template.name}
                </h3>

                <p style={{
                    fontSize: '11px',
                    color: '#94A3B8',
                    marginBottom: '10px',
                    lineHeight: '1.4',
                    minHeight: '32px'
                }}>
                    {template.description}
                </p>

                <div style={{
                    marginBottom: '10px',
                    padding: '6px',
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '6px'
                }}>
                    <div style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        color: '#CBD5E1',
                        marginBottom: '4px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Fields ({template.fields.length}):
                    </div>
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '3px'
                    }}>
                        {template.fields.slice(0, 3).map((field, index) => (
                            <span
                                key={index}
                                style={{
                                    padding: '2px 5px',
                                    background: `${color}15`,
                                    border: `1px solid ${color}30`,
                                    borderRadius: '4px',
                                    fontSize: '8px',
                                    color: color
                                }}
                            >
                                {getFieldDisplayName(field)}
                            </span>
                        ))}
                        {template.fields.length > 3 && (
                            <span style={{
                                padding: '2px 5px',
                                background: `${color}15`,
                                border: `1px solid ${color}30`,
                                borderRadius: '4px',
                                fontSize: '8px',
                                color: color
                            }}>
                                +{template.fields.length - 3}
                            </span>
                        )}
                    </div>
                </div>

                <div style={{
                    display: 'flex',
                    gap: '6px',
                    marginTop: 'auto'
                }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            window.open(`${window.location.origin}/form?template=${template.id}`, '_blank');
                        }}
                        className="btn btn-secondary"
                        style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            backdropFilter: 'blur(10px)',
                            color: '#ffffff',
                            border: '2px solid rgba(56, 189, 248, 0.4)',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';
                            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.6)';
                            e.currentTarget.style.transform = 'translateY(-3px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        <span>View Form</span>
                    </button>
                    <button
                        onClick={(e) => onCopyLink(template.id, e)}
                        className="btn btn-secondary"
                        style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            backdropFilter: 'blur(10px)',
                            color: '#ffffff',
                            border: '2px solid rgba(56, 189, 248, 0.4)',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';
                            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.6)';
                            e.currentTarget.style.transform = 'translateY(-3px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        <span>{copiedTemplateId === template.id ? '✓ Copied!' : 'Copy Link'}</span>
                    </button>
                </div>
            </div>
        );
    };

    // مكون لعرض قسم القوالب
    const TemplateSection = ({ title, icon, description, templates, selectedTemplate, color }) => {
        return (
            <div style={{ marginBottom: '40px' }}>
                <div style={{
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '16px',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-start',
                    alignItems: 'stretch'
                }}>
                    {templates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            isSelected={selectedTemplate?.id === template.id}
                            onSelect={handleSelectTemplate}
                            onCopyLink={handleCopyLink}
                            color={color}
                        />
                    ))}
                </div>
            </div>
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
                <div className="design-background">
                    <div className="design-orb-1"></div>
                    <div className="design-orb-2"></div>
                    <div className="design-orb-3"></div>
                </div>

                <div className="container" style={{ 
                    maxWidth: '1400px', 
                    margin: '0 auto', 
                    position: 'relative', 
                    zIndex: 1
                }}>
                    <div className="design-header" style={{ marginBottom: '32px' }}>
                        <div style={{ width: '100%' }}>
                            <h1 className="design-title" style={{ marginBottom: '8px', fontSize: '36px' }}>
                                Interview Templates
                            </h1>
                            <p className="design-subtitle" style={{ marginBottom: '20px' }}>
                                اختر قالب الاستمارة الذي تريد استخدامه حسب نوع المقابلة
                            </p>
                            
                            {/* Action Buttons */}
                            <div style={{
                                display: 'flex',
                                gap: '12px',
                                flexWrap: 'wrap'
                            }}>
                                <button
                                    onClick={() => setActiveSection('process')}
                                    className="btn-small"
                                    style={{
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease',
                                        background: activeSection === 'process' ? 'rgba(59, 130, 246, 0.2)' : undefined,
                                        borderColor: activeSection === 'process' ? 'rgba(59, 130, 246, 0.5)' : undefined
                                    }}
                                    onMouseEnter={(e) => {
                                        if (activeSection !== 'process') {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (activeSection !== 'process') {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }
                                    }}
                                >
                                    Process
                                </button>
                                
                                <button
                                    onClick={() => setActiveSection('written')}
                                    className="btn-small"
                                    style={{
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease',
                                        background: activeSection === 'written' ? 'rgba(16, 185, 129, 0.2)' : undefined,
                                        borderColor: activeSection === 'written' ? 'rgba(16, 185, 129, 0.5)' : undefined
                                    }}
                                    onMouseEnter={(e) => {
                                        if (activeSection !== 'written') {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (activeSection !== 'written') {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }
                                    }}
                                >
                                    Written
                                </button>
                                
                                <button
                                    onClick={() => setActiveSection('voice')}
                                    className="btn-small"
                                    style={{
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease',
                                        background: activeSection === 'voice' ? 'rgba(236, 72, 153, 0.2)' : undefined,
                                        borderColor: activeSection === 'voice' ? 'rgba(236, 72, 153, 0.5)' : undefined
                                    }}
                                    onMouseEnter={(e) => {
                                        if (activeSection !== 'voice') {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(236, 72, 153, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (activeSection !== 'voice') {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }
                                    }}
                                >
                                    Voice
                                </button>
                                
                                <button
                                    onClick={() => setActiveSection('video')}
                                    className="btn-small"
                                    style={{
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease',
                                        background: activeSection === 'video' ? 'rgba(6, 182, 212, 0.2)' : undefined,
                                        borderColor: activeSection === 'video' ? 'rgba(6, 182, 212, 0.5)' : undefined
                                    }}
                                    onMouseEnter={(e) => {
                                        if (activeSection !== 'video') {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(6, 182, 212, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (activeSection !== 'video') {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }
                                    }}
                                >
                                    Video
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Process Templates */}
                    {activeSection === 'process' && (
                        <div id="process-section">
                            <TemplateSection
                                title="Process Templates"
                                description="قوالب لمراحل العملية الكاملة (Start Process)"
                                templates={processTemplates}
                                selectedTemplate={selectedTemplate}
                                color="#3B82F6"
                            />
                        </div>
                    )}

                    {/* Written Templates */}
                    {activeSection === 'written' && (
                        <div id="written-section">
                            <TemplateSection
                                title="Written Interview Templates"
                                description="قوالب للمقابلات المكتوبة (Written Interview)"
                                templates={[]}
                                selectedTemplate={null}
                                color="#10B981"
                            />
                        </div>
                    )}

                    {/* Audio Interview Templates */}
                    {activeSection === 'voice' && (
                        <div id="audio-section">
                            <TemplateSection
                                title="Audio Interview Templates"
                                description="قوالب للمقابلات الصوتية (Audio Interview)"
                                templates={audioTemplates}
                                selectedTemplate={selectedAudioTemplate}
                                color="#EC4899"
                            />
                        </div>
                    )}

                    {/* Video Interview Templates */}
                    {activeSection === 'video' && (
                        <div id="video-section">
                            <TemplateSection
                                title="Video Interview Templates"
                                description="قوالب للمقابلات بالفيديو (Video Interview)"
                                templates={videoTemplates}
                                selectedTemplate={selectedVideoTemplate}
                                color="#06B6D4"
                            />
                        </div>
                    )}

                    {/* Info Card */}
                    <div style={{
                        padding: '20px',
                        background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        marginTop: '40px'
                    }}>
                        <h3 style={{
                            fontSize: '16px',
                            fontWeight: 700,
                            color: '#fff',
                            marginBottom: '10px'
                        }}>
                            كيفية الاستخدام:
                        </h3>
                        <ol style={{
                            paddingLeft: '20px',
                            color: '#94A3B8',
                            lineHeight: '1.8',
                            fontSize: '13px',
                            margin: 0
                        }}>
                            <li>اختر القالب المناسب من القسم المطلوب (Process / Video / Audio)</li>
                            <li>اضغط على "Copy Link" لنسخ رابط الاستمارة</li>
                            <li>اذهب إلى Dashboard واضغط على "New Interview"</li>
                            <li>اختر النوع المناسب (Start Process / Video Interview / Audio Interview)</li>
                            <li>سيتم استخدام القالب المختار تلقائياً في العملية</li>
                        </ol>
                    </div>
                </div>
            </div>
        </>
    );
};

export default InterviewTemplates;
