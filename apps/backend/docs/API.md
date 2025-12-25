# Evaalo Backend API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication

Most endpoints are public. Some endpoints require JWT authentication.

### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "user"
  }
}
```

Use token in subsequent requests:
```http
Authorization: Bearer <token>
```

## Sessions

### Create Session
```http
POST /api/sessions
Content-Type: application/json

{
  "user_id": "optional-uuid",
  "metadata": {}
}
```

Response:
```json
{
  "success": true,
  "session_id": "uuid",
  "session": { ... }
}
```

### Get Session
```http
GET /api/sessions/:session_id
```

Response:
```json
{
  "success": true,
  "session": {
    "id": "uuid",
    "status": "active",
    "started_at": "2024-01-01T00:00:00Z",
    "messages": [ ... ]
  }
}
```

### Update Session
```http
PATCH /api/sessions/:session_id
Content-Type: application/json

{
  "status": "completed",
  "ended_at": "2024-01-01T01:00:00Z",
  "duration": 3600,
  "quality_score": 0.95
}
```

## Messages

### Create Message
```http
POST /api/sessions/:session_id/messages
Content-Type: application/json

{
  "role": "user",
  "text": "Hello, how are you?",
  "audio_url": "https://...",
  "tokens": 10,
  "timestamp": 1704067200000,
  "vapi_message_id": "optional",
  "metadata": {}
}
```

### Get Messages
```http
GET /api/sessions/:session_id/messages
```

Response:
```json
{
  "success": true,
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "text": "Hello",
      "audio_url": null,
      "tokens": 5,
      "timestamp": 1704067200000
    }
  ]
}
```

### Create Bulk Messages
```http
POST /api/sessions/:session_id/messages/bulk
Content-Type: application/json

{
  "messages": [
    {
      "role": "user",
      "text": "Hello",
      "timestamp": 1704067200000
    },
    {
      "role": "assistant",
      "text": "Hi there!",
      "timestamp": 1704067201000
    }
  ]
}
```

## Uploads

### Generate Upload URL
```http
POST /api/uploads
Content-Type: application/json

{
  "session_id": "optional-uuid",
  "file_name": "audio.mp3",
  "content_type": "audio/mpeg",
  "duration": 120,
  "type": "audio"
}
```

Response:
```json
{
  "success": true,
  "file_id": "uuid",
  "presigned_url": "https://s3.amazonaws.com/...",
  "file_url": "https://s3.amazonaws.com/...",
  "expires_in": 3600
}
```

### Update File After Upload
```http
PATCH /api/uploads/:file_id
Content-Type: application/json

{
  "duration": 120,
  "size": 2048000,
  "metadata": {}
}
```

## Webhooks

### Vapi Webhook
```http
POST /api/webhooks/vapi
Content-Type: application/json

{
  "type": "status-update",
  "call": {
    "id": "call-id"
  },
  "session_id": "uuid",
  ...
}
```

This endpoint is public and accepts all Vapi webhook events. It responds immediately (within 3 seconds) and processes events asynchronously.

## Export

### Export Dataset (Requires Auth)
```http
GET /api/export/dataset?from_date=2024-01-01&to_date=2024-12-31&quality=0.8
Authorization: Bearer <token>
```

Response: JSONL file with format:
```jsonl
{"input": "user message", "output": "assistant response", "session_id": "uuid", "timestamp": 1704067200000, "quality_score": 0.95}
{"input": "another message", "output": "another response", "session_id": "uuid", "timestamp": 1704067201000, "quality_score": 0.95}
```

### Export Session Data
```http
GET /api/export/sessions/:session_id?format=jsonl
Authorization: Bearer <token>
```

## Health Check

```http
GET /api/health
```

Response:
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Error Responses

All errors follow this format:
```json
{
  "success": false,
  "error": "Error message",
  "message": "Detailed error message (in development)"
}
```

Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

