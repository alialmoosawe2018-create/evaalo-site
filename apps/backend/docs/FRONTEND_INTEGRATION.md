# Frontend Integration Guide - دليل التكامل مع الواجهة الأمامية

## Overview

هذا الدليل يشرح كيفية ربط واجهة React مع الباك-إند.

## Base URL

```javascript
const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:3000/api';
```

## Authentication

### Login Example

```javascript
const login = async (email, password) => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  
  const data = await response.json();
  
  if (data.success) {
    localStorage.setItem('token', data.token);
    return data.user;
  }
  
  throw new Error(data.error);
};
```

### Using Token in Requests

```javascript
const getHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};
```

## Sessions API

### Create Session

```javascript
const createSession = async (metadata = {}) => {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ metadata }),
  });
  
  const data = await response.json();
  return data.session_id;
};
```

### Get Session with Messages

```javascript
const getSession = async (sessionId) => {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
    headers: getHeaders(),
  });
  
  const data = await response.json();
  return data.session;
};
```

## Messages API

### Create Message

```javascript
const createMessage = async (sessionId, messageData) => {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      role: messageData.role,
      text: messageData.text,
      audio_url: messageData.audioUrl,
      tokens: messageData.tokens || 0,
      timestamp: Date.now(),
      metadata: messageData.metadata || {},
    }),
  });
  
  const data = await response.json();
  return data.message;
};
```

### Get Messages

```javascript
const getMessages = async (sessionId) => {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`, {
    headers: getHeaders(),
  });
  
  const data = await response.json();
  return data.messages;
};
```

## Upload API

### Get Pre-signed URL

```javascript
const getUploadUrl = async (fileName, contentType, sessionId = null) => {
  const response = await fetch(`${API_BASE_URL}/uploads`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      session_id: sessionId,
      file_name: fileName,
      content_type: contentType,
      type: 'audio',
    }),
  });
  
  const data = await response.json();
  return {
    fileId: data.file_id,
    presignedUrl: data.presigned_url,
    fileUrl: data.file_url,
  };
};
```

### Upload File to S3

```javascript
const uploadFile = async (file, sessionId = null) => {
  // Get pre-signed URL
  const { presignedUrl, fileId, fileUrl } = await getUploadUrl(
    file.name,
    file.type,
    sessionId
  );
  
  // Upload to S3
  await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });
  
  return fileUrl;
};
```

## Vapi Webhook Configuration

في إعدادات Vapi، اضبط Webhook URL:

```
https://your-api-domain.com/api/webhooks/vapi
```

Vapi سيرسل جميع الأحداث تلقائياً إلى هذا المسار.

## React Components Structure

### Interview Component Example

```javascript
import { useState, useEffect } from 'react';

function Interview() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Create session on mount
    createSession().then(id => {
      setSessionId(id);
      loadMessages(id);
    });
  }, []);

  const loadMessages = async (sessionId) => {
    const sessionData = await getSession(sessionId);
    setMessages(sessionData.messages || []);
  };

  const sendMessage = async (text, audioUrl = null) => {
    if (!sessionId) return;

    await createMessage(sessionId, {
      role: 'user',
      text,
      audioUrl,
    });

    // Reload messages
    loadMessages(sessionId);
  };

  return (
    <div className="interview-container">
      <ChatMessages messages={messages} />
      <VoiceCall 
        sessionId={sessionId}
        onMessage={sendMessage}
      />
    </div>
  );
}
```

### Chat Messages Component

```javascript
function ChatMessages({ messages }) {
  return (
    <div className="chat-messages">
      {messages.map((msg) => (
        <div key={msg.id} className={`message ${msg.role}`}>
          <div className="message-content">{msg.text}</div>
          {msg.audio_url && (
            <audio src={msg.audio_url} controls />
          )}
          <div className="message-time">
            {new Date(msg.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}
```

## Real-time Updates

للتحديثات الفورية، يمكنك استخدام polling أو WebSocket:

### Polling Example

```javascript
useEffect(() => {
  if (!sessionId) return;

  const interval = setInterval(() => {
    loadMessages(sessionId);
  }, 2000); // Poll every 2 seconds

  return () => clearInterval(interval);
}, [sessionId]);
```

## Export Dataset

```javascript
const exportDataset = async (filters = {}) => {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams(filters);
  
  const response = await fetch(
    `${API_BASE_URL}/export/dataset?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dataset-${Date.now()}.jsonl`;
  a.click();
};
```

## Error Handling

```javascript
const apiCall = async (url, options = {}) => {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};
```

## Environment Variables (Frontend)

في ملف `.env` الخاص بـ React:

```env
VITE_API_URL=http://localhost:3000/api
```

## CORS Configuration

تأكد من أن `FRONTEND_URL` في ملف `.env` الخاص بالباك-إند يطابق عنوان الواجهة الأمامية:

```env
FRONTEND_URL=http://localhost:5173
```

## Example: Complete Interview Flow

```javascript
class InterviewService {
  constructor() {
    this.sessionId = null;
  }

  async startInterview() {
    this.sessionId = await createSession();
    return this.sessionId;
  }

  async sendUserMessage(text, audioUrl = null) {
    return await createMessage(this.sessionId, {
      role: 'user',
      text,
      audioUrl,
    });
  }

  async getConversation() {
    const session = await getSession(this.sessionId);
    return session.messages;
  }

  async uploadAudio(audioBlob) {
    const file = new File([audioBlob], 'audio.webm', {
      type: 'audio/webm',
    });
    
    return await uploadFile(file, this.sessionId);
  }

  async exportConversation() {
    return await exportDataset({
      session_id: this.sessionId,
    });
  }
}
```

## Testing API Connection

```javascript
const testConnection = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await response.json();
    console.log('API Status:', data.status);
    return data.status === 'ok';
  } catch (error) {
    console.error('API not reachable:', error);
    return false;
  }
};
```

