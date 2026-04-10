# Ambientika Local Control Add-on Documentation

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]

## About

This add-on provides local control for Ambientika ventilation devices, integrating them
into Home Assistant via MQTT while optionally keeping the official Ambientika cloud app
working in parallel.

---

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the "Ambientika Local Control" add-on
3. Configure the add-on (see Configuration section)
4. Provision your devices (see Device Provisioning section)
5. Start the add-on

---

## Device Provisioning (BLE)

Each device must be told to connect to your Home Assistant instance instead of the
Ambientika cloud. This is done once per device over Bluetooth (BLE).

### What provisioning does

It writes three values into the device:
- The TCP host to connect to (`H_<HA-IP>:11000`)
- Your WiFi SSID (`S_<ssid>`)
- Your WiFi password (`P_<password>`)

### Steps

1. Put the device in pairing mode
2. Scan for BLE devices — it appears as `VMC_<MAC>`
3. Connect and navigate to:
   - Service UUID: `0000a002-*`
   - Characteristic UUID: `0000c302-*`
4. Write the following values to the characteristic (one at a time):
   - `H_<YOUR_HA_IP>:11000`
   - `S_<YOUR_WIFI_SSID>`
   - `P_<YOUR_WIFI_PASSWORD>`
5. The device restarts and connects to the add-on

BLE apps for manual provisioning: **LightBlue Explorer** (iOS) or **nRF Connect** (Android).

Alternatively, use the provisioning script in `src/scripts/ble-provisioning.ts` — update
`CLOUD_HOST`, `SSID`, `PWD`, and `MAC` before running.

### Re-provisioning

Re-provisioning is required if:
- The Home Assistant IP address changes
- A device is factory-reset

It is **not** required for normal operation, add-on updates, or HA restarts.

For full technical background on the provisioning flow and cloud registration, see
[`CLOUD-INTEGRATION.md`](../CLOUD-INTEGRATION.md).

---

## Cloud Sync (Optional)

With `cloud_sync_enabled: true` the add-on forwards device traffic to the Ambientika
cloud in parallel. This allows the **official Ambientika app to continue working**
alongside the Home Assistant integration — devices appear online in both.

Without cloud sync, devices are only accessible via Home Assistant. The official
Ambientika app will show them as offline.

---

## Configuration

### MQTT Settings

| Option | Default | Description |
|--------|---------|-------------|
| `mqtt_host` | `core-mosquitto` | MQTT broker hostname |
| `mqtt_port` | `1883` | MQTT broker port |
| `mqtt_username` | _(empty)_ | MQTT username |
| `mqtt_password` | _(empty)_ | MQTT password |

### Device Settings

| Option | Default | Description |
|--------|---------|-------------|
| `device_stale_timeout` | `90` | Seconds before a silent device is marked offline (30–300) |

### Network Settings

| Option | Default | Description |
|--------|---------|-------------|
| `rest_api_port` | `3000` | REST API port |
| `local_socket_port` | `11000` | TCP port devices connect to |
| `udp_broadcast_start_port` | `45000` | Base port for UDP zone broadcasts (one per zone) |

### Cloud Settings

| Option | Default | Description |
|--------|---------|-------------|
| `cloud_sync_enabled` | `false` | Forward device traffic to Ambientika cloud |
| `cloud_host` | `185.214.203.87` | Ambientika cloud IP |
| `cloud_port` | `11000` | Ambientika cloud TCP port |

---

## Usage

Once provisioned and running:

1. Devices appear automatically in Home Assistant via MQTT auto-discovery
2. Control devices through the Home Assistant climate/fan entities
3. Optionally use the REST API at `http://<ha-host>:3000`

---

## Troubleshooting

### Devices not appearing in Home Assistant

1. Check the add-on log for `Device connected: <IP>` — if missing, the device is not reaching the add-on
2. Verify the device was provisioned with the correct HA IP
3. Confirm the device is on the same WiFi network as Home Assistant
4. Check that port 11000 is not blocked by a firewall

### Devices offline in the Ambientika app

1. Enable `cloud_sync_enabled: true` in the add-on configuration
2. Restart the add-on and wait ~60 seconds
3. Check the add-on log for `connection to cloud established`

### MQTT issues

1. Verify MQTT broker settings
2. Ensure MQTT auto-discovery is enabled in the Home Assistant MQTT integration
3. Check the broker logs for authentication errors

---

## Support

For issues and questions, visit the [GitHub repository](https://github.com/alexlenk/ambientika-local-control-ha-addon/issues).

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
