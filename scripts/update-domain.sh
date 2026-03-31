#!/bin/bash
# Auto-update EXPO_PUBLIC_DOMAIN, APP_DOMAIN, CORS_ORIGINS di .env
# dengan domain Replit terkini setiap kali dijalankan

ENV_FILE="$(dirname "$0")/../.env"

if [ -z "$REPLIT_DEV_DOMAIN" ]; then
  echo "[update-domain] REPLIT_DEV_DOMAIN tidak ditemukan, skip update"
  exit 0
fi

CURRENT_DOMAIN="$REPLIT_DEV_DOMAIN"
echo "[update-domain] Domain aktif: $CURRENT_DOMAIN"

if [ -f "$ENV_FILE" ]; then
  sed -i "s|APP_DOMAIN=.*|APP_DOMAIN=${CURRENT_DOMAIN}|g" "$ENV_FILE"
  sed -i "s|EXPO_PUBLIC_DOMAIN=.*|EXPO_PUBLIC_DOMAIN=${CURRENT_DOMAIN}|g" "$ENV_FILE"
  sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=https://${CURRENT_DOMAIN}|g" "$ENV_FILE"
  echo "[update-domain] .env berhasil diupdate"
fi
