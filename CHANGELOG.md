# Changelog

All notable changes to this project will be documented in this file.

### Version 1.1.17 - Persist zone and house ID across restarts

#### Fixed
- **Zone / house ID sensor**: zone and house ID were stored in memory only and lost on every restart. Slave devices (which have their own IP separate from their paired master) would never recover their zone or house ID after restart since only master devices emit UDP broadcasts. Both values are now persisted to SQLite and restored automatically when a device reconnects. Masters recover from the next UDP broadcast and write to DB; slaves recover from the DB on reconnect. A one-time `setup/set` MQTT command is still needed for slaves whose zone was never set.

#### Changed
- **Release notes**: GitHub release now contains only the section for the released version instead of the full changelog history, so Home Assistant shows the correct update description.

---

### Version 1.1.16 - Fix setup packet format: houseId at correct byte offset

#### Fixed
- **Device setup**: the proxy-injected setup packet had an extra `0x00` padding byte at position 11, causing the device to read houseId shifted by one byte. Devices configured via the MQTT `setup/set` command would store a wrong house ID and broadcast it in UDP. The packet is now 15 bytes matching the cloud format (`02 00 <MAC 6b> 00 <role> <zone> <houseId 4b LE>`). Devices that received a setup command before this fix need to have the setup command resent to correct their stored house ID.

---

### Version 1.1.15 - House ID populated from UDP broadcasts

#### Fixed
- **House ID sensor**: house ID was never populated because it relied only on cloud setup packets (which the cloud does not send on every connection). House ID is now read from the UDP broadcast packets that master devices send every ~30 seconds (bytes 3–6, uint32 big-endian). The value is cached for all devices sharing the same IP (master + slaves) and published to Home Assistant immediately on the next status update.

---

### Version 1.1.14 - Fix zone sensor for slave devices after cloud role change

#### Fixed
- **Zone sensor**: when the cloud sends a setup packet (role/zone change) to a device via the inbound back-channel, the zone was routed to the device but never emitted as a `DEVICE_SETUP_UPDATE` event. Slave devices (which don't broadcast UDP) would therefore show "unknown" for their zone sensor in HA after a master/slave swap. The local socket service now emits `deviceSetupUpdate` for all 15/16-byte setup packets routed from the cloud.

---

### Version 1.1.13 - Fix cloud sync: forward real device packets

#### Fixed
- **Cloud sync**: removed debug packet substitution — device firmware and status bytes are now forwarded to the cloud unchanged. The root cause of devices not appearing online was a local IP binding (`185.214.203.87`) on the HA host that caused the proxy to connect to itself instead of the real cloud.

---

### Version 1.1.12 - Debug: substitute cloud packets with known-working templates

#### Changed
- **Cloud sync debug**: firmware and status packets forwarded to the cloud are now replaced with known-working byte templates (from bring-online.ts) with the real device MAC injected at runtime. Tests whether the proxy connection itself is the issue rather than subtle differences in the forwarded bytes.
- Both incoming and outgoing hex are logged at silly level for each packet.

---

### Version 1.1.11 - Fix orphaned cloud socket, 15-byte setup, cloud debug logging

#### Fixed
- **Cloud sync**: when a device reconnected, the old cloud socket was left open but removed from the active map. When it eventually closed, its `close` handler deleted the *new* socket entry for the same IP — silently breaking cloud forwarding until the next add-on restart. Fixed by guarding the close handler with an identity check (`clients.get(ip) === thisSocket`).
- **Cloud sync**: cloud-initiated setup packets (15 bytes) were silently dropped because the parser only accepted 16-byte proxy-injected setups. Both lengths are now accepted; `houseId` is read from offset 11 for 15-byte and offset 12 for 16-byte packets.

#### Added
- **Cloud sync debug logging** (silly level): every raw packet forwarded to the cloud is now hex-logged before write and confirmed after kernel flush, making it possible to verify exactly what the proxy is sending.
- **Debug REST endpoint** `POST /cloud/send-setup/:serialNumber` — injects a 16-byte setup packet into the cloud relay for a device.

---

### Version 1.1.3 - Fix cloud sync connection loop

#### Fixed
- **Cloud sync**: when `cloud_sync_enabled=true`, the cloud server was connecting back to the local TCP port, triggering `LOCAL_SOCKET_CONNECTED` for the cloud host IP. This caused `RemoteSocketService` to open additional outbound connections to the cloud for each inbound cloud connection, creating a runaway feedback loop of hundreds of orphaned sockets within seconds of startup. The fix ignores `LOCAL_SOCKET_CONNECTED` events originating from the configured cloud host.

---

### Version 1.1.1 - NIGHT Fan Speed

#### Fixed
- **Protocol**: Added `NIGHT = 3` to `FanSpeed` enum based on the official Ambientika Smart APP manual (P06506000). Value `3` is the night-time speed set automatically by SMART and NIGHT operating modes — previously triggered a warning and fell back to MEDIUM.

#### Changed
- `night` is now exposed as a selectable fan mode in Home Assistant and accepted as a valid MQTT fan speed command.

---

### Version 1.1.0 - Full Test Suite & CI/CD

#### Added
- **Test suite**: 225 tests across all services (Vitest + `@vitest/coverage-v8`), covering 93% of the codebase.
- **Automated release workflow**: merging a PR to `master` with a bumped `config.yaml` version now automatically creates the GitHub release and triggers Docker image builds for `amd64` and `aarch64`.
- **Protocol reference**: comprehensive JSDoc on all enums and a Protocol Reference section in the README documenting the binary TCP protocol, byte layouts, and all known values — cross-referenced against the official Ambientika manual.
- Official Ambientika icon for the Home Assistant add-on store.

#### Fixed
- **TypeScript build**: test files were being compiled by `tsc` during `npm run build`, causing strict-mode errors in Docker. Fixed by adding `exclude` to `tsconfig.json`.
- **Node.js deprecation warnings** in GitHub Actions: opted into Node.js 24 for all actions runners via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`.
- **CI arm64 build**: switched from QEMU emulation to native `ubuntu-24.04-arm` runner — faster and more reliable.

---

### Version 1.0.41 - TypeScript Build Fix

#### Fixed
- **Build Error**: Fixed TypeScript compilation errors for Error.code property access
- Proper type casting for socket error codes in error handlers
- Resolved Docker build failures caused by TypeScript strict typing

### Version 1.0.40 - Critical Socket Error Handling Fix

#### Fixed
- **CRITICAL**: Fixed overly aggressive socket error handling that was causing devices to go offline
- Socket connections are now only terminated for fatal errors (ECONNRESET, EPIPE, ENOTCONN, ECONNREFUSED)
- Transient socket errors no longer disconnect working devices
- Improved connection stability for devices experiencing temporary network issues

### Version 1.0.39 - Improved Warning Logs

#### Enhanced
- **Warning Visibility**: Fan speed warning logs now include device serial number for better troubleshooting
- Invalid fan speed warnings now show specific device ID instead of generic message
- Improved debugging capabilities for devices sending unexpected fan speed values

#### Fixed
- Enhanced error message clarity for invalid fan speed values from devices
- Better device identification in warning logs for tracking problematic devices

### Version 1.0.35 - Command Queue Implementation

#### Fixed
- Fixed issue where only the last command was processed when sending multiple commands rapidly
- Replaced single command processing with command queue system per device
- Commands are now queued and processed sequentially instead of being cancelled by newer commands
- Added detailed logging for command queue status and processing

### Version 1.0.34 - Remove House ID Feature

#### Removed
- Removed house ID sensor functionality due to network routing complexity
- Removed DeviceMetadataService and house ID correlation logic
- Removed house ID from MQTT topics and Home Assistant auto-discovery
- Simplified UDP broadcast processing by removing house ID extraction

### Version 1.0.33 - House ID Publishing Debug

#### Fixed
- Added detailed logging for house ID sensor MQTT publishing
- Debug logs show house ID correlation status and MQTT topic publishing
- Improved troubleshooting for house ID sensors showing 0 in Home Assistant UI

### Version 1.0.32 - Multi-House Network Support

#### Added
- Intelligent correlation system for house IDs in multi-apartment WiFi networks
- Track UDP house IDs by IP:port to handle different houses on same network
- Automatic correlation of TCP device connections with UDP house ID broadcasts
- Support for multiple house networks sharing the same WiFi infrastructure

#### Fixed
- House ID sensor now works correctly in shared network environments
- TCP devices now properly inherit house IDs from UDP broadcasts of same IP address
- Device metadata service correlates devices within 30-second UDP broadcast window
- Automatic cleanup of stale UDP house ID tracking data

### Version 1.0.31 - House ID Endianness Fix

#### Fixed
- House ID sensor now uses correct big-endian (uint32BE) byte order instead of little-endian
- House ID values like `00 00 2f 10` now correctly display as 12048 instead of 271515648
- Added getUInt32BEFromBufferSlice method for proper UDP broadcast house ID extraction

### Version 1.0.30 - House ID Sensor Bug Fix

#### Fixed
- House ID sensor now correctly displays actual house ID (e.g., 12048) instead of 0
- Extract house ID directly from UDP broadcast buffer (bytes 3-6 as uint32LE)
- Added missing HOUSE_ID_TOPIC environment variable for MQTT publishing
- Fixed changelog formatting with proper header hierarchy (### for versions, #### for subsections)

### Version 1.0.29 - House ID Sensor Support

#### Added
- House ID sensor for all devices showing the network identification
- Device metadata tracking from both UDP broadcasts and device setup messages
- Automatic house ID inference for devices that don't broadcast directly
- Support for house ID extraction from both master and slave devices

#### Enhanced
- Device broadcast status model now includes house ID data
- MQTT service publishes house ID sensor data to Home Assistant
- Home Assistant auto-discovery creates house ID sensors with home icon

### Version 1.0.26 - Raw Command Testing

#### Added
- Raw command MQTT topic for testing device protocols (`ambientika/%serialNumber/raw_command/set`)
- Hex string to buffer conversion with validation
- Detailed logging and analysis of raw commands sent to devices
- Byte-by-byte command analysis for debugging device communication

#### Changed
- Enhanced MQTT service with raw command testing capabilities for protocol discovery

### Version 1.0.25 - Device Role Accuracy

#### Added
- Remove artificial MASTER fallback for undefined device roles to show true device state
- Remove device-specific debug code

#### Changed
- Device role parsing now shows undefined when device role is unmapped instead of defaulting to MASTER

### Version 1.0.24 - Device Setup Protocol

#### Added
- MQTT-based device setup functionality to convert devices between MASTER/SLAVE roles
- Device setup command protocol with 15-byte buffer generation
- Event system integration for device setup commands
- TCP socket communication for device role assignment

#### Fixed
- RangeError in device setup by changing writeInt8 to writeUInt8 for serial number bytes
- Device role constraint errors with proper undefined handling

### Version 1.0.23 - Database Constraints Fix

#### Fixed
- SQLITE_CONSTRAINT errors for undefined device roles
- Database constraint handling for device role field

### Version 1.0.22 - Changelog Format

#### Fixed
- **Changelog Format**: Removed incorrect dates from changelog entries
- Simplified format for better readability and accuracy

### Version 1.0.21 - Changelog Visibility

#### Fixed
- **Changelog Visibility**: Added CHANGELOG.md to add-on directory for Home Assistant UI
- Ensures changelog is properly displayed in Home Assistant add-on store

### Version 1.0.20 - Preset Mode Sensor

#### Added
- **New Sensor**: Dedicated preset mode sensor for Home Assistant
  - Creates separate `sensor.<device_serial>_preset_mode` entity for each device
  - Shows current operating mode (SMART, INTAKE, AUTO, AWAY_HOME, etc.)
  - Uses `mdi:tune-variant` icon for clear visual identification
  - Automatically discovered when devices connect

#### Changed
- Enhanced Home Assistant integration with additional sensor entities
- Improved device visibility for dashboards and automations

### Version 1.0.19 - Critical Connection Routing Fix

#### Fixed
- **CRITICAL**: Fixed socket connection routing bug causing devices to become permanently unresponsive
  - Commands now route to correct device based on serial number mapping instead of IP address only
  - Prevents MASTER socket from being overwritten when SLAVE device connects from same IP
  - Resolves issue where devices would stop responding after SLAVE connection
- **UI**: Removed invalid "auto" fan speed option from Home Assistant interface
  - Added validation to only accept LOW, MEDIUM, HIGH fan speeds
  - Fixed AUTO->MEDIUM mapping that was creating confusion
  - Added explicit `fan_modes` configuration to prevent non-existent options

#### Changed
- Improved command routing with IP:port connection keys instead of IP-only mapping
- Enhanced error handling for invalid fan speed commands
- Better device connection logging with connection key details

### Version 1.0.18 - Build Error Fix

#### Fixed
- Fixed TypeScript build errors by reverting `trace` back to `silly` log level
- Winston Logger compatibility: Updated config schema to match Winston levels (silly|debug|info|warn|error)

#### Added
- Deep command analysis for debugging command rejections
- Enhanced UDP broadcast logging with device roles and coordination details
- Improved command transmission debugging with hex buffer output

#### Changed
- Command timeout reduced to 5 seconds for faster failure detection
- Removed rate limiting as real issue was socket routing bug

### Version 1.0.17 - Real Device State

#### Fixed
- **CRITICAL**: Removed fake UI state overrides that masked real device command failures
- Fixed command persistence logic to show actual device state instead of assumed success
- Enhanced logging to detect when devices reject operating mode commands

#### Added
- Comprehensive buffer analysis showing byte-by-byte breakdown for debugging
- Device role information included in status logging
- UDP coordination patterns visible at silly log level

### Version 1.0.16 - Architecture Badges

#### Fixed
- Fixed Home Assistant add-on README architecture badges showing wrong architectures
- Updated architecture badges to show only aarch64 and amd64
- Corrected add-on description text

#### Changed
- Enhanced log level configuration mapping from HA addon settings to application
- Improved logging levels and optimized log output

### Version 1.0.15 - Deep Debugging

#### Added
- Initial deep debugging capabilities for device command analysis
- Command buffer hex output for protocol debugging
- Enhanced device status logging with operating modes and fan speeds

#### Fixed
- Log level configuration not being passed from Home Assistant add-on settings
- Various logging improvements for better debugging visibility

### Future Releases

#### Planned
- Additional protocol analysis features
- Enhanced error recovery mechanisms
- Performance optimizations for large deployments

---

## Installation & Upgrade Notes

### v1.0.22 (Current)
- **Documentation**: Corrected changelog format and removed incorrect dates

### v1.0.21
- **Visibility**: Changelog now properly displayed in Home Assistant add-on store

### v1.0.20
- **New Feature**: Individual preset mode sensors for enhanced device monitoring

### v1.0.19 (Critical Update)
- **Essential**: Critical for multi-device setups where MASTER and SLAVE devices connect from the same network
- **Breaking**: Invalid fan speed commands will now be rejected instead of mapped to MEDIUM
- **UI**: Home Assistant fan controls will only show valid options (low/medium/high)

### v1.0.18
- **Breaking**: Log level configuration changed from custom levels to Winston standard levels
- Update your add-on configuration if using custom log levels

### v1.0.17
- **Breaking**: UI will now show actual device state instead of optimistic updates
- Commands that fail will be visible in the UI (this is correct behavior)

---

## Support

For issues, feature requests, or contributions, please visit:
- GitHub Issues: https://github.com/alexlenk/ambientika-local-control-ha-addon/issues
- Original Protocol: https://github.com/sragas/ambientika-local-control

## Credits

Based on the excellent work by [sragas](https://github.com/sragas) in the original [ambientika-local-control](https://github.com/sragas/ambientika-local-control) project.