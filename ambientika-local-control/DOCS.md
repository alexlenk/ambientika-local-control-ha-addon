# Ambientika Local Control Add-on Documentation

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]

## About

This add-on provides local control for Ambientika devices, allowing you to manage your ventilation system without relying on the cloud service.

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the "Ambientika Local Control" add-on
3. Configure the add-on (see Configuration section)
4. Set up device redirection (see Device Configuration section)
5. Start the add-on

## Device Configuration

**Important:** Before using this add-on, you must redirect your Ambientika devices to connect to your local Home Assistant instead of the cloud.

This add-on supports two methods to redirect device traffic locally. Choose the method that works best for your setup:

## Method 1: Router Static Route (Recommended - More Robust)

This method redirects all Ambientika cloud traffic to your Home Assistant via your router.

### Router Configuration
Add a static route in your router:
- **Destination:** `185.214.203.87/32`
- **Gateway:** `[YOUR_HA_IP]` (replace with your Home Assistant IP address)

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

### MQTT Settings

- **mqtt_host**: MQTT broker hostname (default: "core-mosquitto" for HA built-in broker)
- **mqtt_port**: MQTT broker port (default: 1883)
- **mqtt_username**: MQTT username (leave empty if no auth required)
- **mqtt_password**: MQTT password (leave empty if no auth required)

### Device Settings

- **zone_count**: Number of device zones in your setup (1-10, default: 3)
- **device_stale_timeout**: How long to wait before marking device as offline (30-300 seconds, default: 90)

### Network Settings

- **rest_api_port**: Port for the REST API (default: 3000)
- **local_socket_port**: Port for device TCP communication (default: 11000)
- **udp_broadcast_start_port**: Starting port for UDP broadcasts (default: 45000)

### Cloud Settings (Optional)

- **cloud_sync_enabled**: Enable synchronization with original Ambientika cloud (default: false)
- **cloud_host**: Ambientika cloud hostname (only if cloud sync enabled)
- **cloud_port**: Ambientika cloud port (only if cloud sync enabled)

## Usage

Once configured and started:

1. Devices will automatically appear in Home Assistant via MQTT auto-discovery
2. Control your devices through the Home Assistant interface
3. Access the REST API at `http://homeassistant:3000` if needed
4. Monitor logs for device connectivity and status

## Troubleshooting

### Devices Not Appearing

1. Verify devices are provisioned correctly with your HA IP
2. Check that devices are on the same network as Home Assistant
3. Ensure MQTT broker is running and accessible
4. Check add-on logs for connection errors

### Connection Issues

1. Verify port 11000 is not blocked by firewall
2. Check that host networking is enabled (required for UDP broadcasts)
3. Ensure devices can reach your Home Assistant IP address

### MQTT Issues

1. Verify MQTT broker settings in configuration
2. Check MQTT broker logs for authentication errors
3. Ensure auto-discovery is enabled in Home Assistant MQTT integration

## Support

For issues and questions, visit the [GitHub repository](https://github.com/sragas/ambientika-local-control).

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg