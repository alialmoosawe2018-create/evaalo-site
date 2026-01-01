import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import VapiWidget from '../components/VapiWidget';
import { vapiAssistants } from '../config/vapiAssistants';

const Interview = () => {
  const { id } = useParams();
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [userDisplayText, setUserDisplayText] = useState('');
  const [assistantDisplayText, setAssistantDisplayText] = useState('');
  const userTypingRef = useRef(null);
  const assistantTypingRef = useRef(null);
  const userDisplayTextRef = useRef('');
  const assistantDisplayTextRef = useRef('');
  const userTranscriptRef = useRef(null);
  const assistantTranscriptRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const vapiWidgetRef = useRef(null);
  
  const voiceInterviewConfig = vapiAssistants.voiceInterview;
  const API_KEY = voiceInterviewConfig.apiKey;
  const ASSISTANT_ID = voiceInterviewConfig.assistantId;
  
  // Update refs when display text changes
  useEffect(() => {
    userDisplayTextRef.current = userDisplayText;
  }, [userDisplayText]);

  useEffect(() => {
    assistantDisplayTextRef.current = assistantDisplayText;
  }, [assistantDisplayText]);

  // Auto-scroll to bottom when text updates
  useEffect(() => {
    if (userTranscriptRef.current) {
      // Scroll to bottom smoothly
      userTranscriptRef.current.scrollTo({
        top: userTranscriptRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [userDisplayText]);

  useEffect(() => {
    if (assistantTranscriptRef.current) {
      // Scroll to bottom smoothly
      assistantTranscriptRef.current.scrollTo({
        top: assistantTranscriptRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [assistantDisplayText]);

  useEffect(() => {
    const originalBodyStyle = {
      padding: document.body.style.padding,
      background: document.body.style.background,
      margin: document.body.style.margin
    };
    
    document.body.style.padding = '0';
    document.body.style.background = 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)';
    document.body.style.margin = '0';

    if (id) {
      console.log('Candidate ID from URL:', id);
      fetchCandidateInfo(id);
    } else {
      setLoading(false);
      console.warn('⚠️ No candidate ID in URL');
    }

    return () => {
      document.body.style.padding = originalBodyStyle.padding || '';
      document.body.style.background = originalBodyStyle.background || '';
      document.body.style.margin = originalBodyStyle.margin || '';
    };
  }, [id]);
  
  const fetchCandidateInfo = async (candidateId, retryCount = 0) => {
    const MAX_RETRIES = 2;
    const TIMEOUT_MS = 15000;
    
    try {
      setLoading(true);
      setError(null);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      // استخدام VITE_API_URL في الإنتاج، أو localhost في التطوير
      let apiUrl = import.meta.env.VITE_API_URL;
      const hostname = window.location.hostname;
      
      // إذا كان على الدومين (www.evaalo.com أو evaalo.com)، استخدم رابط الباك إند على الإنترنت دائماً
      if (hostname === 'www.evaalo.com' || hostname === 'evaalo.com') {
          apiUrl = 'https://evaalo-backend.onrender.com';
      } else if (!apiUrl) {
          // في التطوير: استخدام localhost مباشرة
          apiUrl = 'http://localhost:5000';
      }
      const fullApiUrl = `${apiUrl}/api/candidates/${candidateId}`;
      
      const response = await fetch(fullApiUrl, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('المرشح غير موجود');
        } else if (response.status >= 500) {
          throw new Error('خطأ في الخادم. يرجى المحاولة مرة أخرى');
        } else {
          throw new Error(`فشل في جلب بيانات المرشح: ${response.statusText}`);
        }
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        setCandidate(result.data);
        console.log('✅ Candidate info loaded:', result.data);
      } else {
        throw new Error('المرشح غير موجود');
      }
    } catch (err) {
      console.error('❌ Error fetching candidate:', err);
      console.log('📝 Using mock candidate data for development (temporary)');
      
      // بيانات وهمية للاستخدام عند فشل الاتصال (مؤقت للتطوير)
      const mockCandidateData = {
        _id: candidateId || '123',
        firstName: 'أحمد',
        lastName: 'الموسوي',
        email: 'ahmed@example.com',
        phone: '+966 50 123 4567',
        positionAppliedFor: 'Software Engineer',
        location: 'Riyadh, Saudi Arabia',
        jobTitle: 'Software Engineer'
      };
      
      // استخدام البيانات الوهمية بدلاً من عرض الخطأ
      setCandidate(mockCandidateData);
      setError(null); // لا نعرض خطأ، نستخدم البيانات الوهمية
    } finally {
      setLoading(false);
    }
  };

  const handleStartCall = async () => {
    console.log('🎤 Button clicked - Starting call...');
    
    // Request microphone permission first
    try {
      console.log('🎤 Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ Microphone permission granted');
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.error('❌ Microphone permission denied:', err);
      setError('يجب السماح بالوصول إلى الميكروفون لبدء المكالمة');
      return;
    }
    
    // ⚠️ مهم: استخدام Backend endpoint بدلاً من vapi.start() مباشرة
    try {
      if (!candidate) {
        setError('بيانات المرشح غير متوفرة');
        return;
      }

      // تحديد API URL
      let apiUrl = import.meta.env.VITE_API_URL;
      const hostname = window.location.hostname;
      
      if (hostname === 'www.evaalo.com' || hostname === 'evaalo.com') {
        apiUrl = 'https://evaalo-backend.onrender.com';
      } else if (!apiUrl) {
        // في التطوير: استخدام localhost مباشرة
        apiUrl = 'http://localhost:5000';
      }

      // 1️⃣ الحصول على System Prompt الديناميكي من Backend
      console.log('📞 Getting interview context from backend...');
      const contextResponse = await fetch(`${apiUrl}/api/interview-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate: {
            firstName: candidate.firstName || candidate.first_name || 'Ali',
            lastName: candidate.lastName || candidate.last_name || 'Makdhdhdh',
            jobTitle: candidate.jobTitle || candidate.positionAppliedFor || 'Data Scientist',
            location: candidate.location || 'Baghdad',
          },
        }),
      });

      if (!contextResponse.ok) {
        const errorData = await contextResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'فشل في الحصول على سياق المقابلة');
      }

      const contextResult = await contextResponse.json();
      console.log('✅ Interview context received');
      console.log('📋 System Prompt:', contextResult.systemPrompt.substring(0, 100) + '...');
      
      // 2️⃣ بدء المكالمة من Frontend باستخدام System Prompt الديناميكي
      if (vapiWidgetRef.current && vapiWidgetRef.current.startCall) {
        console.log('🚀 Starting call with dynamic system prompt...');
        // نمرر systemPrompt إلى VapiWidget
        const result = await vapiWidgetRef.current.startCall(contextResult.systemPrompt);
        console.log('✅ Call started successfully:', result);
        setIsCallActive(true);
      } else {
        throw new Error('VapiWidget غير جاهز');
      }
      
      console.log('💡 التحقق من نجاح الحقن:');
      console.log('   - يجب أن يقول EVAALO: "Hello [اسم المرشح], welcome to your interview..."');
      console.log('   - إذا لم يقل الاسم → System Prompt لم يتم حقنه بشكل صحيح');
    } catch (error) {
      console.error('❌ Error starting interview:', error);
      setError(error.message || 'فشل في بدء المكالمة. يرجى المحاولة مرة أخرى.');
    }
  };

  const handleEndCall = () => {
    if (vapiWidgetRef.current && vapiWidgetRef.current.endCall) {
      vapiWidgetRef.current.endCall();
      setIsCallActive(false);
      setTranscript([]);
      setUserDisplayText('');
      setAssistantDisplayText('');
      userDisplayTextRef.current = '';
      assistantDisplayTextRef.current = '';
      if (userTypingRef.current) {
        clearInterval(userTypingRef.current);
        userTypingRef.current = null;
      }
      if (assistantTypingRef.current) {
        clearInterval(assistantTypingRef.current);
        assistantTypingRef.current = null;
      }
    }
  };

  // Audio visualization component - Complex waveform like the image
  const AudioWave = ({ isActive, color }) => {
    const [waveHeights, setWaveHeights] = useState([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    
    useEffect(() => {
      console.log('🌊 AudioWave isActive changed:', isActive);
      
      if (!isActive) {
        // When inactive, show minimal static waves
        setWaveHeights([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
        return;
      }
      
      // When active, animate the waves
      const interval = setInterval(() => {
        setWaveHeights(prev => prev.map(() => {
          const baseHeight = 8;
          const variation = Math.random() * 32;
          return baseHeight + variation;
        }));
      }, 100);
      
      return () => clearInterval(interval);
    }, [isActive]);
    
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        height: '50px',
        padding: '0 8px',
        minWidth: '103px' // Ensure minimum width so waves are always visible
      }}>
        {waveHeights.map((height, i) => {
          // Create gradient colors (blue, green, purple)
          const hue = 240 + (i * 20) % 120; // Blue to purple range
          const saturation = 70 + (i % 3) * 10;
          const lightness = 50 + (height / 50) * 20;
          
          return (
            <div
              key={i}
              style={{
                width: '3px',
                height: `${height}px`,
                minHeight: '4px', // Ensure minimum height so waves are always visible
                background: isActive 
                  ? `linear-gradient(180deg, 
                      hsl(${hue}, ${saturation}%, ${lightness + 10}%) 0%, 
                      hsl(${hue + 30}, ${saturation}%, ${lightness}%) 50%,
                      hsl(${hue + 60}, ${saturation}%, ${lightness - 10}%) 100%)`
                  : `linear-gradient(180deg, ${color} 0%, ${color} 100%)`,
                borderRadius: '2px',
                transition: 'height 0.15s ease, background 0.15s ease',
                boxShadow: isActive 
                  ? `0 0 8px hsla(${hue}, ${saturation}%, ${lightness}%, 0.6)`
                  : 'none',
                opacity: isActive ? 1 : 0.5 // Increased opacity when inactive so waves are visible
              }}
            />
          );
        })}
      </div>
    );
  };


  if (loading) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
        justifyContent: 'center',
        background: '#E9ECFF'
    }}>
      <div style={{
          background: '#ffffff',
        borderRadius: '16px',
          padding: '60px 40px',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.1)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <p style={{ fontSize: '18px', color: '#475569' }}>جاري تحميل معلومات المقابلة...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="design-page" style={{
        minHeight: '100vh',
        padding: '90px 0 40px',
        position: 'relative',
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '12px',
          padding: '60px 40px',
          textAlign: 'center',
          boxShadow: `
            0 8px 24px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(239, 68, 68, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.03)
          `,
          maxWidth: '600px',
          border: '2px solid rgba(239, 68, 68, 0.3)',
          position: 'relative'
        }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h1 style={{
              fontSize: '28px',
              fontWeight: 'bold',
            color: '#ef4444',
              marginBottom: '16px'
            }}>
            خطأ في تحميل المقابلة
            </h1>
            <p style={{
              fontSize: '16px',
            color: '#CBD5E1',
              marginBottom: '24px'
            }}>
              {error}
            </p>
        </div>
      </div>
    );
  }

  return (
    <div className="design-page" style={{
      minHeight: '100vh',
      padding: '90px 0 40px',
      position: 'relative',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
      zIndex: 1
    }}>
      {/* Background Orbs */}
      <div className="design-background" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0
      }}>
        <div className="design-orb-1" style={{
          position: 'absolute',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, transparent 70%)',
          filter: 'blur(120px)',
          opacity: 0.25,
          top: '-10%',
          right: '-10%',
          animation: 'float 25s infinite ease-in-out'
        }}></div>
        <div className="design-orb-2" style={{
          position: 'absolute',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, transparent 70%)',
          filter: 'blur(120px)',
          opacity: 0.25,
          bottom: '-10%',
          left: '-10%',
          animation: 'float 25s infinite ease-in-out',
          animationDelay: '8s'
        }}></div>
        <div className="design-orb-3" style={{
          position: 'absolute',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(14, 165, 233, 0.3) 0%, transparent 70%)',
          filter: 'blur(120px)',
          opacity: 0.25,
          top: '40%',
          left: '50%',
          animation: 'float 25s infinite ease-in-out',
          animationDelay: '15s'
        }}></div>
      </div>

      <div className="design-container" style={{
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '0 30px',
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header - Same design as Design page */}
        <div className="design-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '40px',
          padding: '30px',
          background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          <div className="header-content" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            flex: 1
          }}>
            <h1 className="design-title" style={{
              fontSize: '42px',
              fontWeight: 800,
              background: 'linear-gradient(135deg, #38bdf8 0%, #22d3ee 25%, #c084fc 50%, #c084fc 75%, #38bdf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              backgroundSize: '200% auto',
              animation: 'gradientShift 8s ease infinite',
              filter: 'drop-shadow(0 2px 20px rgba(56, 189, 248, 0.3))',
              marginBottom: '8px',
              letterSpacing: '0.5px',
              lineHeight: 1.2,
              position: 'relative',
              display: 'inline-block',
              transition: 'all 0.3s ease'
            }}>
              🎤 مقابلة صوتية ذكية
            </h1>
            {candidate && (
              <p className="design-subtitle" style={{
                fontSize: '17px',
                color: '#CBD5E1',
                fontWeight: 500,
                letterSpacing: '0.3px',
                opacity: 0.9,
                transition: 'all 0.3s ease',
                margin: 0
              }}>
                {candidate.firstName} {candidate.lastName} - {candidate.positionAppliedFor || 'Position'}
              </p>
            )}
          </div>
          {isCallActive && (
            <button
              onClick={handleEndCall}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '6px',
                padding: '10px 16px',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onMouseOver={(e) => {
                e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                e.target.style.borderColor = 'rgba(239, 68, 68, 0.4)';
              }}
              onMouseOut={(e) => {
                e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                e.target.style.borderColor = 'rgba(239, 68, 68, 0.2)';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 1.5C5.272 1.5 2.25 4.522 2.25 8.25C2.25 12.978 5.272 15 9 15C12.728 15 15.75 12.978 15.75 8.25C15.75 4.522 12.728 1.5 9 1.5Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M6 6L12 12M12 6L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>إنهاء المكالمة</span>
            </button>
          )}
        </div>

        {/* Main Interview Interface - Same design as questions-container */}
        <div className="questions-container" style={{
          marginBottom: '40px',
          padding: '30px',
          background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '12px',
          border: '2px solid rgba(34, 211, 238, 0.3)',
          boxShadow: `
            0 8px 24px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(34, 211, 238, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.03)
          `,
          width: '100%',
          boxSizing: 'border-box',
          maxWidth: '100%',
          minHeight: 'calc(100vh - 250px)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            height: '100%'
          }}>
            {/* Candidate Side */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%'
            }}>
              {/* Spacer at top */}
              <div style={{ flex: '0 0 auto', minHeight: '80px', marginBottom: '16px' }}></div>
              
              {/* Transcript - Centered */}
              <div 
                ref={userTranscriptRef}
                data-transcript-container
                className="smart-transcript-container"
                style={{
                  flex: '1 1 auto',
                  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  borderRadius: '12px',
                  padding: '16px',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  height: '350px',
                  border: '2px solid rgba(34, 211, 238, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  scrollBehavior: 'smooth',
                  position: 'relative',
                  boxShadow: `
                    0 8px 24px rgba(0, 0, 0, 0.6),
                    0 0 0 1px rgba(34, 211, 238, 0.1),
                    inset 0 1px 0 rgba(255, 255, 255, 0.03)
                  `
                }}
              >
                {userDisplayText.length === 0 && transcript.filter(msg => msg.role === 'user').length === 0 ? (
            <p style={{
                    color: '#64748b',
                    fontSize: '14px',
                    textAlign: 'center',
                    margin: 'auto 0'
                  }}>
                    {isCallActive ? 'ابدأ التحدث...' : 'انتظر بدء المكالمة'}
                  </p>
                ) : (
                  <div style={{
                    color: '#fff',
                    fontSize: '14px',
                    lineHeight: '1.8',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word'
                  }}>
                    {userDisplayText}
                  </div>
                )}
              </div>

              {/* Candidate Header with Audio Wave - At bottom */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                flex: '0 0 auto',
                minHeight: '80px',
                marginTop: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  color: '#fff',
                  fontWeight: 'bold',
                  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
                  flexShrink: 0
                }}>
                  {candidate ? (candidate.firstName?.[0] || 'U') : 'U'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h2 style={{
                      fontSize: '18px',
                      fontWeight: '600',
                      color: '#f1f5f9',
                      margin: 0
                    }}>
                      المرشح
                    </h2>
                    {/* Audio Wave */}
                    <div style={{
                      minHeight: '40px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <AudioWave isActive={isUserSpeaking} color="#8b5cf6" />
                      {/* Debug info - remove in production */}
                      {process.env.NODE_ENV === 'development' && (
                        <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '8px' }}>
                          {isUserSpeaking ? '🔴' : '⚪'}
                        </span>
                      )}
                    </div>
                  </div>
            <p style={{
              fontSize: '14px',
                    color: '#94a3b8',
                    margin: 0
            }}>
                    {candidate ? `${candidate.firstName} ${candidate.lastName}` : 'Candidate'}
            </p>
          </div>
              </div>
            </div>

            {/* Assistant Side */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%'
            }}>
              {/* Assistant Header with Audio Wave - At top */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '16px',
                flex: '0 0 auto',
                minHeight: '80px',
                marginBottom: '16px'
              }}>
                {/* Audio Wave */}
                <div style={{
                  minHeight: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <AudioWave isActive={isSpeaking} color="#8b5cf6" />
                  {/* Debug info - remove in production */}
                  {process.env.NODE_ENV === 'development' && (
                    <span style={{ fontSize: '10px', color: '#64748b', marginRight: '8px' }}>
                      {isSpeaking ? '🔴' : '⚪'}
                    </span>
                  )}
                </div>
                <div>
                  <h2 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                    color: '#f1f5f9',
                    margin: 0
                  }}>
                    المساعد الذكي
                  </h2>
                  <p style={{
                    fontSize: '14px',
                    color: '#94a3b8',
                    margin: '4px 0 0 0'
                  }}>
                    AI Assistant
                  </p>
                </div>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
                  flexShrink: 0
                }}>
                  🤖
                </div>
              </div>

              {/* Transcript - Centered */}
              <div 
                ref={assistantTranscriptRef}
                data-transcript-container
                className="smart-transcript-container"
                style={{
                  flex: '1 1 auto',
                  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.98) 100%)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  borderRadius: '12px',
                  padding: '16px',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  height: '350px',
                  border: '2px solid rgba(34, 211, 238, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  scrollBehavior: 'smooth',
                  position: 'relative',
                  boxShadow: `
                    0 8px 24px rgba(0, 0, 0, 0.6),
                    0 0 0 1px rgba(34, 211, 238, 0.1),
                    inset 0 1px 0 rgba(255, 255, 255, 0.03)
                  `
                }}
              >
                {assistantDisplayText.length === 0 && transcript.filter(msg => msg.role === 'assistant').length === 0 ? (
                  <p style={{
                    color: '#64748b',
                    fontSize: '14px',
                    textAlign: 'center',
                    margin: 'auto 0'
                  }}>
                    {isCallActive ? 'المساعد يستمع...' : 'انتظر بدء المكالمة'}
                  </p>
                ) : (
                  <div style={{
                    color: '#fff',
                    fontSize: '14px',
                    lineHeight: '1.8',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word'
                  }}>
                    {assistantDisplayText}
                  </div>
                )}
              </div>

              {/* Spacer at bottom */}
              <div style={{ flex: '0 0 auto', minHeight: '80px', marginTop: '16px' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Icon Button */}
      {!isCallActive && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginTop: '30px',
          position: 'relative'
        }}>
          <button
            onClick={handleStartCall}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              zIndex: 1
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-5px) scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
            }}
            title="ابدأ المكالمة"
          >
            {/* Glow effect */}
            <div style={{
              position: 'absolute',
              width: '95px',
              height: '95px',
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, transparent 70%)',
              borderRadius: '50%',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
              filter: 'blur(8px)',
              zIndex: 0,
              animation: 'pulse 2s ease-in-out infinite'
            }} />
            
            {/* Icon circle */}
            <div style={{
              position: 'relative',
              zIndex: 1,
              width: '70px',
              height: '70px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(168, 85, 247, 0.2) 100%)',
              border: '1.5px solid rgba(139, 92, 246, 0.5)',
              boxShadow: '0 8px 32px rgba(139, 92, 246, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="#f1f5f9" opacity="0.9"/>
                <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10H7V12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12V10H19Z" fill="#f1f5f9" opacity="0.9"/>
                <path d="M12 21C11.45 21 11 20.55 11 20V19H13V20C13 20.55 12.55 21 12 21Z" fill="#f1f5f9" opacity="0.7"/>
              </svg>
            </div>
          </button>
        </div>
        )}

      {/* Hidden Vapi Widget - for functionality only */}
      {/* ⚠️ مهم: VapiWidget يستخدم للاستماع فقط، المكالمة يتم إنشاؤها من Backend */}
      <VapiWidget 
        ref={vapiWidgetRef}
        apiKey={API_KEY}
        assistantId={ASSISTANT_ID}
        config={{
          ...voiceInterviewConfig.config,
          hideUI: true, // Hide default UI
          hideDefaultUI: true, // Hide default UI
          onCallStart: () => {
            console.log('✅ Call started callback');
            setIsCallActive(true);
          },
          onCallEnd: () => {
            console.log('❌ Call ended callback');
            setIsCallActive(false);
            setTranscript([]);
            setUserDisplayText('');
            setAssistantDisplayText('');
            userDisplayTextRef.current = '';
            assistantDisplayTextRef.current = '';
            if (userTypingRef.current) {
              clearInterval(userTypingRef.current);
              userTypingRef.current = null;
            }
            if (assistantTypingRef.current) {
              clearInterval(assistantTypingRef.current);
              assistantTypingRef.current = null;
            }
          },
          onTranscript: (msg) => {
            console.log('📝 Transcript:', msg);
            
            // Update transcript - keep only latest message per role to avoid duplicates
            setTranscript(prev => {
              // Check if this exact message already exists
              const existingMsg = prev.find(m => m.role === msg.role && m.text === msg.text);
              if (existingMsg) {
                console.log('⚠️ Duplicate message ignored:', msg.text);
                return prev; // Don't add duplicate
              }
              
              // Remove all previous messages of the same role
              const filtered = prev.filter(m => m.role !== msg.role);
              // Add the new message
              return [...filtered, msg];
            });
            
            // Update displayed text immediately for streaming effect
            if (msg.role === 'user') {
              // Clear existing typing animation
              if (userTypingRef.current) {
                clearInterval(userTypingRef.current);
                userTypingRef.current = null;
              }
              
              // Use the message text directly (only latest message)
              const fullText = msg.text.trim();
              
              // Check if this is new text or extension of existing
              const currentText = userDisplayTextRef.current.trim();
              
              // Only start typing if there's genuinely new text and it's not the same
              if (fullText !== currentText && fullText.length > currentText.length && fullText.startsWith(currentText)) {
                // Extension of existing text - continue from where we left off
                const remainingText = fullText.substring(currentText.length);
                const words = remainingText.split(/(\s+)/); // Split by spaces but keep spaces
                let wordIndex = 0;
                let displayedWords = currentText;
                
                userTypingRef.current = setInterval(() => {
                  if (wordIndex < words.length) {
                    // Add next word (including space if exists)
                    displayedWords += words[wordIndex];
                    wordIndex++;
                    userDisplayTextRef.current = displayedWords;
                    setUserDisplayText(displayedWords);
                  } else {
                    // Finished all words
                    if (userTypingRef.current) {
                      clearInterval(userTypingRef.current);
                      userTypingRef.current = null;
                    }
                  }
                }, 50); // Delay between words
              } else if (fullText !== currentText && fullText.length > 0 && !fullText.startsWith(currentText)) {
                // Completely new text - start from beginning
                userDisplayTextRef.current = '';
                setUserDisplayText('');
                const words = fullText.split(/(\s+)/);
                let wordIndex = 0;
                let displayedWords = '';
                
                userTypingRef.current = setInterval(() => {
                  if (wordIndex < words.length) {
                    displayedWords += words[wordIndex];
                    wordIndex++;
                    userDisplayTextRef.current = displayedWords;
                    setUserDisplayText(displayedWords);
                  } else {
                    if (userTypingRef.current) {
                      clearInterval(userTypingRef.current);
                      userTypingRef.current = null;
                    }
                  }
                }, 50); // Delay between words
              }
            } else if (msg.role === 'assistant') {
              // Clear existing typing animation
              if (assistantTypingRef.current) {
                clearInterval(assistantTypingRef.current);
                assistantTypingRef.current = null;
              }
              
              // Use the message text directly (only latest message)
              const fullText = msg.text.trim();
              
              // Check if this is new text or extension of existing
              const currentText = assistantDisplayTextRef.current.trim();
              
              // Only start typing if there's genuinely new text and it's not the same
              if (fullText !== currentText && fullText.length > currentText.length && fullText.startsWith(currentText)) {
                // Extension of existing text - continue from where we left off
                const remainingText = fullText.substring(currentText.length);
                const words = remainingText.split(/(\s+)/); // Split by spaces but keep spaces
                let wordIndex = 0;
                let displayedWords = currentText;
                
                assistantTypingRef.current = setInterval(() => {
                  if (wordIndex < words.length) {
                    // Add next word (including space if exists)
                    displayedWords += words[wordIndex];
                    wordIndex++;
                    assistantDisplayTextRef.current = displayedWords;
                    setAssistantDisplayText(displayedWords);
                  } else {
                    // Finished all words
                    if (assistantTypingRef.current) {
                      clearInterval(assistantTypingRef.current);
                      assistantTypingRef.current = null;
                    }
                  }
                }, 50); // Delay between words
              } else if (fullText !== currentText && fullText.length > 0 && !fullText.startsWith(currentText)) {
                // Completely new text - start from beginning
                assistantDisplayTextRef.current = '';
                setAssistantDisplayText('');
                const words = fullText.split(/(\s+)/);
                let wordIndex = 0;
                let displayedWords = '';
                
                assistantTypingRef.current = setInterval(() => {
                  if (wordIndex < words.length) {
                    displayedWords += words[wordIndex];
                    wordIndex++;
                    assistantDisplayTextRef.current = displayedWords;
                    setAssistantDisplayText(displayedWords);
                  } else {
                    if (assistantTypingRef.current) {
                      clearInterval(assistantTypingRef.current);
                      assistantTypingRef.current = null;
                    }
                  }
                }, 50); // Delay between words
              }
            }
          },
          onSpeaking: (speaking) => {
            console.log('🎤 Assistant speaking:', speaking);
            console.log('🎤 Setting isSpeaking to:', speaking);
            setIsSpeaking(speaking);
            // Force re-render check
            setTimeout(() => {
              console.log('🎤 isSpeaking state after update:', speaking);
            }, 100);
          },
          onUserSpeaking: (speaking) => {
            console.log('👤 User speaking:', speaking);
            console.log('👤 Setting isUserSpeaking to:', speaking);
            setIsUserSpeaking(speaking);
            // Force re-render check
            setTimeout(() => {
              console.log('👤 isUserSpeaking state after update:', speaking);
            }, 100);
          }
        }}
      />

      <style>{`
        @keyframes wave {
          0%, 100% { height: 4px; }
          50% { height: 24px; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
        }
        @keyframes shimmer {
          0%, 100% {
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
        }
        @keyframes gradientShift {
          0%, 100% {
            background-position: 0% center;
          }
          50% {
            background-position: 100% center;
          }
        }
        @keyframes float {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -30px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }
        /* Questions container shimmer effect */
        .questions-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, 
            transparent, 
            rgba(34, 211, 238, 0.5), 
            rgba(34, 211, 238, 0.8), 
            rgba(34, 211, 238, 0.5), 
            transparent
          );
          animation: shimmer 3s ease-in-out infinite;
          z-index: 1;
          pointer-events: none;
        }
        /* Smart transcript container effects */
        .smart-transcript-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, 
            transparent, 
            rgba(34, 211, 238, 0.5), 
            rgba(34, 211, 238, 0.8), 
            rgba(34, 211, 238, 0.5), 
            transparent
          );
          animation: shimmer 3s ease-in-out infinite;
          z-index: 1;
          pointer-events: none;
        }
        /* Design title hover effect */
        .design-title:hover {
          filter: drop-shadow(0 4px 24px rgba(56, 189, 248, 0.5));
          transform: translateY(-2px);
        }
        /* Hide scrollbar but allow scrolling */
        [data-transcript-container]::-webkit-scrollbar {
          display: none;
        }
        [data-transcript-container] {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default Interview;
