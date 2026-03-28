# Testing chat-apk

## Overview
This is a React Native/Expo chat application with a Node.js Express backend that proxies to Cerebras AI. It has two modes: Chat (direct LLM streaming) and Agent (Python-based tool execution).

## Devin Secrets Needed
- `CEREBRAS_API_KEY` - Cerebras AI API key from https://cloud.cerebras.ai/

## Local Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Verify .env file exists
The `.env` file should contain:
- `CEREBRAS_API_KEY`, `CEREBRAS_CHAT_MODEL`, `CEREBRAS_AGENT_MODEL`
- `PORT=5000`, `NODE_ENV=development`

### 3. Start the backend server
```bash
npm run server:dev
# Runs on port 5000
```
Verify: `curl http://localhost:5000/status` should return `{"status":"ok"}`

### 4. Start Expo web dev server
```bash
npx expo start --web --port 8081
# Takes ~25-30 seconds to bundle
```
The app will be available at `http://localhost:8081`

## Testing Checklist

### Chat Mode (always works with Cerebras API)
1. **Empty state**: Dark background, centered "Apa yang bisa saya bantu?" text, no header, input bar with toolbar at bottom
2. **Send message**: Type in input field, click purple send button. Header should appear with "Dzeck AI" and "Lite" badge
3. **Response streaming**: AI response streams in real-time from Cerebras AI, displayed without bubble on left side
4. **User bubble**: User messages appear in gray (#2A2A30) bubble on right side
5. **Mode toggle**: Only visible on empty state (disappears when chat has content)
6. **Back button**: Returns to empty state (clears chat)

### Agent Mode (requires Python backend with pydantic)
1. **Toggle**: Click flash/branch icon in toolbar to switch modes
2. **Empty state**: Placeholder changes to "Tetapkan tugas atau tanyakan apa saja"
3. **Header**: Shows "Dzeck Agent" with purple "Agent" badge
4. **Python backend**: Agent mode spawns `python3 -m server.agent.agent_flow` - requires `pydantic` and other Python dependencies installed. If `pydantic` is not installed, agent responses will silently fail.

### Known Issues
- Agent mode Python backend may fail if `pydantic` is not installed (`pip install pydantic`)
- Browser console shows standard React Native web warnings (shadow props, pointerEvents, useNativeDriver) - these are harmless
- The `onShowHistory` prop is passed to ChatInput but not destructured/used - history button is not accessible from empty state
- Expo web bundling takes ~25-30 seconds on first load

## Architecture Notes
- Frontend: React Native/Expo with file-based routing (`app/(tabs)/index.tsx` is the main screen)
- Backend: Express server at `server/routes.ts` with `/api/chat` (Cerebras AI SSE proxy) and `/api/agent` (Python process spawner)
- API client: `lib/chat.ts` with `streamChat()` and `streamAgent()` functions
- The frontend connects to backend via `getApiUrl()` which defaults to `http://localhost:5000/`
