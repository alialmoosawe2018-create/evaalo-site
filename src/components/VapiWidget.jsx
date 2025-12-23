import React, { useState, useEffect, useRef } from 'react';
import Vapi from '@vapi-ai/web';

const VapiWidget = ({ 
  apiKey, 
  assistantId, 
  config = {} 
}) => {
  const [vapi, setVapi] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);
  const [functionCalls, setFunctionCalls] = useState([]);
  const vapiRef = useRef(null);
  const textInputRef = useRef(null);

  // Default config values
  const {
    position = 'bottom-right',
    theme = 'default',
    greeting = null,
    voice = {},
    enableTextInput = false,
    ...otherConfig
  } = config;

  // Position styles
  const getPositionStyles = () => {
    const positions = {
      'bottom-right': { bottom: '24px', right: '24px' },
      'bottom-left': { bottom: '24px', left: '24px' },
      'top-right': { top: '24px', right: '24px' },
      'top-left': { top: '24px', left: '24px' }
    };
    return positions[position] || positions['bottom-right'];
  };

  // Theme styles
  const getThemeStyles = () => {
    const themes = {
      default: {
        primaryColor: '#12A594',
        backgroundColor: '#fff',
        textColor: '#333',
        borderColor: '#e1e5e9',
        userMessageBg: '#12A594',
        assistantMessageBg: '#333'
      },
      ecommerce: {
        primaryColor: '#2563eb',
        backgroundColor: '#fff',
        textColor: '#1f2937',
        borderColor: '#e5e7eb',
        userMessageBg: '#2563eb',
        assistantMessageBg: '#4b5563'
      },
      dark: {
        primaryColor: '#8b5cf6',
        backgroundColor: '#1f2937',
        textColor: '#f9fafb',
        borderColor: '#374151',
        userMessageBg: '#8b5cf6',
        assistantMessageBg: '#4b5563'
      },
      healthcare: {
        primaryColor: '#10b981',
        backgroundColor: '#fff',
        textColor: '#1f2937',
        borderColor: '#d1fae5',
        userMessageBg: '#10b981',
        assistantMessageBg: '#059669'
      }
    };
    return themes[theme] || themes.default;
  };

  const themeStyles = getThemeStyles();

  useEffect(() => {
    if (!apiKey) {
      console.error('Vapi API key is required');
      return;
    }

    const vapiInstance = new Vapi(apiKey);
    vapiRef.current = vapiInstance;
    setVapi(vapiInstance);

    // Call lifecycle events
    vapiInstance.on('call-start', () => {
      console.log('Voice conversation started');
      setIsConnected(true);
      setError(null);
      setTranscript([]);
      setFunctionCalls([]);
      // Track analytics, show notifications, etc.
    });

    vapiInstance.on('call-end', () => {
      console.log('Voice conversation ended');
      setIsConnected(false);
      setIsSpeaking(false);
      setIsUserSpeaking(false);
      // Save conversation data, show feedback form, etc.
    });

    // Real-time conversation events
    vapiInstance.on('speech-start', () => {
      console.log('User started speaking');
      setIsUserSpeaking(true);
    });

    vapiInstance.on('speech-end', () => {
      console.log('User stopped speaking');
      setIsUserSpeaking(false);
    });

    vapiInstance.on('assistant-speech-start', () => {
      console.log('Assistant started speaking');
      setIsSpeaking(true);
    });

    vapiInstance.on('assistant-speech-end', () => {
      console.log('Assistant stopped speaking');
      setIsSpeaking(false);
    });

    vapiInstance.on('message', (message) => {
      if (message.type === 'transcript') {
        console.log(`${message.role}: ${message.transcript}`);
        setTranscript(prev => [...prev, {
          role: message.role,
          text: message.transcript,
          timestamp: new Date().toISOString()
        }]);
        // Update UI with real-time transcription
      } else if (message.type === 'function-call') {
        console.log('Function called:', message.functionCall?.name);
        setFunctionCalls(prev => [...prev, {
          name: message.functionCall?.name,
          parameters: message.functionCall?.parameters,
          timestamp: new Date().toISOString()
        }]);
        // Handle custom function calls
      }
    });

    // Error handling
    vapiInstance.on('error', (error) => {
      console.error('Voice widget error:', error);
      setError(error.message || 'An error occurred with the voice widget');
      // Show user-friendly error messages
    });

    return () => {
      if (vapiRef.current) {
        vapiRef.current.stop();
        vapiRef.current = null;
      }
    };
  }, [apiKey]);

  const startCall = () => {
    if (vapi && assistantId) {
      try {
        // Prepare call options with voice settings if provided
        const callOptions = {};
        if (voice.provider) {
          callOptions.voice = {
            provider: voice.provider,
            voiceId: voice.voiceId
          };
        }
        
        // Start call with options
        if (Object.keys(callOptions).length > 0) {
          vapi.start(assistantId, callOptions);
        } else {
          vapi.start(assistantId);
        }
      } catch (err) {
        console.error('Error starting call:', err);
        setError('Failed to start call. Please try again.');
      }
    } else {
      setError('Assistant ID is required to start a call.');
    }
  };

  const endCall = () => {
    if (vapi) {
      try {
        vapi.stop();
      } catch (err) {
        console.error('Error ending call:', err);
      }
    }
  };

  const sendMessage = (messageText) => {
    if (vapi && isConnected && messageText.trim()) {
      try {
        vapi.send({
          type: 'add-message',
          message: {
            role: 'user',
            content: messageText
          }
        });
      } catch (err) {
        console.error('Error sending message:', err);
        setError('Failed to send message. Please try again.');
      }
    }
  };

  return (
    <div style={{
      position: 'fixed',
      ...getPositionStyles(),
      zIndex: 1000,
      fontFamily: 'Arial, sans-serif'
    }}>
      {error && (
        <div style={{
          background: '#fee',
          color: '#c33',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '12px',
          fontSize: '14px',
          maxWidth: '320px',
          border: '1px solid #fcc'
        }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: 'right',
              background: 'none',
              border: 'none',
              color: '#c33',
              cursor: 'pointer',
              fontSize: '18px',
              fontWeight: 'bold'
            }}
          >
            ×
          </button>
        </div>
      )}

      {!isConnected ? (
        <>
          <button
            onClick={startCall}
            disabled={!apiKey || !assistantId}
            className="vapi-icon-button"
            style={{
              opacity: (!apiKey || !assistantId) ? 0.6 : 1,
              cursor: (!apiKey || !assistantId) ? 'not-allowed' : 'pointer'
            }}
          >
            <div className="vapi-icon-circle">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="currentColor" opacity="0.9"/>
                <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10H7V12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12V10H19Z" fill="currentColor" opacity="0.9"/>
                <path d="M12 21C11.45 21 11 20.55 11 20V19H13V20C13 20.55 12.55 21 12 21Z" fill="currentColor" opacity="0.7"/>
              </svg>
            </div>
          </button>
        </>
      ) : (
        <div style={{
          background: themeStyles.backgroundColor,
          borderRadius: '12px',
          padding: '20px',
          width: '360px',
          maxHeight: '600px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
          border: `1px solid ${themeStyles.borderColor}`,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flex: 1
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: isSpeaking ? '#ff4444' : isUserSpeaking ? '#4CAF50' : themeStyles.primaryColor,
                animation: (isSpeaking || isUserSpeaking) ? 'pulse 1s infinite' : 'none'
              }}></div>
              <span style={{ fontWeight: 'bold', color: themeStyles.textColor, fontSize: '14px' }}>
                {isSpeaking ? 'Assistant Speaking...' : isUserSpeaking ? 'You are speaking...' : 'Listening...'}
              </span>
            </div>
            <button
              onClick={endCall}
              style={{
                background: '#ff4444',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              End
            </button>
          </div>
          
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            marginBottom: '12px',
            padding: '12px',
            background: '#f8f9fa',
            borderRadius: '8px',
            flex: 1
          }}>
            {transcript.length === 0 ? (
              <p style={{ color: themeStyles.textColor, fontSize: '14px', margin: 0, textAlign: 'center', opacity: 0.6 }}>
                {greeting || 'Conversation will appear here...'}
              </p>
            ) : (
              <>
                {transcript.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: '12px',
                      textAlign: msg.role === 'user' ? 'right' : 'left'
                    }}
                  >
                    <div style={{
                      fontSize: '11px',
                      color: themeStyles.textColor,
                      opacity: 0.6,
                      marginBottom: '4px',
                      paddingLeft: msg.role === 'user' ? '0' : '8px',
                      paddingRight: msg.role === 'user' ? '8px' : '0'
                    }}>
                      {msg.role === 'user' ? 'You' : 'Assistant'}
                    </div>
                    <span style={{
                      background: msg.role === 'user' ? themeStyles.userMessageBg : themeStyles.assistantMessageBg,
                      color: '#fff',
                      padding: '8px 12px',
                      borderRadius: '12px',
                      display: 'inline-block',
                      fontSize: '14px',
                      maxWidth: '80%',
                      wordWrap: 'break-word'
                    }}>
                      {msg.text}
                    </span>
                  </div>
                ))}
                {functionCalls.length > 0 && (
                  <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: `1px solid ${themeStyles.borderColor}`
                  }}>
                    <div style={{ fontSize: '11px', color: themeStyles.textColor, opacity: 0.6, marginBottom: '8px' }}>
                      Function Calls:
                    </div>
                    {functionCalls.map((fc, i) => (
                      <div key={i} style={{
                        background: '#e3f2fd',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        marginBottom: '6px',
                        color: '#1976d2'
                      }}>
                        <strong>{fc.name}</strong>
                        {fc.parameters && Object.keys(fc.parameters).length > 0 && (
                          <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.8 }}>
                            {JSON.stringify(fc.parameters, null, 2)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Optional: Text input for sending messages */}
          {config.enableTextInput && (
            <div style={{
              display: 'flex',
              gap: '8px',
              marginTop: '8px'
            }}>
              <input
                ref={textInputRef}
                type="text"
                placeholder="Type a message..."
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    sendMessage(e.target.value);
                    e.target.value = '';
                  }
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
              <button
                onClick={() => {
                  if (textInputRef.current && textInputRef.current.value.trim()) {
                    sendMessage(textInputRef.current.value);
                    textInputRef.current.value = '';
                  }
                }}
                style={{
                  background: themeStyles.primaryColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
      
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default VapiWidget;

