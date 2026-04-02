#!/usr/bin/env bash
#
# Dzeck AI — Auto Setup & Install ALL Dependencies
# Jalankan dari root project: bash setup.sh
# Diperbarui: March 2026 — Full stack: Backend + Expo Mobile + Python Agent
#
# Catatan: Script ini TIDAK menggunakan set -e supaya satu kegagalan
# tidak menghentikan seluruh proses install.
#

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

print_step()  { echo -e "\n${BLUE}[$(date +%H:%M:%S)]${NC} ${BOLD}▶ $1${NC}"; }
print_ok()    { echo -e "${GREEN}  ✓ $1${NC}"; }
print_warn()  { echo -e "${YELLOW}  ⚠ $1${NC}"; }
print_error() { echo -e "${RED}  ✗ $1${NC}"; }
print_info()  { echo -e "    ${CYAN}$1${NC}"; }

echo ""
echo -e "${CYAN}${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║        Dzeck AI — Setup & Install ALL Dependencies            ║${NC}"
echo -e "${CYAN}${BOLD}║        Backend · Expo Mobile · Python Agent                   ║${NC}"
echo -e "${CYAN}${BOLD}║        LLM: Cerebras AI (qwen-3-235b)                        ║${NC}"
echo -e "${CYAN}${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Deteksi Python ───────────────────────────────────────────────────────────
print_step "Mendeteksi runtime Python & Node.js..."

PYTHON=""
for cmd in python3.11 python3.10 python3 python; do
  if command -v "$cmd" &>/dev/null; then PYTHON="$cmd"; break; fi
done
if [ -z "$PYTHON" ]; then
  print_error "Python tidak ditemukan! Install Python 3.10+ dulu."
  exit 1
fi
print_ok "Python: $($PYTHON --version 2>&1)"

if ! command -v node &>/dev/null; then
  print_error "Node.js tidak ditemukan! Install Node.js 18+ dulu."
  exit 1
fi
print_ok "Node.js: $(node --version)  /  npm: $(npm --version)"

# ─── pip flags ────────────────────────────────────────────────────────────────
PIP_FLAGS="-q"
if $PYTHON -m pip install --help 2>&1 | grep -q 'break-system'; then
  PIP_FLAGS="$PIP_FLAGS --break-system-packages"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BAGIAN 1: NODE.JS — Backend (Express + TypeScript)
# ═══════════════════════════════════════════════════════════════════════════════
print_step "Menginstall Node.js packages dari package.json (npm install)..."
npm install --legacy-peer-deps --no-audit --no-fund 2>&1 \
  | grep -E "added|updated|packages|WARN" | head -5 || true
print_ok "Base Node.js packages siap"

# ─── Packages backend yang wajib ada (mungkin belum di package.json) ─────────
print_step "Memastikan backend packages terinstall (multer, ws, qrcode-terminal)..."
BACKEND_PKGS=(
  "multer@^2.1.1"
  "@types/multer@^2.1.0"
  "ws@^8.18.0"
  "@types/ws@^8.5.13"
  "qrcode-terminal@^0.12.0"
  "@novnc/novnc@^1.5.0"
)
for pkg in "${BACKEND_PKGS[@]}"; do
  pkg_name="${pkg%%@*}"
  if [ -z "$(ls node_modules | grep "^${pkg_name}$" 2>/dev/null)" ] && \
     [ -z "$(ls node_modules | grep "^${pkg_name%%/*}" 2>/dev/null)" ]; then
    npm install --legacy-peer-deps --no-audit --no-fund "$pkg" 2>&1 | tail -1 || true
    print_ok "Installed: $pkg_name"
  else
    print_ok "Sudah ada: $pkg_name"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# BAGIAN 2: NODE.JS — Expo Mobile (React Native)
# ═══════════════════════════════════════════════════════════════════════════════
print_step "Menginstall Expo & React Native packages..."
print_info "expo, expo-router, expo-status-bar, expo-splash-screen, expo-font, expo-web-browser"
print_info "react-native, react-native-gesture-handler, react-native-safe-area-context, dll"

EXPO_PKGS=(
  "expo@~53.0.0"
  "expo-router@~5.1.11"
  "expo-status-bar@~2.2.3"
  "expo-splash-screen@~0.30.10"
  "expo-font@~13.3.1"
  "expo-web-browser@~14.2.0"
  "expo-constants@~17.1.8"
  "expo-linking@~7.1.7"
  "expo-system-ui@~5.0.7"
  "expo-clipboard@~7.1.5"
  "expo-crypto@~14.1.5"
  "expo-document-picker@~13.1.6"
  "expo-haptics@~14.1.4"
  "expo-image-picker@~16.1.4"
  "expo-localization@~16.1.6"
  "expo-secure-store@~14.2.4"
  "react-native@0.79.6"
  "react-native-gesture-handler@~2.24.0"
  "react-native-safe-area-context@5.4.0"
  "react-native-screens@~4.11.1"
  "react-native-reanimated@~3.17.4"
  "react-native-web@^0.20.0"
  "react-native-keyboard-aware-scroll-view@^0.9.0"
  "@react-native-async-storage/async-storage@2.1.2"
  "@react-navigation/native@^7.0.0"
)

EXPO_MISSING=()
for pkg in "${EXPO_PKGS[@]}"; do
  # Extract base package name (remove version spec)
  pkg_name="${pkg%%@~*}"
  pkg_name="${pkg_name%%@^*}"
  pkg_name="${pkg_name%%@[0-9]*}"
  # Check if directory exists in node_modules
  dir_name="${pkg_name#@*/}"  # strip scope for check
  scope_dir="${pkg_name%%/*}"
  if [[ "$pkg_name" == @* ]]; then
    # Scoped package: @scope/name
    scope="${pkg_name%%/*}"
    name="${pkg_name#*/}"
    if [ ! -d "node_modules/${scope}/${name}" ] 2>/dev/null; then
      EXPO_MISSING+=("$pkg")
    fi
  else
    if [ ! -d "node_modules/${pkg_name}" ] 2>/dev/null; then
      EXPO_MISSING+=("$pkg")
    fi
  fi
done

if [ ${#EXPO_MISSING[@]} -gt 0 ]; then
  print_info "Menginstall ${#EXPO_MISSING[@]} Expo packages yang belum ada..."
  npm install --legacy-peer-deps --no-audit --no-fund "${EXPO_MISSING[@]}" 2>&1 \
    | grep -E "added|updated|packages|error|warn" | head -10 || true
  print_ok "Expo packages diinstall"
else
  print_ok "Semua Expo packages sudah terinstall"
fi

# ─── Verifikasi expo CLI tersedia ─────────────────────────────────────────────
if [ -f "node_modules/.bin/expo" ]; then
  print_ok "Expo CLI tersedia: $(node_modules/.bin/expo --version 2>/dev/null || echo 'ok')"
else
  print_warn "Expo CLI tidak ditemukan di node_modules/.bin/expo"
  print_info "Coba jalankan: npm install expo --legacy-peer-deps"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BAGIAN 3: PYTHON — Agent Dependencies
# ═══════════════════════════════════════════════════════════════════════════════
print_step "Menginstall SEMUA Python packages untuk Agent AI..."
print_info "pydantic · requests · aiohttp · httpx · beautifulsoup4"
print_info "playwright · e2b · e2b-desktop · redis · motor · websockify"
print_info "lxml · aiofiles · dnspython · pymongo · certifi · PyYAML"
print_info "Pillow · numpy · tavily-python"

$PYTHON -m pip install $PIP_FLAGS \
  "pydantic>=2.10.0" \
  "requests>=2.28.0" \
  "aiohttp>=3.8.0" \
  "httpx>=0.24.0" \
  "beautifulsoup4>=4.12.0" \
  "lxml>=4.9.0" \
  "playwright>=1.50.0" \
  "e2b>=2.0.0" \
  "e2b-desktop>=1.0.0" \
  "redis>=5.0.0" \
  "motor>=3.0.0" \
  "pymongo>=4.0.0" \
  "websockify>=0.10.0" \
  "aiofiles>=23.0.0" \
  "dnspython>=2.4.0" \
  "certifi>=2024.0.0" \
  "charset-normalizer>=3.0.0" \
  "idna>=3.4" \
  "multidict>=6.0.0" \
  "yarl>=1.9.0" \
  "PyYAML>=6.0.0" \
  "Pillow>=10.0.0" \
  "numpy>=1.24.0" \
  "tavily-python>=0.5.0" \
  2>&1 | tail -5

print_ok "Semua Python packages berhasil diinstall"

# ─── Verifikasi Python package imports ────────────────────────────────────────
print_step "Verifikasi import Python packages..."
FAILED_PY=()

check_py() {
  local mod="$1" name="$2"
  if $PYTHON -c "import $mod" &>/dev/null 2>&1; then
    print_ok "$name"
  else
    print_warn "$name — gagal diimport"
    FAILED_PY+=("$name")
  fi
}

check_py "pydantic"      "pydantic"
check_py "requests"      "requests"
check_py "aiohttp"       "aiohttp"
check_py "httpx"         "httpx"
check_py "bs4"           "beautifulsoup4"
check_py "lxml"          "lxml"
check_py "playwright"    "playwright"
check_py "e2b"           "e2b"
check_py "redis"         "redis"
check_py "motor"         "motor"
check_py "pymongo"       "pymongo"
check_py "aiofiles"      "aiofiles"
check_py "websockify"    "websockify"
check_py "yaml"          "PyYAML"
check_py "PIL"           "Pillow (image processing)"
check_py "numpy"         "numpy"

if [ ${#FAILED_PY[@]} -eq 0 ]; then
  print_ok "Semua Python packages terverifikasi"
else
  print_warn "Gagal: ${FAILED_PY[*]} (mungkin butuh server/koneksi khusus)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BAGIAN 4: PLAYWRIGHT CHROMIUM BROWSER
# ═══════════════════════════════════════════════════════════════════════════════
print_step "Menginstall Playwright Chromium browser..."
if $PYTHON -m playwright install chromium 2>&1 | grep -v "^$"; then
  print_ok "Playwright Chromium siap"
else
  print_warn "Playwright browser gagal. Coba manual:"
  print_info "python3 -m playwright install chromium"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BAGIAN 5: VNC / DISPLAY STACK
# ═══════════════════════════════════════════════════════════════════════════════
print_step "Cek stack VNC/display (opsional)..."
VNC_MISSING=()
for bin in Xvfb x11vnc fluxbox; do
  if command -v "$bin" &>/dev/null; then
    print_ok "$bin → $(which "$bin")"
  else
    print_warn "$bin tidak ditemukan (opsional — tambahkan ke replit.nix)"
    VNC_MISSING+=("$bin")
  fi
done

if [ ${#VNC_MISSING[@]} -eq 0 ]; then
  print_ok "Stack VNC lengkap (Xvfb + x11vnc + fluxbox)"
  # Konfigurasi Fluxbox kiosk mode
  FBDIR="$HOME/.fluxbox"
  mkdir -p "$FBDIR"
  cat > "$FBDIR/init" <<'FBINIT'
session.screen0.toolbar.visible: false
session.screen0.toolbar.autoHide: true
session.screen0.slit.autoHide: true
session.screen0.defaultDeco: NONE
session.screen0.workspaces: 1
session.screen0.focusModel: MouseFocus
session.screen0.autoRaise: true
session.screen0.clickRaises: true
session.styleFile: /dev/null
FBINIT
  cat > "$FBDIR/apps" <<'FBAPPS'
[app] (name=.*) (class=.*)
  [Maximized] {yes}
  [Deco] {NONE}
  [Dimensions] {1280 720}
  [Position] {0 0}
[end]
FBAPPS
  print_ok "Fluxbox dikonfigurasi: kiosk mode"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BAGIAN 6: STATUS ENVIRONMENT
# ═══════════════════════════════════════════════════════════════════════════════
print_step "Cek environment variables penting..."

check_env() {
  local key="$1" label="$2"
  if [ -n "${!key:-}" ]; then
    print_ok "$label (${key}) → terdeteksi"
  else
    print_warn "$label (${key}) → belum diset"
  fi
}

check_env "CEREBRAS_API_KEY"  "Cerebras API Key (WAJIB untuk AI)"
check_env "E2B_API_KEY"      "E2B Sandbox API Key (untuk shell tools)"
check_env "MONGODB_URI"      "MongoDB URI (untuk session persistence)"
check_env "REDIS_URL"        "Redis URL (untuk caching)"
check_env "REDIS_PASSWORD"   "Redis Password (untuk autentikasi Redis)"
check_env "JWT_SECRET"       "JWT Secret (WAJIB untuk autentikasi token)"
check_env "TAVILY_API_KEY"   "Tavily API Key (untuk web search tools)"

# ─── Runtime directories ──────────────────────────────────────────────────────
print_step "Membuat runtime directories..."
mkdir -p /tmp/dzeck_files /tmp/dzeck_files/uploads
print_ok "/tmp/dzeck_files/ siap"

# ─── .env file template ───────────────────────────────────────────────────────
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  print_step "Membuat file .env template..."
  cat > "$PROJECT_ROOT/.env" <<'DOTENV'
# ─── Dzeck AI — Environment Variables ────────────────────────────────────────

# Cerebras AI (WAJIB untuk fitur AI) — https://cloud.cerebras.ai/
CEREBRAS_API_KEY=

# Model AI (opsional — sudah ada default di kode)
CEREBRAS_CHAT_MODEL=qwen-3-235b-a22b-instruct-2507
CEREBRAS_AGENT_MODEL=qwen-3-235b-a22b-instruct-2507

# E2B Cloud Sandbox (untuk shell_exec & browser automation)
E2B_API_KEY=

# MongoDB Atlas (opsional — session persistence)
MONGODB_URI=

# Redis (opsional — session caching)
REDIS_URL=
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth
JWT_SECRET=

# Tavily Web Search (opsional — untuk tool web_search)
TAVILY_API_KEY=

# Server
PORT=5000
NODE_ENV=development

# MCP (opsional)
# MCP_SERVER_URL=
# MCP_AUTH_TOKEN=

# Browser
PLAYWRIGHT_ENABLED=true
DOTENV
  print_warn ".env baru dibuat — isi CEREBRAS_API_KEY dan lainnya sesuai kebutuhan"
  print_info "Atau set via Replit → Secrets (Settings → Environment variables)"
else
  print_ok ".env sudah ada"
fi

# ─── Bersihkan Python cache ────────────────────────────────────────────────────
print_step "Membersihkan Python __pycache__ lama..."
find "$PROJECT_ROOT/server/agent" -type d -name "__pycache__" \
  -exec rm -rf {} + 2>/dev/null || true
print_ok "Cache dibersihkan"

# ═══════════════════════════════════════════════════════════════════════════════
# RANGKUMAN
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║  Arsitektur Multi-Agent Dzeck AI                              ║${NC}"
echo -e "${CYAN}${BOLD}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}${BOLD}║  Web Agent   → browsing, scraping, search                     ║${NC}"
echo -e "${CYAN}${BOLD}║  Data Agent  → analisis data, API, visualisasi                ║${NC}"
echo -e "${CYAN}${BOLD}║  Code Agent  → Python/shell exec, scripting, automasi         ║${NC}"
echo -e "${CYAN}${BOLD}║  Files Agent → manajemen file, dokumen, konversi              ║${NC}"
echo -e "${CYAN}${BOLD}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}${BOLD}║  LLM Agent: qwen-3-235b-a22b-instruct-2507 (Cerebras)        ║${NC}"
echo -e "${CYAN}${BOLD}║  LLM Chat:  qwen-3-235b-a22b-instruct-2507 (Cerebras)        ║${NC}"
echo -e "${CYAN}${BOLD}║  Shell:     E2B Cloud Sandbox (isolated & secure)             ║${NC}"
echo -e "${CYAN}${BOLD}║  Browser:   Playwright CDP via VNC display                    ║${NC}"
echo -e "${CYAN}${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ✓  Setup SELESAI! Dzeck AI siap digunakan            ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Backend (Web UI):${NC}   Workflow ${CYAN}Start Backend${NC}  →  port 5000"
echo -e "  ${BOLD}Mobile (Expo Go):${NC}   Workflow ${CYAN}Start Frontend${NC} →  port 8099"
echo ""
echo -e "  ${BOLD}Config wajib:${NC}  Edit ${CYAN}.env${NC} atau set di Replit Secrets"
echo -e "    - ${CYAN}CEREBRAS_API_KEY${NC}  → Cerebras AI (https://cloud.cerebras.ai/)"
echo -e "    - ${CYAN}E2B_API_KEY${NC}      → E2B Cloud Sandbox (opsional)"
echo ""
