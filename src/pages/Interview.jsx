import React from 'react';
import VapiWidget from '../components/VapiWidget';

const Interview = () => {
  // Vapi API credentials
  const API_KEY = '7c4dacd3-c0fe-4a6c-bf4f-d9601585f155';
  const ASSISTANT_ID = 'fda09eb4-2275-47aa-a75c-8f2ac1976856';

  return (
    <div style={{
      minHeight: '100vh',
      padding: '40px 20px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
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
        <h1 style={{
          fontSize: '32px',
          fontWeight: 'bold',
          color: '#333',
          marginBottom: '16px'
        }}>
          🎤 AI Interview Assistant
        </h1>
        <p style={{
          fontSize: '18px',
          color: '#666',
          marginBottom: '32px',
          lineHeight: '1.6'
        }}>
          Start your interview by clicking the button in the bottom right corner.
          The AI assistant will guide you through the interview process.
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
            Instructions
          </h2>
          <ul style={{
            textAlign: 'left',
            color: '#666',
            lineHeight: '1.8',
            paddingLeft: '20px'
          }}>
            <li>Click the "Talk to Assistant" button to start the interview</li>
            <li>Speak clearly and answer the questions asked by the AI</li>
            <li>The conversation transcript will appear in real-time</li>
            <li>Click "End Call" when you're finished</li>
          </ul>
        </div>
      </div>

      {/* Vapi Widget - Fixed position in bottom right */}
      <VapiWidget 
        apiKey={API_KEY}
        assistantId={ASSISTANT_ID}
      />
    </div>
  );
};

export default Interview;

