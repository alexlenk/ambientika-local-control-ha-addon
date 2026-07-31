# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

```
ambientika-local-control/   ← the add-on (Node.js/TypeScript)
  src/
    index.ts                ← entry point, wires all services together
    services/               ← all business logic
    models/                 ← Device model + all enums
    models/enum/            ← protocol enums (see below)
    dto/                    ← plain data-transfer objects (excluded from coverage)
    scripts/                ← one-off BLE provisioning tool (excluded from coverage)
  src/__tests__/            ← Vitest tests (excluded from tsc build)
  Dockerfile                ← multi-stage: build+prune → production COPY
  config.yaml               ← HA add-on manifest; version field is the single source of truth
.github/workflows/
  build.yml                 ← test → docker build/push (triggers on push/PR/tag)
  release.yml               ← auto-release on master merge when config.yaml changes
```

## Common commands

All commands run from `ambientika-local-control/`:

```bash
npm test                        # run all tests once
npm run test:watch              # watch mode
npm run test:coverage           # run with coverage report (must meet ≥80%)
npm run build                   # tsc compile to dist/ (test files excluded)

# Run a single test file
npx vitest run src/__tests__/service/mqtt.service.test.ts

# Run tests matching a description
npx vitest run -t "fan speed"
```

Local arm64 image test (only needed when touching Dockerfile or package.json):
```bash
finch build --platform linux/arm64 -t ambientika-test ./ambientika-local-control/
finch run --rm ambientika-test node -e "const {DatabaseSync} = require('node:sqlite'); new DatabaseSync(':memory:'); console.log('ok')"
```

## Architecture

All services are instantiated once in `index.ts` and communicate exclusively through `EventService` (an `EventEmitter` subclass). No service holds a direct reference to another service except `DeviceStorageService` and `EventService`, which are injected into most services.

### Data flow

```
Ambientika devices (TCP port 11000)
    ↓
LocalSocketService          — receives 21-byte status packets from devices
    ↓ DEVICE_STATUS_UPDATE_RECEIVED
DeviceStorageService        — persists device state to SQLite (devices.db)
DeviceCommandService        — manages per-device command queue with 5s timeout
MqttService                 — publishes state to MQTT, subscribes to HA commands
    ↓ (HA sends command)
MqttService → DEVICE_OPERATING_MODE_UPDATE
    ↓
DeviceCommandService        — builds 13-byte command buffer, sends via LOCAL_SOCKET_DATA_UPDATE
    ↓
LocalSocketService          — writes buffer to the device TCP socket

UDPBroadcastService         — listens on UDP ports 45000+ for broadcast status packets
RemoteSocketService         — optional cloud relay (when cloud_sync_enabled=true)
SchedulerService            — marks stale devices offline every minute
```

### Key event names (AppEvents enum)

| Event | Direction | Meaning |
|-------|-----------|---------|
| `DEVICE_STATUS_UPDATE_RECEIVED` | LocalSocket → all | Device sent a 21-byte status packet |
| `LOCAL_SOCKET_DATA_UPDATE` | Command/MQTT → LocalSocket | Write bytes to device socket |
| `DEVICE_OPERATING_MODE_UPDATE` | MQTT → DeviceCommand | HA sent a command |
| `DEVICE_OFFLINE` | Scheduler → MQTT/Storage | Device went stale |
| `DEVICE_BROADCAST_STATUS_RECEIVED` | UDP → MQTT | UDP fan status broadcast |
| `REMOTE_SOCKET_CONNECTED/DISCONNECTED` | Remote → MQTT | Cloud relay status |

### Protocol

Devices speak a binary TCP protocol. Key packet sizes:
- **21 bytes** — device status (parsed by `DeviceMapper.deviceFromSocketBuffer`)
- **18 bytes** — device info / firmware versions
- **16 bytes** — device setup: `02 00 <MAC 6b> 00 <role> <zone> 00 <houseId 4b LE>` (bytes 8 and 11 are fixed `00`)
- **13 bytes** — operating mode command sent to device
- **9 bytes** — filter reset command

Byte layout and enum values are documented in `src/models/enum/` JSDoc and in the README Protocol Reference section. All enum values were reverse-engineered and cross-referenced against the official Ambientika Smart APP manual (P06506000, EN October 2023).

### Protocol enums

- `OperatingMode` — 12 modes (0=SMART … 11=OFF). SMART auto-triggers MASTER_SLAVE_FLOW free-cooling.
- `FanSpeed` — 4 speeds: LOW=0, MEDIUM=1, HIGH=2, NIGHT=3 (night-time speed, set automatically).
- `FanMode` — MANUAL vs AUTO fan control mode.
- `DeviceRole` — MASTER=0, SLAVE_EQUAL_MASTER=1, SLAVE_OPPOSITE_MASTER=2. **Commands always go to MASTER only.**
- `HumidityLevel` — DRY=0 (40%), NORMAL=1 (60%), MOIST=2 (75%).
- `AirQuality` — 5 levels: VERY_GOOD, GOOD, MEDIUM, POOR, BAD (byte 13 of status packet).
- `FilterStatus` — GOOD or CLOGGED (byte 14 of status packet).
- `LightSensitivity` — NOT_AVAILABLE, OFF, LOW, MEDIUM (byte 19 of status packet).

### REST API (RestService)

`RestService` exposes an Express HTTP server alongside MQTT. Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/device/status/:serialNumber` | Returns current `DeviceDto` for a device |
| `POST` | `/device/operating-mode/:serialNumber` | Sends an `OperatingModeDto` command |
| `POST` | `/device/reset-filter/:serialNumber` | Sends a 9-byte filter reset command |
| `POST` | `/device/weather-update` | Pushes external weather data (`WeatherUpdateDto`) |

### HAAutoDiscoveryService

Publishes Home Assistant MQTT auto-discovery messages so devices appear automatically as `climate` entities in HA. It maps the 12 `OperatingMode` values to HA preset modes (AUTO, NIGHT, AWAY, BOOST, SMART, HOLIDAY, MANUAL, SLEEP, INTENSIVE, GEOTHERMAL, FIREPLACE, TURBO). Fires on initial MQTT connect and whenever a new device is first seen.

## Working conventions

- Always work on the `dev` branch; never commit directly to `master`.
- Commit after each logical unit; commit messages explain *why*, not just *what*.
- `config.yaml` version is the single source of truth — `package.json` has no version field intentionally.
- **Any user-facing behavior change or feature add gets a version bump and release as part of the same piece of work — proactively, without waiting to be asked.** A merged PR that changes runtime behavior isn't done until `config.yaml`'s version is bumped and `CHANGELOG.md` has an entry for it; otherwise the fix sits on `master` but never reaches a released Docker image. Pure internal changes with no user-visible effect (test-only changes, CI tweaks, refactors) don't need a version bump on their own — bundle them into the next behavior-changing release instead.

## Release process

1. Bump `version` in `ambientika-local-control/config.yaml`
2. **Always update `CHANGELOG.md`** (repo root) with a `### Version X.Y.Z - <summary>` entry for the release — `release.yml` extracts this section verbatim for the GitHub Release notes, so a missing entry means an empty release description. Never skip this step, even for small fixes.
3. Commit to `dev` branch, push, open PR
4. Merge PR to `master`
5. `release.yml` fires automatically: reads version, creates tag `vX.Y.Z`, creates GitHub Release
6. `build.yml` triggers on the new tag: runs tests, builds and pushes Docker images for `amd64` + `aarch64`

Note: `ambientika-local-control/CHANGELOG.md` is a second, separate changelog file inside the add-on directory — this is the one Home Assistant Supervisor actually displays in the add-on's "Changelog" tab in the UI. It is easy to forget since only the root `CHANGELOG.md` feeds the GitHub Release. Keep both in sync, or check whether a symlink (`ambientika-local-control/CHANGELOG.md` → `../CHANGELOG.md`) would be safer before assuming manual sync is enough.

## Test infrastructure

**Framework:** Vitest 4 + `@vitest/coverage-v8`. Current coverage: ~94%.

Key mocking patterns used across the test suite:
- `device-storage.service.test.ts` uses **real** `node:sqlite` `DatabaseSync` instances
  (`DEVICE_DB=':memory:'`) rather than mocking — it's a Node built-in with no native
  compilation step, so there's nothing to avoid; this also exercises real SQL.
- `vi.mock('node:net')` / `vi.mock('node:dgram')` — socket services
- `vi.mock('mqtt')` with captured `mqttEventHandlers` map — MQTT client events
- `vi.useFakeTimers()` — 5-second command timeout in `device-command.service.test.ts`
- Private methods accessed via `(service as any).methodName()`

Coverage excludes: `src/dto/**`, `src/scripts/**`, `src/**/*.interface.ts`, `src/services/logger.service.ts`, `src/models/device-status.model.ts`.

## CI/CD

- **Test job** on `ubuntu-latest` (x86, no QEMU) gates all Docker builds via `needs: test`
- **arm64 Docker build** uses native `ubuntu-24.04-arm` runner — no QEMU
- **Dockerfile** has no native build toolchain — device storage uses `node:sqlite` (built
  into Node), not the `sqlite3` npm package, so there's nothing to compile
