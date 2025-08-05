import {HaAutoDiscoverClimateInterface} from '../models/ha-auto-discover-climate.interface';
import dotenv from 'dotenv'
import {MqttService} from './mqtt.service';
import {Device} from '../models/device.model';
import {HaAutoDiscoverDeviceAttributes} from '../models/ha-auto-discover-device-attributes.interface';

dotenv.config()

export class HAAutoDiscoveryService {


    constructor(private mqttService: MqttService) {
    }

    getClimateDeviceDiscoveryMessage(device: Device): string {
        const climateDeviceDiscovery: HaAutoDiscoverClimateInterface = {
            name: null,
            unique_id: 'climate_' + device.serialNumber,
            device: {
                identifiers: [device.serialNumber],
                serial_number: device.serialNumber,
                manufacturer: 'Südwind',
                model: 'Ghost',
                name: process.env.HOME_ASSISTANT_DEVICE_NAME_PREFIX + ' ' + device.serialNumber
            },
            action_topic: this.mqttService.getDevicePublishTopic(process.env.ACTION_STATE_TOPIC,
                device.serialNumber),
            availability_topic: this.mqttService.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC,
                device.serialNumber),
            current_humidity_topic: this.mqttService.getDevicePublishTopic(process.env.CURRENT_HUMIDITY_TOPIC,
                device.serialNumber),
            target_humidity_state_topic: this.mqttService.getDevicePublishTopic(process.env.TARGET_HUMIDITY_STATE_TOPIC,
                device.serialNumber),
            target_humidity_command_topic: this.mqttService.getDevicePublishTopic(
                process.env.TARGET_HUMIDITY_COMMAND_TOPIC, device.serialNumber),
            current_temperature_topic: this.mqttService.getDevicePublishTopic(process.env.CURRENT_TEMPERATURE_TOPIC,
                device.serialNumber),
            fan_mode_state_topic: this.mqttService.getDevicePublishTopic(process.env.FAN_MODE_STATE_TOPIC,
                device.serialNumber),
            fan_mode_command_topic: this.mqttService.getDevicePublishTopic(process.env.FAN_MODE_COMMAND_TOPIC,
                device.serialNumber),
            mode_state_topic: this.mqttService.getDevicePublishTopic(process.env.MODE_STATE_TOPIC,
                device.serialNumber),
            mode_command_topic: this.mqttService.getDevicePublishTopic(process.env.MODE_COMMAND_TOPIC,
                device.serialNumber),
            preset_mode_state_topic: this.mqttService.getDevicePublishTopic(process.env.PRESET_MODE_STATE_TOPIC,
                device.serialNumber),
            preset_mode_command_topic: this.mqttService.getDevicePublishTopic(process.env.PRESET_MODE_COMMAND_TOPIC,
                device.serialNumber),
            preset_modes: (process.env.HOME_ASSISTANT_CLIMATE_DISCOVERY_PRESET_MODES?.split(',') || []),
            modes: ['off', 'fan_only'],
            fan_modes: ['low', 'medium', 'high']
        } as HaAutoDiscoverClimateInterface;

        return JSON.stringify(climateDeviceDiscovery);
    }

    getNightAlarmBinarySensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:weather-night'
        };
        return this.getBinarySensorDiscoveryMessage('night_alarm', process.env.NIGHT_ALARM_TOPIC, device, attributes);
    }

    getHumidityAlarmBinarySensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:water-percent-alert'
        };
        return this.getBinarySensorDiscoveryMessage('humidity_alarm', process.env.HUMIDITY_ALARM_TOPIC, device, attributes);
    }

    getCloudAvailabilityBinarySensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:cloud-check-variant'
        };
        return this.getBinarySensorDiscoveryMessage('cloud_availability', process.env.CLOUD_AVAILABILITY_TOPIC, device, attributes);
    }

    getAirQualitySensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:blur'
        };
        return this.getSensorDiscoveryMessage('air_quality', process.env.CURRENT_AIR_QUALITY_TOPIC, device, attributes);
    }

    getFilterStatusSensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:air-filter'
        };
        return this.getSensorDiscoveryMessage('filter_status', process.env.FILTER_STATUS_TOPIC, device, attributes);
    }

    getFanStatusSensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:fan-remove'
        };
        return this.getSensorDiscoveryMessage('fan_status', process.env.FAN_STATUS_TOPIC, device, attributes);
    }

    getFanModeSensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:fan-clock'
        };
        return this.getSensorDiscoveryMessage('fan_mode', process.env.FAN_MODE_TOPIC, device, attributes);
    }

    getFilterResetButtonMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:air-filter'
        };
        return this.getButtonDiscoveryMessage('filter_reset', process.env.FILTER_RESET_TOPIC, device, attributes);
    }

    getHumidityStatusSensorMessage(device: Device): string {
        const attributes: HaAutoDiscoverDeviceAttributes = {
            state_class: 'measurement',
            unit_of_measurement: '%',
            device_class: 'humidity'
        };
        return this.getSensorDiscoveryMessage('humidity', process.env.CURRENT_HUMIDITY_TOPIC, device, attributes);
    }

    getLightSensitivitySensorMessage(device: Device): string {
        const options = ['OFF', 'LOW', 'MEDIUM'];
        const attributes: HaAutoDiscoverDeviceAttributes = {
            icon: 'mdi:brightness-6'
        };
        return this.getSelectDiscoveryMessage('light_sensitivity', process.env.LIGHT_SENSITIVITY_TOPIC,
            process.env.LIGHT_SENSITIVITY_COMMAND_TOPIC, device, options, attributes);
    }

    private getBinarySensorDiscoveryMessage(type: string, topic: string | undefined, device: Device,
                                            attributes?: HaAutoDiscoverDeviceAttributes): string {
        const binarySensorDiscovery = {
            name: type,
            unique_id: type + '_' + device.serialNumber,
            state_topic: this.mqttService.getDevicePublishTopic(topic,
                device.serialNumber),
            payload_off: 'false',
            payload_on: 'true',
            availability_topic: this.mqttService.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC,
                device.serialNumber),
            device: {
                identifiers: [device.serialNumber]
            },
            ...attributes
        };
        return JSON.stringify(binarySensorDiscovery);
    }

    private getSensorDiscoveryMessage(type: string, topic: string | undefined, device: Device,
                                      attributes?: HaAutoDiscoverDeviceAttributes): string {
        const sensorDiscovery = {
            name: type,
            unique_id: type + '_' + device.serialNumber,
            state_topic: this.mqttService.getDevicePublishTopic(topic,
                device.serialNumber),
            availability_topic: this.mqttService.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC,
                device.serialNumber),
            device: {
                identifiers: [device.serialNumber],
            },
            ...attributes
        };
        return JSON.stringify(sensorDiscovery);
    }

    private getSelectDiscoveryMessage(type: string, stateTopic: string | undefined,
                                       commandTopic: string | undefined, device: Device, options: string[],
                                       attributes?: HaAutoDiscoverDeviceAttributes): string {
        const sensorDiscovery = {
            name: type,
            unique_id: type + '_' + device.serialNumber,
            state_topic: this.mqttService.getDevicePublishTopic(stateTopic, device.serialNumber),
            availability_topic: this.mqttService.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC,
                device.serialNumber),
            command_topic: this.mqttService.getDevicePublishTopic(commandTopic, device.serialNumber),
            options: options,
            device: {
                identifiers: [device.serialNumber]
            },
            ...attributes
        };
        return JSON.stringify(sensorDiscovery);
    }

    private getButtonDiscoveryMessage(type: string, commandTopic: string | undefined, device: Device,
                                       attributes?: HaAutoDiscoverDeviceAttributes): string {
        const sensorDiscovery = {
            name: type,
            unique_id: type + '_' + device.serialNumber,
            availability_topic: this.mqttService.getDevicePublishTopic(process.env.AVAILABILITY_TOPIC,
                device.serialNumber),
            command_topic: this.mqttService.getDevicePublishTopic(commandTopic, device.serialNumber),
            device: {
                identifiers: [device.serialNumber]
            },
            ...attributes
        };
        return JSON.stringify(sensorDiscovery);
    }
}
