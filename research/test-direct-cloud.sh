#!/usr/bin/env bash
# test-direct-cloud.sh — Send raw binary packets directly to the Ambientika cloud TCP endpoint
# and poll /Device/device-status to test whether the cloud stores status from any TCP connection.
#
# Usage:
#   TOKEN=$(./get-token.sh) ./test-direct-cloud.sh [serial]
#
# Default serial: 8813bf1650e0
# The packets are the exact firmware info + status bytes captured from the 2026-04-09 log.

set -euo pipefail

CLOUD_HOST="185.214.203.87"
CLOUD_PORT="11000"
API_BASE="https://app.ambientika.eu:4521"
SERIAL="${1:-8813bf1650e0}"
SERIAL_UPPER="${SERIAL^^}"

if [[ -z "${TOKEN:-}" ]]; then
  echo "ERROR: TOKEN env var not set. Run: TOKEN=\$(./get-token.sh) ./test-direct-cloud.sh" >&2
  exit 1
fi

echo "=== Step 0: Connectivity check ==="
nc -zv "$CLOUD_HOST" "$CLOUD_PORT" 2>&1
echo

echo "=== Step 1: Baseline — poll device-status BEFORE sending any packets ==="
BEFORE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_BASE}/Device/device-status?deviceSerialNumber=${SERIAL_UPPER}")
echo "Before: $BEFORE"
echo

echo "=== Step 2: Send firmware info (0x03, 18 bytes) + status (0x01, 21 bytes) directly to cloud ==="
echo "Packets for serial: $SERIAL"

# Firmware info: 03 00 88 13 bf 16 50 e0 01 01 09 01 01 09 02 01 00 00
# Status:        01 00 88 13 bf 16 50 e0 00 02 01 14 1e 03 00 00 00 00 00 02 ce
RESPONSE=$(
  (
    printf '\x03\x00\x88\x13\xbf\x16\x50\xe0\x01\x01\x09\x01\x01\x09\x02\x01\x00\x00'
    printf '\x01\x00\x88\x13\xbf\x16\x50\xe0\x00\x02\x01\x14\x1e\x03\x00\x00\x00\x00\x00\x02\xce'
    sleep 3
  ) | nc "$CLOUD_HOST" "$CLOUD_PORT" | xxd
)

echo "Cloud response (echo):"
echo "$RESPONSE"
echo

echo "=== Step 3: Poll device-status immediately after ==="
AFTER=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_BASE}/Device/device-status?deviceSerialNumber=${SERIAL_UPPER}")
echo "After: $AFTER"
echo

if echo "$AFTER" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'operatingMode' in d else 1)" 2>/dev/null; then
  echo ">>> RESULT: Cloud STORED the status packet. Storage works from direct TCP connections."
else
  echo ">>> RESULT: Cloud did NOT store the status packet. Proceeding to setup-first test."
fi
