# Dzeck AI — Project Summary & Roadmap
**Diperbarui:** Maret 2026  
**Status:** Aktif dikembangkan

---

## Apa itu Dzeck AI?

Dzeck AI adalah agen AI otonom (autonomous AI agent) berbasis web dan mobile yang dirancang setara dengan Manus.im. Ia bisa menyelesaikan tugas-tugas kompleks secara mandiri menggunakan komputer — menjelajah web, menulis & menjalankan kode, membuat file, menganalisis data, dan berinteraksi dengan browser persis seperti manusia.

---

## Arsitektur Sistem

### Stack Teknologi
- **Frontend:** React Native (Expo) + TypeScript — berjalan di web dan mobile (Android/iOS)
- **Backend:** Node.js + Express, menggunakan Server-Sent Events (SSE) untuk streaming real-time
- **Agent Engine:** Python async (asyncio + AsyncGenerator) — otak dari sistem
- **LLM:** Cerebras AI (`qwen-3-235b-a22b-instruct-2507`) via https://cloud.cerebras.ai/
- **Database:** MongoDB Atlas (session & agent state persistence via `motor`)
- **Cache:** Redis (session state caching)
- **Browser Automation:** Playwright via CDP ke Chromium yang berjalan di VNC display nyata
- **Shell Sandbox:** E2B Cloud Sandbox — eksekusi kode Python/shell yang terisolasi dan aman
- **VNC:** Xvfb + Fluxbox + x11vnc → noVNC (HTML5) untuk live browser view di UI

### Alur Kerja Agent

```
User Input
    ↓
Node.js Backend (routes.ts)
    ↓ spawn subprocess
Python Agent (agent_flow.py) — DzeckAgent
    ↓
Planner → buat rencana (Plan + Steps)
    ↓
Executor → jalankan satu tool per iterasi
    ↓ tool calls
[Browser VNC] [Shell E2B] [File] [Search] [MCP]
    ↓ hasil/observasi
Loop kembali → update plan → lanjut atau selesai
    ↓
Summarizer → kirim hasil final ke user
```

### Direktori Utama

```
server/
  agent/
    agent_flow.py       ← Core agent loop (DzeckAgent class)
    prompts/
      system.py         ← System prompt utama (Dzeck identity + rules)
      execution.py      ← Execution step prompt + tool guide
      planner.py        ← Planner module prompt
    tools/
      browser.py        ← Browser tools (VNC CDP + E2B + HTTP fallback)
      shell.py          ← Shell tools (E2B sandbox + local fallback)
      file.py           ← File read/write/search tools
      search.py         ← Web search + browse tools
      message.py        ← Message notify/ask tools
      mcp.py            ← MCP (Model Context Protocol) tools
      registry.py       ← Tool registry & schema builder
    models/             ← Pydantic data models (Plan, Step, Memory, etc.)
    services/           ← Session service (MongoDB + Redis)
  templates/
    web-chat.html       ← Main web UI (Manus-style, VNC embedded, SSE)
    landing-page.html   ← Landing page
    vnc-view.html       ← VNC viewer standalone
  index.ts              ← Express server entry point
  routes.ts             ← API routes (/api/chat, /api/agent, /api/vnc/*)
app/                    ← Expo React Native app (JANGAN dimodifikasi tanpa instruksi)
assets/images/          ← Logo dan icon assets
```

---

## Fitur yang Sudah Berjalan

- Real-time streaming AI chat via SSE
- Agent mode: Plan → Execute → Summarize loop
- 28+ tools: browser, shell, file, search, MCP, message
- VNC live view: AI browser tampil di panel "Komputer Dzeck"
- AI kontrol browser di VNC: klik, scroll, input, navigasi (setara manusia)
- E2B Cloud Sandbox untuk eksekusi kode Python terisolasi
- Session persistence (MongoDB) + caching (Redis)
- File download: file output agent bisa didownload user
- Browser CDP mode: persistent Chromium terhubung ke Python agent via CDP
- Splash screen dengan logo Dzeck AI (tanpa duplikasi nama teks)
- **E2B file cache & replay**: File yang ditulis via `file_write` di-cache di memori dan otomatis di-replay ke sandbox baru saat sandbox restart — menghilangkan error "No such file or directory"
- **E2B workspace auto-init**: Setiap `shell_exec` dan `run_command` otomatis membuat workspace dir (`mkdir -p`) sebelum menjalankan command
- **E2B Browser persistent CDP session**: `E2BBrowserSession` meluncurkan Chromium sekali sebagai background process di E2B sandbox dengan `--remote-debugging-port`, lalu semua tool call (navigate/click/type/scroll) connect ke browser yang SAMA via CDP — halaman tetap hidup antar tool call tanpa membuka browser baru
- **yt-dlp auto-install**: Jika command menggunakan yt-dlp, otomatis dicek dan di-install jika belum tersedia
- **System prompt VNC+E2B sync**: Instruksi eksplisit untuk browser VNC stateful, file execution rules, dan workspace persistence

---

## Environment Variables yang Diperlukan

| Variable | Keterangan |
|---|---|
| `CEREBRAS_API_KEY` | Cerebras AI API key (dari https://cloud.cerebras.ai/) |
| `CEREBRAS_AGENT_MODEL` | Model untuk agent (default: `qwen-3-235b-a22b-instruct-2507`) |
| `CEREBRAS_CHAT_MODEL` | Model untuk chat biasa (default: `qwen-3-235b-a22b-instruct-2507`) |
| `E2B_API_KEY` | E2B Cloud Sandbox API key (opsional, tapi disarankan) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `REDIS_URL` | Redis connection URL |

---

## Roadmap ke Depan

### Prioritas Tinggi
1. Multi-tab browser — AI bisa membuka dan mengelola beberapa tab di VNC
2. Screenshot streaming — screenshot realtime dari browser tampil di UI setiap step
3. File manager UI — user bisa lihat dan download semua file output langsung dari web
4. Agent memory — AI mengingat konteks dari sesi sebelumnya (long-term memory)
5. Tool result preview — hasil browser/shell tampil inline di chat bubble

### Prioritas Menengah
6. Custom tool plugins — user bisa tambah tool sendiri via konfigurasi
7. Voice input/output — user bisa berbicara dengan Dzeck AI
8. Task scheduler — agent bisa menjalankan tugas terjadwal
9. Webhook integration — trigger agent dari webhook eksternal
10. API key management UI — kelola semua API keys langsung dari web

### Optimasi
11. Streaming screenshot di VNC — latency lebih rendah untuk live view
12. Tool caching — cache hasil search/browse yang sama untuk hemat token
13. Model selection — user bisa pilih model AI yang digunakan
14. Cost tracking — monitor penggunaan token dan estimasi biaya

---

## Catatan Penting untuk Developer

- Jangan modifikasi folder `app/` tanpa instruksi eksplisit dari user
- System prompt ada di `server/agent/prompts/system.py` — diperbarui Maret 2026
- Tool call schemas di-generate otomatis dari class-based tool instances di `registry.py`
- Browser selalu mencoba CDP ke Chromium di port 9222 (VNC) sebelum fallback ke headless
- E2B sandbox workspace: `/home/user/dzeck-ai/`, output: `/home/user/dzeck-ai/output/`
- Agent berjalan sebagai subprocess Python dari Node.js, berkomunikasi via stdout JSON (SSE)
- Semua prompt dalam Bahasa Indonesia secara default
