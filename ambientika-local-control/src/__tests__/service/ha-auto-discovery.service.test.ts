import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Device } from '../../models/device.model';

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { HAAutoDiscoveryService } from '../../services/ha-auto-discovery.service';

function makeDevice(sn = 'aabbccddeeff'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

// Minimal MqttService mock — only getDevicePublishTopic is used by HAAutoDiscoveryService
const mockMqttService = {
    getDevicePublishTopic: vi.fn((topic: string | undefined, serialNumber: string) => {
        if (topic) return topic.replace('%serialNumber', serialNumber);
        return '';
    }),
} as any;

describe('HAAutoDiscoveryService', () => {
    let service: HAAutoDiscoveryService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.HOME_ASSISTANT_DEVICE_NAME_PREFIX = 'Ambientika';
        process.env.HOME_ASSISTANT_CLIMATE_DISCOVERY_PRESET_MODES =
            'AUTO,NIGHT,AWAY,BOOST,SMART,HOLIDAY,MANUAL,SLEEP,INTENSIVE,GEOTHERMAL,FIREPLACE,TURBO';
        process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
        process.env.ACTION_STATE_TOPIC = 'ambientika/%serialNumber/action';
        process.env.CURRENT_HUMIDITY_TOPIC = 'ambientika/%serialNumber/humidity';
        process.env.TARGET_HUMIDITY_STATE_TOPIC = 'ambientika/%serialNumber/target-humidity/state';
        process.env.TARGET_HUMIDITY_COMMAND_TOPIC = 'ambientika/%serialNumber/target-humidity/set';
        process.env.CURRENT_TEMPERATURE_TOPIC = 'ambientika/%serialNumber/temperature';
        process.env.FAN_MODE_STATE_TOPIC = 'ambientika/%serialNumber/fan-mode/state';
        process.env.FAN_MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/fan-mode/set';
        process.env.MODE_STATE_TOPIC = 'ambientika/%serialNumber/mode/state';
        process.env.MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/mode/set';
        process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';
        process.env.PRESET_MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/preset/set';
        process.env.NIGHT_ALARM_TOPIC = 'ambientika/%serialNumber/night-alarm';
        process.env.HUMIDITY_ALARM_TOPIC = 'ambientika/%serialNumber/humidity-alarm';
        process.env.CLOUD_AVAILABILITY_TOPIC = 'ambientika/%serialNumber/cloud-availability';
        process.env.CURRENT_AIR_QUALITY_TOPIC = 'ambientika/%serialNumber/air-quality';
        process.env.FILTER_STATUS_TOPIC = 'ambientika/%serialNumber/filter-status';
        process.env.FILTER_RESET_TOPIC = 'ambientika/%serialNumber/filter-reset';
        process.env.LIGHT_SENSITIVITY_TOPIC = 'ambientika/%serialNumber/light-sensitivity/state';
        process.env.LIGHT_SENSITIVITY_COMMAND_TOPIC = 'ambientika/%serialNumber/light-sensitivity/set';
        process.env.FAN_STATUS_TOPIC = 'ambientika/%serialNumber/fan-status';
        process.env.FAN_MODE_TOPIC = 'ambientika/%serialNumber/fan-mode';
        process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';

        service = new HAAutoDiscoveryService(mockMqttService);
    });

    describe('getClimateDeviceDiscoveryMessage', () => {
        it('returns valid JSON', () => {
            const device = makeDevice();
            expect(() => JSON.parse(service.getClimateDeviceDiscoveryMessage(device))).not.toThrow();
        });

        it('unique_id uses "climate_" prefix + serialNumber', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.unique_id).toBe('climate_aabbccddeeff');
        });

        it('device identifiers contains the serial number', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.device.identifiers).toContain('aabbccddeeff');
        });

        it('device name includes the prefix and serial number', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.device.name).toBe('Ambientika aabbccddeeff');
        });

        it('preset_modes is parsed from env (12 modes)', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.preset_modes).toHaveLength(12);
            expect(msg.preset_modes).toContain('AUTO');
            expect(msg.preset_modes).toContain('NIGHT');
        });

        it('modes is ["off", "fan_only"]', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.modes).toEqual(['off', 'fan_only']);
        });

        it('fan_modes is ["low", "medium", "high", "night"]', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.fan_modes).toEqual(['low', 'medium', 'high', 'night']);
        });

        it('topics are interpolated with serialNumber', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getClimateDeviceDiscoveryMessage(device));
            expect(msg.availability_topic).toContain('aabbccddeeff');
            expect(msg.availability_topic).not.toContain('%serialNumber');
        });
    });

    describe('binary sensor messages', () => {
        it('night alarm: unique_id uses "night_alarm_" prefix', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getNightAlarmBinarySensorMessage(device));
            expect(msg.unique_id).toBe('night_alarm_aabbccddeeff');
        });

        it('night alarm: payload_on is "true", payload_off is "false"', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getNightAlarmBinarySensorMessage(device));
            expect(msg.payload_on).toBe('true');
            expect(msg.payload_off).toBe('false');
        });

        it('night alarm: has icon mdi:weather-night', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getNightAlarmBinarySensorMessage(device));
            expect(msg.icon).toBe('mdi:weather-night');
        });

        it('humidity alarm: unique_id uses "humidity_alarm_" prefix', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getHumidityAlarmBinarySensorMessage(device));
            expect(msg.unique_id).toBe('humidity_alarm_aabbccddeeff');
        });

        it('cloud availability: unique_id uses "cloud_availability_" prefix', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getCloudAvailabilityBinarySensorMessage(device));
            expect(msg.unique_id).toBe('cloud_availability_aabbccddeeff');
        });
    });

    describe('sensor messages', () => {
        it('air quality: unique_id uses "air_quality_" prefix', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getAirQualitySensorMessage(device));
            expect(msg.unique_id).toBe('air_quality_aabbccddeeff');
        });

        it('filter status: has icon mdi:air-filter', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getFilterStatusSensorMessage(device));
            expect(msg.icon).toBe('mdi:air-filter');
        });

        it('humidity status: has device_class "humidity" and unit "%"', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getHumidityStatusSensorMessage(device));
            expect(msg.device_class).toBe('humidity');
            expect(msg.unit_of_measurement).toBe('%');
        });

        it('humidity status: state_class is "measurement"', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getHumidityStatusSensorMessage(device));
            expect(msg.state_class).toBe('measurement');
        });
    });

    describe('select messages', () => {
        it('light sensitivity: options are ["OFF", "LOW", "MEDIUM"]', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getLightSensitivitySensorMessage(device));
            expect(msg.options).toEqual(['OFF', 'LOW', 'MEDIUM']);
        });

        it('light sensitivity: has command_topic', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getLightSensitivitySensorMessage(device));
            expect(msg.command_topic).toBeTruthy();
            expect(msg.command_topic).toContain('aabbccddeeff');
        });

        it('light sensitivity: unique_id uses "light_sensitivity_" prefix', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getLightSensitivitySensorMessage(device));
            expect(msg.unique_id).toBe('light_sensitivity_aabbccddeeff');
        });
    });

    describe('button messages', () => {
        it('filter reset: unique_id uses "filter_reset_" prefix', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getFilterResetButtonMessage(device));
            expect(msg.unique_id).toBe('filter_reset_aabbccddeeff');
        });

        it('filter reset: has command_topic interpolated with serialNumber', () => {
            const device = makeDevice('aabbccddeeff');
            const msg = JSON.parse(service.getFilterResetButtonMessage(device));
            expect(msg.command_topic).toContain('aabbccddeeff');
            expect(msg.command_topic).not.toContain('%serialNumber');
        });

        it('filter reset: has icon mdi:air-filter', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getFilterResetButtonMessage(device));
            expect(msg.icon).toBe('mdi:air-filter');
        });

        it('filter reset: has no state_topic (it is a button)', () => {
            const device = makeDevice();
            const msg = JSON.parse(service.getFilterResetButtonMessage(device));
            expect(msg.state_topic).toBeUndefined();
        });
    });

    describe('getDevicePublishTopic delegation', () => {
        it('calls mqttService.getDevicePublishTopic for each topic field', () => {
            const device = makeDevice();
            service.getClimateDeviceDiscoveryMessage(device);
            expect(mockMqttService.getDevicePublishTopic).toHaveBeenCalled();
        });
    });
});
