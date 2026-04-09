#!/usr/bin/env bash
# apply-config.sh — POST /Device/apply-config for a house.
#
# Sends the full house JSON to the cloud, which then pushes 16-byte setup packets
# to each device via the inbound TCP connection to the proxy. Device must acknowledge
# within ~60s or the call returns HTTP 406.
#
# Usage:
#   TOKEN=$(./get-token.sh)
#   ./apply-config.sh "$TOKEN" <houseId>
#   Example: ./apply-config.sh "$TOKEN" 12048

set -euo pipefail

API_BASE="https://app.ambientika.eu:4521"
TOKEN="${1:-}"
HOUSE_ID="${2:-}"

if [[ -z "$TOKEN" || -z "$HOUSE_ID" ]]; then
  echo "Usage: $0 <bearer-token> <houseId>" >&2
  exit 1
fi

echo "Fetching house $HOUSE_ID..." >&2
HOUSE_JSON=$(curl -s "${API_BASE}/house/house-complete-info?houseId=${HOUSE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

echo "House JSON:" >&2
echo "$HOUSE_JSON" | python3 -m json.tool >&2

echo "" >&2
echo "Calling apply-config (waiting up to ~70s for device acknowledgement)..." >&2

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/Device/apply-config" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --max-time 90 \
  -d "$HOUSE_JSON")

HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)
BODY=$(echo "$HTTP_RESPONSE" | head -n -1)

echo "HTTP $HTTP_CODE" >&2
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "SUCCESS: All devices acknowledged setup." >&2
elif [[ "$HTTP_CODE" == "406" ]]; then
  echo "TIMEOUT (406): Device(s) did not acknowledge within timeout." >&2
  echo "This means the proxy is not routing the 16-byte setup packet to the device." >&2
else
  echo "UNEXPECTED response $HTTP_CODE:" >&2
fi
echo "$BODY"
