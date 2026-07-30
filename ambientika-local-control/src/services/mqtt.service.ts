import {Logger} from 'winston';
import {EventService} from './event.service';
import {connect, MqttClient} from "mqtt";
import dotenv from 'dotenv'
import {IClientOptions} from 'mqtt/src/lib/client';
import {AppEvents} from '../models/enum/app-events.enum';
import {Device} from '../models/device.model';
import {OperatingMode} from '../models/enum/operating-mode.enum';
import {HumidityLevel} from '../models/enum/humidity-level.enum';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {HAAutoDiscoveryService} from './ha-auto-discovery.service';
import {DeviceStorageService} from './device-storage.service';
import {DeviceDto} from '../dto/device.dto';
import {DeviceMapper} from './device.mapper';
import {WeatherUpdateDto} from '../dto/weather-update.dto';
import {DeviceSetupDto} from '../dto/device-setup.dto';
import {DeviceBroadcastStatus} from '../models/device-broadcast-status.model';

dotenv.config()

interface DeviceSetupJsonDto {
    role: 'MASTER' | 'SLAVE_EQUAL_MASTER' | 'SLAVE_OPPOSITE_MASTER';
    zone: number;
    houseId: number;
}

export class MqttService {

    // UDP broadcasts (the authoritative source for fan_status/fan_mode) arrive roughly
    // every ~30s from a master device; suppress the TCP-derived fallback for this long
    // after the last one seen for a serial so it doesn't flip-flop between vocabularies.
    private static readonly UDP_FRESHNESS_WINDOW_MS = 60000;
    // Arbitrary raw protocol access is a control primitive — any MQTT publish access
    // (including anonymous/weak broker ACLs common in home setups) becomes unrestricted
    // device control unless enable_raw_commands is explicitly turned on. See #42.
    private static readonly MAX_RAW_COMMAND_BYTES = 32;

    private mqttConnectionString = process.env.MQTT_CONNECTION_STRING || 'localhost';
    private mqttUsername = process.env.MQTT_USERNAME;
    private mqttPassword = process.env.MQTT_PASSWORD;
    private mqttClientId = process.env.MQTT_CLIENT_ID;

    private mqttClient!: MqttClient;

    private readonly deviceMapper: DeviceMapper;
    private readonly hAAutoDiscoveryService: HAAutoDiscoveryService;
    private readonly deviceTopicSubscriptions: Set<string> = new Set<string>();
    private readonly deviceZones: Map<string, number> = new Map();
    private readonly deviceHouseIds: Map<string, number> = new Map();
    private readonly lastUdpBroadcastAt: Map<string, number> = new Map();

    constructor(private log: Logger,
                private eventService: EventService,
                private deviceStorageService: DeviceStorageService) {
        this.log.debug(`Initializing MqttService`);
        this.log.info(process.env.ENABLE_RAW_COMMANDS === 'true'
            ? 'MQTT raw_command topic is enabled — any broker publish access can send arbitrary bytes to devices'
            : 'MQTT raw_command topic is disabled (enable_raw_commands)');
        this.deviceMapper = new DeviceMapper(this.log);
        this.hAAutoDiscoveryService = new HAAutoDiscoveryService(this);
        this.connect();
        this.initEventListener();
    }

    private connect(): void {
        const options: IClientOptions = {};
        if (this.mqttUsername && this.mqttPassword) {
            options.username = this.mqttUsername;
            options.password = this.mqttPassword;
            options.clientId = this.mqttClientId;
        }
        this.mqttClient = connect(this.mqttConnectionString, options);
        this.mqttClient.on('connect', () => {
            this.subscribeToTopic(process.env.HOME_ASSISTANT_STATUS_TOPIC || 'homeassistant/status');
            this.log.info(`MQTT broker connected`);
        });
        this.mqttClient.on('reconnect', () => {
            this.log.info(`MQTT broker reconnecting`);
            this.deviceTopicSubscriptions.clear();
        });
        this.mqttClient.on('error', (error) => {
            this.log.error(`MqttService error`, error);
            this.deviceTopicSubscriptions.clear();
        });

        this.mqttClient.on('message', (topic: string, message: Buffer) => {
            this.handleMessages(topic, message);
        });
    }


    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_OFFLINE, (device: Device) => {
            this.sendDeviceAvailability(device, 'offline');
            this.unsubscribeDeviceSubscriptions(device.serialNumber);
        });
        this.eventService.on(AppEvents.REMOTE_SOCKET_CONNECTED, (remoteAddress: string) => {
            this.sendDeviceCloudAvailability(remoteAddress, 'true');
        });
        this.eventService.on(AppEvents.REMOTE_SOCKET_DISCONNECTED, (remoteAddress: string) => {
            this.sendDeviceCloudAvailability(remoteAddress, 'false');
        });
        this.eventService.on(AppEvents.DEVICE_SETUP_UPDATE, (deviceSetupDto: DeviceSetupDto) => {
            this.deviceHouseIds.set(deviceSetupDto.serialNumber, deviceSetupDto.houseId);
            this.deviceZones.set(deviceSetupDto.serialNumber, deviceSetupDto.zoneIndex);
            this.deviceStorageService.saveDeviceZoneHouseId(
                deviceSetupDto.serialNumber, deviceSetupDto.zoneIndex, deviceSetupDto.houseId);
        });
        this.eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED,
            (deviceBroadcastStatus: DeviceBroadcastStatus) => {
                this.log.debug(`UDP broadcast: zone=${deviceBroadcastStatus.zoneIndex}, fanMode=${deviceBroadcastStatus.fanMode}, fanStatus=${deviceBroadcastStatus.fanStatus}, serial=${deviceBroadcastStatus.serialNumber}, houseId=${deviceBroadcastStatus.houseId}, allSerials=${deviceBroadcastStatus.allSerialNumbers.join(',')}`);
                // Cache zone and houseId for all devices at this IP (master + slaves)
                for (const sn of deviceBroadcastStatus.allSerialNumbers) {
                    this.deviceZones.set(sn, deviceBroadcastStatus.zoneIndex);
                    if (deviceBroadcastStatus.houseId !== undefined) {
                        this.deviceHouseIds.set(sn, deviceBroadcastStatus.houseId);
                    }
                    this.deviceStorageService.saveDeviceZoneHouseId(
                        sn, deviceBroadcastStatus.zoneIndex, deviceBroadcastStatus.houseId);
                }
                // Fan status/mode published only for the primary serial (master)
                this.sendFanStatus(deviceBroadcastStatus);
                this.sendFanMode(deviceBroadcastStatus);
            });
        this.eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, (device: Device) => {
            if (!this.deviceTopicSubscriptions.has(device.serialNumber)) {
                this.sendDeviceDiscoveryMessages(device);
            }
            this.subscribeDeviceSubscriptions(device.serialNumber);
            this.sendDeviceAvailability(device, 'online');
            this.sendDeviceOperatingMode(device);
            this.sendDeviceMode(device);
            this.sendDeviceAction(device);
            this.sendDeviceFanSpeed(device);
            this.sendDeviceTemperature(device);
            this.sendDeviceHumidity(device);
            this.sendDeviceTargetHumidity(device);
            this.sendDeviceHumidityLevel(device);
            this.sendDeviceAirQuality(device);
            this.sendHumidityAlarm(device);
            this.sendFilterStatus(device);
            this.sendNightAlarm(device);
            this.sendLightSensitivity(device);
            
            // Also publish fan status from device data as fallback
            this.sendFanStatusFromDevice(device);
            this.sendFanModeFromDevice(device);
            this.sendDeviceZone(device);
            this.sendDeviceHouseId(device);
            this.sendDeviceRole(device);
            // If zone/houseId not yet in memory (e.g. after restart), load from DB
            if (!this.deviceZones.has(device.serialNumber) || !this.deviceHouseIds.has(device.serialNumber)) {
                this.loadZoneHouseIdFromDb(device);
            }
        });
    }

    private sendDeviceAvailability(device: Device, availability: string) {
        this.publish(this.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC, device.serialNumber), availability);
    }

    private sendDeviceCloudAvailability(remoteAddress: string, availability: string) {
        this.deviceStorageService.findExistingDeviceByRemoteAddress(remoteAddress,
            (device: DeviceDto | undefined) => {
                if (device) {
                    this.publish(this.getDevicePublishTopic(process.env.CLOUD_AVAILABILITY_TOPIC, device.serialNumber),
                        availability);
                }
            })
    }

    private sendDeviceDiscoveryMessages(device: Device): void {
        const enabled = process.env.HOME_ASSISTANT_AUTO_DISCOVERY === 'true';
        if (enabled) {
            this.log.debug(`Sending HA discovery messages for device ${device.serialNumber}`)
            
            // Send discovery messages asynchronously to avoid blocking
            setImmediate(() => {
                const climateDiscovery = this.hAAutoDiscoveryService.getClimateDeviceDiscoveryMessage(device);
                let topic = this.getDevicePublishTopic(process.env.HOME_ASSISTANT_CLIMATE_DISCOVERY_TOPIC,
                    device.serialNumber);
                this.publish(topic, climateDiscovery);

                const alarmDiscovery = this.hAAutoDiscoveryService.getNightAlarmBinarySensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_BINARY_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'nightalarm');
                this.publish(topic, alarmDiscovery);

                const humidityAlarmDiscovery = this.hAAutoDiscoveryService.getHumidityAlarmBinarySensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_BINARY_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'humidityalarm');
                this.publish(topic, humidityAlarmDiscovery);

                if (process.env.CLOUD_SYNC_ENABLED === 'true') {
                    const cloudAvailabilityDiscovery = this.hAAutoDiscoveryService.getCloudAvailabilityBinarySensorMessage(device);
                    topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_BINARY_SENSOR_DISCOVERY_TOPIC,
                        device.serialNumber, 'cloudavailability');
                    this.publish(topic, cloudAvailabilityDiscovery);
                }

                const airQualityDiscovery = this.hAAutoDiscoveryService.getAirQualitySensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'airquality');
                this.publish(topic, airQualityDiscovery);

                const filterStatusDiscovery = this.hAAutoDiscoveryService.getFilterStatusSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'filterstatus');
                this.publish(topic, filterStatusDiscovery);

                const humidityDiscovery = this.hAAutoDiscoveryService.getHumidityStatusSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'humidity');
                this.publish(topic, humidityDiscovery);

                const fanStatusDiscovery = this.hAAutoDiscoveryService.getFanStatusSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'fanstatus');
                this.publish(topic, fanStatusDiscovery);

                const fanModeDiscovery = this.hAAutoDiscoveryService.getFanModeSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'fanmode');
                this.publish(topic, fanModeDiscovery);

                const filterResetButtonDiscovery = this.hAAutoDiscoveryService.getFilterResetButtonMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_BUTTON_DISCOVERY_TOPIC,
                    device.serialNumber, 'filterreset');
                this.publish(topic, filterResetButtonDiscovery);

                const lightSensitivityDiscovery = this.hAAutoDiscoveryService.getLightSensitivitySensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SELECT_DISCOVERY_TOPIC,
                    device.serialNumber, 'lightsensitivity');
                this.publish(topic, lightSensitivityDiscovery);

                const presetModeDiscovery = this.hAAutoDiscoveryService.getPresetModeSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'presetmode');
                this.publish(topic, presetModeDiscovery);

                const zoneDiscovery = this.hAAutoDiscoveryService.getZoneSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'zone');
                this.publish(topic, zoneDiscovery);

                const houseIdDiscovery = this.hAAutoDiscoveryService.getHouseIdSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'houseid');
                this.publish(topic, houseIdDiscovery);

                const deviceRoleDiscovery = this.hAAutoDiscoveryService.getDeviceRoleSensorMessage(device);
                topic = this.getDeviceSensorPublishTopic(process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC,
                    device.serialNumber, 'devicerole');
                this.publish(topic, deviceRoleDiscovery);

            });
        }
    }

    private sendDeviceMode(device: Device) {
        // Check if we have a stored command that should override the device's reported mode
        const storedMode = this.deviceStorageService.getStoredOperatingMode(device.serialNumber);
        const effectiveOperatingMode = storedMode || device.operatingMode;
        const mode = effectiveOperatingMode === OperatingMode[OperatingMode.OFF] ? 'off' : 'fan_only';
        this.publish(this.getDevicePublishTopic(process.env.MODE_STATE_TOPIC, device.serialNumber), mode);
    }

    private sendDeviceAction(device: Device) {
        // Check if we have a stored command that should override the device's reported mode
        const storedMode = this.deviceStorageService.getStoredOperatingMode(device.serialNumber);
        const effectiveOperatingMode = storedMode || device.operatingMode;
        const action = effectiveOperatingMode === OperatingMode[OperatingMode.OFF] ? 'off' : 'fan';
        this.publish(this.getDevicePublishTopic(process.env.ACTION_STATE_TOPIC, device.serialNumber), action);
    }

    private sendDeviceOperatingMode(device: Device) {
        // Publish the actual operating mode for every device, master or slave — a device role
        // is not an operating mode. Slaves already have their own dedicated device_role topic
        // (sendDeviceRole), so preset_mode no longer doubles as a role indicator (see #45).
        // Check if we have a stored command that should override the device's reported mode
        const storedMode = this.deviceStorageService.getStoredOperatingMode(device.serialNumber);
        const modeToPublish = storedMode || device.operatingMode;
        this.publish(this.getDevicePublishTopic(process.env.PRESET_MODE_STATE_TOPIC, device.serialNumber),
            modeToPublish);
    }

    private sendDeviceFanSpeed(device: Device) {
        if (device.fanSpeed) {
            // Check if we have a stored command that should override the device's reported fan speed
            const storedFanSpeed = this.deviceStorageService.getStoredFanSpeed(device.serialNumber);
            const fanSpeedToPublish = storedFanSpeed?.toLowerCase() || device.fanSpeed.toLowerCase();
            
            this.publish(this.getDevicePublishTopic(process.env.FAN_MODE_STATE_TOPIC, device.serialNumber),
                fanSpeedToPublish)
        }
    }

    private sendDeviceTemperature(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.CURRENT_TEMPERATURE_TOPIC, device.serialNumber),
            device.temperature.toString())
    }

    private sendDeviceHumidity(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.CURRENT_HUMIDITY_TOPIC, device.serialNumber),
            device.humidity.toString())
    }

    private sendDeviceTargetHumidity(device: Device) {
        let targetHumidity = 0;
        switch (device.humidityLevel) {
            case HumidityLevel[HumidityLevel.DRY]:
                targetHumidity = 40;
                break;
            case HumidityLevel[HumidityLevel.NORMAL]:
                targetHumidity = 60;
                break;
            case HumidityLevel[HumidityLevel.MOIST]:
                targetHumidity = 75;
                break;
        }
        this.publish(this.getDevicePublishTopic(process.env.TARGET_HUMIDITY_STATE_TOPIC, device.serialNumber),
            targetHumidity.toString());
    }

    private sendDeviceHumidityLevel(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.CURRENT_HUMIDITY_LEVEL_TOPIC, device.serialNumber),
            device.humidityLevel)
    }

    private sendDeviceAirQuality(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.CURRENT_AIR_QUALITY_TOPIC, device.serialNumber),
            device.airQuality.toString())
    }

    private sendHumidityAlarm(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.HUMIDITY_ALARM_TOPIC, device.serialNumber),
            device.humidityAlarm.toString())
    }

    private sendFilterStatus(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.FILTER_STATUS_TOPIC, device.serialNumber),
            device.filterStatus.toString())
    }

    private sendNightAlarm(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.NIGHT_ALARM_TOPIC, device.serialNumber),
            device.nightAlarm.toString())
    }

    private sendLightSensitivity(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.LIGHT_SENSITIVITY_TOPIC, device.serialNumber),
            device.lightSensitivity.toString())
    }

    private loadZoneHouseIdFromDb(device: Device): void {
        this.deviceStorageService.findExistingDeviceBySerialNumber(device.serialNumber,
            (dto) => {
                if (!dto) return;
                let published = false;
                if (dto.zone !== undefined && dto.zone !== null && !this.deviceZones.has(device.serialNumber)) {
                    this.deviceZones.set(device.serialNumber, dto.zone);
                    this.publish(this.getDevicePublishTopic(process.env.DEVICE_ZONE_TOPIC, device.serialNumber),
                        dto.zone.toString());
                    published = true;
                }
                if (dto.houseId !== undefined && dto.houseId !== null && !this.deviceHouseIds.has(device.serialNumber)) {
                    this.deviceHouseIds.set(device.serialNumber, dto.houseId);
                    this.publish(this.getDevicePublishTopic(process.env.HOUSE_ID_TOPIC, device.serialNumber),
                        dto.houseId.toString());
                    published = true;
                }
                if (published) {
                    this.log.debug(`Restored zone/houseId from DB for ${device.serialNumber}: zone=${dto.zone}, houseId=${dto.houseId}`);
                }
            });
    }

    private sendDeviceZone(device: Device) {
        const zone = this.deviceZones.get(device.serialNumber);
        if (zone !== undefined) {
            this.publish(this.getDevicePublishTopic(process.env.DEVICE_ZONE_TOPIC, device.serialNumber),
                zone.toString());
        }
    }

    private sendDeviceHouseId(device: Device) {
        const houseId = this.deviceHouseIds.get(device.serialNumber);
        if (houseId !== undefined) {
            this.publish(this.getDevicePublishTopic(process.env.HOUSE_ID_TOPIC, device.serialNumber),
                houseId.toString());
        }
    }

    private sendDeviceRole(device: Device) {
        this.publish(this.getDevicePublishTopic(process.env.DEVICE_ROLE_TOPIC, device.serialNumber),
            device.deviceRole);
    }

    private isUdpDataFresh(serialNumber: string): boolean {
        const lastSeen = this.lastUdpBroadcastAt.get(serialNumber);
        return lastSeen !== undefined && Date.now() - lastSeen < MqttService.UDP_FRESHNESS_WINDOW_MS;
    }

    private sendFanStatusFromDevice(device: Device) {
        // UDP broadcasts are the authoritative source for fan_status (real FanStatus enum
        // values); only fall back to this TCP-derived approximation when no broadcast has
        // been seen recently for this serial, so the topic doesn't flip-flop between the
        // two vocabularies (see #45). A device role is not a fan status, so — unlike the
        // old behavior — slaves get the same derived value as any other device here.
        if (this.isUdpDataFresh(device.serialNumber)) {
            return;
        }
        let fanStatus = 'OFF';
        if (device.operatingMode !== 'OFF') {
            fanStatus = device.fanSpeed === 'HIGH' ? 'HIGH' :
                       device.fanSpeed === 'MEDIUM' ? 'MEDIUM' : 'LOW';
        }
        this.publish(this.getDevicePublishTopic(process.env.FAN_STATUS_TOPIC, device.serialNumber),
            fanStatus);
    }

    private sendFanModeFromDevice(device: Device) {
        // Same UDP-freshness suppression as sendFanStatusFromDevice — see #45.
        if (this.isUdpDataFresh(device.serialNumber)) {
            return;
        }
        let fanMode = 'OFF';
        if (device.operatingMode !== 'OFF') {
            fanMode = device.operatingMode === 'AUTO' ? 'AUTO' : 'MANUAL';
        }
        this.publish(this.getDevicePublishTopic(process.env.FAN_MODE_TOPIC, device.serialNumber),
            fanMode);
    }

    private sendFanStatus(deviceBroadcastStatus: DeviceBroadcastStatus) {
        if (deviceBroadcastStatus.serialNumber) {
            this.lastUdpBroadcastAt.set(deviceBroadcastStatus.serialNumber, Date.now());
            this.publish(this.getDevicePublishTopic(process.env.FAN_STATUS_TOPIC, deviceBroadcastStatus.serialNumber),
                (deviceBroadcastStatus.fanStatus ?? 'UNKNOWN').toString());
        }
    }

    private sendFanMode(deviceBroadcastStatus: DeviceBroadcastStatus) {
        if (deviceBroadcastStatus.serialNumber) {
            this.lastUdpBroadcastAt.set(deviceBroadcastStatus.serialNumber, Date.now());
            this.publish(this.getDevicePublishTopic(process.env.FAN_MODE_TOPIC, deviceBroadcastStatus.serialNumber),
                (deviceBroadcastStatus.fanMode ?? 'UNKNOWN').toString());
        }
    }


    private publish(topic: string, message: string): void {
        if (this.mqttClient.connected) {
            this.log.silly(`mqtt publish ${message} to ${topic}`);
            this.mqttClient.publish(topic, message, (err) => {
                if (err) {
                    this.log.error(`mqtt publish error to ${topic}: `, err);
                }
            });
        }
    }

    getDevicePublishTopic(topic: string | undefined, serialNumber: string): string {
        if (topic) {
            return topic.replace('%serialNumber', serialNumber);
        } else {
            return '';
        }
    }

    getDeviceSensorPublishTopic(topic: string | undefined, serialNumber: string, senorId: string): string {
        if (topic) {
            let replacedTopic = topic.replace('%serialNumber', serialNumber);
            replacedTopic = replacedTopic.replace('%sensorId', senorId);
            return replacedTopic;
        } else {
            return '';
        }
    }

    private subscribeDeviceSubscriptions(serialNumber: string): void {
        if (this.mqttClient.connected) {
            if (!this.deviceTopicSubscriptions.has(serialNumber)) {
                const subscriptionTopics = this.getSubscriptionTopics(serialNumber);
                // Batch subscribe to all topics at once instead of one by one
                this.batchSubscribeToTopics(subscriptionTopics);
                this.deviceTopicSubscriptions.add(serialNumber);
            }
        }
    }

    private unsubscribeDeviceSubscriptions(serialNumber: string): void {
        if (this.mqttClient.connected) {
            if (this.deviceTopicSubscriptions.has(serialNumber)) {
                const subscriptionTopics = this.getSubscriptionTopics(serialNumber);
                subscriptionTopics.forEach(topic => {
                    this.unsubscribeFromTopic(topic);
                })
                this.deviceTopicSubscriptions.delete(serialNumber);
            }
        }
    }

    private getSubscriptionTopics(serialNumber: string): string[] {
        const topics: string[] = [];
        topics.push((process.env.TARGET_HUMIDITY_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.FAN_MODE_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.MODE_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.PRESET_MODE_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.LIGHT_SENSITIVITY_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.FILTER_RESET_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.DEVICE_SETUP_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        topics.push((process.env.DEVICE_SETUP_JSON_TOPIC || '').replace('%serialNumber', serialNumber));
        if (process.env.ENABLE_RAW_COMMANDS === 'true') {
            topics.push((process.env.RAW_COMMAND_TOPIC || '').replace('%serialNumber', serialNumber));
        }
        topics.push((process.env.WEATHER_UPDATE_TOPIC || ''));
        return topics;
    }

    private subscribeToTopic(topic: string): void {
        this.mqttClient.subscribe(topic, (err) => {
            if (err) {
                this.log.error(`mqtt subscription error to ${topic}: `, err);
            } else {
                this.log.silly(`mqtt subscription to ${topic}`);
            }
        });
    }

    private batchSubscribeToTopics(topics: string[]): void {
        // Filter out empty topics
        const validTopics = topics.filter(topic => topic && topic.trim() !== '');
        
        if (validTopics.length === 0) return;

        // Use MQTT batch subscription for better performance - subscribe to array of topics
        this.mqttClient.subscribe(validTopics, (err) => {
            if (err) {
                this.log.error(`mqtt batch subscription error: `, err);
                // Fallback to individual subscriptions if batch fails
                validTopics.forEach(topic => this.subscribeToTopic(topic));
            } else {
                this.log.info(`MQTT subscribed to ${validTopics.length} device topics`);
            }
        });
    }

    private unsubscribeFromTopic(topic: string): void {
        this.mqttClient.unsubscribe(topic, (err) => {
            if (err) {
                this.log.error(`mqtt unsubscribe error from ${topic}: `, err);
            } else {
                this.log.debug(`mqtt unsubscribe from ${topic}`);
            }
        });
    }

    private handleMessages(topic: string, message: Buffer): void {
        this.log.info(`MQTT command: ${message.toString()} → ${topic.split('/').pop()}`);
        switch (topic) {
            case process.env.HOME_ASSISTANT_STATUS_TOPIC:
                this.handleHAStatusMessage(message);
                break;
            case process.env.WEATHER_UPDATE_TOPIC:
                this.handleWeatherUpdate(message);
                break;
            default:
                this.handleCommandStatusMessage(topic, message);
                break;

        }
    }

    private handleHAStatusMessage(message: Buffer): void {
        if (message.toString() === 'online') {
            this.log.info('Home Assistant online - sending device discovery messages')
            this.deviceStorageService.getDevices((devices: DeviceDto[]) => {
                if (devices) {
                    // Process devices in parallel using setImmediate to avoid blocking
                    devices.forEach((deviceDto: DeviceDto) => {
                        setImmediate(() => {
                            const device = this.deviceMapper.deviceFromDto(deviceDto);
                            if (this.deviceTopicSubscriptions.has(device.serialNumber)) {
                                this.sendDeviceDiscoveryMessages(device);
                            }
                        });
                    });
                }
            });
        }
    }

    private handleWeatherUpdate(message: Buffer): void {
        try {
            const weatherUpdate = JSON.parse(message.toString()) as WeatherUpdateDto;
            this.eventService.deviceWeatherUpdate(weatherUpdate);
        } catch (err) {
            this.log.error('Failed to parse weather update message:', err);
        }
    }

    private handleFilterReset(serialNumber: string | undefined): void {
        if (serialNumber) {
            this.eventService.deviceFilterReset(serialNumber);
        } else {
            this.log.warn(`Could not find serial number in filter reset topic`);
        }
    }

    private handleDeviceSetup(serialNumber: string, message: Buffer): void {
        try {
            const deviceSetupDto = JSON.parse(message.toString()) as DeviceSetupDto;
            deviceSetupDto.serialNumber = serialNumber; // Ensure serial number matches topic
            this.log.info(`Device setup received for ${serialNumber}: ${JSON.stringify(deviceSetupDto)}`);
            this.eventService.deviceSetupUpdate(deviceSetupDto);
        } catch (error) {
            this.log.error(`Failed to parse device setup message for ${serialNumber}: ${error}`);
        }
    }

    private handleDeviceSetupJson(serialNumber: string, message: Buffer): void {
        try {
            const jsonSetup = JSON.parse(message.toString()) as DeviceSetupJsonDto;
            
            // Validate required fields
            if (!jsonSetup.role || jsonSetup.zone === undefined || jsonSetup.houseId === undefined) {
                this.log.error(`Invalid JSON setup for ${serialNumber}: missing required fields (role, zone, houseId)`);
                return;
            }
            
            // Validate role
            const validRoles = ['MASTER', 'SLAVE_EQUAL_MASTER', 'SLAVE_OPPOSITE_MASTER'];
            if (!validRoles.includes(jsonSetup.role)) {
                this.log.error(`Invalid device role '${jsonSetup.role}' for ${serialNumber}. Valid roles: ${validRoles.join(', ')}`);
                return;
            }
            
            // Convert to DeviceSetupDto format
            const deviceSetupDto: DeviceSetupDto = {
                serialNumber: serialNumber,
                deviceRole: jsonSetup.role,
                zoneIndex: jsonSetup.zone,
                houseId: jsonSetup.houseId
            };
            
            this.log.info(`JSON device setup received for ${serialNumber}: role=${jsonSetup.role}, zone=${jsonSetup.zone}, houseId=${jsonSetup.houseId}`);
            this.eventService.deviceSetupUpdate(deviceSetupDto);
        } catch (error) {
            this.log.error(`Failed to parse JSON device setup message for ${serialNumber}: ${error}`);
        }
    }

    private handleRawCommand(serialNumber: string, message: Buffer): void {
        if (process.env.ENABLE_RAW_COMMANDS !== 'true') {
            this.log.warn(`Raw command received for ${serialNumber} but raw commands are disabled (enable_raw_commands); ignoring`);
            return;
        }
        try {
            const hexString = message.toString().trim();
            this.log.debug(`Raw command received for ${serialNumber}: ${hexString}`);

            // Convert hex string to buffer
            const commandBuffer = this.hexStringToBuffer(hexString);
            if (commandBuffer) {
                if (commandBuffer.length > MqttService.MAX_RAW_COMMAND_BYTES) {
                    this.log.error(`Raw command for ${serialNumber} rejected: ${commandBuffer.length} bytes exceeds the ${MqttService.MAX_RAW_COMMAND_BYTES}-byte limit`);
                    return;
                }
                this.log.debug(`Sending raw command to ${serialNumber}: ${commandBuffer.toString('hex')} (${commandBuffer.length} bytes)`);
                this.sendRawCommandToDevice(serialNumber, commandBuffer);
            } else {
                this.log.error(`Invalid hex string format for ${serialNumber}: ${hexString}`);
            }
        } catch (error) {
            this.log.error(`Failed to process raw command for ${serialNumber}: ${error}`);
        }
    }

    private hexStringToBuffer(hexString: string): Buffer | null {
        try {
            // Remove any whitespace and ensure even number of characters
            const cleanHex = hexString.replace(/\s+/g, '');
            if (cleanHex.length % 2 !== 0) {
                this.log.error(`Hex string must have even number of characters: ${cleanHex}`);
                return null;
            }
            
            // Validate hex characters
            if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
                this.log.error(`Invalid hex characters in string: ${cleanHex}`);
                return null;
            }
            
            return Buffer.from(cleanHex, 'hex');
        } catch (error) {
            this.log.error(`Error converting hex string to buffer: ${error}`);
            return null;
        }
    }

    private sendRawCommandToDevice(serialNumber: string, commandBuffer: Buffer): void {
        this.deviceStorageService.findExistingDeviceBySerialNumber(serialNumber,
            (dto: DeviceDto | undefined) => {
                if (dto) {
                    const device = this.deviceMapper.deviceFromDto(dto);
                    this.log.info(`Sending raw command to device ${serialNumber} at ${device.remoteAddress}`);
                    
                    // Log buffer analysis
                    this.logBufferAnalysis(commandBuffer, serialNumber);
                    
                    // Send via local socket
                    this.eventService.localSocketDataUpdate(commandBuffer, device.remoteAddress);
                } else {
                    this.log.error(`Device ${serialNumber} not found for raw command`);
                }
            });
    }

    private logBufferAnalysis(buffer: Buffer, serialNumber: string): void {
        this.log.debug(`=== RAW COMMAND ANALYSIS for ${serialNumber} ===`);
        this.log.debug(`Buffer length: ${buffer.length} bytes`);
        this.log.debug(`Hex: ${buffer.toString('hex')}`);

        // Byte-by-byte analysis
        for (let i = 0; i < buffer.length; i++) {
            const byte = buffer[i] as number;
            this.log.debug(`Byte ${i}: 0x${byte.toString(16).padStart(2, '0')} (${byte})`);
        }

        // Common pattern analysis
        if (buffer.length >= 8) {
            const possibleSerial = buffer.slice(2, 8).toString('hex');
            this.log.debug(`Possible serial number (bytes 2-7): ${possibleSerial}`);
        }

        if (buffer.length >= 2) {
            const byte0 = buffer[0] as number;
            const byte1 = buffer[1] as number;
            this.log.debug(`Header (bytes 0-1): 0x${byte0.toString(16).padStart(2, '0')} 0x${byte1.toString(16).padStart(2, '0')}`);
        }

        if (buffer.length >= 9) {
            const byte8 = buffer[8] as number;
            this.log.debug(`Command byte (byte 8): 0x${byte8.toString(16).padStart(2, '0')} (${byte8})`);
        }
    }

    private handleCommandStatusMessage(topic: string, message: Buffer): void {
        const serialNumber: string | undefined = this.extractSerialNumberFromTopic(topic);
        if (serialNumber) {
            const operatingModeDto: OperatingModeDto | undefined = this.getOperatingDtoFromTopic(serialNumber, topic, message);
            if (operatingModeDto) {
                this.eventService.deviceOperatingModeUpdate(operatingModeDto, serialNumber);
            } else if (topic.replace(/[a-f0-9]{12}/, '%serialNumber') === process.env.FILTER_RESET_TOPIC) {
                this.handleFilterReset(serialNumber);
            } else if (topic.replace(/[a-f0-9]{12}/, '%serialNumber') === process.env.DEVICE_SETUP_COMMAND_TOPIC) {
                this.handleDeviceSetup(serialNumber, message);
            } else if (topic.replace(/[a-f0-9]{12}/, '%serialNumber') === process.env.DEVICE_SETUP_JSON_TOPIC) {
                this.handleDeviceSetupJson(serialNumber, message);
            } else if (topic.replace(/[a-f0-9]{12}/, '%serialNumber') === process.env.RAW_COMMAND_TOPIC) {
                this.handleRawCommand(serialNumber, message);
            } else {
                this.log.warn(`Could not build command for ${serialNumber} from ${message} on ${topic}`);
            }
        } else {
            this.log.warn(`Could not find serial number in command topic ${topic}`);
        }
    }

    private extractSerialNumberFromTopic(topic: string): string | undefined {
        const matches = topic.match(/(?<serial>[a-f0-9]{12})/);
        const serialNumber = matches?.groups?.serial;
        if (serialNumber && this.deviceTopicSubscriptions.has(serialNumber)) {
            return serialNumber;
        }
        return undefined;
    }

    private getOperatingDtoFromTopic(serialNumber: string, topic: string, message: Buffer): OperatingModeDto | undefined {
        const dto: OperatingModeDto = {} as OperatingModeDto;
        const messageString = message.toString();
        switch (topic) {
            case process.env.TARGET_HUMIDITY_COMMAND_TOPIC?.replace('%serialNumber', serialNumber):
                dto.humidityLevel = this.getHumidityLevel(messageString);
                return dto;
            case process.env.FAN_MODE_COMMAND_TOPIC?.replace('%serialNumber', serialNumber): {
                // Only accept valid fan speeds: LOW, MEDIUM, HIGH, NIGHT
                const fanSpeedUpper = messageString.toUpperCase();
                if (fanSpeedUpper === 'LOW' || fanSpeedUpper === 'MEDIUM' || fanSpeedUpper === 'HIGH' || fanSpeedUpper === 'NIGHT') {
                    dto.fanSpeed = fanSpeedUpper;
                } else {
                    this.log.warn(`Invalid fan speed '${messageString}' received, ignoring command`);
                    return undefined;
                }
                return dto;
            }
            case process.env.MODE_COMMAND_TOPIC?.replace('%serialNumber', serialNumber):
                dto.operatingMode = messageString === 'fan_only' ? OperatingMode.LAST.toString() :
                    messageString.toUpperCase();
                return dto;
            case process.env.PRESET_MODE_COMMAND_TOPIC?.replace('%serialNumber', serialNumber):
                dto.operatingMode = messageString.toUpperCase();
                return dto;
            case process.env.LIGHT_SENSITIVITY_COMMAND_TOPIC?.replace('%serialNumber', serialNumber):
                dto.lightSensitivity = messageString.toUpperCase();
                return dto;
        }
        return undefined;
    }

    private getHumidityLevel(humidityLevel: string): string {
        const humidityLevelNumber = parseInt(humidityLevel);
        if (humidityLevelNumber <= 40) {
            return HumidityLevel.DRY.toString()
        } else if (humidityLevelNumber > 40 && humidityLevelNumber <= 60) {
            return HumidityLevel.NORMAL.toString()
        } else {
            return HumidityLevel.MOIST.toString()
        }
    }

    close(): Promise<void> {
        this.log.debug('Closing MqttService');
        if (!this.mqttClient?.connected) {
            return Promise.resolve();
        }
        for (const serialNumber of this.deviceTopicSubscriptions) {
            const topic = this.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC, serialNumber);
            if (topic) {
                this.mqttClient.publish(topic, 'offline', {retain: true});
            }
        }
        return new Promise((resolve) => {
            this.mqttClient.end(false, {}, () => resolve());
        });
    }

}
