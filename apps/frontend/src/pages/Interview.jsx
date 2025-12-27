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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const vapiWidgetRef = useRef(null);
  
  const voiceInterviewConfig = vapiAssistants.voiceInterview;
  const API_KEY = voiceInterviewConfig.apiKey;
  const ASSISTANT_ID = voiceInterviewConfig.assistantId;

  useEffect(() => {
    const originalBodyStyle = {
      padding: document.body.style.padding,
      background: document.body.style.background,
      margin: document.body.style.margin
    };
    
    document.body.style.padding = '0';
    document.body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
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
      
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
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
      
      let errorMessage = 'فشل في تحميل معلومات المرشح';
      
      if (err.name === 'AbortError') {
        errorMessage = 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى';
      } else if (err.message && err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        errorMessage = 'لا يمكن الاتصال بالخادم. يرجى التأكد من أن الخادم الخلفي يعمل';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      if (retryCount < MAX_RETRIES && (err.name === 'AbortError' || err.message?.includes('fetch'))) {
        console.log(`🔄 Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          fetchCandidateInfo(candidateId, retryCount + 1);
        }, 2000 * (retryCount + 1));
        return;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleStartCall = () => {
    if (vapiWidgetRef.current && vapiWidgetRef.current.startCall) {
      vapiWidgetRef.current.startCall();
      setIsCallActive(true);
    }
  };

  const handleEndCall = () => {
    if (vapiWidgetRef.current && vapiWidgetRef.current.endCall) {
      vapiWidgetRef.current.endCall();
      setIsCallActive(false);
      setTranscript([]);
    }
  };

  // Audio visualization component
  const AudioWave = ({ isActive, color }) => {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        height: '40px'
      }}>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            style={{
              width: '4px',
              height: isActive ? `${20 + Math.random() * 20}px` : '4px',
              background: color,
              borderRadius: '2px',
              transition: 'height 0.1s ease',
              animation: isActive ? 'wave 0.5s infinite' : 'none',
              animationDelay: `${i * 0.1}s`
            }}
          />
        ))}
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '60px 40px',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <p style={{ fontSize: '18px', color: '#666' }}>جاري تحميل معلومات المقابلة...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '60px 40px',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          maxWidth: '600px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 'bold',
            color: '#EF4444',
            marginBottom: '16px'
          }}>
            خطأ في تحميل المقابلة
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#666',
            marginBottom: '24px'
          }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '16px',
        padding: '20px 30px',
        marginBottom: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)'
      }}>
        <div>
          <h1 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#333',
            margin: 0
          }}>
            🎤 مقابلة صوتية ذكية
          </h1>
          {candidate && (
            <p style={{
              fontSize: '14px',
              color: '#666',
              margin: '4px 0 0 0'
            }}>
              {candidate.firstName} {candidate.lastName} - {candidate.positionAppliedFor || 'Position'}
            </p>
          )}
        </div>
        {isCallActive && (
          <button
            onClick={handleEndCall}
            style={{
              background: '#EF4444',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => e.target.style.background = '#DC2626'}
            onMouseOut={(e) => e.target.style.background = '#EF4444'}
          >
            إنهاء المكالمة
          </button>
        )}
      </div>

      {/* Main Interview Interface */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
        marginBottom: '20px'
      }}>
        {/* Candidate Side */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: '16px',
          padding: '30px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '20px'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              color: '#fff',
              fontWeight: 'bold'
            }}>
              {candidate ? (candidate.firstName?.[0] || 'U') : 'U'}
            </div>
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: '#333',
                margin: 0
              }}>
                المرشح
              </h2>
              <p style={{
                fontSize: '14px',
                color: '#666',
                margin: '4px 0 0 0'
              }}>
                {candidate ? `${candidate.firstName} ${candidate.lastName}` : 'Candidate'}
              </p>
            </div>
          </div>

          {/* Audio Wave */}
          <div style={{
            marginBottom: '20px',
            minHeight: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <AudioWave isActive={isUserSpeaking} color="#10b981" />
          </div>

          {/* Transcript */}
          <div style={{
            flex: 1,
            background: '#f8f9fa',
            borderRadius: '12px',
            padding: '20px',
            overflowY: 'auto',
            minHeight: '300px',
            maxHeight: '400px'
          }}>
            {transcript.filter(msg => msg.role === 'user').length === 0 ? (
              <p style={{
                color: '#999',
                fontSize: '14px',
                textAlign: 'center',
                margin: '40px 0'
              }}>
                {isCallActive ? 'ابدأ التحدث...' : 'انتظر بدء المكالمة'}
              </p>
            ) : (
              transcript.filter(msg => msg.role === 'user').map((msg, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: '12px',
                    padding: '12px',
                    background: '#10b981',
                    color: '#fff',
                    borderRadius: '12px',
                    fontSize: '14px',
                    lineHeight: '1.6'
                  }}
                >
                  {msg.text}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Assistant Side */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: '16px',
          padding: '30px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '20px'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              color: '#fff'
            }}>
              🤖
            </div>
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: '#333',
                margin: 0
              }}>
                المساعد الذكي
              </h2>
              <p style={{
                fontSize: '14px',
                color: '#666',
                margin: '4px 0 0 0'
              }}>
                AI Assistant
              </p>
            </div>
          </div>

          {/* Audio Wave */}
          <div style={{
            marginBottom: '20px',
            minHeight: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <AudioWave isActive={isSpeaking} color="#667eea" />
          </div>

          {/* Transcript */}
          <div style={{
            flex: 1,
            background: '#f8f9fa',
            borderRadius: '12px',
            padding: '20px',
            overflowY: 'auto',
            minHeight: '300px',
            maxHeight: '400px'
          }}>
            {transcript.filter(msg => msg.role === 'assistant').length === 0 ? (
              <p style={{
                color: '#999',
                fontSize: '14px',
                textAlign: 'center',
                margin: '40px 0'
              }}>
                {isCallActive ? 'المساعد يستمع...' : 'انتظر بدء المكالمة'}
              </p>
            ) : (
              transcript.filter(msg => msg.role === 'assistant').map((msg, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: '12px',
                    padding: '12px',
                    background: '#667eea',
                    color: '#fff',
                    borderRadius: '12px',
                    fontSize: '14px',
                    lineHeight: '1.6'
                  }}
                >
                  {msg.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Start Button */}
      {!isCallActive && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '20px'
        }}>
          <button
            onClick={handleStartCall}
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '16px',
              padding: '20px 60px',
              fontSize: '20px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
            onMouseOver={(e) => {
              e.target.style.transform = 'scale(1.05)';
              e.target.style.boxShadow = '0 12px 32px rgba(16, 185, 129, 0.5)';
            }}
            onMouseOut={(e) => {
              e.target.style.transform = 'scale(1)';
              e.target.style.boxShadow = '0 8px 24px rgba(16, 185, 129, 0.4)';
            }}
          >
            <span style={{ fontSize: '28px' }}>▶️</span>
            <span>بدء المقابلة</span>
          </button>
        </div>
      )}

      {/* Hidden Vapi Widget - for functionality only */}
      <VapiWidget 
        ref={vapiWidgetRef}
        apiKey={API_KEY}
        assistantId={ASSISTANT_ID}
        candidateId={id || null}
        candidateName={candidate ? `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() : null}
        candidateEmail={candidate?.email || null}
        candidate={candidate}
        config={{
          ...voiceInterviewConfig.config,
          hideUI: true, // Hide default UI
          onCallStart: () => setIsCallActive(true),
          onCallEnd: () => {
            setIsCallActive(false);
            setTranscript([]);
          },
          onTranscript: (msg) => setTranscript(prev => [...prev, msg]),
          onSpeaking: (speaking) => setIsSpeaking(speaking),
          onUserSpeaking: (speaking) => setIsUserSpeaking(speaking)
        }}
      />

      <style>{`
        @keyframes wave {
          0%, 100% { height: 4px; }
          50% { height: 24px; }
        }
      `}</style>
    </div>
  );
};

export default Interview;
