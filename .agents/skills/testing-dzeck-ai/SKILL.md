# Testing Dzeck AI App

## Architecture Overview

This project has TWO separate frontends:
1. **Web UI (`server/templates/web-chat.html`)**: A standalone 3000+ line HTML/JS template served at `localhost:5000`. This is what users see in web browsers.
2. **Expo React Native App (`components/*.tsx`, `app/`)**: React Native components used in the Expo mobile app (or Expo web build). These are NOT rendered by the web UI.

When testing changes to React Native components (e.g., `ToolPanel.tsx`, `BrowserPanel.tsx`, `AgentToolCard.tsx`), be aware they are only visible in the Expo app, NOT the web-chat.html interface.

## How to Run

```bash
# Start the dev server (serves web-chat.html at localhost:5000)
npm run dev

# TypeScript type check (use this, NOT `npx tsc` which installs wrong package)
npm install --no-save typescript && npx tsc --noEmit --pretty
```

## Python Agent Dependencies

The agent mode (`/api/agent`) spawns a Python process that requires dependencies from `requirements.txt`. If the agent fails with `ModuleNotFoundError`, install them:

```bash
pip install -r requirements.txt
# At minimum: pip install pydantic
```

## Key Endpoints

- `GET /` - Serves web-chat.html (the main web UI)
- `GET /mobile` - Serves landing-page.html (Expo mobile download page)
- `GET /e2b-viewer` - Serves E2B VNC viewer
- `POST /api/chat` - Simple chat (no tools, just LLM response)
- `POST /api/agent` - Agent mode with tool execution (shell, file, browser, etc.)
- `GET /api/status` - Health check

## E2B Sandbox

The app uses E2B cloud sandboxes for tool execution (shell, file operations, browser). If E2B sandbox is not available, tool execution will fail with "E2B sandbox not available. Check E2B_API_KEY". This is expected if the E2B API key is expired or invalid.

## Testing Checklist

1. **TypeScript compilation**: `npx tsc --noEmit --pretty` should pass
2. **Server starts**: `npm run dev` should show "Server ready" on port 5000
3. **Chat mode**: Send a message at localhost:5000, verify AI responds
4. **Agent mode**: Send a task like "Buat file hello.txt", verify tool cards appear
5. **Komputer button**: Click "Komputer" in header, verify VNC panel toggles
6. **Expo components**: Can only be tested with Expo Go on mobile or `npx expo export:web`

## Devin Secrets Needed

- `E2B_API_KEY` - For E2B cloud sandbox (tool execution)
- `CEREBRAS_API_KEY` - For Cerebras AI LLM (chat/agent responses)
- `MONGODB_URI` - For session persistence
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - For Redis cache

## Common Issues

- **No agent response**: Check if Python dependencies are installed (`pip install pydantic`)
- **E2B sandbox errors**: The E2B API key may be expired. Check `.env` file.
- **TypeScript `npx tsc` installs wrong package**: Use `npx tsc --noEmit` only after `npm install --no-save typescript`
- **React Native changes not visible in web**: The web UI is `web-chat.html`, not the Expo app. RN component changes only affect the Expo mobile app.
