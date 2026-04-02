# Dzeck AI - Autonomous AI Agent

## Project Overview
Dzeck AI is a full-stack Expo/React Native AI agent application that runs autonomous tasks in an isolated cloud E2B sandbox environment. It features a real-time desktop viewer (VNC), file management, tool execution, and a rich chat interface — matching Manus.im capabilities.

## Architecture

### Frontend (Expo / React Native + Web client)
- **Framework**: Expo ~54.0.0 with React Native 0.79.x
- **Router**: Expo Router v5 (file-based routing in `app/`)
- **State**: React Context (Auth) + React Query (server state)
- **Entry**: `app/_layout.tsx` → `app/(tabs)/index.tsx` → `components/MainLayout.tsx`
- **Web client**: `client/src/App.tsx` → `client/src/pages/chat.tsx` (React web, dark theme)

### Backend (Node.js / Express)
- **Server**: Express 5 with TypeScript (transpiled via tsx)
- **AI**: Cohere AI (`command-a-reasoning-08-2025`) + custom multi-agent flow (Python)
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
- `components/MainLayout.tsx` — Root layout with left/chat/right panels; accepts `isAgentMode` prop to pass down to ChatPage
- `components/ChatPage.tsx` — Main chat UI; `isAgentMode` prop takes priority over URL `?mode=agent` param
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
- `lib/api-service.ts` — API service client (chat, agent, sessions) — uses `getApiUrl()` from query-client.ts
- `lib/query-client.ts` — Single source of truth for API base URL resolution (`getApiUrl()`)
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
- `none` (default) — Auto-login with no credentials required (handled by `AuthProvider.initAuth()`)
- `local` — Single user from env vars (`LOCAL_USER_EMAIL`, `LOCAL_USER_PASSWORD`)
- `password` — MongoDB-backed user database (register/login/reset-password)

Auto-login logic lives exclusively in `AuthProvider` (`lib/auth-context.tsx`). `AuthScreen` only renders forms for `local` and `password` modes.

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

## E2B Sandbox Endpoints
- `POST /api/e2b/sessions` — Create desktop sandbox
- `GET /api/e2b/sessions/:id/screenshot` — Capture screenshot (base64 PNG)
- `POST /api/e2b/sessions/:id/click` — Click at coordinates
- `POST /api/e2b/sessions/:id/type` — Type text to desktop
- `POST /api/e2b/sessions/:id/upload` — Upload file to sandbox

## Session Sharing
- `POST /api/sessions/:id/share` — Toggle public sharing (`is_shared: true/false`)
- `GET /api/sessions/:id/share` — Get sharing status + URL
- `GET /api/sessions/:id/events` — Get events for shared session (public read-only)
- `app/share/[sessionId].tsx` — Full read-only public share view with tabs for Messages, Plan, Tools

## Session Files API
- `POST /api/sessions/:sessionId/upload` — Upload file(s) for a specific session; stores metadata in MongoDB `session_files`
- `GET /api/sessions/:sessionId/files` — List all files uploaded to a session

## Health API
- `GET /api/health` — Returns status of MongoDB, Redis, E2B, and Cerebras; 200 if healthy, 503 if MongoDB unavailable

## MCP Server Management
- `GET /api/mcp/config` — List configured MCP servers (admin only)
- `POST /api/mcp/config` — Add a new MCP server
- `PUT /api/mcp/config/:name` — Update a specific MCP server
- `DELETE /api/mcp/config/:name` — Remove a MCP server
- `components/MCPPanel.tsx` — Full MCP management UI (add/edit/delete/enable servers)

## Model & Settings
- `GET /api/config` — Get app config (model names, search provider, feature flags)
- `PUT /api/config` — Update runtime config (model names, search provider)
- `components/SettingsPanel.tsx` — Model selection + search provider + status UI

## Agent Tools (multimedia + email)
- `server/agent/tools/multimedia.py` — `MultimediaTool`: export_pdf, render_diagram, speech_to_text, export_slides, upload_file
- `server/agent/tools/email_tool.py` — `EmailTool`: send_email
- All new tools registered in `server/agent/tools/registry.py` (TOOLS dict, ALL_TOOL_INSTANCES, TOOLKIT_MAP)

## SSE Reconnect
- `lib/api-service.ts` — `apiService.connectSessionSSE(sessionId, callbacks)`: connects to session stream with exponential backoff reconnect (max 10 retries), uses Redis XRANGE replay via `last_event_id` param

## Internationalization (i18n)
- Two locales: English (`en`) and Indonesian (`id`)
- Auto-detects device locale on startup
- Language toggle in settings (gear icon in ChatPage header)
- `lib/i18n.ts` exports `t()`, `useI18n()`, `setLocale()`

## Development Workflows
- **Backend**: `npx tsx server/index.ts` — port 5000 (external port 80, HTTPS)
- **Expo Go**: `bash scripts/update-domain.sh && REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_DEV_DOMAIN npx expo start --port 3002`

## Expo Go Connection Architecture
Replit only accepts HTTPS on external ports — plain HTTP (port 3002) is rejected. The connection uses an HTTPS relay through the Express backend:

1. User opens `https://domain/mobile` → sees QR code with `exps://domain`
2. Expo Go scans QR → connects to Express backend via HTTPS (port 80)
3. Express backend proxies manifest from Metro (`http://localhost:3002/manifest`)
4. Manifest URLs are rewritten: `http://domain:3002/*` → `https://domain/metro-proxy/*`
5. Expo Go downloads bundle via `https://domain/metro-proxy/index.bundle?...`
6. Express `/metro-proxy/*` route streams from Metro (`http://localhost:3002`) back to Expo Go
7. App loads!

**Key backend routes for Expo:**
- `GET /` or `/manifest` with `expo-platform: android` header → serves manifest (proxied from Metro)
- `GET /metro-proxy/*` → proxies all requests to Metro bundler on port 3002
- `GET /mobile` → landing page with QR code

## UI Theme
- **Palette**: Charcoal dark — bg `#1a1a1a`, surfaces `#242424`/`#2a2a2a`, borders `#333333`/`#3a3a3a`, text `#e0e0e0`, muted `#888888`, accent `#4a7cf0`
- **Defined in**: `lib/theme.ts` — all components import COLORS from here
- **Header icons**: Transparent button backgrounds, icon color `#a0a0a0`–`#b0b0b0`, size 20–22px
- **Tool icons**: `components/icons/ToolIcons.tsx` — SVG icons with `#2a2a2a` fill, `#3a3a3a` stroke

## Recent Fixes (April 2026 — Latest)
- **Cohere AI fully integrated**: All G4F/gpt4free references removed from `server/routes.ts`, `server/index.ts`, `server/agent/runner/agent_runner.py`, `server/agent/domain/g4f.py`. App now uses only `COHERE_API_KEY` env var.
- **Streaming parser fixed**: Chat endpoint (`/api/chat`) now correctly parses Cohere v2 NDJSON streaming format (each line is raw JSON with `type` field) instead of SSE format. Supports `thinking_start/chunk/end` events for reasoning model tokens.
- **Thinking tokens exposed**: `command-a-reasoning-08-2025` model sends thinking tokens before the actual response. These are now streamed as `thinking_chunk` events for real-time display.
- **Health check updated**: `/api/health/tools` now reports `cohere_configured` (was `g4f_configured`); `/api/health` now checks `services.cohere` instead of `services.g4f`.

## Recent Fixes (April 2026)
- **Icons fix**: Added `...Ionicons.font` to `useFonts` in `app/_layout.tsx` — Ionicons (from @expo/vector-icons) now loads properly; icons no longer appear as squares.
- **E2B text removed**: Replaced all user-facing "E2B" labels with professional equivalents: "Sandbox" (status badge in ChatPage.tsx), "Cloud Desktop" (BrowserPanel.tsx title), "Membuat Cloud Desktop Sandbox..." (status message).
- **Chrome-only browsing**: Fixed `_navigate_via_xdotool` in `browser.py` — now always ensures Chrome is running first, then navigates via xdotool Ctrl+L; removed `sb.open()` and `xdg-open` fallbacks that could launch Firefox. Also updated web_agent system prompt to explicitly require Chrome.
- **File upload (all types)**: ChatInput.tsx now uses DocumentPicker (`type: "*/*"`) for all file attachments, not just images. File type is auto-detected (image vs generic file) by mimeType. Non-image files show a document icon preview. ChatAttachment type updated to include `type: "file"` and optional `mimeType` field.

## Session Staleness Fix
- **LeftPanel** uses `isSessionActuallyRunning()` — treats sessions with `updated_at` older than 3 min as idle, even if status is "running"
- **Server startup** (`server/routes.ts`) marks all sessions with status "running" and `updated_at` older than 5 min as "completed" in MongoDB
- **Polling interval**: LeftPanel polls every 8s (down from 5s)

## Critical Patches Applied
- **`node_modules/@expo/metro-config/build/serializer/fork/js.js`**: Patched undefined `dependency.absolutePath` bug (line ~72) that caused `TypeError: The "to" argument must be of type string` when bundling Android. Fix: wrap `path.relative()` call in null-check.
- **`babel.config.cjs`**: Added `react-native-reanimated/plugin` (required for TypingIndicator worklets)
- **`components/FilePanel.tsx`**: Fixed dynamic `require("@/lib/api-service")` → static import of `getStoredToken`
- **`app.config.js`**: Dynamic Expo config overrides `app.json` plugins — sets `expo-router` `origin` from `EXPO_PUBLIC_DOMAIN` env var instead of hardcoded `https://dzeck-ai.app/`. Also sets `extra.apiDomain` for runtime use.
- **`scripts/update-domain.sh`**: Now uses `grep + append` to add missing `.env` keys (not just sed-replace existing ones), and prints the `/mobile` URL clearly in the terminal after each start.

## Python Agent Dependencies (`requirements.txt`)
- `e2b>=2.0.0` + `e2b-desktop>=1.0.0`
- `Pillow>=10.0.0`, `numpy>=1.24.0`
- `motor>=3.0.0`, `pymongo>=4.0.0` — MongoDB async/sync
- `redis>=5.0.0` — Redis async
- `tavily-python>=0.5.0`, `beautifulsoup4>=4.12.0`, `lxml>=4.9.0`

## Testing
### Python
- `pytest server/agent/tests/ -v` — runs 38 unit tests for `e2b_sandbox.py` (no E2B API key needed)
- Tests cover: `_is_sandbox_alive`, `_detect_sandbox_home`, `run_command`, file read/write, VNC stream params, `get_sandbox` deduplication, `_create_sandbox` retry logic, file cache, `_connect_existing_sandbox`, `get_session_workspace`
- All tests use `unittest.mock` — no live sandbox required

### TypeScript
- `npx vitest run` — runs 19 unit tests for `e2b-desktop.ts` (no E2B API key needed)
- Tests cover: SDK API method signatures (camelCase names), `execInSandbox` result mapping, `bootstrapDesktop` VNC stream params, `destroySession` cleanup, retry behavior
- Config: `vitest.config.ts`

## Dependencies
All packages tracked in `package.json`. Key:
- `@e2b/desktop` — E2B sandbox SDK
- `@novnc/novnc` — VNC viewer for web
- `ioredis`, `mongodb` — Database clients
- `ws` — WebSocket server (VNC proxy)
- `multer` — File upload handling
- `vitest` (dev) — TypeScript unit test runner
