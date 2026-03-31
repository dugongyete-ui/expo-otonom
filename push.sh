#!/bin/bash

REPO="dugongyete-ui/expo-otonom"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN belum diset."
  echo "Jalankan dengan: GITHUB_TOKEN='ghp_...' bash push.sh"
  echo "Atau simpan sebagai Replit Secret bernama GITHUB_TOKEN."
  exit 1
fi

# Bersihkan semua stale lock file git
echo "Membersihkan git lock files..."
find .git -name "*.lock" -delete 2>/dev/null || true

# Setup credential helper
git config --local credential.helper \
  "!f() { echo username=x-token-auth; echo password=${GITHUB_TOKEN}; }; f"

git remote set-url origin "https://github.com/${REPO}.git" 2>/dev/null || \
  git remote add origin "https://github.com/${REPO}.git"

echo "Pull dulu dari GitHub (rebase)..."
git pull --rebase origin main 2>&1
PULL_CODE=$?

if [ $PULL_CODE -ne 0 ]; then
  echo ""
  echo "Pull gagal. Kemungkinan ada konflik merge."
  echo "Selesaikan konflik dulu, lalu jalankan push.sh lagi."
  git config --local --unset credential.helper 2>/dev/null || true
  exit 1
fi

echo "Pushing ke GitHub..."
git push origin main 2>&1
EXIT_CODE=$?

# Bersihkan credential helper setelah push
git config --local --unset credential.helper 2>/dev/null || true

if [ $EXIT_CODE -eq 0 ]; then
  echo "Push berhasil!"
else
  echo ""
  echo "Push gagal. Kemungkinan penyebab:"
  echo "  1. Token sudah dicabut/expired — buat token baru di https://github.com/settings/tokens"
  echo "  2. GitHub Secret Scanning memblokir — kunjungi URL unblock yang diberikan GitHub"
  echo "  3. Konflik — selesaikan merge conflict dulu"
  exit 1
fi
