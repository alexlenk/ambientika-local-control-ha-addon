# Add-on Configuration Reference

Source: `ambientika-local-control/config.yaml` (single source of truth for version and options schema).

All options are set in the HA add-on UI or in `options:` in config.yaml. They are exported as environment variables by `run.sh` and read via `process.env` in the Node.js add-on.

---

## Options

### MQTT

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mqtt_host` | string | `core-mosquitto` | Hostname or IP of the MQTT broker. `core-mosquitto` resolves to the built-in Mosquitto add-on inside HA. |
| `mqtt_port` | int 1–65535 | `1883` | MQTT broker port. |
| `mqtt_username` | string (optional) | `""` | MQTT username. Leave empty if the broker has no authentication. |
| `mqtt_password` | password (optional) | `""` | MQTT password. Stored as a HA secret. Leave empty if not required. |

### Cloud sync

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cloud_sync_enabled` | bool | `false` | When `true`, the add-on opens one outbound TCP connection per device to the cloud and routes cloud→device packets back. Enables the `cloud_availability` MQTT sensor and `cloudavailability` HA binary sensor. |
| `cloud_host` | string (optional) | `185.214.203.87` | Cloud relay IP or hostname. Only used when `cloud_sync_enabled=true`. |
| `cloud_port` | int 1–65535 (optional) | `11000` | Cloud relay TCP port. Only used when `cloud_sync_enabled=true`. |

### Ports

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rest_api_port` | int 1–65535 | `3000` | TCP port for the built-in REST API (Express). Exposed on the HA host as port 3000. |
| `local_socket_port` | int 1–65535 | `11000` | TCP port the add-on listens on for incoming device connections. Devices must be redirected here via DNS or DNAT. |
| `udp_broadcast_start_port` | int 1–65535 | `45000` | First UDP port for zone broadcast listening. The add-on opens 16 ports: `start_port` through `start_port + 15`, one per zone index. |

### Device management

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `device_stale_timeout` | int 30–300 | `90` | Seconds without a status packet before a device is marked `offline`. The scheduler checks every 60 s; effective offline detection latency is up to `timeout + 60` s. |

### Logging

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log_level` | enum (optional) | `info` | Winston log level: `silly` (most verbose) → `debug` → `info` → `warn` → `error`. `silly` logs every MQTT publish and every raw packet received. Use `info` in production; `silly` only for debugging. |

---

## Observed production configuration (2026-04-09)

```
mqtt_host:               core-mosquitto
mqtt_port:               1883
cloud_sync_enabled:      true
cloud_host:              185.214.203.87
cloud_port:              11000
device_stale_timeout:    90
rest_api_port:           3000
local_socket_port:       11000
udp_broadcast_start_port: 45000
log_level:               silly
```

---

## Network requirements

The add-on uses `host_network: true` and the `NET_ADMIN` privilege, so it binds directly to the HA host network. Required network access:

| Direction | Protocol | Port(s) | Purpose |
|-----------|----------|---------|---------|
| Inbound | TCP | 11000 | Device → add-on connections |
| Inbound | UDP | 45000–45015 | Zone broadcast packets from devices |
| Inbound | TCP | 3000 | REST API calls from HA or external tools |
| Outbound | TCP | 1883 | MQTT broker |
| Outbound | TCP | 11000 | Cloud relay (only when `cloud_sync_enabled=true`) |

Devices connect to the HA host IP on port 11000. A DNAT rule or local DNS override must redirect `app.ambientika.eu:11000` to the HA host IP so devices reach the proxy instead of the cloud directly.
