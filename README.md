# Ambientika Local Control - Home Assistant Add-on

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

## Network Configuration

This add-on intercepts cloud traffic by redirecting it locally. Two configurations are required:

### 1. Router Static Route
Add a static route in your router:
- **Destination:** `185.214.203.87/32`
- **Gateway:** `192.168.178.30` (your HA IP)

### 2. Home Assistant IP Alias

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

**⚠️ Warning:** The official Ambientika app and Home Assistant Integration will not work when the static route or IP alias is active, as they require direct cloud connectivity.

## Configuration

Configure the add-on through the Home Assistant UI with your MQTT broker settings and device network information.

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