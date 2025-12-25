import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import VapiWidget from '../components/VapiWidget';
import { vapiAssistants } from '../config/vapiAssistants';

const Interview = () => {
  const { id } = useParams(); // Get candidate ID from URL
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Get Voice Interview Assistant configuration from centralized config
  const voiceInterviewConfig = vapiAssistants.voiceInterview;
  const API_KEY = voiceInterviewConfig.apiKey;
  const ASSISTANT_ID = voiceInterviewConfig.assistantId;
  
  // Fetch candidate information from backend
  useEffect(() => {
    // Remove body padding and change background for Interview page
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

    // Cleanup: restore original body style when component unmounts
    return () => {
      document.body.style.padding = originalBodyStyle.padding || '';
      document.body.style.background = originalBodyStyle.background || '';
      document.body.style.margin = originalBodyStyle.margin || '';
    };
  }, [id]);
  
  const fetchCandidateInfo = async (candidateId, retryCount = 0) => {
    const MAX_RETRIES = 2;
    const TIMEOUT_MS = 15000; // 15 seconds timeout
    
    try {
      setLoading(true);
      setError(null);
      
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      // Try localhost first, fallback to production if needed
      const apiUrl = process.env.NODE_ENV === 'production' 
        ? `https://evaalo-backend.onrender.com/api/candidates/${candidateId}`
        : `http://localhost:5000/api/candidates/${candidateId}`;
      
      const response = await fetch(apiUrl, {
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
      
      // Handle different error types
      let errorMessage = 'فشل في تحميل معلومات المرشح';
      
      if (err.name === 'AbortError') {
        errorMessage = 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى';
      } else if (err.message && err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        errorMessage = 'لا يمكن الاتصال بالخادم. يرجى التأكد من أن الخادم الخلفي يعمل';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      // Retry logic
      if (retryCount < MAX_RETRIES && (err.name === 'AbortError' || err.message?.includes('fetch'))) {
        console.log(`🔄 Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          fetchCandidateInfo(candidateId, retryCount + 1);
        }, 2000 * (retryCount + 1)); // Exponential backoff: 2s, 4s
        return;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      padding: '40px 20px',
      background: 'transparent',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '40px',
        maxWidth: '800px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        textAlign: 'center'
      }}>
        {loading ? (
          <div>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
            <p style={{ fontSize: '18px', color: '#666' }}>جاري تحميل معلومات المقابلة...</p>
          </div>
        ) : error ? (
          <div>
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
            <p style={{
              fontSize: '14px',
              color: '#94A3B8'
            }}>
              يرجى التحقق من رابط المقابلة أو الاتصال بالدعم.
            </p>
          </div>
        ) : (
          <>
            <h1 style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: '#333',
              marginBottom: '16px'
            }}>
              🎤 AI Voice Interview
            </h1>
            
            {candidate && (
              <div style={{
                background: '#f0f9ff',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '24px',
                border: '1px solid #bae6fd'
              }}>
                <div style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#0369a1',
                  marginBottom: '8px'
                }}>
                  <strong>Candidate:</strong> {candidate.firstName || ''} {candidate.lastName || ''}
                </div>
                {candidate.positionAppliedFor && (
                  <div style={{
                    fontSize: '16px',
                    color: '#0284c7'
                  }}>
                    <strong>Position:</strong> {candidate.positionAppliedFor}
                  </div>
                )}
              </div>
            )}
            
            <p style={{
              fontSize: '18px',
              color: '#666',
              marginBottom: '32px',
              lineHeight: '1.6'
            }}>
              ابدأ مقابلتك بالضغط على الزر في الزاوية اليمنى السفلى.
              سيرشدك المساعد الذكي خلال عملية المقابلة.
            </p>
            <div style={{
              background: '#f8f9fa',
              borderRadius: '12px',
              padding: '24px',
              marginTop: '24px'
            }}>
              <h2 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: '#333',
                marginBottom: '12px'
              }}>
                التعليمات
              </h2>
              <ul style={{
                textAlign: 'right',
                color: '#666',
                lineHeight: '1.8',
                paddingRight: '20px',
                direction: 'rtl'
              }}>
                <li>اضغط على زر "التحدث مع المساعد" لبدء المقابلة</li>
                <li>تحدث بوضوح وأجب على الأسئلة التي يطرحها الذكاء الاصطناعي</li>
                <li>سيظهر نص المحادثة في الوقت الفعلي</li>
                <li>اضغط على "إنهاء المكالمة" عند الانتهاء</li>
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Vapi Widget - Fixed position in bottom right */}
      <VapiWidget 
        apiKey={API_KEY}
        assistantId={ASSISTANT_ID}
        candidateId={id || null}
        candidateName={candidate ? `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() : null}
        candidateEmail={candidate?.email || null}
        config={voiceInterviewConfig.config}
      />
    </div>
  );
};

export default Interview;

