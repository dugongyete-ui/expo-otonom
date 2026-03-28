# Dzeck AI - Autonomous AI Agent

## Project Overview
Dzeck AI is a full-stack Expo/React Native AI agent application that runs autonomous tasks in an isolated cloud E2B sandbox environment. It features a real-time desktop viewer (VNC), file management, tool execution, and a rich chat interface.

## Architecture

### Frontend (Expo / React Native)
- **Framework**: Expo ~53.0.0 with React Native 0.79.6
- **Router**: Expo Router v5 (file-based routing in `app/`)
- **State**: React Context (Auth) + React Query (server state)
- **Entry**: `app/_layout.tsx` → `app/(tabs)/index.tsx` → `components/MainLayout.tsx`

### Backend (Node.js / Express)
- **Server**: Express 5 with TypeScript (transpiled via tsx)
- **AI**: Cerebras AI (LLM) + custom agent flow
- **Sandbox**: E2B Desktop SDK (`@e2b/desktop`) — sole execution environment
- **Auth**: Custom JWT system (no Passport dependency)

## Key Files

### Server
- `server/index.ts` — Express server entry, registers all routes
- `server/routes.ts` — Main API routes (agent chat, sessions, sharing)
- `server/e2b-desktop.ts` — E2B Desktop sandbox management + REST API
- `server/auth-routes.ts` — JWT auth routes (login/register/logout/refresh/me)
- `server/agent/` — Python agent flow (LLM + tool execution)

### Frontend Components
- `components/MainLayout.tsx` — Root layout with left/chat/right panels
- `components/ChatPage.tsx` — Main chat UI with agent mode, settings (language, logout)
- `components/ChatInput.tsx` — Chat input with image + document file upload (sandbox upload)
- `components/VNCViewer.tsx` — VNC desktop viewer (noVNC on web, screenshot polling on mobile), auto-reconnect with exponential backoff, mobile touch-to-click + keyboard modal
- `components/ChatScreen.tsx` — Mobile chat screen with inline VNC panel + share modal
- `components/LeftPanel.tsx` — Session list with live background-agent indicator badge
- `components/AuthScreen.tsx` — Login/Register/Reset password screens

### Libraries
- `lib/auth-context.tsx` — React Context for auth state (AuthProvider + useAuth hook)
- `lib/auth-service.ts` — JWT auth API client with AsyncStorage token storage
- `lib/i18n.ts` — i18n module (English + Indonesian), `useI18n()` hook, `t()` function
- `lib/useChat.ts` — Chat/agent state hook with VNC URL handling
- `lib/api-service.ts` — API service client (chat, agent, sessions)
- `lib/e2b-service.ts` — E2B sandbox client-side service

## Authentication System
Controlled by `AUTH_PROVIDER` env var:
- `none` (default) — Auto-login with no credentials required
- `local` — Single user from env vars (`LOCAL_USER_EMAIL`, `LOCAL_USER_PASSWORD`, `LOCAL_USER_NAME`)
- `password` — In-memory user database (register/login)

JWT tokens stored in AsyncStorage (mobile) / localStorage (web).

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

## Internationalization (i18n)
- Two locales: English (`en`) and Indonesian (`id`)
- Auto-detects device locale on startup
- Language toggle in settings (gear icon in ChatPage header)
- `lib/i18n.ts` exports `t()`, `useI18n()`, `setLocale()`

## Development Workflows
- **Backend**: `npm run dev` (tsx server/index.ts) — port 5000
- **Expo Go**: `npx expo start` — port 8083 (web)

## Dependencies
All packages tracked in `package.json`. Key additions:
- `@e2b/desktop` — E2B sandbox SDK
- `@novnc/novnc` — VNC viewer for web
- `expo-document-picker@~13.1.6` — File upload from device
- `expo-clipboard@~7.1.5` — Clipboard for share URL copy
- `expo-localization@~16.1.6` — Device locale detection
- `expo-image-picker@~16.1.4` — Image picker
- `expo-haptics@~14.1.4` — Haptic feedback
- `expo-crypto@~14.1.5` — UUID generation
- `@react-native-async-storage/async-storage` — Token storage
