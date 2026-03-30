# Dzeck AI - Autonomous AI Agent

## Project Overview
Dzeck AI is a full-stack Expo/React Native AI agent application that runs autonomous tasks in an isolated cloud E2B sandbox environment. It features a real-time desktop viewer (VNC), file management, tool execution, and a rich chat interface — matching Manus.im capabilities.

## Architecture

### Frontend (Expo / React Native + Web client)
- **Framework**: Expo ~53.0.0 with React Native 0.79.6
- **Router**: Expo Router v5 (file-based routing in `app/`)
- **State**: React Context (Auth) + React Query (server state)
- **Entry**: `app/_layout.tsx` → `app/(tabs)/index.tsx` → `components/MainLayout.tsx`
- **Web client**: `client/src/App.tsx` → `client/src/pages/chat.tsx` (React web, dark theme)

### Backend (Node.js / Express)
- **Server**: Express 5 with TypeScript (transpiled via tsx)
- **AI**: Cerebras AI (LLM) + custom multi-agent flow (Python)
- **Sandbox**: E2B Desktop SDK (`@e2b/desktop`) — sole execution environment (no local fallback)
- **Auth**: Custom JWT system (no Passport dependency)

### Python Agent (`server/agent/`)
- **Flow**: `server/agent/flows/plan_act.py` — DzeckAgent with multi-step planning
- **Tools**: shell (E2B), browser (E2B Desktop), file (E2B + GridFS), search, desktop, todo, task
- **Multi-agent**: WebAgent, CodeAgent, FilesAgent, DataAgent, general (routed by step type)
- **Memory**: `server/agent/services/memory_service.py` — cross-session memory in MongoDB `agent_memory`
- **Streams**: Real-time SSE events via Python stdout → Node.js → client

## Key Files

### Server
- `server/index.ts` — Express server entry, registers all routes
- `server/routes.ts` — Main API routes (agent chat, sessions, sharing, files)
- `server/e2b-desktop.ts` — E2B Desktop sandbox management + REST API
- `server/auth-routes.ts` — JWT auth routes (login/register/logout/refresh/me)
- `server/db/mongo.ts` — MongoDB client (uses `MONGO_DB_NAME` env, default "manus")
- `server/db/redis.ts` — Redis client with graceful fallback
- `server/agent/` — Python agent flow (LLM + tool execution)

### Frontend Components
- `components/MainLayout.tsx` — Root layout with left/chat/right panels
- `components/ChatPage.tsx` — Main chat UI, handles browser_screenshot + desktop_screenshot events
- `components/ChatInput.tsx` — Chat input with image + document file upload
- `components/VNCViewer.tsx` — VNC desktop viewer (noVNC on web, screenshot polling on mobile), exponential backoff retry
- `components/BrowserPanel.tsx` — Browser panel, accepts lastBrowserEvent with screenshot_b64
- `components/ComputerView.tsx` — Desktop computer view
- `components/AgentPlanView.tsx` — Plan/step visualization
- `components/AgentToolView.tsx` — Tool output (shell terminal-like, search results, file viewer)
- `components/FilePanel.tsx` — File manager with GridFS download support
- `components/TakeOverView.tsx` — Interactive VNC takeover mode

### Libraries
- `lib/auth-context.tsx` — React Context for auth state
- `lib/auth-service.ts` — JWT auth API client with SecureStore/localStorage
- `lib/i18n.ts` — i18n module (English + Indonesian)
- `lib/useChat.ts` — Chat/agent hook with VNC URL + browser_screenshot handling
- `lib/api-service.ts` — API service client (chat, agent, sessions)
- `lib/agent-service.ts` — Agent SSE service with type definitions (incl. browser_screenshot, shell_output)
- `lib/e2b-service.ts` — E2B sandbox client-side service

## Database Configuration
- **MongoDB**: `MONGODB_URI` env var (URI), `MONGO_DB_NAME` env var (DB name, default: "manus")
  - All layers (TypeScript + Python) read `MONGO_DB_NAME` for consistency
- **Redis**: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` — graceful fallback if unavailable

## SSE Event Types
Real-time events streamed from agent to frontend:
- `message_start/chunk/end` — streaming text
- `tool` — tool call result with `tool_content` (shell, browser, search, file types)
- `tool_stream` — real-time shell output chunks
- `shell_output` — shell output with per-line type (stdout/stderr)
- `browser_screenshot` — base64 screenshot from browser actions
- `desktop_screenshot` — base64 screenshot from desktop actions
- `search_results` — web search results list
- `todo_update` / `task_update` — task list changes
- `vnc_stream_url` — VNC WebSocket URL for desktop viewer
- `plan` / `step` — plan structure and step status
- `done` — session complete

## Multi-Agent Routing
Steps routed by `agent_type` field in plan:
- `web` → WebAgent (browser, search tools)
- `code` → CodeAgent (shell, file tools)
- `files` → FilesAgent (file management)
- `data` → DataAgent (analysis, API)
- `general` → all tools

## Authentication System
Controlled by `AUTH_PROVIDER` env var:
- `none` (default) — Auto-login with no credentials required
- `local` — Single user from env vars
- `password` — MongoDB-backed user database

## E2B Sandbox
- `POST /api/e2b/sessions` — Create desktop sandbox (XFCE4 + Chrome + VNC)
- `GET /api/e2b/sessions/:id/screenshot` — Capture screenshot
- All agent tools (shell, browser, file, desktop) run ONLY in E2B
- No local subprocess fallback — explicit error if `E2B_API_KEY` not set

## Session Features
- Resume: `resume_from_session` param in `/api/agent`
- Share: `POST /api/sessions/:id/share` → public read-only URL
- Files: `GET /api/sessions/:id/files` → MongoDB `session_files` + GridFS download
- Todos: `GET /api/sessions/:id/todos` → MongoDB `agent_todos`
- Tasks: `GET /api/sessions/:id/tasks` → MongoDB `agent_tasks`

## Development Workflows
- **Backend**: `npm run dev` (tsx server/index.ts) — port 5000
- **Expo Go**: `npx expo start` — port 8083 (web)

## Python Agent Dependencies (`requirements.txt`)
- `e2b>=2.0.0` + `e2b-desktop>=1.0.0`
- `Pillow>=10.0.0`, `numpy>=1.24.0`
- `motor>=3.0.0`, `pymongo>=4.0.0` — MongoDB async/sync
- `redis>=5.0.0` — Redis async
- `tavily-python>=0.5.0`, `beautifulsoup4>=4.12.0`, `lxml>=4.9.0`

## Dependencies
All packages tracked in `package.json`. Key:
- `@e2b/desktop` — E2B sandbox SDK
- `@novnc/novnc` — VNC viewer for web
- `ioredis`, `mongodb` — Database clients
- `ws` — WebSocket server (VNC proxy)
- `multer` — File upload handling
