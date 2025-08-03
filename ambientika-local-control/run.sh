#!/bin/bash

# Get configuration from Home Assistant
CONFIG_PATH=/data/options.json

# Logging functions that write to stderr (Home Assistant captures this)
log_info() {
    echo "[INFO] $1" >&2
}

log_error() {
    echo "[ERROR] $1" >&2
}

log_debug() {
    echo "[DEBUG] $1" >&2
}

log_info "🚀 Starting Ambientika Local Control..."
log_info "📋 Reading configuration from: $CONFIG_PATH"

# Check if config file exists
if [[ ! -f "$CONFIG_PATH" ]]; then
    log_error "❌ Configuration file not found: $CONFIG_PATH"
    log_info "📄 Available files in /data:"
    ls -la /data/ >&2 || log_error "Cannot list /data directory"
    log_info "🔧 Using default configuration..."
fi

# Read configuration values using jq
MQTT_HOST=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.mqtt_host // "core-mosquitto"')
MQTT_PORT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.mqtt_port // 1883')
MQTT_USERNAME=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.mqtt_username // ""')
MQTT_PASSWORD=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.mqtt_password // ""')
ZONE_COUNT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.zone_count // 3')
CLOUD_SYNC_ENABLED=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.cloud_sync_enabled // false')
CLOUD_HOST=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.cloud_host // "185.214.203.87"')
CLOUD_PORT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.cloud_port // 11000')
DEVICE_STALE_TIMEOUT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.device_stale_timeout // 90')
REST_API_PORT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.rest_api_port // 3000')
LOCAL_SOCKET_PORT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.local_socket_port // 11000')
UDP_BROADCAST_START_PORT=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.udp_broadcast_start_port // 45000')

log_info "🔧 Configuration loaded:"
log_info "  MQTT: $MQTT_HOST:$MQTT_PORT"
log_info "  Zones: $ZONE_COUNT"
log_info "  Local Socket: $LOCAL_SOCKET_PORT"
log_info "  REST API: $REST_API_PORT"

# Build MQTT connection string
if [[ -n "$MQTT_USERNAME" && -n "$MQTT_PASSWORD" ]]; then
    MQTT_CONNECTION_STRING="mqtt://${MQTT_USERNAME}:${MQTT_PASSWORD}@${MQTT_HOST}:${MQTT_PORT}"
else
    MQTT_CONNECTION_STRING="mqtt://${MQTT_HOST}:${MQTT_PORT}"
fi

# Create .env file with configuration
cat > /app/.env << EOF
LOCAL_SOCKET_PORT=${LOCAL_SOCKET_PORT}
REST_API_PORT=${REST_API_PORT}

CLOUD_SYNC_ENABLED=${CLOUD_SYNC_ENABLED}
REMOTE_CLOUD_SOCKET_PORT=${CLOUD_PORT}
REMOTE_CLOUD_HOST=${CLOUD_HOST}

ZONE_COUNT=${ZONE_COUNT}

UDP_BROADCAST_LISTENER_START_PORT=${UDP_BROADCAST_START_PORT}

DEVICE_DB=/data/devices.db
DEVICE_STALE_TIMEOUT=${DEVICE_STALE_TIMEOUT}
SCHEDULER_CRON="*/1 * * * *"

MQTT_CONNECTION_STRING=${MQTT_CONNECTION_STRING}
MQTT_USERNAME=${MQTT_USERNAME}
MQTT_PASSWORD=${MQTT_PASSWORD}
MQTT_CLIENT_ID=ambientika

HOME_ASSISTANT_AUTO_DISCOVERY=true
HOME_ASSISTANT_STATUS_TOPIC=homeassistant/status
HOME_ASSISTANT_CLIMATE_DISCOVERY_TOPIC=homeassistant/climate/%serialNumber/hvac/config

HOME_ASSISTANT_BINARY_SENSOR_DISCOVERY_TOPIC=homeassistant/binary_sensor/%serialNumber/%sensorId/config
HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC=homeassistant/sensor/%serialNumber/%sensorId/config
HOME_ASSISTANT_SELECT_DISCOVERY_TOPIC=homeassistant/select/%serialNumber/%sensorId/config
HOME_ASSISTANT_BUTTON_DISCOVERY_TOPIC=homeassistant/button/%serialNumber/%sensorId/config

HOME_ASSISTANT_DEVICE_NAME_PREFIX=Ambientika
HOME_ASSISTANT_CLIMATE_DISCOVERY_PRESET_MODES="SMART,AUTO,MANUAL_HEAT_RECOVERY,NIGHT,AWAY_HOME,SURVEILLANCE,TIMED_EXPULSION,EXPULSION,INTAKE,MASTER_SLAVE_FLOW,SLAVE_MASTER_FLOW,OFF"

AVAILABILITY_TOPIC=ambientika/%serialNumber/availability
CLOUD_AVAILABILITY_TOPIC=ambientika/%serialNumber/cloud_availability
PRESET_MODE_STATE_TOPIC=ambientika/%serialNumber/preset_mode
PRESET_MODE_COMMAND_TOPIC=ambientika/%serialNumber/preset_mode/set
ACTION_STATE_TOPIC=ambientika/%serialNumber/action
MODE_STATE_TOPIC=ambientika/%serialNumber/mode
MODE_COMMAND_TOPIC=ambientika/%serialNumber/mode/set
FAN_MODE_STATE_TOPIC=ambientika/%serialNumber/fan
FAN_MODE_COMMAND_TOPIC=ambientika/%serialNumber/fan/set
CURRENT_TEMPERATURE_TOPIC=ambientika/%serialNumber/temperature
CURRENT_HUMIDITY_LEVEL_TOPIC=ambientika/%serialNumber/humidity_level
CURRENT_HUMIDITY_TOPIC=ambientika/%serialNumber/humidity
TARGET_HUMIDITY_STATE_TOPIC=ambientika/%serialNumber/target_humidity
TARGET_HUMIDITY_COMMAND_TOPIC=ambientika/%serialNumber/target_humidity/set
CURRENT_AIR_QUALITY_TOPIC=ambientika/%serialNumber/air_quality
HUMIDITY_ALARM_TOPIC=ambientika/%serialNumber/humidity_alarm
FILTER_STATUS_TOPIC=ambientika/%serialNumber/filter_status
FILTER_RESET_TOPIC=ambientika/%serialNumber/filter_reset
FAN_STATUS_TOPIC=ambientika/%serialNumber/fan_status
FAN_MODE_TOPIC=ambientika/%serialNumber/fan_mode
NIGHT_ALARM_TOPIC=ambientika/%serialNumber/night_alarm
LIGHT_SENSITIVITY_TOPIC=ambientika/%serialNumber/light_sensitivity
LIGHT_SENSITIVITY_COMMAND_TOPIC=ambientika/%serialNumber/light_sensitivity/set
WEATHER_UPDATE_TOPIC=ambientika/weather
EOF

# Log configuration
log_info "📊 Final configuration:"
log_info "  MQTT Host: ${MQTT_HOST}:${MQTT_PORT}"
log_info "  Zone Count: ${ZONE_COUNT}"
log_info "  Cloud Sync: ${CLOUD_SYNC_ENABLED}"
log_info "  Database: /data/devices.db"
log_info "  .env file created successfully"

log_info "🎯 Starting Ambientika Local Control application..."
log_info "📂 Working directory: $(pwd)"
log_info "📁 App files:"
ls -la /app/ >&2

# Start the application
cd /app
log_info "🚀 Executing: node dist/index.js"

# Redirect both stdout and stderr to ensure logs are captured
exec node dist/index.js 2>&1