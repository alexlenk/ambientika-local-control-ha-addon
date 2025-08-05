# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.19] - 2025-08-05

### Fixed
- **CRITICAL**: Fixed socket connection routing bug causing devices to become permanently unresponsive
  - Commands now route to correct device based on serial number mapping instead of IP address only
  - Prevents MASTER socket from being overwritten when SLAVE device connects from same IP
  - Resolves issue where devices would stop responding after SLAVE connection
- **UI**: Removed invalid "auto" fan speed option from Home Assistant interface
  - Added validation to only accept LOW, MEDIUM, HIGH fan speeds
  - Fixed AUTO->MEDIUM mapping that was creating confusion
  - Added explicit `fan_modes` configuration to prevent non-existent options

### Changed
- Improved command routing with IP:port connection keys instead of IP-only mapping
- Enhanced error handling for invalid fan speed commands
- Better device connection logging with connection key details

## [1.0.18] - 2025-08-05

### Fixed
- Fixed TypeScript build errors by reverting `trace` back to `silly` log level
- Winston Logger compatibility: Updated config schema to match Winston levels (silly|debug|info|warn|error)

### Added
- Deep command analysis for debugging command rejections
- Enhanced UDP broadcast logging with device roles and coordination details
- Improved command transmission debugging with hex buffer output

### Changed
- Command timeout reduced to 5 seconds for faster failure detection
- Removed rate limiting as real issue was socket routing bug

## [1.0.17] - 2025-08-05

### Fixed
- **CRITICAL**: Removed fake UI state overrides that masked real device command failures
- Fixed command persistence logic to show actual device state instead of assumed success
- Enhanced logging to detect when devices reject operating mode commands

### Added
- Comprehensive buffer analysis showing byte-by-byte breakdown for debugging
- Device role information included in status logging
- UDP coordination patterns visible at silly log level

## [1.0.16] - 2025-08-05

### Fixed
- Fixed Home Assistant add-on README architecture badges showing wrong architectures
- Updated architecture badges to show only aarch64 and amd64
- Corrected add-on description text

### Changed
- Enhanced log level configuration mapping from HA addon settings to application
- Improved logging levels and optimized log output

## [1.0.15] - 2025-08-05

### Added
- Initial deep debugging capabilities for device command analysis
- Command buffer hex output for protocol debugging
- Enhanced device status logging with operating modes and fan speeds

### Fixed
- Log level configuration not being passed from Home Assistant add-on settings
- Various logging improvements for better debugging visibility

## [1.0.21] - 2025-08-05

### Fixed
- **Changelog Visibility**: Added CHANGELOG.md to add-on directory for Home Assistant UI
- Ensures changelog is properly displayed in Home Assistant add-on store

## [1.0.20] - 2025-08-05

### Added
- **New Sensor**: Dedicated preset mode sensor for Home Assistant
  - Creates separate `sensor.<device_serial>_preset_mode` entity for each device
  - Shows current operating mode (SMART, INTAKE, AUTO, AWAY_HOME, etc.)
  - Uses `mdi:tune-variant` icon for clear visual identification
  - Automatically discovered when devices connect

### Changed
- Enhanced Home Assistant integration with additional sensor entities
- Improved device visibility for dashboards and automations

## [Unreleased]

### Planned
- Additional protocol analysis features
- Enhanced error recovery mechanisms
- Performance optimizations for large deployments

---

## Installation & Upgrade Notes

### v1.0.19 (Current)
- **Critical Update**: Essential for multi-device setups where MASTER and SLAVE devices connect from the same network
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