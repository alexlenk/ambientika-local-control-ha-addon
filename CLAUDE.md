# Project Context

## Working Conventions
- Always work on the `dev` branch, never commit directly to `master`
- Commit after each logical unit (one bug fix, one test file, one config change — not batches)
- Commit messages explain *why*, not just *what*
- Push to dev branch regularly

## Pre-Push Checklist

Run these steps in order before every push:

1. **Tests** — all 185 tests must pass:
   ```bash
   cd ambientika-local-control && npm test
   ```

2. **Coverage** — must meet ≥80% lines/functions/branches:
   ```bash
   npm run test:coverage
   ```

3. **TypeScript build** — must compile clean (test files are excluded via `tsconfig.json`):
   ```bash
   npm run build
   ```

4. **arm64 image build** — validates Dockerfile and native sqlite3 compilation (use Finch):
   ```bash
   finch build --platform linux/arm64 -t ambientika-local:arm64-test ./ambientika-local-control/
   finch run --rm ambientika-local:arm64-test node -e "const s = require('sqlite3'); console.log('sqlite3 ok', s.VERSION)"
   ```
   Steps 4 is mandatory when touching `Dockerfile`, `package.json`, or any native dependency.

## Test Infrastructure

**Framework:** Vitest + `@vitest/coverage-v8`. Config: `ambientika-local-control/vitest.config.ts`.
**Scripts:** `npm test`, `npm run test:watch`, `npm run test:coverage`
**Coverage thresholds:** ≥80% lines / functions / branches
**Excluded from coverage:** `src/dto/**`, `src/scripts/**`, `src/**/*.interface.ts`, `src/services/logger.service.ts`

12 test files across 3 layers (all I/O mocked — no native compilation needed):

| Layer | Files |
|-------|-------|
| Unit | `device.mapper`, `event.service`, `device-command-buffers` |
| Service | `device-storage`, `device-command`, `rest`, `scheduler`, `mqtt`, `ha-auto-discovery` |
| Integration | `local-socket`, `remote-socket`, `udp-broadcast` |

Key mocking patterns:
- `vi.mock('sqlite3')` — avoids native compilation in tests
- `vi.mock('node:net')` / `vi.mock('node:dgram')` — socket services
- `vi.mock('mqtt')` with captured `mqttEventHandlers` map — MQTT service
- `vi.useFakeTimers()` — command timeout tests in device-command.service.test.ts
- Private methods tested via `(service as any).methodName()`

## CI/CD

- **Test job** on `ubuntu-latest` (x86, no QEMU) gates all Docker builds via `needs: test`
- **arm64 Docker build** uses native `ubuntu-24.04-arm` runner — no QEMU, sqlite3 compiles fast
- **Dockerfile** compiles sqlite3 once in the `build` stage, prunes devDeps, then `COPY --from=build` into production — no second compilation
