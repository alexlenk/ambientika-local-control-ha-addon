# Ambientika Cloud Sync — Research Notes

> Protocol and API reference: see [`../PROTOCOL.md`](../PROTOCOL.md) and [`../CLOUD-API.md`](../CLOUD-API.md)

---

## Cloud state (confirmed 2026-04-09)

### Authentication

- API base: `https://app.ambientika.eu:4521`
- userId: `3987`
- Token stored in `research/.token` (see `expiresAt` in token for exact expiry)

---

### Hauptwohnung (houseId=12048)

Source: `GET /House/house-complete-info?houseId=12048`

| Serial | Name | Cloud Role | zoneIndex | roomId | deviceId |
|--------|------|-----------|-----------|--------|----------|
| 8813BF1650E0 | Wohnzimmer | Master | 0 | 16435 | 18703 |
| 8813BF164098 | Kinderzimmer | SlaveOppositeMaster | 0 | 16436 | 18704 |
| 8813BF16089C | Büro Alex | SlaveOppositeMaster | 1 | 16437 | 18705 |
| 8813BF164AA8 | Schlafzimmer | Master | 1 | 16705 | 19007 |

- `zones: []` — house has no zone objects (see note below)
- `hasZones: false`, `hasDevices: true`
- All devices: `deviceType: Ghost`, firmware `radioFwVersion: 1.1.9`, `microFwVersion: 1.1.9`

Source: `GET /Device/house-devices-status?houseId=12048`

- `zoneDevicesInfo: null` — no zone-level status available
- `uniqueZoneStatusPacket: null` — **no status packet received from any device**
- `uniqueZoneDevicesCount: 4`
- `masterSn: 8813BF1650E0`

Source: `GET /Device/device-status?deviceSerialNumber=...` for each device

- All 4 devices return `"Status packet not found!"` — **the cloud has not received any status packet from any device in Hauptwohnung**

---

### Einliegerwohnung (houseId=11590)

Source: `GET /House/house-complete-info?houseId=11590`

| Serial | Name | Cloud Role | zoneIndex | roomId | deviceId |
|--------|------|-----------|-----------|--------|----------|
| 8813BF1618E4 | Küche Lüftung | Master | 0 | 15732 | 17918 |
| 8813BF15FF74 | Wohnzimmer Lüftung | SlaveOppositeMaster | 0 | 15731 | 17917 |

- `zones: []` — house has no zone objects (see note below)
- `hasZones: false`, `hasDevices: true`
- All devices: `deviceType: Ghost`, firmware `radioFwVersion: 1.1.9`, `microFwVersion: 1.1.9`

Source: `GET /Device/house-devices-status?houseId=11590`

- `zoneDevicesInfo: null`
- `uniqueZoneStatusPacket: null` — **no status packet received from any device**
- `uniqueZoneDevicesCount: 2`
- `masterSn: 8813BF1618E4`

Source: `GET /Device/device-status?deviceSerialNumber=...` for each device

- Both devices return `"Status packet not found!"` — **the cloud has not received any status packet from either device in Einliegerwohnung**

---

### Notes

**`zones: []` on both houses:**
The Swagger summary for `POST /Device/apply-config-force-unique` states:
> "Forces the house to be configured as unique zone, removing zones."
This endpoint was called at some point and removed all zone objects from both houses.
Whether this affects `apply-config` behaviour or device provisioning is not yet confirmed.

**No status packets on cloud:**
`/Device/device-status` returns `"Status packet not found!"` for all 6 devices across
both houses. This confirms the cloud is not receiving any device data — devices are either
not connecting to the cloud at all, or connecting but the proxy is not forwarding their packets.

---

## Open questions

1. ~~Are devices currently connecting to the proxy (port 11000 on HA host)?~~ **Confirmed yes** — all 6 devices connected during the log window (2026-04-09).
2. ~~Is the proxy forwarding device packets to the cloud (outbound connections to 185.214.203.87:11000)?~~ **Confirmed yes** — proxy opens one outbound TCP connection per device to 185.214.203.87.
3. ~~Is there a DNS or DNAT redirect in place routing devices to the proxy?~~ **Confirmed yes** — devices are reaching the proxy; a DNAT or DNS redirect must be in place.
4. What is the correct intended role for Büro Alex and Schlafzimmer in zone 1?
5. Why does `/Device/device-status` return "Status packet not found!" for all 6 devices even though the proxy logs confirm the cloud is actively echoing their packets?
6. Device `4831b7adf390` has a clogged filter (FilterStatus=BAD). When was it last cleaned/replaced?
7. Device `4831b7adf390` does not appear in either cloud house — is it part of a third house or is it unprovisioned?

---

## HA add-on state (confirmed from silly logs, 2026-04-09, 07:49–07:57 UTC)

### Startup configuration

- **Version:** `1.1.10`
- **cloud_sync_enabled:** `true`
- **MQTT broker:** `core-mosquitto:1883`
- **log_level:** `silly`
- **Local TCP port:** `11000` (device connections)
- **REST port:** `3000`
- **UDP ports:** `45000`–`45015` (16 zone ports, all active)

---

### Devices connected to proxy

All 6 devices connected during the log window. Each device established both a local connection (device→proxy) and an outbound cloud connection (proxy→185.214.203.87).

| Serial | IP | Local Port | Cloud Port | Connect time (UTC) | Role | Mode | Fan | Firmware |
|--------|----|-----------|-----------|---------------------|------|------|-----|----------|
| `8813bf15ff74` | 192.168.5.46 | 50447 | 49602 | 08:51:36 | MASTER | SMART | HIGH | 1.1.9/1.1.9/2.1.0.0 |
| `4831b7adf390` | 192.168.5.170 | 50619 | 49608 | 08:51:39 | SLAVE_OPPOSITE_MASTER | SMART | NIGHT | 1.1.12/1.1.12/2.4.2.0 |
| `8813bf16089c` | 192.168.5.60 | 61686 | 49820 | 08:51:50 | MASTER | SMART | HIGH | 1.1.9/1.1.9/2.1.0.0 |
| `8813bf1650e0` | 192.168.5.52 | 63915 | 49822 | 08:51:51 | MASTER | SMART | HIGH | 1.1.9/1.1.9/2.1.0.0 |
| `8813bf164aa8` | 192.168.5.63 | 54582 | 35874 | 08:51:55 | SLAVE_OPPOSITE_MASTER | MASTER_SLAVE_FLOW | MEDIUM | 1.1.9/1.1.9/2.1.0.0 |
| `8813bf164098` | 192.168.5.53 | 62919 | 35884 | 08:52:01 | SLAVE_OPPOSITE_MASTER | INTAKE | MEDIUM | 1.1.9/1.1.9/2.1.0.0 |

**Note on `4831b7adf390`:** This serial does not appear in either cloud house (`houseId=12048` or `houseId=11590`). It has newer firmware (1.1.12) than all other devices (1.1.9). Its IP (192.168.5.170) was not previously recorded.

---

### Cloud relay behavior (outbound)

For each device, the proxy opens an outbound TCP connection to the cloud:
- Cloud endpoint: `185.214.203.87` (port varies per connection, not port 11000 on the cloud side)
- Log sequence per device: `connection to cloud established` → `Device connected: 185.214.203.87:<port>`
- All 6 devices got successful cloud connections during the log window

### Cloud inbound echo behavior

The cloud opens inbound connections back to the proxy and echoes device packets. The proxy logs these as `Routing cloud→device command for <serial>`. This confirms:

1. The cloud IS receiving device packets (via the outbound relay).
2. The cloud IS sending echo/command packets back.
3. The proxy IS routing these back to the correct device socket (matched by serial number).

**Contradiction with cloud API:** `/Device/device-status` returns `"Status packet not found!"` for all devices, yet the proxy logs confirm the cloud is actively receiving and echoing data. This is unresolved.

---

### 0x04 keepalive packets

The cloud sends 8-byte `0x04` keepalive packets to MASTER devices on the inbound connection. Timing from log:

| Packet (hex) | Device | First seen (UTC) | Second seen (UTC) | Interval |
|---|---|---|---|---|
| `04 00 88 13 bf 15 ff 74` | `8813bf15ff74` | 08:52:40 | 08:53:16 | ~36s |
| `04 00 88 13 bf 16 08 9c` | `8813bf16089c` | 08:52:54 | — | — |
| `04 00 88 13 bf 16 50 e0` | `8813bf1650e0` | 08:52:56 | — | — |

- First keepalive arrives ~60–64 seconds after device connects
- Interval between keepalives: ~35–36 seconds (not ~2 minutes as initially guessed)
- Only sent to MASTER-role devices — never to `4831b7adf390`, `8813bf164aa8`, `8813bf164098` (all slaves)
- The proxy forwards keepalives to the device TCP socket unchanged (pass-through)
- Also documented in `PROTOCOL.md` as the 8-byte keepalive packet type

---

### Zone assignments (from MQTT `zone` topic)

| Serial | Zone (MQTT) | Source |
|--------|-------------|--------|
| `8813bf1650e0` | 1 | UDP broadcast on port 45001 from 192.168.5.52 |
| `8813bf16089c` | 2 | UDP broadcast on port 45002 from 192.168.5.60 |
| `8813bf15ff74` | 3 | UDP broadcast on port 45003 from 192.168.5.46 |

Slave devices (`4831b7adf390`, `8813bf164aa8`, `8813bf164098`) had no `zone` topic published — slaves do not send UDP broadcasts; their zone must come from a `setup/set` MQTT command.

**Note:** Zone values here are 1-indexed (MQTT display). The cloud API uses 0-indexed `zoneIndex`. Zone 1 here = `zoneIndex 0` in cloud data.

Zones can be set by three mechanisms (in order of priority as observed):
1. UDP broadcast received from a device IP → zone = port - 45000
2. Cloud setup packet (16-byte type `0x02`) received on the inbound connection
3. MQTT `ambientika/<sn>/setup/set` command

---

### UDP broadcast raw packets

UDP broadcasts are 7 bytes. Received on ports 45000–45015. Before the TCP handshake completes, `serialNumber` is `undefined`. After handshake, broadcasts are attributed to the device by IP.

All packets observed in this session have bytes 3–6 = `00 2f 10 00`. This does not match either known houseId (12048 = `0x2ED0`, 11590 = `0x2D46`) in any byte order — the meaning of this field is unconfirmed.

| Raw hex | Port | Source IP | Zone | fanMode | fanStatus | Serial (after handshake) |
|---------|------|-----------|------|---------|-----------|--------------------------|
| `65 31 22 00 2f 10 00` | 45001 | 192.168.5.52 | 1 | ALTERNATING | START_MEDIUM | `8813bf1650e0` |
| `65 31 2a 00 2f 10 00` | 45001 | 192.168.5.52 | 1 | ALTERNATING | INTAKE_MEDIUM | `8813bf1650e0` |
| `65 32 2a 00 2f 10 00` | 45002 | 192.168.5.60 | 2 | ALTERNATING | INTAKE_MEDIUM | `8813bf16089c` |
| `65 32 22 00 2f 10 00` | 45002 | 192.168.5.60 | 2 | ALTERNATING | START_MEDIUM | `8813bf16089c` |
| `65 32 26 00 2f 10 00` | 45002 | 192.168.5.60 | 2 | ALTERNATING | EXPULSION_MEDIUM | `8813bf16089c` |
| `65 33 24 00 2f 10 00` | 45003 | 192.168.5.46 | 3 | ALTERNATING | EXPULSION_NIGHT | `8813bf15ff74` |
| `65 33 28 00 2f 10 00` | 45003 | 192.168.5.46 | 3 | ALTERNATING | INTAKE_NIGHT | `8813bf15ff74` |
| `65 33 20 00 2f 10 00` | 45003 | 192.168.5.46 | 3 | ALTERNATING | STOP | `8813bf15ff74` |

Byte 2 decoding (`<fanMode nibble><fanStatus nibble>`):
- `22` = fanMode=2 (ALTERNATING), fanStatus=2 (START_MEDIUM)
- `2a` = fanMode=2, fanStatus=10 (INTAKE_MEDIUM)
- `26` = fanMode=2, fanStatus=6 (EXPULSION_MEDIUM)
- `24` = fanMode=2, fanStatus=4 (EXPULSION_NIGHT)
- `28` = fanMode=2, fanStatus=8 (INTAKE_NIGHT)
- `20` = fanMode=2, fanStatus=0 (STOP)

---

### Sample firmware info packets (18 bytes) — confirmed directly from log

> Raw hex captured verbatim from `silly`-level log lines (e.g. `Received data on local socket <Buffer ...>`).

| Serial | Raw hex (18 bytes) | radio | micro | radioAT |
|--------|--------------------|-------|-------|---------|
| `4831b7adf390` | `03 00 48 31 b7 ad f3 90 01 01 0c 01 01 0c 02 04 02 00` | 1.1.12 | 1.1.12 | 2.4.2.0 |
| `8813bf15ff74` | `03 00 88 13 bf 15 ff 74 01 01 09 01 01 09 02 01 00 00` | 1.1.9 | 1.1.9 | 2.1.0.0 |
| `8813bf16089c` | `03 00 88 13 bf 16 08 9c 01 01 09 01 01 09 02 01 00 00` | 1.1.9 | 1.1.9 | 2.1.0.0 |
| `8813bf1650e0` | `03 00 88 13 bf 16 50 e0 01 01 09 01 01 09 02 01 00 00` | 1.1.9 | 1.1.9 | 2.1.0.0 |
| `8813bf164aa8` | `03 00 88 13 bf 16 4a a8 01 01 09 01 01 09 02 01 00 00` | 1.1.9 | 1.1.9 | 2.1.0.0 |
| `8813bf164098` | `03 00 88 13 bf 16 40 98 01 01 09 01 01 09 02 01 00 00` | 1.1.9 | 1.1.9 | 2.1.0.0 |

---

### Sample raw status packets (21 bytes, decoded) — all 6 devices, first packet on connect

All packets confirmed directly from log (`silly` level). AirQuality byte 13 uses 0-based enum in code (0=VERY_GOOD, 3=POOR) despite PROTOCOL.md saying 1-based — the code subtracts nothing; value in byte is the enum index directly.

**`8813bf15ff74`** (MASTER, SMART, HIGH, night_alarm=true) — `01 00 88 13 bf 15 ff 74 00 02 01 15 27 00 00 00 01 00 00 02 cc`

| B | Value | Field |
|---|-------|-------|
| 8 | `00` | OperatingMode: SMART |
| 9 | `02` | FanSpeed: HIGH |
| 10 | `01` | HumidityLevel: NORMAL |
| 11 | `15`=21 | Temperature: 21°C |
| 12 | `27`=39 | Humidity: 39% |
| 13 | `00` | AirQuality: VERY_GOOD |
| 14 | `00` | HumidityAlarm: OFF |
| 15 | `00` | FilterStatus: GOOD |
| 16 | `01` | **NightAlarm: ON** |
| 17 | `00` | DeviceRole: MASTER |
| 18 | `00` | LastMode: SMART |
| 19 | `02` | LightSensitivity: LOW |
| 20 | `cc` | WiFi |

**`4831b7adf390`** (SLAVE_OPPOSITE_MASTER, SMART, NIGHT, filter=BAD) — `01 00 48 31 b7 ad f3 90 00 03 01 15 24 00 00 02 00 02 01 02 c7`

| B | Value | Field |
|---|-------|-------|
| 8 | `00` | OperatingMode: SMART |
| 9 | `03` | FanSpeed: NIGHT |
| 10 | `01` | HumidityLevel: NORMAL |
| 11 | `15`=21 | Temperature: 21°C |
| 12 | `24`=36 | Humidity: 36% |
| 13 | `00` | AirQuality: VERY_GOOD |
| 14 | `00` | HumidityAlarm: OFF |
| 15 | `02` | **FilterStatus: BAD** |
| 16 | `00` | NightAlarm: OFF |
| 17 | `02` | DeviceRole: SLAVE_OPPOSITE_MASTER |
| 18 | `01` | LastMode: AUTO |
| 19 | `02` | LightSensitivity: LOW |
| 20 | `c7` | WiFi |

> **Operational alert:** `4831b7adf390` filter needs replacement.

**`8813bf16089c`** (MASTER, SMART, HIGH) — `01 00 88 13 bf 16 08 9c 00 02 01 18 16 00 00 00 00 00 00 02 ce`

| B | Value | Field |
|---|-------|-------|
| 8 | `00` | SMART | 9 | `02` | HIGH | 10 | `01` | NORMAL |
| 11 | `18`=24 | 24°C | 12 | `16`=22 | 22% | 13 | `00` | VERY_GOOD |
| 14 | `00` | OFF | 15 | `00` | GOOD | 16 | `00` | OFF |
| 17 | `00` | MASTER | 18 | `00` | SMART | 19 | `02` | LOW | 20 | `ce` | WiFi |

**`8813bf1650e0`** (MASTER, SMART, HIGH) — `01 00 88 13 bf 16 50 e0 00 02 01 14 1e 03 00 00 00 00 00 02 ce`

| B | Value | Field |
|---|-------|-------|
| 8 | `00` | SMART | 9 | `02` | HIGH | 10 | `01` | NORMAL |
| 11 | `14`=20 | 20°C | 12 | `1e`=30 | 30% | 13 | `03` | POOR |
| 14 | `00` | OFF | 15 | `00` | GOOD | 16 | `00` | OFF |
| 17 | `00` | MASTER | 18 | `00` | SMART | 19 | `02` | LOW | 20 | `ce` | WiFi |

**`8813bf164aa8`** (SLAVE_OPPOSITE_MASTER, MASTER_SLAVE_FLOW, MEDIUM) — `01 00 88 13 bf 16 4a a8 09 01 01 15 25 03 00 00 00 02 01 02 ce`

| B | Value | Field |
|---|-------|-------|
| 8 | `09` | MASTER_SLAVE_FLOW | 9 | `01` | MEDIUM | 10 | `01` | NORMAL |
| 11 | `15`=21 | 21°C | 12 | `25`=37 | 37% | 13 | `03` | POOR |
| 14 | `00` | OFF | 15 | `00` | GOOD | 16 | `00` | OFF |
| 17 | `02` | SLAVE_OPPOSITE_MASTER | 18 | `01` | AUTO | 19 | `02` | LOW | 20 | `ce` | WiFi |

**`8813bf164098`** (SLAVE_OPPOSITE_MASTER, INTAKE, MEDIUM) — `01 00 88 13 bf 16 40 98 08 01 01 15 1f 03 00 00 00 02 01 02 cc`

| B | Value | Field |
|---|-------|-------|
| 8 | `08` | INTAKE | 9 | `01` | MEDIUM | 10 | `01` | NORMAL |
| 11 | `15`=21 | 21°C | 12 | `1f`=31 | 31% | 13 | `03` | POOR |
| 14 | `00` | OFF | 15 | `00` | GOOD | 16 | `00` | OFF |
| 17 | `02` | SLAVE_OPPOSITE_MASTER | 18 | `01` | AUTO | 19 | `02` | LOW | 20 | `cc` | WiFi |

---

### Setup packet sent during session

At 08:53:51 UTC, a setup command was issued via MQTT (`ambientika/8813bf16089c/setup/set`) to assign `8813bf16089c` as MASTER in zone 2 of houseId 12048:

```
MQTT payload: {"role": "MASTER", "zone": 2, "houseId": 12048}
Generated buffer: 02 00 88 13 bf 16 08 9c 00 00 02 00 10 2f 00 00
```

Decoding: `02 00` + MAC + `00` (pad) + `00` (MASTER) + `02` (zone 2) + `00` (pad) + `10 2f 00 00` (houseId 12048 = 0x00002F10 LE).

The buffer was written directly to `8813bf16089c`'s TCP socket at 192.168.5.60:61686. No cloud involvement — local injection only.

---

### Discrepancies between cloud and proxy

| Item | Cloud API (2026-04-09) | Proxy logs (2026-04-09) |
|------|----------------------|------------------------|
| `4831b7adf390` | Not in any house | Connected, SLAVE_OPPOSITE_MASTER |
| `8813bf15ff74` | SlaveOppositeMaster (Einliegerwohnung) | Self-reports as MASTER |
| `8813bf16089c` | SlaveOppositeMaster (Hauptwohnung) | Self-reports as MASTER |
| `8813bf164aa8` | Master (Hauptwohnung) | Self-reports as SLAVE_OPPOSITE_MASTER |
| Status packets | "Status packet not found!" for all | Cloud actively echoes all device packets |

The role discrepancies (cloud assignment ≠ device self-report) are the primary candidates for why cloud sync is misbehaving.
