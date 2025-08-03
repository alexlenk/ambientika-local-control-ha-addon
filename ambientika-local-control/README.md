# Ambientika Local Control Add-on

![Supports aarch64 Architecture][aarch64-shield] ![Supports amd64 Architecture][amd64-shield] ![Supports armhf Architecture][armhf-shield] ![Supports armv7 Architecture][armv7-shield] ![Supports i386 Architecture][i386-shield]

Local control for Ambientika ventilation devices with Home Assistant integration via MQTT.

## About

This add-on allows you to control your Ambientika ventilation devices locally without relying on the cloud service. It provides:

- Local device communication and control
- MQTT integration with Home Assistant auto-discovery
- Multi-zone support
- Real-time device status monitoring
- Optional cloud synchronization

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the "Ambientika Local Control" add-on
3. Configure MQTT settings
4. Provision your devices (see documentation)
5. Start the add-on

[Full documentation](DOCS.md)

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg