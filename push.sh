#!/bin/bash

REPO_URL="https://github.com/dugongyete-ui/expo-otonom.git"

git remote set-url origin "$REPO_URL"

echo "Pushing ke GitHub..."
GIT_ASKPASS='' GIT_TERMINAL_PROMPT=0 git push origin main 2>&1

if [ $? -eq 0 ]; then
  echo "Push berhasil!"
else
  echo "Push gagal. Cek error di atas."
fi
