# Ambientika Local Control - Home Assistant Add-on

[![Build](https://github.com/alexlenk/ambientika-local-control-ha-addon/actions/workflows/build.yml/badge.svg?branch=master)](https://github.com/alexlenk/ambientika-local-control-ha-addon/actions/workflows/build.yml)
![Tests](https://img.shields.io/badge/tests-239%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-93%25-brightgreen)
![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]

A Home Assistant add-on for local control of Ambientika ventilation devices with MQTT integration.

## Attribution

Based on [ambientika-local-control](https://github.com/sragas/ambientika-local-control) by [sragas](https://github.com/sragas).

---

## Features

- **Home Assistant add-on** — easy installation through the add-on store
- **MQTT integration** — full MQTT support with auto-discovery
- **Multi-zone support** — control master/slave device pairs across zones
- **Cloud sync** — optional parallel forwarding to the Ambientika cloud so the official app keeps working
- **Local control** — no cloud dependency required for Home Assistant control
- **Command persistence** — reliable operating mode changes queued until acknowledged

---

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the "Ambientika Local Control" add-on
3. Configure MQTT settings
4. Provision your devices via BLE (see below)
5. Start the add-on

---

## Device Provisioning (BLE)

Each device must be told to connect to your Home Assistant instance instead of the Ambientika cloud. This is done **once per device** over Bluetooth.

Write the following three values to the device's WiFi characteristic
(Service `0000a002-*`, Characteristic `0000c302-*`):

| Value | Example |
|-------|---------|
| `H_<HA-IP>:11000` | `H_192.168.1.10:11000` |
| `S_<wifi-ssid>` | `S_MyNetwork` |
| `P_<wifi-password>` | `P_mypassword` |

BLE apps: **LightBlue Explorer** (iOS) or **nRF Connect** (Android/iOS).

The device appears as `VMC_<MAC>` in BLE scans. After writing, it restarts and connects to the add-on.

Re-provisioning is only needed if your HA IP changes or a device is factory-reset.

---

## Cloud Sync

With `cloud_sync_enabled: true` the add-on forwards device traffic to the Ambientika cloud in parallel. This allows the **official Ambientika app to continue working** alongside Home Assistant — devices appear online in both.

Without cloud sync, devices are only accessible via Home Assistant and show as offline in the official app.

---

## Protocol Reference

For the full binary protocol spec see [`PROTOCOL.md`](PROTOCOL.md).
For cloud API and provisioning architecture see [`CLOUD-INTEGRATION.md`](CLOUD-INTEGRATION.md).

### Operating Modes

| Value | Name | Description |
|-------|------|-------------|
| 0 | `SMART` | Self-managing. Uses indoor/outdoor sensors. Auto-triggers free-cooling (MASTER_SLAVE_FLOW) when indoor > 24°C and outdoor is lower. |
| 1 | `AUTO` | Humidity-controlled. Ventilates when humidity exceeds the configured threshold. |
| 2 | `MANUAL_HEAT_RECOVERY` | Fixed heat-recovery at a chosen fan speed. All sensors disabled. |
| 3 | `NIGHT` | All units at NIGHT fan speed in heat-recovery mode. |
| 4 | `AWAY_HOME` | Standby, damper closed. Starts at LOW on humidity > 60%. |
| 5 | `SURVEILLANCE` | Standby, damper closed. Expels at configured speed on humidity alarm. |
| 6 | `TIMED_EXPULSION` | All units expel at HIGH for 20 minutes, then return to previous mode. |
| 7 | `EXPULSION` | Continuous expulsion at chosen speed. |
| 8 | `INTAKE` | Continuous intake at chosen speed. |
| 9 | `MASTER_SLAVE_FLOW` | Airflow MASTER → SLAVE_OPPOSITE_MASTER. Used to push air into a room. |
| 10 | `SLAVE_MASTER_FLOW` | Reverse of MASTER_SLAVE_FLOW. |
| 11 | `OFF` | All units off, sensors disabled, damper closed. |

> `MASTER_SLAVE_FLOW` and `SLAVE_MASTER_FLOW` can be set manually or triggered automatically by SMART mode's free-cooling logic.

### Fan Speeds

| Value | Name | Description |
|-------|------|-------------|
| 0 | `LOW` | Minimum speed |
| 1 | `MEDIUM` | Average speed |
| 2 | `HIGH` | Maximum speed |
| 3 | `NIGHT` | Night-time speed — quieter than LOW. Set automatically by SMART and NIGHT modes. |

### Device Roles

| Value | Name | Description |
|-------|------|-------------|
| 0 | `MASTER` | Primary device. Receives all commands and propagates to slaves. |
| 1 | `SLAVE_EQUAL_MASTER` | Secondary device, same airflow direction as master. |
| 2 | `SLAVE_OPPOSITE_MASTER` | Secondary device, opposite airflow direction to master. |

> Commands must always be sent to the MASTER device.

### Device Status Packet (21 bytes, TCP)

| Byte(s) | Content |
|---------|---------|
| 0–1 | Packet header (`0x01 0x00`) |
| 2–7 | Serial number (6 bytes, MAC) |
| 8 | Operating mode |
| 9 | Fan speed |
| 10 | Humidity level (threshold setting) |
| 11 | Temperature (°C) |
| 12 | Humidity (%) |
| 13 | Air quality |
| 14 | Humidity alarm (0/1) |
| 15 | Filter status |
| 16 | Night alarm (0/1) |
| 17 | Device role |
| 18 | Last operating mode |
| 19 | Light sensitivity |
| 20 | Signal strength |

---

## MQTT Topics

### Device setup command
```
ambientika/{serialNumber}/setup/set
{"role": "SLAVE_OPPOSITE_MASTER", "zone": 1, "houseId": 12048}
```

### Raw command (advanced/debug)
```
ambientika/{serialNumber}/raw_command/set
02001234567890ab00020200102f0000
```

---

## Development & Versioning

- `config.yaml` version is the single source of truth — `package.json` has no version field
- Bump `version` in `config.yaml`, commit to `dev`, open PR to `master`
- Merging to `master` automatically creates the GitHub release and triggers Docker builds for `amd64` and `aarch64`

---

## License

Based on the original [ambientika-local-control](https://github.com/sragas/ambientika-local-control) project by sragas.

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
