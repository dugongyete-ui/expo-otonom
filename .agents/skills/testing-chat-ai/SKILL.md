# Testing Dzeck AI Chat App

## Overview
Dzeck AI is an Expo (React Native) chat app with an Express.js backend that uses Python g4f (gpt4free) library for AI responses via the Yqcloud provider.

## Architecture
- **Frontend**: Expo/React Native app (supports web via `npx expo start --web`)
- **Backend**: Express.js server (`server/index.ts`) on port 5000
- **AI Engine**: Python script (`server/g4f_chat.py`) spawned per request, streams responses via SSE
- **Chat flow**: Frontend POSTs to `/api/chat` → Express spawns Python g4f process → streams SSE response back

## Local Development Setup

### Prerequisites
- Node.js with npm
- Python 3 with pip
- g4f Python package (`pip3 install g4f`)

### Start Backend
```bash
npm install
npm run server:dev
# Server runs on port 5000
```

### Start Frontend (Web)
```bash
npx expo start --web --port 8081
# Opens on http://localhost:8081
```

The frontend connects to the backend via `getApiUrl()` in `lib/query-client.ts`, which defaults to `http://localhost:5000/` for local development.

## Quick API Test
You can verify the AI chat backend works without the frontend:
```bash
curl -N -s -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}], "model": "mistral-small-24b"}'
```
Expected: `data: {"content": "..."}` chunks followed by `data: [DONE]`

You can also test the Python script directly:
```bash
echo '{"messages": [{"role": "user", "content": "Hello"}], "model": "mistral-small-24b"}' | python3 server/g4f_chat.py
```

## Testing Procedure
1. Open http://localhost:8081 in browser
2. Verify the Dzeck AI interface loads (header: "Dzeck AI", empty state: "How can I help you today?")
3. Type a message in the input field at the bottom and click the purple send button
4. Verify: User message appears on right, typing indicator (dots) appears, then AI response streams on left
5. Send a follow-up message to test multi-turn conversation with context

## Known Issues & Troubleshooting

### Express 5 `req.on('close')` behavior
Express 5 fires `req.on('close')` when the request body is fully consumed, NOT when the client disconnects. If the chat endpoint uses `req.on('close')` to clean up child processes, it will kill the Python process immediately (~9ms) before it can respond. The fix is to use `res.on('close')` instead.

### g4f Provider Reliability
The Yqcloud provider is a free/community provider and may have intermittent availability issues. If AI responses fail, it might be a provider-side issue rather than a code bug. Test with `curl` first to isolate frontend vs backend issues.

### No Authentication Required
The app has no login/auth system - just open the URL and start chatting.

## Devin Secrets Needed
None - the app uses the free g4f library with no API keys required.
