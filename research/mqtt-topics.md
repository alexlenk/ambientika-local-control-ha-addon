# MQTT Topic Reference

All state topics use base prefix `ambientika/<serialNumber>/`. Topics with `/set` suffix are command (subscribe) topics.

---

## State topics (add-on publishes)

| Topic | Payload | Notes |
|-------|---------|-------|
| `ambientika/<sn>/availability` | `online` / `offline` | Published on each status packet; `offline` on device timeout |
| `ambientika/<sn>/cloud_availability` | `true` / `false` | Published when cloud relay connects/disconnects; only when `cloud_sync_enabled=true` |
| `ambientika/<sn>/preset_mode` | `SMART`, `AUTO`, `MANUAL_HEAT_RECOVERY`, `NIGHT`, `AWAY_HOME`, `SURVEILLANCE`, `TIMED_EXPULSION`, `EXPULSION`, `INTAKE`, `MASTER_SLAVE_FLOW`, `SLAVE_MASTER_FLOW`, `OFF` (master) or `SLAVE_OPPOSITE_MASTER` / `SLAVE_EQUAL_MASTER` (slave) | Slave devices publish their role here instead of operating mode |
| `ambientika/<sn>/action` | `fan` / `off` | HA climate action state |
| `ambientika/<sn>/mode` | `fan_only` / `off` | HA climate mode state |
| `ambientika/<sn>/fan` | `low` / `medium` / `high` / `night` | Fan speed (lowercase) |
| `ambientika/<sn>/temperature` | Integer °C | Current room temperature |
| `ambientika/<sn>/humidity` | Integer % | Current room humidity |
| `ambientika/<sn>/humidity_level` | `DRY` / `NORMAL` / `MOIST` | Humidity setpoint level |
| `ambientika/<sn>/target_humidity` | `40` / `60` / `75` | Numeric target humidity (DRY=40, NORMAL=60, MOIST=75) |
| `ambientika/<sn>/air_quality` | `VERY_GOOD`, `GOOD`, `MEDIUM`, `POOR`, `BAD` | Air quality enum |
| `ambientika/<sn>/humidity_alarm` | `true` / `false` | Humidity alarm active |
| `ambientika/<sn>/filter_status` | `GOOD` / `MEDIUM` / `BAD` | Filter condition; `BAD` means filter needs replacement |
| `ambientika/<sn>/night_alarm` | `true` / `false` | Night alarm active |
| `ambientika/<sn>/light_sensitivity` | `NOT_AVAILABLE` / `OFF` / `LOW` / `MEDIUM` | Light sensor sensitivity |
| `ambientika/<sn>/fan_status` | `SLAVE_OPPOSITE_MASTER` / `SLAVE_EQUAL_MASTER` (slave) or `HIGH` / `MEDIUM` / `LOW` / `OFF` (master) | Effective fan status; slaves publish role |
| `ambientika/<sn>/fan_mode` | `AUTO` / `MANUAL` / `OFF` | Derived from operating mode (`AUTO` only for OperatingMode=AUTO) |
| `ambientika/<sn>/zone` | Integer (0-based) | Zone index from setup packet; only published when known |
| `ambientika/<sn>/house_id` | Integer | House ID from setup packet; only published when known |
| `ambientika/<sn>/device_role` | `MASTER` / `SLAVE_EQUAL_MASTER` / `SLAVE_OPPOSITE_MASTER` | Self-reported from status packet byte 17 |

---

## Command topics (add-on subscribes)

| Topic | Payload | Notes |
|-------|---------|-------|
| `ambientika/<sn>/preset_mode/set` | OperatingMode string (e.g., `SMART`, `NIGHT`, `OFF`) | Changes operating mode on master only |
| `ambientika/<sn>/mode/set` | `fan_only` / `off` | HA climate mode command |
| `ambientika/<sn>/fan/set` | `low` / `medium` / `high` / `night` | Changes fan speed |
| `ambientika/<sn>/target_humidity/set` | `40` / `60` / `75` | Sets humidity level (maps to DRY/NORMAL/MOIST) |
| `ambientika/<sn>/light_sensitivity/set` | `OFF` / `LOW` / `MEDIUM` | Changes light sensitivity |
| `ambientika/<sn>/filter_reset/set` | any | Sends 9-byte filter reset command to device |
| `ambientika/<sn>/device_setup/set` | Binary (16-byte hex) | Injects a raw 16-byte setup packet into the device TCP socket |
| `ambientika/<sn>/setup/set` | JSON `{"role":"MASTER","zone":0,"houseId":12048}` | Sends a setup packet from JSON parameters |
| `ambientika/<sn>/raw_command/set` | Binary hex | Sends a raw command buffer to the device TCP socket |
| `ambientika/weather` | JSON `WeatherUpdateDto` | Pushes weather data to all connected devices |
| `homeassistant/status` | `online` | Re-triggers HA auto-discovery for all known devices |

---

## HA auto-discovery topics

Published once per device on first status packet (and again on `homeassistant/status` = `online`).

| Entity type | Topic pattern |
|-------------|---------------|
| `climate` | `homeassistant/climate/<sn>/hvac/config` |
| `binary_sensor` (night alarm) | `homeassistant/binary_sensor/<sn>/nightalarm/config` |
| `binary_sensor` (humidity alarm) | `homeassistant/binary_sensor/<sn>/humidityalarm/config` |
| `binary_sensor` (cloud availability) | `homeassistant/binary_sensor/<sn>/cloudavailability/config` — only when `cloud_sync_enabled=true` |
| `sensor` (air quality) | `homeassistant/sensor/<sn>/airquality/config` |
| `sensor` (filter status) | `homeassistant/sensor/<sn>/filterstatus/config` |
| `sensor` (humidity) | `homeassistant/sensor/<sn>/humidity/config` |
| `sensor` (fan status) | `homeassistant/sensor/<sn>/fanstatus/config` |
| `sensor` (fan mode) | `homeassistant/sensor/<sn>/fanmode/config` |
| `sensor` (preset mode) | `homeassistant/sensor/<sn>/presetmode/config` |
| `sensor` (zone) | `homeassistant/sensor/<sn>/zone/config` |
| `sensor` (house ID) | `homeassistant/sensor/<sn>/houseid/config` |
| `sensor` (device role) | `homeassistant/sensor/<sn>/devicerole/config` |
| `button` (filter reset) | `homeassistant/button/<sn>/filterreset/config` |
| `select` (light sensitivity) | `homeassistant/select/<sn>/lightsensitivity/config` |

Climate entity: `modes: ['off', 'fan_only']`, `fan_modes: ['low', 'medium', 'high', 'night']`

---

## Notes

- **Slave preset_mode:** Slave devices publish `SLAVE_OPPOSITE_MASTER` or `SLAVE_EQUAL_MASTER` as their preset_mode. This is intentional — their operating mode changes dynamically with the master's commands, but their role is stable and informative.
- **zone/house_id:** Only published for devices that received a setup packet (16 bytes, type `0x02`). Slaves may not have a separate zone published if they share the master's zone.
- **fan_status vs fan:** `fan` = fan speed from the 21-byte status packet. `fan_status` = effective direction/speed derived from the UDP broadcast (preferred) or from the status packet (fallback).
- **filter_status=BAD** triggers no automatic HA alarm — it is only exposed as a sensor value. Manual monitoring required.
