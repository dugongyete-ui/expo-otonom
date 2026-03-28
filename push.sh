#!/bin/bash

REPO="dugongyete-ui/expo-otonom"
REPO_URL="https://github.com/${REPO}.git"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN belum diset di Replit Secrets."
  echo "Tambahkan secret GITHUB_TOKEN dengan Personal Access Token GitHub Anda."
  exit 1
fi

printf 'https://dugongyete-ui:%s@github.com\n' "$GITHUB_TOKEN" > ~/.git-credentials
chmod 600 ~/.git-credentials

git config --global credential.helper store
unset GIT_ASKPASS

git remote set-url origin "$REPO_URL"

echo "Pushing ke GitHub..."
git push origin main 2>&1

if [ $? -eq 0 ]; then
  echo "Push berhasil!"
else
  echo "Push gagal. Cek error di atas."
  exit 1
fi
