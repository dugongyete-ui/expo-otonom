#!/bin/bash
# ─── Post-merge setup — Dzeck AI ──────────────────────────────────────────────
# Dijalankan otomatis setelah task agent merge ke main.
# Jangan gunakan set -e agar satu kegagalan tidak menghentikan semua proses.

echo "[post-merge] Mulai install dependencies..."

# ─── Node.js — install semua dari package.json ───────────────────────────────
echo "[post-merge] npm install..."
npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -5 || true

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
    "flask-sqlalchemy>=3.0.0" \
    "SQLAlchemy>=2.0.0" \
    "psycopg2-binary>=2.9.0" \
    "pymysql>=1.1.0" \
    "uvicorn>=0.29.0" \
    "tabulate>=0.9.0" \
    "tqdm>=4.66.0" \
    "Markdown>=3.6.0" \
    "mistune>=3.0.0" \
    "tzdata>=2024.0" \
    2>&1 | tail -3 || true
  echo "[post-merge] Python packages selesai"
else
  echo "[post-merge] WARNING: Python tidak ditemukan, skip pip install"
fi

echo "[post-merge] Selesai!"
