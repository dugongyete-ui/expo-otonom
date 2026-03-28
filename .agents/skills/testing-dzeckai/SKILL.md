# Testing Dzeck AI (new-dzeckai)

## Quick Start
```bash
npm install
pip install -r requirements.txt
npm run dev  # starts Express server on port 5000
```

## Devin Secrets Needed
- `E2B_API_KEY` — E2B cloud sandbox API key (must be in `.env` file)
- `CEREBRAS_API_KEY` — Cerebras AI API key
- `MONGODB_URI` — MongoDB Atlas connection string (optional, graceful fallback)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` — Redis connection (optional, graceful fallback)

## Key Endpoints to Verify
| Endpoint | What to check | Expected when working |
|----------|--------------|----------------------|
| `GET /api/status` | `e2bEnabled` | `true` |
| `GET /api/e2b/health` | `e2b_enabled`, `status` | `true`, `"ready"` |
| `GET /api/vnc/status` | `ready`, `e2b_enabled` | `true`, `true` |
| `GET /api/test` | `e2bEnabled`, `cerebrasConfigured` | `true`, `true` |
| `GET /api/e2b/sessions` | Returns JSON (not 404) | `{sessions: [], count: 0}` |

## E2B VNC Session Lifecycle Testing

To test the full E2B VNC session lifecycle via curl:

1. **Create session**: `POST /api/e2b/sessions` with `{"resolution":{"width":1280,"height":720}}`
   - Returns `session_id`, `sandbox_id`, `status: "starting"`
   - Session ID format: `xxxxxxxx-xxx` (8 chars, dash, 3 chars)

2. **Poll health**: `GET /api/e2b/sessions/{id}/health` every 3s, up to 60s
   - When ready: `ready: true`, `status: "running"`, non-null `stream_url`

3. **Get VNC URL**: `GET /api/e2b/sessions/{id}/vnc-url`
   - Returns `vnc_ws_url`, `stream_url`, `connection` object with `autoConnect: true`, `viewOnly: false`, `resize: "scale"`
   - May return 404 transiently due to Express 5.x route matching timing — retry once if this happens

4. **Connect API** (simulates BrowserPanel.tsx): `POST /api/e2b/sessions/connect` with `{"sandbox_id": "..."}`
   - Returns `session_id`, `sandbox_id`, `sdk_connected: true`, `status: "running"`

5. **Cleanup**: `DELETE /api/e2b/sessions/{id}` — returns `destroyed: true`

## E2B VNC Viewer (postMessage Bridge)

- **URL**: `http://localhost:5000/e2b-viewer`
- The page auto-connects to an existing E2B session if one exists
- `postStatusToParent` is defined inside `<script type="module">` — it is **module-scoped**, NOT on `window`
- To test the postMessage bridge, dispatch a message event:
  ```js
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'getStatus' } }))
  ```
  Expected console log: `[E2B-VNC] Received message from parent: getStatus`
- Non-critical warnings to expect: noVNC CDN fallback warning, favicon 404

## Web Chat UI
- Navigate to `http://localhost:5000/` to see the chat interface
- Sidebar should show **E2B Sandbox: Aktif** (green) and **Cerebras AI: Terhubung** (green)
- If E2B shows as inactive, the `.env` file may not have `E2B_API_KEY` or the env loading might be broken
- Click **"Komputer"** button (top-right) to open VNC panel — should show "Komputer Dzeck" with LIVE indicator

## Agent SSE Stream
- `POST /api/agent` with `{"message":"hello"}` returns an SSE stream
- First event: `type: "session"` with `session_id` and `e2b_enabled: true`
- Subsequent events: `message_start`, `message_chunk`, etc.
- Stream ends with `[DONE]`

## Architecture Notes
- **Server**: Express.js (TypeScript) — `server/index.ts` is the entry point
- **Agent**: Python async subprocess — `server/agent/agent_flow.py`
- **E2B Sandbox**: All shell/browser execution goes through E2B cloud (never local)
- The server spawns Python agent via `python3 -m server.agent.agent_flow` and passes env vars explicitly

## Browser Testing Gotchas
- **VNC canvas intercepts keyboard input**: When the e2b-viewer page is open, the VNC canvas captures all keyboard events. If you need to navigate away, close the VNC tab first or open a new tab. Typing in the URL bar while VNC is visible may send keystrokes to the remote desktop instead.
- **Browser autocomplete**: Chrome may autocomplete `localhost:5000` to `localhost:5000/e2b-viewer` from history. Use `localhost:5000/#main` or close all VNC tabs before navigating to avoid this.
- **Two separate frontends**: Web UI is `server/templates/web-chat.html`, Expo React Native components are separate and only testable in Expo app.

## Common Gotchas
- `.env` is loaded by a custom IIFE in `server/index.ts`. ESM import hoisting means module-level constants in imported files evaluate BEFORE the IIFE runs. Any E2B checks must use dynamic functions (not `const`) to read `process.env` at call time.
- TypeScript check: `./node_modules/.bin/tsc --noEmit` (not `npx tsc` which installs wrong package)
- Python deps must be installed separately (`pip install -r requirements.txt`)
- MongoDB/Redis are optional — the Python agent gracefully falls back to in-memory storage if unavailable
- The Dockerfile build command is `npm run build` (not `npm run server:build`)
