#!/bin/bash

REPO="dugongyete-ui/expo-otonom"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN belum diset di Replit Secrets."
  echo "Tambahkan secret GITHUB_TOKEN dengan Personal Access Token GitHub Anda."
  exit 1
fi

PUSH_URL="https://dugongyete-ui:${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "Pushing ke GitHub..."
git push "$PUSH_URL" main 2>&1

if [ $? -eq 0 ]; then
  echo "Push berhasil!"
else
  echo "Push gagal. Cek error di atas."
  exit 1
fi
