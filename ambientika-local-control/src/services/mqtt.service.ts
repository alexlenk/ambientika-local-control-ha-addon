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
import {DeviceBroadcastStatus} from '../models/device-broadcast-status.model';

dotenv.config()

export class MqttService {

    private mqttConnectionString = process.env.MQTT_CONNECTION_STRING || 'localhost';
    private mqttUsername = process.env.MQTT_USERNAME;
    private mqttPassword = process.env.MQTT_PASSWORD;
    private mqttClientId = process.env.MQTT_CLIENT_ID;

    private mqttClient: MqttClient;

    private readonly deviceMapper: DeviceMapper;
    private readonly hAAutoDiscoveryService: HAAutoDiscoveryService;
    private readonly deviceTopicSubscriptions: Set<string> = new Set<string>();

    constructor(private log: Logger,
                private eventService: EventService,
                private deviceStorageService: DeviceStorageService) {
        this.log.debug(`Initializing MqttService`);
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
            this.log.debug(`MqttService connected`);
        });
        this.mqttClient.on('reconnect', () => {
            this.log.debug(`MqttService reconnecting`);
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
        this.eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED,
            (deviceBroadcastStatus: DeviceBroadcastStatus) => {
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
            this.log.debug('Home Assistant MQTT auto discovery enabled, sending discovery messages')
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


        }
    }

    private sendDeviceMode(device: Device) {
        const mode = device.operatingMode === OperatingMode[OperatingMode.OFF] ? 'off' : 'fan_only';
        this.publish(this.getDevicePublishTopic(process.env.MODE_STATE_TOPIC, device.serialNumber), mode);
    }

    private sendDeviceAction(device: Device) {
        const action = device.operatingMode === OperatingMode[OperatingMode.OFF] ? 'off' : 'fan';
        this.publish(this.getDevicePublishTopic(process.env.ACTION_STATE_TOPIC, device.serialNumber), action);
    }

    private sendDeviceOperatingMode(device: Device) {
        // Check if we have a stored command that should override the device's reported mode
        const storedMode = this.deviceStorageService.getStoredOperatingMode(device.serialNumber);
        const modeToPublish = storedMode || device.operatingMode;
        
        this.publish(this.getDevicePublishTopic(process.env.PRESET_MODE_STATE_TOPIC, device.serialNumber),
            modeToPublish)
    }

    private sendDeviceFanSpeed(device: Device) {
        if (device.fanSpeed) {
            this.publish(this.getDevicePublishTopic(process.env.FAN_MODE_STATE_TOPIC, device.serialNumber),
                device.fanSpeed.toLowerCase())
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

    private sendFanStatus(deviceBroadcastStatus: DeviceBroadcastStatus) {
        if (deviceBroadcastStatus.serialNumber) {
            this.publish(this.getDevicePublishTopic(process.env.FAN_STATUS_TOPIC, deviceBroadcastStatus.serialNumber),
                deviceBroadcastStatus.fanStatus.toString());
        }
    }

    private sendFanMode(deviceBroadcastStatus: DeviceBroadcastStatus) {
        if (deviceBroadcastStatus.serialNumber) {
            this.publish(this.getDevicePublishTopic(process.env.FAN_MODE_TOPIC, deviceBroadcastStatus.serialNumber),
                deviceBroadcastStatus.fanMode.toString());
        }
    }

    private publish(topic: string, message: string): void {
        if (this.mqttClient.connected) {
            this.log.debug(`mqtt publish %o to %o`, message, topic);
            this.mqttClient.publish(topic, message, (err) => {
                if (err) {
                    this.log.log(`mqtt publish error occur on publish to ${topic} with message ${message}: `, err);
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
                subscriptionTopics.forEach(topic => {
                    this.subscribeToTopic(topic);
                })
                this.deviceTopicSubscriptions.add(serialNumber);
            }
        }
    }

    private unsubscribeDeviceSubscriptions(serialNumber: string): void {
        if (this.mqttClient.connected) {
            if (!this.deviceTopicSubscriptions.has(serialNumber)) {
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
        topics.push((process.env.WEATHER_UPDATE_TOPIC || ''));
        return topics;
    }

    private subscribeToTopic(topic: string): void {
        this.mqttClient.subscribe(topic, (err) => {
            if (err) {
                this.log.error(`mqtt subscription error to ${topic}: `, err);
            } else {
                this.log.debug(`mqtt subscription to ${topic}`);
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
        this.log.debug(`mqtt received ${message.toString()} from topic ${topic}`);
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
            this.log.debug('Home Assistant went online, send discovery messages')
            this.deviceStorageService.getDevices((devices: DeviceDto[]) => {
                if (devices) {
                    devices.forEach((deviceDto: DeviceDto) => {
                        const device = this.deviceMapper.deviceFromDto(deviceDto);
                        if (this.deviceTopicSubscriptions.has(device.serialNumber)) {
                            this.sendDeviceDiscoveryMessages(device);
                        }
                    });
                }
            });
        }
    }

    private handleWeatherUpdate(message: Buffer): void {
        const weatherUpdate = JSON.parse(message.toString()) as WeatherUpdateDto;
        this.eventService.deviceWeatherUpdate(weatherUpdate);
    }

    private handleFilterReset(serialNumber: string | undefined): void {
        if (serialNumber) {
            this.eventService.deviceFilterReset(serialNumber);
        } else {
            this.log.warn(`Could not find serial number in filter reset topic`);
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
            } else {
                this.log.warn(`Could not build command for ${serialNumber} from ${message} on ${topic}`);
            }
        } else {
            this.log.warn(`Could not find serial number in command topic ${topic}`);
        }
    }

    private extractSerialNumberFromTopic(topic: string): string | undefined {
        const matches = topic.match(/(?<serial>[a-f0-9]{12})/);
        if (matches !== null && matches.groups) {
            const serialNumber = matches.groups.serial;
            if (this.deviceTopicSubscriptions.has(serialNumber)) {
                return serialNumber;
            }
        }
    }

    private getOperatingDtoFromTopic(serialNumber: string, topic: string, message: Buffer): OperatingModeDto | undefined {
        const dto: OperatingModeDto = {} as OperatingModeDto;
        const messageString = message.toString();
        switch (topic) {
            case process.env.TARGET_HUMIDITY_COMMAND_TOPIC?.replace('%serialNumber', serialNumber):
                dto.humidityLevel = this.getHumidityLevel(messageString);
                return dto;
            case process.env.FAN_MODE_COMMAND_TOPIC?.replace('%serialNumber', serialNumber):
                dto.fanSpeed = messageString.toUpperCase();
                return dto;
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

}
