# Ambientika Cloud REST API Reference

Source: `https://app.ambientika.eu:4521/swagger/v1/swagger.json` (retrieved 2026-04-09)
API title: **O.Erre Web Service v1** (OpenAPI 3.0.1)

- **Base URL:** `https://app.ambientika.eu:4521`
- **Swagger UI:** `https://app.ambientika.eu:4521/swagger/index.html`

For the binary TCP protocol used between devices and the cloud, see [`PROTOCOL.md`](PROTOCOL.md).

---

## Authentication

All endpoints except `/Users/authenticate` and `/Users/register` require:
```
Authorization: Bearer <jwtToken>
```

### `POST /Users/authenticate`

```json
{ "username": "email@example.com", "password": "..." }
```

Response (`AuthenticateResponse`):
```json
{
  "id": 3987,
  "firstName": "...",
  "lastName": "...",
  "completeName": "...",
  "username": "...",
  "jwtToken": "eyJ...",
  "expiresAt": "2025-10-04T...",
  "userLevel": 0
}
```

Use `jwtToken` as the bearer token. See `expiresAt` for expiry (typically ~6 months).

### `GET /Users/refresh-token`

Extends token expiration. Returns `TokenRefreshResponse` with a new `token`.

### `GET /Users/token-info`

Returns `TokenInfoResponse`: `userId`, `validFrom`, `validTo`, `username`.

### `GET /Users/feature-flags`

Returns `FeatureFlagsResponse`:
```json
{
  "rememberMeLogin": true/false,
  "resetDeviceEndpoint": true/false,
  "weeklyScheduler": true/false,
  "improvedRoomList": true/false
}
```

---

## Device endpoints

### `POST /Device/change-mode`

Send a change working mode command to a device. Can also change fan speed and humidity level.

Request (`ChangeModeRequest`):
```json
{
  "deviceSerialNumber": "8813BF1650E0",
  "operatingMode": "Smart",
  "fanSpeed": "Low",
  "humidityLevel": "Normal",
  "lightSensorLevel": "Off",
  "isScheduleMode": false
}
```

Responses: `200 OK`, `400 Bad Request`, `406 Not Acceptable` (device did not respond)

### `POST /Device/apply-config`

Apply role configuration to all devices in a house. If the house has multiple zones, all are configured.

Pushes 16-byte binary setup packets to each device via the inbound TCP connection.
Device must acknowledge within ~60 seconds or `406` is returned.

Request body: full `House` object (as returned by `/House/house-complete-info`).
Response: `200` with array of device IDs, or `406` on communication timeout.

### `POST /Device/apply-config-force-unique`

Apply role configuration to all devices in a house, **forcing the house to be configured as a unique zone — this removes all zones**.

Same request/response as `apply-config`, but modifies the house structure server-side to eliminate zones. This is the cause of `zones: []` observed in our house data as of 2026-04-09.

### `GET /Device/device-status?deviceSerialNumber=...`

Get the last status packet received by the cloud for a device.
Response: `StatusPacket` object (see schema below), or `400` if serial not found.

### `GET /Device/house-devices-status?houseId=...`

Get status for all devices in a house.
Response: `HouseDevicesInfo`:
```json
{
  "zoneDevicesInfo": [...],
  "uniqueZoneStatusPacket": { ... },
  "uniqueZoneDevicesCount": 2,
  "masterSn": "8813BF1650E0"
}
```

### `GET /Device/reset-filter?deviceSerialNumber=...`

Send the filter reset command (9-byte binary packet) to a device.
Responses: `200 OK`, `400 Bad Request`

### `POST /Device/reset-device`

Send a reset command to a device. After a successful reset, the stored role is cleared.

Request (`ResetDeviceRequest`):
```json
{
  "deviceSerialNumber": "8813BF1650E0",
  "resetType": "DeviceReset"
}
```

`resetType` values: `"ConnectionReset"`, `"DeviceReset"`
Responses: `200 OK`, `400 Bad Request`, `406 Not Acceptable`

### `GET /Device/send-device-config?deviceSn=...`

Sends the device configuration to a single device.
Responses: `200 OK`, `400`, `404` (device not found), `406` (timeout)

---

## House endpoints

### `GET /House/houses-info`

List summary info for all user houses.
Response: array of `HouseInfo`:
```json
[
  { "houseId": 12048, "houseName": "Hauptwohnung", "houseZonesCount": 0, "houseDevicesCount": 4 },
  { "houseId": 11590, "houseName": "Einliegerwohnung", "houseZonesCount": 0, "houseDevicesCount": 2 }
]
```

### `GET /House/houses`

Returns full `House` objects for all user houses.

### `GET /House/configured-houses`

Returns full `House` objects for houses that have at least one master device configured.

### `GET /House/house-info?houseId=...`

Returns a single `House` object by ID.

### `GET /House/house-complete-info?houseId=...`

Returns a `House` with full nested structure: zones → rooms → devices.
Response: `404` if house not found.

### `GET /House/house-devices?houseId=...`

Returns a `House` containing only the device list.

### `GET /House/house-config-auto?houseId=...&forceUniqueZone=false`

Retrieve the **automatic configuration** of a house (suggested role assignments).
`forceUniqueZone` (default `false`): if `true`, treats the house as a single zone even if zones exist.
Returns a `House` object with suggested roles filled in.

### `POST /House/add-house`

Create a new house. Request (`AddHouseRequest`):
```json
{ "name": "...", "address": "...", "latitude": 0.0, "longitude": 0.0, "timezone": 120 }
```

### `POST /House/rename-house`

```json
{ "houseId": 12048, "newName": "..." }
```

### `POST /House/set-house-timezone`

```json
{ "houseId": 12048, "timezone": 120 }
```

### `DELETE /House/house?houseId=...`

Delete a house.

---

## Zone endpoints

### `GET /House/user-zones?houseId=...`

List all zones for a house. Returns array of `Zone`.

### `POST /House/add-zone`

Add a new zone with rooms. Request (`NewZoneWithRoomsRequest`):
```json
{ "zoneName": "Wohnen", "houseId": 12048, "roomsId": [16435, 16436] }
```

### `POST /House/rename-zone`

```json
{ "zoneId": 12975, "newName": "..." }
```

### `DELETE /House/delete-zone?zoneId=...`

Delete a zone.

### `GET /House/zone-devices?zoneId=...`

Returns all `Device` objects in a zone.

---

## Room endpoints

### `GET /House/user-rooms?houseId=...`

List all rooms for a house.

### `GET /House/user-free-rooms?houseId=...`

List rooms not assigned to any zone.

### `POST /House/add-device-room`

Add a new device (ghost) to a room. Request (`AddNewDeviceRequest`):
```json
{
  "deviceName": "Wohnzimmer",
  "encryptedDeviceInfo": "...",
  "roomName": "LivingRoom",
  "houseId": 12048
}
```

### `POST /House/rename-device`

```json
{ "deviceId": 18703, "newName": "..." }
```

### `GET /House/device-info?encryptedDeviceInfo=...`

Look up a device by its encrypted info string (used during BLE provisioning).

---

## Schedule endpoints

### `GET /Schedule/{deviceId}`

Get the full schedule for a device including all time slots.

### `POST /Schedule/{deviceId}/timeslots`

Add a time slot. Request (`TimeSlot`):
```json
{
  "dayOfWeek": "Monday",
  "startTime": { "hours": 8, "minutes": 0, "seconds": 0, ... },
  "endTime": { "hours": 10, "minutes": 0, "seconds": 0, ... },
  "operatingMode": "Auto",
  "fanSpeed": "Low",
  "humidityLevel": "Normal",
  "lightSensorLevel": "Off",
  "scheduleId": 0
}
```

### `PUT /Schedule/{deviceId}/timeslots/{timeSlotId}`

Update an existing time slot.

### `DELETE /Schedule/{deviceId}/timeslots/{timeSlotId}`

Delete a time slot. Deletes the whole schedule if no slots remain.

---

## Data schemas

### Enums

| Enum | Values |
|------|--------|
| `OperatingMode` | `Smart`, `Auto`, `ManualHeatRecovery`, `Night`, `AwayHome`, `Surveillance`, `TimedExpulsion`, `Expulsion`, `Intake`, `MasterSlaveFlow`, `SlaveMasterFlow`, `Off` |
| `FanSpeed` | `Low`, `Medium`, `High`, `Night` |
| `HumidityLevel` | `Dry`, `Normal`, `Moist` |
| `DeviceRole` | `Master`, `SlaveEqualMaster`, `SlaveOppositeMaster`, `NotConfigured` |
| `DeviceType` | `Ghost`, `Diamond` |
| `AirQuality` | `VeryGood`, `Good`, `Medium`, `Poor`, `Bad` |
| `FilterStatus` | `Good`, `Medium`, `Bad` |
| `LightSensorLevelEnum` | `NotAvailable`, `Off`, `Low`, `Medium` |
| `ResetType` | `ConnectionReset`, `DeviceReset` |
| `PacketType` | `Connection`, `Status`, `Command`, `FwVersions`, `OutsideWeatherRequest`, `Unknown` |
| `RoomNames` | `Kitchen`, `LivingRoom`, `Bedroom`, `Bathroom`, `DinningRoom`, `ChildrenRoom`, `Bathroom2`, `Bathroom3`, `Bedroom2`, `Bedroom3`, `Bedroom4`, `Study`, `Laundry`, `Garage`, `Basement`, `Attic`, `GenericRoom1`, `GenericRoom2` |
| `ScheduleState` | `NotAvailable`, `Off`, `On` |
| `DayOfWeek` | `Sunday`, `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday` |

### `StatusPacket`

Returned by `/Device/device-status` and `/Device/house-devices-status`.

```json
{
  "packetType": "Status",
  "deviceType": "Ghost",
  "deviceSerialNumber": "8813BF1650E0",
  "operatingMode": "Smart",
  "fanSpeed": "Low",
  "humidityLevel": "Normal",
  "temperature": 20,
  "humidity": 55,
  "airQuality": "Good",
  "humidityAlarm": false,
  "filtersStatus": "Good",
  "nightAlarm": false,
  "deviceRole": "Master",
  "lastOperatingMode": "Auto",
  "lightSensorLevel": "Off",
  "signalStrenght": 195,
  "isScheduled": "Off"
}
```

### `House`

```json
{
  "userId": 3987,
  "id": 12048,
  "name": "Hauptwohnung",
  "zones": [ ... ],
  "rooms": [ ... ],
  "schedule": null,
  "hasZones": false,
  "hasDevices": true,
  "address": "...",
  "latitude": 48.959,
  "longitude": 8.288,
  "timezone": 120,
  "currentHouseTime": "2026-04-09T..."
}
```

`hasZones` and `hasDevices` are read-only computed fields.

### `Device`

```json
{
  "id": 18703,
  "deviceType": "Ghost",
  "serialNumber": "8813BF1650E0",
  "userId": 3987,
  "name": "Wohnzimmer",
  "role": "Master",
  "zoneIndex": 0,
  "installation": "2025-03-02T...",
  "radioFwVersion": "1.1.9",
  "microFwVersion": "1.1.9",
  "radioAtCommandsFwVersion": "2.1.0.0",
  "roomId": 16435
}
```

`zoneIndex` maps to zone byte (offset 10) in the [16-byte binary setup packet](PROTOCOL.md).
`serialNumber` maps to MAC bytes 2–7 in binary packets.

### `Zone`

```json
{
  "id": 12975,
  "name": "Wohnen",
  "houseId": 12048,
  "rooms": [ ... ]
}
```
