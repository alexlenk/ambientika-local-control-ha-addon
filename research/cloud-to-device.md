# Cloud → Device Packets

Analysis of all packets routed from the cloud inbound connection to device sockets, captured from the 2026-04-09 08:51–08:54 UTC production log (silly level).

The proxy logs every cloud→device routing as:
```
[debug] Routing cloud→device command for <serial> via <ip>:<port>: <hex>
```

---

## Packet types observed

| Type | Bytes | Count in log | Description |
|------|-------|-------------|-------------|
| `0x03` | 18 | 6 | Echo of device's own firmware info packet — one per device on connect |
| `0x01` | 21 | ~45 | Echo of device's own status packet — every ~30s per device |
| `0x04` | 8 | 4 | Keepalive / ping — MASTER devices only |

**No weather updates (`0x02` subtype `0x04`) were observed in this 3-minute window.**

---

## Echo behavior

The cloud echoes every packet it receives from a device back to that same device. This is the cloud's only communication pattern during normal operation — it does not inject new data unprompted (within this window).

### Firmware info echo (0x03)

Immediately after a device sends its 18-byte firmware packet, the cloud echoes it back verbatim:

| Time (UTC) | Serial | Cloud echoed |
|-----------|--------|-------------|
| 08:51:38 | `8813bf15ff74` | `03 00 88 13 bf 15 ff 74 01 01 09 01 01 09 02 01 00 00` |
| 08:51:41 | `4831b7adf390` | `03 00 48 31 b7 ad f3 90 01 01 0c 01 01 0c 02 04 02 00` |
| 08:51:51 | `8813bf16089c` | `03 00 88 13 bf 16 08 9c 01 01 09 01 01 09 02 01 00 00` |
| 08:51:53 | `8813bf1650e0` | `03 00 88 13 bf 16 50 e0 01 01 09 01 01 09 02 01 00 00` |
| 08:51:56 | `8813bf164aa8` | `03 00 88 13 bf 16 4a a8 01 01 09 01 01 09 02 01 00 00` |
| 08:52:03 | `8813bf164098` | `03 00 88 13 bf 16 40 98 01 01 09 01 01 09 02 01 00 00` |

### Status echo (0x01)

Every ~30s the device sends a 21-byte status packet; the cloud echoes it back within milliseconds. Selected examples:

| Time (UTC) | Serial | Cloud echoed |
|-----------|--------|-------------|
| 08:51:39 | `8813bf15ff74` | `01 00 88 13 bf 15 ff 74 00 02 01 15 27 00 00 00 01 00 00 02 cc` |
| 08:51:42 | `4831b7adf390` | `01 00 48 31 b7 ad f3 90 00 03 01 15 24 00 00 02 00 02 01 02 c7` |
| 08:51:53 | `8813bf16089c` | `01 00 88 13 bf 16 08 9c 00 02 01 18 16 00 00 00 00 00 00 02 ce` |
| 08:51:54 | `8813bf1650e0` | `01 00 88 13 bf 16 50 e0 00 02 01 14 1e 03 00 00 00 00 00 02 ce` |
| 08:51:58 | `8813bf164aa8` | `01 00 88 13 bf 16 4a a8 09 01 01 15 25 03 00 00 00 02 01 02 ce` |
| 08:52:04 | `8813bf164098` | `01 00 88 13 bf 16 40 98 08 01 01 15 1f 03 00 00 00 02 01 02 cc` |

The echo is byte-for-byte identical to what the device sent (only the WiFi signal byte varies between packets as the device moves slightly). The cloud does not modify the status packet.

---

## Keepalive packets (0x04)

### Format

```
04 00 <MAC 6 bytes>
```

8 bytes total. The MAC in bytes 2–7 is the target device's serial number.

### All keepalives observed in log

| Time (UTC) | Hex | Serial | Seconds after connect | Note |
|-----------|-----|--------|----------------------|------|
| 08:52:40.306 | `04 00 88 13 bf 15 ff 74` | `8813bf15ff74` | +63.9s | 1st KA |
| 08:52:54.356 | `04 00 88 13 bf 16 08 9c` | `8813bf16089c` | +64.1s | 1st KA |
| 08:52:56.235 | `04 00 88 13 bf 16 50 e0` | `8813bf1650e0` | +64.3s | 1st KA |
| 08:53:16.133 | `04 00 88 13 bf 15 ff 74` | `8813bf15ff74` | +99.7s | 2nd KA (+35.8s) |

### Timing pattern

- **Initial delay:** ~64 seconds after device connects (very consistent across all 3 masters: 63.9s, 64.1s, 64.3s)
- **Interval:** ~35–36 seconds between subsequent keepalives
- **Only MASTER devices** receive keepalives — confirmed by absence for `4831b7adf390`, `8813bf164aa8`, `8813bf164098` (all SLAVE_OPPOSITE_MASTER)

### Keepalive → status response timing

After each keepalive, the device sends a status packet within ~1–2 seconds:

| Keepalive (UTC) | Next status echo (UTC) | Delta |
|----------------|----------------------|-------|
| 08:52:40.306 (`8813bf15ff74`) | 08:52:41.566 | +1.26s |
| 08:52:54.356 (`8813bf16089c`) | 08:52:55.629 | +1.27s |
| 08:52:56.235 (`8813bf1650e0`) | 08:52:57.512 | +1.28s |
| 08:53:16.133 (`8813bf15ff74`) | 08:53:17.409 | +1.28s |

**Hypothesis:** The keepalive is a cloud-side ping that triggers an immediate status report from the device. The ~1.28s response time is consistent across all devices and rounds, suggesting the device processes the keepalive and responds with a status packet within a fixed timer.

---

## Weather updates (0x02 subtype 0x04)

### Format (from PROTOCOL.md)

```
02 00 <MAC 6 bytes> 04 <temp lo> <temp hi> <humidity> <airQuality>
```

13 bytes total. Temperature is uint16 LE, divide by 100 for °C.

### Observed in this session

**None.** No weather update packets were routed from cloud to any device during the 08:51–08:54 UTC window.

### Known facts

- The session window was ~3 minutes — too short to rule out infrequent pushes
- Both houses have `latitude`, `longitude`, and `timezone` configured in the cloud (confirmed from `/House/house-complete-info`)
- `/Device/device-status` returns `"Status packet not found!"` for all 6 devices (confirmed 2026-04-09)
- `/Device/house-devices-status` returns `uniqueZoneStatusPacket: null` for both houses (confirmed 2026-04-09)
- The cloud echoes every device packet back within milliseconds (confirmed in logs)
- The `PacketType` enum in the cloud API includes `OutsideWeatherRequest` — confirming the cloud has a concept of weather update packets

### What to look for

A weather update would appear in the routing log as a 26-character hex string starting with `0200<MAC>04`:
```
Routing cloud→device command for <serial>: 0200<12-hex-MAC>04<temp-lo><temp-hi><hum><aq>
```
Example for 15°C, 70%, GOOD air: `02008813bf1650e004960007014601`

### Cloud "device online" requirements — confirmed findings (2026-04-09)

#### What makes a device appear online in the Ambientika app

Tested via `bring-online.py` with add-on stopped (direct TCP connections, same source IP as proxy):

| Test | Result |
|---|---|
| Firmware only (0x03) | Device stays **offline** |
| Firmware + status on same TCP connection | Device goes **online** |
| Firmware + status on same TCP connection, then close connection | Device goes **offline immediately** |
| Firmware on one connection, status on a second | Device stays **offline** |
| Firmware + status on same connection (kept open 5s then closed), status on new connection | Device goes **offline** after first connection closes, stays offline |
| Firmware + status every 30s on persistent connection | Device goes **online** and stays online |

**Conclusions:**
1. The cloud requires firmware (0x03) **and** at least one status (0x01) on the **same TCP connection** before marking a device online.
2. Online status is **tied to the TCP connection** — closing the connection drops the device offline immediately, regardless of subsequent packets on new connections.
3. A persistent TCP connection with periodic status every ~30s keeps the device online indefinitely.

#### Why the proxy relay does not make devices online

The proxy maintains persistent outbound TCP connections to the cloud (one per device IP), and forwards both firmware and status packets. The cloud echoes them back on its inbound back-channel — confirming it receives them. Yet devices stay offline.

**Hypothesis: cloud connection expiry while TCP stays open.**

The cloud may have an application-layer session that expires after some hours of operation (or on cloud-side restart), while the underlying TCP connection remains open. In that state:
- TCP is alive → no `close` event fires → proxy does not reconnect
- Cloud continues to echo packets back (TCP-level ACK) but no longer tracks online status for that session
- `bring-online.py` always starts a fresh TCP connection → always gets a fresh cloud session → works every time

**Next test:** restart the add-on and check the Ambientika app within 60 seconds. Fresh TCP connections will be opened for all devices. If devices appear online immediately after restart → the hypothesis is confirmed. If devices never go online even right after restart → something else is different between the proxy and direct connections.

---

**Step 0 — Verify connectivity**

```bash
nc -zv 185.214.203.87 11000
```

- If port is open → proceed.
- If refused/timeout → raw shell approach not viable; stop and reassess.

---

**Step 1 — Send firmware info + status directly to the cloud**

Open a fresh TCP connection and send the two packets for `8813bf1650e0` (confirmed firmware and last-known status from the log). I'll keep the connection open for 3s to capture the echo:

```bash
(printf '\x03\x00\x88\x13\xbf\x16\x50\xe0\x01\x01\x09\x01\x01\x09\x02\x01\x00\x00'; \
 printf '\x01\x00\x88\x13\xbf\x16\x50\xe0\x00\x02\x01\x14\x1e\x03\x00\x00\x00\x00\x00\x02\xce'; \
 sleep 3) | nc -v 185.214.203.87 11000 | xxd
```

Packets sent:
- `03 00 88 13 bf 16 50 e0 01 01 09 01 01 09 02 01 00 00` — firmware info (18 bytes)
- `01 00 88 13 bf 16 50 e0 00 02 01 14 1e 03 00 00 00 00 00 02 ce` — status (21 bytes)

Expected: the cloud echoes both packets back (same behavior observed via proxy).

---

**Step 2 — Poll `/Device/device-status`**

Immediately after the connection closes:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://app.ambientika.eu:4521/Device/device-status?deviceSerialNumber=8813BF1650E0"
```

- **Returns a `StatusPacket`** → the cloud stores status from any TCP connection with correct packet content. The proxy relay path is missing something — investigate what differs (e.g. relay sends status-only without the preceding 0x03 firmware packet, or connection is not fresh on each session).
- **Still `"Status packet not found!"`** → packet content alone is not sufficient; something else is required before storage triggers. Proceed to step 3.

---

**Step 3 — If Step 2 still empty: send setup packet first, then status**

The cloud may require a device to have a houseId/role/zone assigned before it stores status. Send a setup packet for `8813bf1650e0` (role=MASTER, zone=0, houseId=12048) before the status:

```bash
(printf '\x02\x00\x88\x13\xbf\x16\x50\xe0\x00\x00\x00\x00\xd0\x2e\x00\x00'; \
 printf '\x03\x00\x88\x13\xbf\x16\x50\xe0\x01\x01\x09\x01\x01\x09\x02\x01\x00\x00'; \
 printf '\x01\x00\x88\x13\xbf\x16\x50\xe0\x00\x02\x01\x14\x1e\x03\x00\x00\x00\x00\x00\x02\xce'; \
 sleep 3) | nc -v 185.214.203.87 11000 | xxd
```

Poll `/Device/device-status` again. If it populates now → setup packet is a prerequisite for cloud storage.

---

**Step 4 — If Step 2 returns data: check `house-devices-status`**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://app.ambientika.eu:4521/Device/house-devices-status?houseId=12048" | jq .
```

Confirm `uniqueZoneStatusPacket` is populated for the zone containing `8813bf1650e0`.

---

**Decision tree**

```
Step 0: port 11000 reachable?
  └── NO  → raw shell approach not viable; reassess
  └── YES → Step 1+2: device-status populates after direct shell send?
              └── YES → cloud stores by packet content; relay path is missing a step
                          └── Step 4: check house-devices-status
              └── NO  → Step 3: does setup-first trigger storage?
                          └── YES → setup packet is prerequisite for status storage
                          └── NO  → deeper cloud-side requirement; investigate API further
```

> **Weather push is deferred.** Once devices show as online in the cloud (`/Device/device-status` returns data), investigate whether weather updates begin flowing automatically.

---

## Operating mode commands (0x02 subtype 0x01)

### Format (from PROTOCOL.md)

```
02 00 <MAC 6 bytes> 01 <mode> <speed> <humidity> <light>
```

13 bytes total.

### Observed in this session

**None.** The cloud sent no operating mode commands during this window. All routing lines starting with `0200` are absent — the cloud only echoed `0x01` and `0x03` packets and sent `0x04` keepalives.

---

## Summary: what the cloud actually does

Based on this log, the cloud's behavior on the inbound connection is limited to three actions:

1. **Echo** — reflect every device packet (firmware info + status) back to the device within milliseconds
2. **Keepalive** — ping MASTER devices every ~36s (after a ~64s initial delay) to trigger a status report
3. **Nothing else** — no weather updates, no commands, no setup packets observed in this window

The echo mechanism serves as an acknowledgment: the device knows the cloud received its packet when it gets the echo back. Whether the device uses the echo for anything (e.g. updating its own state machine) is unknown.
