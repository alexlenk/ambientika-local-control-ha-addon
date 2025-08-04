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
4. Start the add-on

## Configuration

Configure the add-on through the Home Assistant UI with your MQTT broker settings and device network information.

## Supported Devices

This add-on works with Ambientika air purification/ventilation devices that support local network control.

## License

Based on the original ambientika-local-control project. Please refer to the original repository for licensing information.