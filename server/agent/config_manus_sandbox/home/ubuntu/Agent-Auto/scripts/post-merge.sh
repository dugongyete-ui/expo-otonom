#!/bin/bash
# ─── Post-merge setup — Dzeck AI ──────────────────────────────────────────────
# Dijalankan otomatis setelah task agent merge ke main.
# Jangan gunakan set -e agar satu kegagalan tidak menghentikan semua proses.

echo "[post-merge] Mulai install dependencies..."

# ─── Node.js — base packages ─────────────────────────────────────────────────
echo "[post-merge] npm install (base packages)..."
npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -3 || true

# ─── Node.js — Expo & React Native packages ──────────────────────────────────
echo "[post-merge] Menginstall Expo packages..."
npm install --legacy-peer-deps --no-audit --no-fund \
  "expo@~53.0.0" \
  "expo-router@~4.0.0" \
  "expo-status-bar@~2.2.0" \
  "expo-splash-screen@~0.29.0" \
  "expo-font@~13.3.0" \
  "expo-web-browser@~14.0.0" \
  "expo-constants@~17.0.0" \
  "expo-linking@~7.0.0" \
  "expo-system-ui@~4.0.0" \
  "react-native@0.79.0" \
  "react-native-gesture-handler@~2.24.0" \
  "react-native-safe-area-context@5.4.0" \
  "react-native-screens@~4.10.0" \
  "react-native-reanimated@~3.17.0" \
  "@react-native-async-storage/async-storage@2.1.2" \
  "@react-navigation/native@^7.0.0" \
  2>&1 | tail -3 || true

# ─── Deteksi Python ───────────────────────────────────────────────────────────
PYTHON=""
for cmd in python3.11 python3.10 python3 python; do
  if command -v "$cmd" &>/dev/null; then PYTHON="$cmd"; break; fi
done

# ─── Python packages ─────────────────────────────────────────────────────────
if [ -n "$PYTHON" ]; then
  echo "[post-merge] Menginstall Python packages..."
  PIP_FLAGS="-q"
  if $PYTHON -m pip install --help 2>&1 | grep -q 'break-system'; then
    PIP_FLAGS="$PIP_FLAGS --break-system-packages"
  fi
  $PYTHON -m pip install $PIP_FLAGS \
    "pydantic>=2.0.0" \
    "requests>=2.28.0" \
    "aiohttp>=3.8.0" \
    "httpx>=0.24.0" \
    "beautifulsoup4>=4.12.0" \
    "lxml>=4.9.0" \
    "flask>=3.0.0" \
    "flask-cors>=4.0.0" \
    "playwright>=1.40.0" \
    "e2b>=0.8.0" \
    "redis>=5.0.0" \
    "motor>=3.0.0" \
    "pymongo>=4.0.0" \
    "websockify>=0.10.0" \
    "aiofiles>=23.0.0" \
    "dnspython>=2.4.0" \
    "certifi>=2024.0.0" \
    "charset-normalizer>=3.0.0" \
    "multidict>=6.0.0" \
    "yarl>=1.9.0" \
    2>&1 | tail -3 || true
  echo "[post-merge] Python packages selesai"
else
  echo "[post-merge] WARNING: Python tidak ditemukan, skip pip install"
fi

echo "[post-merge] Selesai!"
