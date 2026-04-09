# REST API Reference

The add-on exposes a local HTTP server (Express) on port 3000 (configurable via `rest_api_port`). All endpoints are on the HA host: `http://<ha-host>:3000`.

No authentication. All requests/responses are JSON unless otherwise noted.

---

## `GET /device/status/:serialNumber`

Returns the current cached state of a device from SQLite.

**Path parameter:** `serialNumber` — lowercase hex MAC, e.g. `8813bf1650e0`

**Response 200:**
```json
{
  "id": 1,
  "serialNumber": "8813bf1650e0",
  "status": "online",
  "lastUpdate": "2026-04-09T07:55:00.000Z",
  "firstSeen": "2026-04-09T07:49:00.000Z",
  "operatingMode": "SMART",
  "fanSpeed": "HIGH",
  "humidityLevel": "NORMAL",
  "temperature": 19,
  "humidity": 26,
  "airQuality": "POOR",
  "humidityAlarm": false,
  "filterStatus": "GOOD",
  "nightAlarm": false,
  "deviceRole": "MASTER",
  "remoteAddress": "192.168.5.52",
  "lastOperatingMode": "SMART",
  "lightSensitivity": "LOW"
}
```

**Response 404:** `Not Found` (plain text) — device serial unknown or never connected.

---

## `POST /device/operating-mode/:serialNumber`

Sends an operating mode command to a device. Fires `DEVICE_OPERATING_MODE_UPDATE` event → `DeviceCommandService` builds the 13-byte command buffer and writes it to the device TCP socket.

**Path parameter:** `serialNumber` — lowercase hex MAC

**Request body** (`OperatingModeDto`, all fields optional):
```json
{
  "operatingMode": "SMART",
  "fanSpeed": "HIGH",
  "humidityLevel": "NORMAL",
  "lightSensitivity": "LOW"
}
```

Valid values:
- `operatingMode`: `SMART`, `AUTO`, `MANUAL_HEAT_RECOVERY`, `NIGHT`, `AWAY_HOME`, `SURVEILLANCE`, `TIMED_EXPULSION`, `EXPULSION`, `INTAKE`, `MASTER_SLAVE_FLOW`, `SLAVE_MASTER_FLOW`, `OFF`
- `fanSpeed`: `LOW`, `MEDIUM`, `HIGH`, `NIGHT`
- `humidityLevel`: `DRY`, `NORMAL`, `MOIST`
- `lightSensitivity`: `NOT_AVAILABLE`, `OFF`, `LOW`, `MEDIUM`

**Response 200:** empty body (fire-and-forget; no confirmation from device)

> **Note:** Commands are only routed to MASTER devices. Sending a command to a slave serial will be queued but the slave ignores operating mode commands — they are controlled by the master.

---

## `POST /device/reset-filter/:serialNumber`

Sends a 9-byte filter reset command to the device. Clears the filter clog indicator on the device.

**Path parameter:** `serialNumber` — lowercase hex MAC

**Request body:** empty

**Response 200:** empty body

> Use this after physically cleaning or replacing the device filter when `filter_status` = `BAD`.

---

## `POST /device/weather-update`

Pushes outdoor weather data to all connected devices. Devices in `SMART` mode use this to decide ventilation direction (intake if outdoor air quality is better than indoor).

**Request body** (`WeatherUpdateDto`):
```json
{
  "temperature": 12.5,
  "humidity": 65,
  "airQuality": 1
}
```

Fields:
- `temperature`: outdoor temperature in °C (number)
- `humidity`: outdoor relative humidity % (number)
- `airQuality`: `AirQuality` enum value: `0`=VERY_GOOD, `1`=GOOD, `2`=MEDIUM, `3`=POOR, `4`=BAD

**Response 200:** empty body

---

## `POST /cloud/send-setup/:serialNumber`

**Debug endpoint.** Injects a 16-byte setup packet into the local device socket for the specified device. Use this to assign a device's role, zone, and house ID without going through the cloud.

**Path parameter:** `serialNumber` — lowercase hex MAC

**Request body:**
```json
{
  "role": 0,
  "zone": 1,
  "houseId": 12048
}
```

Fields:
- `role`: `0`=MASTER, `1`=SLAVE_EQUAL_MASTER, `2`=SLAVE_OPPOSITE_MASTER
- `zone`: zone index (0-based; port = 45000 + zone)
- `houseId`: house ID integer (stored as uint32 LE in bytes 12–15 of the setup packet)

**Response 200:**
```json
{ "sent": "02008813bf16089c0000010000002ed000", "via": "192.168.5.60" }
```

**Response 404:** `Device not found or no IP`

> The endpoint logs the injected packet at `info` level. It writes directly to the device's local TCP socket (not via the cloud relay). This is the primary tool for reprovisioning a device without cloud access.

---

## Summary table

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/device/status/:sn` | Read cached device state | None |
| POST | `/device/operating-mode/:sn` | Send mode/fan/humidity command | None |
| POST | `/device/reset-filter/:sn` | Send filter reset command | None |
| POST | `/device/weather-update` | Push outdoor weather to all devices | None |
| POST | `/cloud/send-setup/:sn` | Inject setup packet into device socket | None |
