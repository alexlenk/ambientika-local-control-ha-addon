# Project Context

## Working Conventions
- Always work on a `dev` branch, never commit directly to `master`
- Commit after each logical unit (one bug fix, one test file, one config change — not batches)
- Commit messages explain *why*, not just *what*
- Push to dev branch regularly

## Known Bugs (to fix before/with tests)

### Bug 1 — CRITICAL: Weather temperature always sent as 0
`src/services/device-command-service.ts:299`
`weatherUpdateDto.toString()` → `"[object Object]"` → digits stripped → `""` → padded `"0000"` → 0°C sent to every device.
Fix: `weatherUpdateDto.temperature.toString().replace(/\D/g, '')`

### Bug 2 — HIGH: Inverted MQTT unsubscribe condition (subscription leak)
`src/services/mqtt.service.ts:378`
`if (!this.deviceTopicSubscriptions.has(serialNumber))` — inverted. Subscriptions accumulate on every reconnect.
Fix: remove the `!`

### Bug 3 — HIGH: Unguarded JSON.parse crashes MQTT weather handler
`src/services/mqtt.service.ts:477`
No try-catch around `JSON.parse`. Every other handler in the file is guarded.
Fix: wrap in try/catch with `this.log.error(...)`

### Bug 4 — MEDIUM: writeInt16LE instead of writeUInt8 for serial number bytes
`src/services/device-command-service.ts:146, 259, 289`
Three methods use `writeInt16LE` for 1-byte octets. `getDeviceSetupBufferData:342` correctly uses `writeUInt8`.
Fix: change all three to `writeUInt8`

## Test Strategy

**Framework:** Vitest + supertest. Starting from 0% coverage. Target: ≥80% lines/functions/branches.
**Dev deps to add:** `vitest`, `@vitest/coverage-v8`, `supertest`, `@types/supertest`
**New scripts:** `test`, `test:watch`, `test:coverage`
**Config:** `vitest.config.ts` at project root

**13 test files across 3 layers:**

Layer 1 — Unit (pure, no I/O):
- `src/__tests__/unit/device.mapper.test.ts` — pure buffer parsing, easiest first
- `src/__tests__/unit/event.service.test.ts` — all 13 emit methods
- `src/__tests__/unit/device-command-buffers.test.ts` — buffer generation + all 4 bug regression tests (private methods via `(service as any).method()`)

Layer 2 — Service (mocked I/O):
- `src/__tests__/service/device-storage.service.test.ts` — `vi.mock('sqlite3')`
- `src/__tests__/service/device-command.service.test.ts` — `vi.useFakeTimers()` for 5s timeout
- `src/__tests__/service/rest.service.test.ts` — supertest HTTP assertions
- `src/__tests__/service/scheduler.service.test.ts` — stale device detection
- `src/__tests__/service/mqtt.service.test.ts` — `vi.mock('mqtt')`, Bug 2 & 3 regressions
- `src/__tests__/service/ha-auto-discovery.service.test.ts` — discovery payload structure

Layer 3 — Integration (net/dgram mocked):
- `src/__tests__/integration/local-socket.service.test.ts` — `vi.mock('net')`
- `src/__tests__/integration/remote-socket.service.test.ts` — `vi.mock('net')`
- `src/__tests__/integration/udp-broadcast.service.test.ts` — `vi.mock('dgram')`

All tests mock sqlite3/net/dgram/mqtt — run on plain x86, no native compilation, ~1 min CI.

## CI/CD Acceleration (arm64 sqlite3 slow under QEMU)

**Root cause:** Production Dockerfile stage re-runs `npm ci --only=production` independently,
recompiling sqlite3 a second time under QEMU emulation (10–20× slower than native).

**Fix 1 — Dockerfile: compile once, prune, copy**
After `npm run build`, run `npm prune --omit=dev`. In production stage:
`COPY --from=build /app/node_modules ./node_modules` instead of `npm ci`.
Removes build tools (`python3 make g++`) from final image too.

**Fix 2 — Native ARM64 GitHub runner**
Use `ubuntu-24.04-arm` for the aarch64 matrix entry. 5–10× faster, no QEMU needed.

**Fix 3 — Separate fast test CI job**
New `test` job on `ubuntu-latest` (x86, no QEMU). Docker builds gate on `needs: test`.
Tests complete in ~1 minute since all I/O is mocked.
