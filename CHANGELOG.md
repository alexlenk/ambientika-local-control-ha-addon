# Changelog

All notable changes to this project will be documented in this file.

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