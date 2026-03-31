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
  # Fungsi helper: update atau tambah baris di .env
  update_or_add() {
    local KEY="$1"
    local VALUE="$2"
    if grep -q "^${KEY}=" "$ENV_FILE"; then
      sed -i "s|^${KEY}=.*|${KEY}=${VALUE}|g" "$ENV_FILE"
    else
      echo "${KEY}=${VALUE}" >> "$ENV_FILE"
    fi
  }

  update_or_add "APP_DOMAIN" "${CURRENT_DOMAIN}"
  update_or_add "EXPO_PUBLIC_DOMAIN" "${CURRENT_DOMAIN}"
  update_or_add "CORS_ORIGINS" "https://${CURRENT_DOMAIN}"
  echo "[update-domain] .env berhasil diupdate"
fi

echo ""
echo "========================================================"
echo " SCAN QR CODE DARI HALAMAN INI (bukan dari Metro terminal):"
echo " https://${CURRENT_DOMAIN}/mobile"
echo "========================================================"
echo ""
