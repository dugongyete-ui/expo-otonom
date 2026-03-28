# Dzeck AI

## Overview
Dzeck AI is a cross-platform application built with Expo (React Native) and Node.js, designed to provide an AI chat experience alongside autonomous agent capabilities. It implements a Manus-like autonomous agent architecture featuring class-based tools and a PlannerAgent + ExecutionAgent pattern. The project aims to deliver a robust and interactive AI assistant with real-time streaming, session persistence, and integrated browser automation.

**Key capabilities include:**
- Real-time AI chat with streaming responses.
- Autonomous agent mode with planning and execution.
- Interactive web UI with live VNC display for browser tools.
- Isolated and secure shell/code execution in a cloud sandbox.
- Comprehensive session management with resume and rollback features.
- Support for the Model Context Protocol (MCP).

## User Preferences
- I prefer the AI to communicate using simple language.
- I want iterative development where I can provide feedback at each major step.
- Ask before making any major architectural changes or introducing new dependencies.
- I prefer detailed explanations for complex technical decisions.
- Do not make changes to the `app/` folder without explicit instruction.
- All prompts should be in Bahasa Indonesia by default.

## Recent Updates (March 2026 — Session 11: VNC Black Screen Fix)
- **Root cause identified & fixed:** Chromium crashloop disebabkan kombinasi flag `--disable-gpu` + `--disable-software-rasterizer`. Tanpa GPU hardware (`/dev/dri` tidak ada) dan software rasterizer dinonaktifkan, Chromium tidak punya rendering path sama sekali → crash exitCode 127.
- **Nix-packaged Chromium digunakan:** Playwright's bundled Chromium (`chrome-linux64/chrome`) tidak bisa dijalankan langsung di NixOS karena library paths tidak set (libglib, libX11, dll. missing). Server sekarang menggunakan `ungoogled-chromium-131.0.6778.204` dari Nix store yang sudah di-rpath-patch dengan benar.
- **Watchdog diperbaiki:** Sebelumnya, ketika Chromium crash, seluruh VNC stack (Xvfb + x11vnc + fluxbox) dimatikan. Sekarang hanya Chromium yang di-restart (`launchChromiumOnly()`). VNC display tetap jalan tanpa interupsi.
- **Splash page ditambahkan:** Chromium sekarang membuka `/vnc-splash` (halaman branded Dzeck AI bergradient dark) bukan `about:blank`. Layar tidak lagi tampak "hitam kosong" saat idle.
- **Chromium launch direfaktor:** Logic launch Chromium diekstrak ke fungsi terpisah `launchChromiumOnly()` yang dapat dipanggil secara independen tanpa restart VNC stack.

## Recent Updates (March 2026 — Session 10: Setup Script Overhaul)
- **setup.sh completely rewritten:** Script sekarang dibagi 6 bagian terstruktur. Ditambahkan instalasi Expo & React Native packages yang sebelumnya tidak ada (expo, expo-router, expo-status-bar, expo-splash-screen, expo-font, expo-web-browser, react-native, react-native-gesture-handler, dll). Script tidak lagi menggunakan `set -euo pipefail` sehingga satu kegagalan tidak menghentikan seluruh proses.
- **Python packages ditambahkan ke setup.sh & requirements.txt:** `lxml`, `aiofiles`, `pymongo`, `dnspython`, `certifi`, `charset-normalizer`, `multidict`, `yarl` — semua sudah diverifikasi berhasil diimport.
- **scripts/post-merge.sh updated:** Sinkronisasi dengan setup.sh, termasuk instalasi Expo packages.
- **requirements.txt updated:** Ditambahkan semua packages baru yang digunakan agent.

## Recent Updates (March 2026 — Session 9: Code Audit & Cleanup)
- **Dead Code Removed:** File-file yang didefinisikan tapi tidak pernah digunakan/dipanggil dihapus:
  - `server/routes.ts.backup` → File backup lama dari routes, sudah tidak relevan.
  - `server/static.ts` → `serveStatic()` tidak pernah dipanggil oleh `server/index.ts`. Server melayani file statis langsung lewat `configureExpoAndLanding`.
  - `server/vite.ts` → `setupVite()` tidak pernah dipanggil oleh `server/index.ts`. UI utama adalah `web-chat.html`, bukan Vite/React dev server.
- **Missing Dependencies Installed:** `multer` dan `qrcode-terminal` diinstall (keduanya digunakan di `server/routes.ts` dan `server/index.ts` tapi belum terinstall).
- **Architecture Verified:** Arsitektur project diverifikasi sudah sesuai dengan diagram System Architecture — User Interface (web-chat.html) → Backend (routes.ts) → Python Agent (agent_flow.py) → Multi-Agent Pool (Web/Data/Code/Files) → Tools (browser/shell/file/search) → Output.
- **Files Preserved (Intentional):** `server/g4f_chat.py` (standalone Python script buatan user, tidak terhubung ke routes tapi dibiarkan), `server/storage.ts` + `shared/schema.ts` (scaffold DB user yang belum terhubung ke routes, dibiarkan untuk pengembangan berikutnya), `client/` directory (React/Vite app yang tidak di-serve oleh server saat ini — UI utama ada di web-chat.html).

## Recent Updates (March 2026 — Session 8: Infrastructure Restoration & Sync)
- **server/routes.ts restored:** Dikembalikan ke versi lengkap dari git history (commit b0edeb0) — 826 baris penuh dengan multer file upload, VNC WebSocket proxy, E2B sandbox status endpoint, `handleVncUpgrade` export, error handler untuk spawn Python.
- **server/index.ts restored:** Dikembalikan ke versi asli — CORS setup, multi-port (5000/8081/8082), serve `web-chat.html` di root, QR code Expo Go, dynamic manifest routing.
- **ESM Compatibility fixes:** `require()` diganti dengan `createRequire`/`import` ESM-compatible di kedua file karena `package.json` pakai `"type": "module"`. Termasuk `__dirname` fix via `fileURLToPath`.
- **Python 3.11 installed:** Module python-3.11 ditambahkan ke environment, semua packages dari `requirements.txt` diinstall.
- **Workflows restored:** Dua workflow dikembalikan ke konfigurasi asli:
  - `Start Backend`: `NODE_ENV=development tsx server/index.ts` — port 5000, outputType=webview (menampilkan web-chat.html)
  - `Start Frontend`: `npx expo start --web --port 8099` — outputType=console (untuk Expo Go APK)
- **requirements.txt cleaned:** Hapus `anthropic>=0.40.0` dan duplikat packages.
- **scripts/post-merge.sh cleaned:** Hapus `anthropic>=0.40.0`.
- **setup.sh updated:** Informasi "Mulai server" diperbarui dengan perintah yang benar dan keterangan workflow Replit.

## Recent Updates (March 2026 — Session 7: Multi-Agent Architecture)
- **Multi-Agent Coordination Layer:** Sistem Dzeck AI sekarang menggunakan 4 specialized agents yang dikoordinasikan oleh Orchestration Layer.
  - `server/agent/prompts/agents/web_agent.py` — Web Agent (Browsing & Extraction): spesialis browser automation, pencarian internet, scraping. Tools: browser_*, info_search_web, web_search, web_browse.
  - `server/agent/prompts/agents/data_agent.py` — Data Agent (Analysis & API): spesialis analisis data, API access, sintesis informasi. Tools: info_search_web, browser_*, file_*, shell_exec.
  - `server/agent/prompts/agents/code_agent.py` — Code Agent (Python & Automation): spesialis penulisan/eksekusi kode Python, file binary. Tools: shell_*, file_*.
  - `server/agent/prompts/agents/files_agent.py` — Files Agent (Management & Processing): spesialis manajemen file, dokumen teks. Tools: file_*, shell_exec.
  - `server/agent/prompts/agents/orchestrator.py` — Orchestrator sistem: koordinasi antar agents dan aturan penugasan.
- **AgentType Enum:** `server/agent/models/plan.py` — Ditambahkan `AgentType` enum (WEB, DATA, CODE, FILES, GENERAL) dan field `agent_type: str` ke model `Step`. Step sekarang membawa informasi agent yang harus menanganinya.
- **Planner Updated:** `server/agent/prompts/planner.py` — Planner sekarang menghasilkan `agent_type` untuk setiap step dalam JSON output, baik `CREATE_PLAN_PROMPT` maupun `UPDATE_PLAN_PROMPT`. Ditambahkan panduan routing Multi-Agent Coordination Layer di system prompt.
- **Agent Flow Multi-Agent Execution:** `server/agent/agent_flow.py` — Ditambahkan:
  - `_AGENT_CONTEXT_MAP`: mapping agent_type → (system_prompt, allowed_tools)
  - `_AGENT_DISPLAY_NAMES`: display names untuk UI notification  
  - `_get_agent_context()`: helper mendapatkan system prompt dan tool list per agent
  - `_filter_tool_schemas()`: memfilter TOOL_SCHEMAS sesuai tools yang diizinkan per agent
  - `run_planner_async`: parse `agent_type` dari step JSON planner
  - `update_plan_async`: parse `agent_type` dari updated steps
  - `execute_step_async`: menggunakan agent-specific system prompt (`_agent_sys_prompt`) dan tool schemas yang difilter (`_agent_tool_schemas`) per step. Emit notify event menampilkan agent mana yang menangani langkah.

## Recent Updates (March 2026 — Session 6: Agent Transparency Overhaul)
- **System Prompt Transparency:** `server/agent/prompts/system.py` — Updated `<agent_loop>` steps 2, 3, 5 to require explicit reporting via `message_notify_user` before/after tool calls. Updated `<agent_behavior>` with new points: "Pelaporan Aksi Eksplisit" (report tool+args before exec), "Pelaporan Hasil Aksi" (report results after exec), "Penanganan Kesalahan Transparan" (report errors and fix strategy). Added new blocks: `<reporting_rules>`, `<sandbox_best_practices>`, `<transparency_checklist>`.
- **File Write Content Preview:** `server/agent/tools/file.py` — `file_write` now returns first 1000 chars of written content in both `message` (as Markdown code block with language hint) and `data.content_preview` field. Language detection from file extension for syntax-aware preview.
- **E2B Shell Streaming Enhancement:** `server/agent/tools/shell.py` — `_run_e2b` now uses `on_stdout`/`on_stderr` callbacks when a `stream_queue` is registered, enabling real-time output streaming to frontend even through the standard shell_exec path (not just the agent_flow.py streaming path).
- **UI Syntax Highlighting:** `components/AgentToolView.tsx` — Replaced plain `Text` rendering in `ShellContent` and `FileContent` with `RichContent` component that parses Markdown code blocks and renders them with syntax highlighting (keywords, strings, comments, numbers, functions in Dracula-style colors), line numbers, and language badges. Added `CallingArgsPreview` to show highlighted code/file content when `status === "calling"`. Increased result display limit and improved argument key highlighting.

## Recent Updates (March 2026 — Session 5: Agent Core Engine Overhaul)
- **Per-Session Workspace Isolation:** `e2b_sandbox.py` — Added `get_session_workspace()` which namespaces E2B workspace by session ID: `/home/user/dzeck-ai/<session_id>/`. Sandbox creation auto-creates session workspace. All shell commands default to session workspace instead of shared dir.
- **E2B file_find_by_name/file_find_in_content in Sandbox:** `file.py` — Both functions now detect E2B paths (`/home/user`, `/tmp`) and run `find`/`grep` commands inside the E2B sandbox instead of local filesystem (which had no sandbox files). This fixes the "directory not found" errors when agent tries to search for files it just created in E2B.
- **Strengthened Repeated Error Detection (Block at 2):** `shell.py` — `_check_repeated_command_prerun` now blocks at count >= 2 (was 3). `_check_repeated_error` now uses session-scoped keys (prefixed with `DZECK_SESSION_ID`) to prevent cross-session pollution. Error message updated to: "BLOCKED: identical command/error seen before — change approach entirely".
- **Context Window Compaction:** `agent_flow.py` — Added `_compact_exec_messages()` function that compresses exec_messages when count > 12: keeps system prompt, first user message, last 4 messages, and a compressed summary of the middle. Called in both native tool-call path and text-based tool-call path. Prevents token limit errors on long tasks.
- **Step Retry on Failure:** `agent_flow.py` — `run_async` now tracks `_step_consecutive_failures` per step. When a step fails for the first time, it automatically retries once with an explicit error context injected: "Previous attempt failed with: [error]. Take a DIFFERENT approach." Only marks the plan step as truly failed after 2 consecutive failures on the same step.
- **Session Workspace in Shell Preflight:** `shell.py` — `_preflight_ensure_scripts` and `_run_e2b` now use `get_session_workspace()` as default exec_dir instead of hardcoded `/home/user/dzeck-ai`. `shell_exec` also uses session workspace as default.

## Recent Updates (March 2026 — Session 4: Production Overhaul)
- **Fix Plan Auto-Complete Bug:** `agent_flow.py` — `message_ask_user` no longer marks steps as COMPLETED. Steps stay PENDING while waiting for user reply. `save_step_completed` is skipped when `step_waiting=True` in both continuation and main flow paths.
- **Code Validation & Self-Correction Loop:** `shell.py` — Added `_validate_python_syntax()` which runs `python3 -m py_compile` before executing Python scripts. Up to 3 retry attempts with syntax analysis between each.
- **Execution Prompt Hardened:** `execution.py` — Added `<code_generation_rules>` (try blocks must have valid body, mandatory syntax validation, pip install before import, output to /output/, consistent indentation, proper error handling) and `<anti_hallucination_rules>` (verify shell output, no completed-on-error, change approach on repeated errors).
- **Planner Prompt Anti-Hallucination:** `planner.py` — Added rules: every code step needs verification step, no library assumption, max 8 steps, atomic/specific steps, retry must differ.
- **File Delivery Enhancement:** `execution.py` SUMMARIZE_PROMPT now includes `{output_files}` template. `agent_flow.py` `summarize_async` scans E2B output dir and syncs files before summary, announces downloadable files.
- **E2B-Only Execution Enforced:** `shell.py` — Local execution disabled; returns error if E2B_API_KEY not set. `file.py` — `file_read`, `file_write`, `file_str_replace` all refuse to operate without E2B sandbox.
- **Anti-Hallucination & Retry Intelligence:** `shell.py` — Added `_check_repeated_error()` (tracks command+error pairs, warns on 2+ repeats), `_check_error_in_output()` (detects traceback/error/failed in output). Error outputs include warnings to change approach.

## Recent Updates (March 2026 — Session 3: System Prompt Upgrade)
- **System Prompt Upgrade (Claude Cowork Integration):** `server/agent/prompts/system.py` diperbarui dengan seksi-seksi perilaku komprehensif: refusal_handling, tone_and_formatting, user_wellbeing, evenhandedness, knowledge_cutoff, additional_info, ask_user_question_guidelines, todo_rules (with tools), task_tool_guidelines, citation_requirements, artifacts_rules, skills_and_best_practices, file_creation_advice, producing_outputs, sharing_files, web_content_restrictions, unnecessary_tool_use_avoidance, suggesting_actions, package_management. Semua referensi "Claude" diganti "Dzeck", "Anthropic" diganti "Tim Dzeck".
- **New Tools — TodoList:** `server/agent/tools/todo.py` — Tools baru: `todo_write` (buat checklist), `todo_update` (tandai item selesai), `todo_read` (baca kemajuan). Menggunakan file todo.md di workspace.
- **New Tools — Task/Subagent:** `server/agent/tools/task.py` — Tools baru: `task_create` (buat sub-tugas), `task_complete` (tandai selesai), `task_list` (lihat status). Menyimpan task data sebagai JSON di `.tasks/` directory.
- **Execution Prompt Updated:** `server/agent/prompts/execution.py` — Ditambahkan: clarification_before_work, progress_tracking (todo tools), tool selection guide #10 (todo) dan #11 (task), sub_task_strategy, artifacts_guidance, package_management, tone_rules, citation_rules.
- **Planner Prompt Updated:** `server/agent/prompts/planner.py` — Tool list diperluas ke 36 tools + idle. Ditambahkan: clarification step, progress tracking step, verification step, sub-task/parallelization guidance, package management rules.
- **Tool Registry Updated:** `server/agent/tools/registry.py` — Ditambahkan 6 tools baru (todo_write, todo_update, todo_read, task_create, task_complete, task_list) ke TOOLS, TOOLKIT_MAP, dan ALL_TOOL_INSTANCES.

## Recent Updates (March 2026 — Session 2)
- **Conversation Memory (Chat History):** Agent sekarang punya memori percakapan lintas pesan dalam sesi yang sama. `respond_directly_async` dan `run_planner_async` menerima parameter `chat_history`. `run_async` memuat history dari SessionService di awal, dan menyimpannya kembali setelah setiap respons. `main()` mem-parse `messages` dari frontend menjadi `chat_history` dan meneruskannya ke agent. History disimpan di Redis (cache) dan MongoDB (persistent).
- **Browser Screenshots di Tool Cards:** `BrowserContent` di `AgentToolCard.tsx` kini merender `screenshot_b64` (base64 JPEG) yang sudah ditangkap oleh `PlaywrightSession` di `browser.py`. Screenshot ditampilkan sebagai gambar di dalam collapsed tool card.
- **Event Handlers Baru di ChatPage:** Menambahkan handler untuk: `message_correct` (koreksi teks streaming yang di-wrap JSON), `notify` (update progress dari agent), `files` (daftar file yang dibuat), `tool_stream` (streaming output shell real-time).
- **Type Definitions Updated:** `AgentEventType` di `lib/chat.ts` diperluas dengan `tool_stream`, `message_correct`, `notify`, `files`, `session`, `ask`. `AgentEvent` interface diperluas dengan field `text`, `files`, `action`, `session_id`.

## Recent Updates (March 2026)
- **System Prompt Upgraded:** `server/agent/prompts/system.py` fully rewritten based on official Dzeck system prompt spec. Now includes full agent loop, planner/knowledge/datasource module docs, VNC browser rules, sandbox environment info, and all tool use rules — aligned with Manus-grade agent behavior.
- **Execution Prompt Updated:** `server/agent/prompts/execution.py` — removed "headless sandbox" restrictions. AI is now instructed that the browser runs on real VNC and can click, scroll, type just like a human operating a computer.
- **Web UI — Duplicate Name Removed:** `server/templates/web-chat.html` — removed all HTML text occurrences of "Dzeck AI" name (splash title, sidebar app name, header title default). Only the logo image (which already contains the brand name) remains, avoiding duplication.
- **Browser VNC Control:** Agent browser tools (browser_navigate, browser_click, browser_input, browser_scroll_up/down, browser_press_key, browser_select_option, browser_move_mouse) are fully active and run in the VNC-visible Chromium session via CDP. AI controls browser exactly like a human.
- **Race Condition Bug Fixed:** `message_notify_user` emits `"notify"` event type (inline note inside step card) instead of `message_start/chunk/end`; `message_ask_user` emits `role: "ask"` to distinguish from final AI response bubbles.
- **Step History Navigator ("Loncat ke Live"):** Full scrubber added to Komputer Dzeck panel — `captureStepSnapshot`, `navigateHistory`, `jumpToLive`, `_renderHistoryFrame`, scrubber drag/touch handlers, prev/next buttons, and dot markers. State: `S.stepHistory`, `historyIdx`, `_liveTermHTML/Url`.
- **Real-time Token Streaming:** `summarize_async` now uses `call_cf_streaming_realtime` for true token-by-token streaming. `message_correct` event handles post-stream JSON wrapper cleanup.
- **"Menunggu Balasan" Badge:** `createAiMsg(isAsk)` now renders a pulsing yellow badge "Dzeck sedang menunggu balasan Anda" when agent calls `message_ask_user`. Badge automatically removed when user sends next message via `appendUserMsg`.

## System Architecture

**Core Architecture:**
- **Manus-like Autonomous Agent:** Utilizes a PlannerAgent and ExecutionAgent pattern with class-based tools and a `@tool` decorator.
- **Language:** Python `async` (AsyncGenerator) for the agent, Node.js for the backend.
- **LLM:** Cerebras AI (specifically `qwen-3-235b-a22b-instruct-2507` via https://cloud.cerebras.ai/).
- **Framework:** Pydantic BaseModel for data models, `async` generator for streaming.
- **Database:** MongoDB Atlas for session and agent persistence.
- **Cache:** Redis for session state caching.
- **Browser Automation:** Playwright (non-headless) running on a VNC display for live interaction, with HTTP fallback.
- **Shell Sandbox:** E2B Cloud Sandbox for isolated and secure code execution, with 900s timeout, 3-attempt retry, auto-recovery, and keepalive. The workspace is `/home/user/dzeck-ai/` with output in `/home/user/dzeck-ai/output/`. Pre-installed packages include reportlab, python-docx, openpyxl, Pillow, yt-dlp, pandas, matplotlib.
- **System Design:** Domain-Driven Design (DDD) with clear separation of Domain, Application, and Infrastructure layers.
- **Session Management:** Full session resume and rollback support.
- **Tooling:** Class-based tools implemented with a `BaseTool` pattern and `@tool` decorator.

**Branding:**
- **Logo:** Dzeck AI logo (`assets/images/icon.png`) - new logo applied to all icons (favicon, Android adaptive icon, splash icon).
- **Transparent Logo:** `assets/images/dzeck-logo-transparent.png` - PNG with alpha channel, used for splash screens.
- **Splash Screen (Web):** Full-screen dark splash (#0a0a0c) in `web-chat.html` shows transparent logo (inverted white) with animated dots, auto-hides after 1.2s.
- **Splash Screen (Native):** Custom `SplashLoader` component in `app/_layout.tsx` shows during font loading with animated logo and dots.

**UI/UX and Web Chat Features:**
- **Manus-style Web UI:** Redesigned `server/templates/web-chat.html` for a Manus-like interface.
- **Dynamic UI Elements:** Smooth transitions between welcome screen and chat, dynamic computer panel toggle.
- **VNC Integration:**
    - Xvfb virtual display on `:10` with `1280x720x24` resolution.
    - Fluxbox lightweight window manager for proper window rendering.
    - `x11vnc` server on port `5910` with `-xkb -noxrecord -noxfixes` flags for proper keyboard input passthrough.
    - Native WebSocket to TCP proxy for VNC connection.
    - Playwright agent browser appears on VNC in kiosk mode for live interaction.
    - `noVNC` client loaded via CDN in HTML templates.
    - Mobile-friendly VNC toolbar with essential controls (takeover, keyboard, clipboard, etc.).
    - Mobile touch events handled with `preventDefault()` and `stopPropagation()` in takeover mode; listeners bound once to prevent accumulation on reconnects.
    - VNC auto-shutdown after 10 minutes of idle activity, with auto-restart on agent demand.
- **Sandbox Terminal:** Real-time streaming output from E2B sandbox for shell tools, displayed in a dark terminal panel.
- **Plan Cards:** Agent plans are displayed as expandable cards in the chat with real-time status updates.
- **Tool Items:** Each tool call shows status (calling, called, error) with visual indicators.
- **"Komputer Dzeck" Panel:** Side panel dynamically switches between VNC for browser tools and Sandbox Terminal for other tools.
- **"Perencana" Tab:** Provides an overview of all plan steps and their status.
- **Clean Chat:** Only final AI responses are shown in the main chat; tool activity is neatly organized under steps.
- **Browser Screenshot:** Live screenshots from Playwright are displayed in tool cards and the panel.
- **Expandable Tool Cards:** Show colored accent bars, icons, labels, and expandable inline content without modals.

**Technical Implementations:**
- **Per-Session Isolation:** Each agent request gets a unique `DZECK_SESSION_ID`; files stored in `/tmp/dzeck_files/{session_id}/` with path traversal protection.
- **File Delivery:** System prompt includes rules for the agent to create downloadable files (`.zip`, `.pdf`, etc.), with binary formats generated via Python scripts in `shell_exec`. Files are synced between local and E2B sandbox.
- **Browser Persistence (CDP Architecture):** Node.js server launches persistent Chromium with remote debugging enabled and anti-detection flags. Python agent connects via `playwright.chromium.connect_over_cdp()`.
- **True Real-Time Streaming:** Uses `AsyncGenerator` pattern and `asyncio.Queue` to bridge sync HTTP requests with async generators for unbuffered, real-time SSE streaming.
- **Tool Registry:** Centralized registry manages tool instantiation, dynamic schema generation for LLMs, and tool execution dispatch.

## External Dependencies

- **Cerebras AI:** For Language Model inference (`qwen-3-235b-a22b-instruct-2507`).
- **MongoDB Atlas:** Cloud-hosted NoSQL database for session and agent state persistence (using `motor` async driver).
- **Redis:** In-memory data store for session state caching (using `aioredis`).
- **Playwright:** Python library for browser automation, interacting with Chromium.
- **E2B Cloud Sandbox:** External service for isolated and secure shell/code execution.
- **noVNC:** HTML5 VNC client for displaying the virtual desktop in the web UI.
- **DuckDuckGo Search:** Used by the `SearchTool` (no API key required).
- **MCP (Model Context Protocol):** Support for MCP servers for tool discovery and execution.
- **Nix Packages:** Essential system libraries required for Playwright Chromium to function in the Replit environment (e.g., `xorg`, `mesa`, `glib`, `cups`, `pango`, `cairo`).
- **Python Libraries:**
    - `pydantic`: For data validation and settings management.
    - `e2b`: Python client for E2B Cloud Sandbox.
    - `motor`: Asynchronous MongoDB driver.
    - `redis`: Asynchronous Redis client.
