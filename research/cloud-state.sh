#!/usr/bin/env bash
# cloud-state.sh — Query Ambientika cloud state: houses, zones, rooms, devices.
#
# Usage:
#   TOKEN=$(./get-token.sh)
#   ./cloud-state.sh "$TOKEN"
#   Or combined: ./cloud-state.sh "$(./get-token.sh)"
#
# Output:
#   Pretty-printed JSON of all houses with full device assignment details.

set -euo pipefail

API_BASE="https://app.ambientika.eu:4521"
TOKEN="${1:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Usage: $0 <bearer-token>" >&2
  echo "  Get a token with: TOKEN=\$(./get-token.sh)" >&2
  exit 1
fi

echo "=== Houses ===" >&2
HOUSES=$(curl -s "${API_BASE}/house/houses-info" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$HOUSES" | python3 -c "
import sys, json
houses = json.load(sys.stdin)
for h in houses:
    print(f'  houseId={h[\"id\"]}  name={h[\"name\"]}', file=sys.stderr)
"

HOUSE_IDS=$(echo "$HOUSES" | python3 -c "
import sys, json
houses = json.load(sys.stdin)
for h in houses:
    print(h['id'])
")

echo "" >&2
for HOUSE_ID in $HOUSE_IDS; do
  echo "=== House $HOUSE_ID — full detail ===" >&2
  DETAIL=$(curl -s "${API_BASE}/house/house-complete-info?houseId=${HOUSE_ID}" \
    -H "Authorization: Bearer ${TOKEN}")

  echo "$DETAIL" | python3 -c "
import sys, json
data = json.load(sys.stdin)
name = data.get('name', '?')
print(f'House: {name} (id={data[\"id\"]})', file=sys.stderr)
for zone in data.get('zones', []):
    print(f'  Zone {zone[\"id\"]} \"{zone[\"name\"]}\" (zoneIndex implied by order)', file=sys.stderr)
    for room in zone.get('rooms', []):
        for dev in room.get('devices', []):
            print(f'    serial={dev[\"serialNumber\"]}  role={dev[\"role\"]}  zone={dev[\"zoneIndex\"]}  room={room[\"name\"]} ({dev[\"roomId\"]})', file=sys.stderr)
" 2>&1 >&2

  echo "$DETAIL"
  echo ""
done
