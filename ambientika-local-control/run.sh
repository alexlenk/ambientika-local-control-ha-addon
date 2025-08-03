#!/usr/bin/with-contenv bashio

# Get configuration from Home Assistant
CONFIG_PATH=/data/options.json

# Read configuration values
MQTT_HOST=$(bashio::config 'mqtt_host')
MQTT_PORT=$(bashio::config 'mqtt_port')
MQTT_USERNAME=$(bashio::config 'mqtt_username')
MQTT_PASSWORD=$(bashio::config 'mqtt_password')
ZONE_COUNT=$(bashio::config 'zone_count')
CLOUD_SYNC_ENABLED=$(bashio::config 'cloud_sync_enabled')
CLOUD_HOST=$(bashio::config 'cloud_host')
CLOUD_PORT=$(bashio::config 'cloud_port')
DEVICE_STALE_TIMEOUT=$(bashio::config 'device_stale_timeout')
REST_API_PORT=$(bashio::config 'rest_api_port')
LOCAL_SOCKET_PORT=$(bashio::config 'local_socket_port')
UDP_BROADCAST_START_PORT=$(bashio::config 'udp_broadcast_start_port')

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
bashio::log.info "Starting Ambientika Local Control..."
bashio::log.info "MQTT Host: ${MQTT_HOST}:${MQTT_PORT}"
bashio::log.info "Zone Count: ${ZONE_COUNT}"
bashio::log.info "Cloud Sync: ${CLOUD_SYNC_ENABLED}"
bashio::log.info "Database: /data/devices.db"

# Start the application
cd /app
exec node dist/index.js