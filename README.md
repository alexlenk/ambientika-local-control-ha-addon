# Ambientika Local Control - Home Assistant Add-on

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]

A Home Assistant add-on for local control of Ambientika air purification devices with MQTT integration.

## Attribution

This Home Assistant add-on is based on [ambientika-local-control](https://github.com/sragas/ambientika-local-control) by [sragas](https://github.com/sragas).

Original project provides local control for Ambientika ventilation devices. This repository packages it as a Home Assistant add-on with additional features for seamless integration.

## Features

- 🏠 **Home Assistant Add-on packaging** - Easy installation through Home Assistant
- 📡 **MQTT integration** - Full MQTT support for Home Assistant integration
- 🔍 **Auto-discovery** - Automatic device discovery in Home Assistant
- 🐳 **Docker containerization** - Optimized Docker build with caching
- 🛠️ **Command persistence** - Reliable operating mode changes that persist until applied
- 📊 **Multiple device support** - Control multiple Ambientika devices
- 🌐 **Local control** - No cloud dependency required

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the "Ambientika Local Control" add-on
3. Configure your MQTT settings
4. Set up network configuration (see below)
5. Start the add-on

## Device Configuration

This add-on supports two methods to redirect device traffic locally. Choose the method that works best for your setup:

## Method 1: Router Static Route (Recommended - More Robust)

This method redirects all Ambientika cloud traffic to your Home Assistant via your router.

### Router Configuration
Add a static route in your router:
- **Destination:** `185.214.203.87/32`
- **Gateway:** `192.168.178.30` (replace with your HA IP)

### Home Assistant IP Alias
Add to your `configuration.yaml`:
```yaml
shell_command:
  add_ip_alias: 'ip addr add 185.214.203.87/32 dev end0 || true'
```

Add this automation:
```yaml
automation:
  - alias: "Add IP Alias for Local Control"
    trigger:
      - platform: homeassistant
        event: start
    action:
      - delay: '00:00:30'
      - service: shell_command.add_ip_alias
    mode: single
```

Restart Home Assistant after adding this configuration.

## Method 2: BLE Device Provisioning

This method reconfigures devices to connect directly to your Home Assistant IP address.

### Prerequisites
Download a BLE app:
- **iOS:** "LightBlue Explorer" 
- **Android:** "nRF Connect for Mobile"

### Provisioning Steps
1. Put your device in pairing mode and scan for BLE devices
2. Connect to your device (appears as `VMC_ABCDEFABCDEF`)
3. Navigate to the WiFi service:
   - Service UUID: `0000a002-*`
   - Characteristic UUID: `0000c302-*`
4. Write these three values to the characteristic:
   - `H_<YOUR_HA_IP>:11000` (replace with your Home Assistant IP address)
   - `S_<YOUR_WIFI_SSID>` (your WiFi network name)
   - `P_<YOUR_WIFI_PASSWORD>` (your WiFi password)
5. The device will restart and connect to your local setup

**Note:** BLE provisioning may lose configuration over time and require re-provisioning. Static route method is more reliable for long-term use.

## Important Warnings

**⚠️ Compatibility:** The official Ambientika app and Home Assistant Integration will not work when either method is active, as they require direct cloud connectivity.

**⚠️ Network Impact:** Router static routes affect all devices on your network trying to reach the Ambientika cloud service.

## Configuration

Configure the add-on through the Home Assistant UI with your MQTT broker settings and device network information.

## Raw Command Programming

For advanced device programming and protocol testing, you can send raw hex commands directly to devices via MQTT.

### Raw Command Topic
```
ambientika/{serialNumber}/raw_command/set
```

### Usage Example
To send a raw command to device `1234567890ab`, publish a hex string to:
```
Topic: ambientika/1234567890ab/raw_command/set
Payload: 02001234567890ab01010901
```

### Command Format
- Commands should be sent as hex strings (without spaces or `0x` prefix)
- The system will convert hex strings to binary before sending to devices
- Invalid hex characters will be rejected with error logging
- Commands are processed through the same queue system as regular device commands

### Debugging
Raw commands include detailed byte-by-byte analysis in the logs when sent, showing:
- Buffer length and hex representation
- Individual byte breakdown
- Possible serial number extraction
- Command structure analysis

This feature is primarily intended for protocol development and advanced device configuration.

## Supported Devices

This add-on works with Ambientika air purification/ventilation devices that support local network control.

## Development & Versioning

### Version Management
- **Home Assistant version** is controlled by `config.yaml` only
- **`package.json`** intentionally has no version field to prevent Docker cache invalidation
- **Git tags** use semantic versioning (e.g., `v1.0.2`)

### Creating New Versions
1. Update version in `config.yaml` (e.g., `"1.0.3"`)
2. Create and push git tag: `git tag v1.0.3 && git push origin v1.0.3`
3. GitHub Actions will build the versioned Docker image automatically

### Build Optimization
- **Docker cache** is optimized for fast rebuilds (~1-2 minutes for source changes)
- **Version changes** don't invalidate npm install cache
- **Dependencies cache** persists across builds unless `package.json` dependencies change

## License

Based on the original ambientika-local-control project. Please refer to the original repository for licensing information.

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg