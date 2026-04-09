#!/usr/bin/env bash
# proxy-diag.sh — Diagnose the cloud proxy status from inside the HA host.
#
# Checks: open TCP connections on port 11000, local socket state, and whether
# the inbound cloud connection (185.214.203.87 → proxy) is established.
#
# Run this ON the HA host (or via the HA terminal add-on / SSH).

set -euo pipefail

CLOUD_IP="185.214.203.87"
PROXY_PORT="11000"

echo "=== TCP connections on port $PROXY_PORT ==="
ss -tnp "( sport = :$PROXY_PORT or dport = :$PROXY_PORT )" 2>/dev/null \
  || netstat -tnp 2>/dev/null | grep ":$PROXY_PORT" \
  || echo "(ss/netstat not available)"

echo ""
echo "=== Connections to/from cloud ($CLOUD_IP) ==="
ss -tnp dst "$CLOUD_IP" 2>/dev/null || echo "(ss not available)"
ss -tnp src "$CLOUD_IP" 2>/dev/null || echo "(ss not available)"

echo ""
echo "=== Add-on process check ==="
pgrep -a node 2>/dev/null || echo "(pgrep not available)"

echo ""
echo "=== Recent add-on logs (last 50 lines) ==="
# Try HA CLI first, then docker logs
if command -v ha &>/dev/null; then
  ha addons logs ambientika_local_control 2>/dev/null | tail -50
elif command -v docker &>/dev/null; then
  CONTAINER=$(docker ps --filter "name=ambientika" --format "{{.Names}}" 2>/dev/null | head -1)
  if [[ -n "$CONTAINER" ]]; then
    docker logs --tail 50 "$CONTAINER" 2>&1
  else
    echo "(No ambientika container found via docker)"
  fi
else
  echo "(Neither 'ha' CLI nor 'docker' available)"
fi
