#!/usr/bin/env bash
# get-token.sh — Authenticate to the Ambientika cloud API and print the bearer token.
#
# Usage:
#   ./get-token.sh
#   The script prompts for email and password interactively (password is not echoed).
#
# Output:
#   Prints ONLY the bearer token to stdout so it can be captured:
#     TOKEN=$(./get-token.sh)

set -euo pipefail

API_BASE="https://app.ambientika.eu:4521"

read -rp "Email: " USERNAME
read -rsp "Password: " PASSWORD
echo

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/users/authenticate" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: Authentication failed (HTTP $HTTP_CODE)" >&2
  echo "$BODY" >&2
  exit 1
fi

TOKEN=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['jwtToken'])")

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: No jwtToken in response" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "$TOKEN"
