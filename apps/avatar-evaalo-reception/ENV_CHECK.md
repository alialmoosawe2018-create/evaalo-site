# ✅ Environment Variables Checklist

## Required for Video Interview Agent (video-interview-agent):

### LiveKit:
```env
LIVEKIT_URL=wss://evaalo-qk1twe6k.livekit.cloud
LIVEKIT_API_KEY=APIPfHsukAntKDq
LIVEKIT_API_SECRET=GDCBeJv6X8Tfz7qweeQZF1oBUukejh2JEnFwXOwsrMaA
```

### Beyond Presence:
```env
BEY_API_KEY=sk-a7Zuo3jPIAqjnw6HLgUOkNVXUPfPtU3soNEN951H0bs
BEYOND_PRESENCE_AVATAR_ID=694c83e2-8895-4a98-bd16-56332ca3f449
```

### Speechmatics (STT - عربي-إنجليزي):
```env
SPEECHMATICS_API_KEY=your_key
SPEECHMATICS_LANGUAGE=ar_en
```

### Optional:
```env
AVATAR_WS_PORT=8765
BEY_API_URL= (optional)
SPEECHMATICS_LANGUAGE=ar_en
```

## Location:
`.env.local` in `apps/avatar-evaalov2/`

## Verification:
When you run the agent, you should see:
- ✅ Loading environment from: .env.local
- ✅ Environment variables set in os.environ
- ✅ LiveKit credentials loaded
- ✅ WebSocket server started
