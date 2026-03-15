import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppEvents } from '../../models/enum/app-events.enum';
import { Device } from '../../models/device.model';

// Captured MQTT event handlers
const mqttEventHandlers: Record<string, (...args: any[]) => void> = {};
const mockMqttClient = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        mqttEventHandlers[event] = handler;
    }),
    subscribe: vi.fn((_topics: unknown, cb?: (err: Error | null) => void) => { if (cb) cb(null); }),
    unsubscribe: vi.fn((_topic: unknown, cb?: (err: Error | null) => void) => { if (cb) cb(null); }),
    publish: vi.fn((_topic: string, _msg: string, cb?: (err?: Error) => void) => { if (cb) cb(); }),
    connected: true,
};

vi.mock('mqtt', () => ({
    connect: vi.fn(() => mockMqttClient),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

// Mock sqlite3 so DeviceStorageService dependency doesn't need native compilation
vi.mock('sqlite3', () => {
    const mockDb = { run: vi.fn(), get: vi.fn(), all: vi.fn(), exec: vi.fn() };
    return {
        default: { Database: vi.fn().mockReturnValue(mockDb) },
        Database: vi.fn().mockReturnValue(mockDb),
    };
});
vi.mock('node:fs', () => ({
    default: { existsSync: vi.fn().mockReturnValue(true) },
    existsSync: vi.fn().mockReturnValue(true),
}));

import { MqttService } from '../../services/mqtt.service';
import { EventService } from '../../services/event.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
} as any;

function makeDevice(sn = 'aabbccddeeff'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

const mockStorage = {
    findExistingDeviceBySerialNumber: vi.fn(),
    findExistingDeviceByRemoteAddress: vi.fn(),
    getDevices: vi.fn(),
    getStoredOperatingMode: vi.fn().mockReturnValue(undefined),
    getStoredFanSpeed: vi.fn().mockReturnValue(undefined),
    hasStoredCommand: vi.fn().mockReturnValue(false),
} as any;

describe('MqttService', () => {
    let service: MqttService;
    let eventService: EventService;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(mqttEventHandlers).forEach(k => delete mqttEventHandlers[k]);
        eventService = new EventService(mockLog);
        service = new MqttService(mockLog, eventService, mockStorage);
    });

    describe('BUG 2 REGRESSION — MQTT subscription leak on device offline', () => {
        it('calls mqttClient.unsubscribe when device goes offline and subscription is tracked', () => {
            // Add device to subscriptions
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');

            // Trigger offline
            const device = makeDevice();
            eventService.deviceOffline(device);

            expect(mockMqttClient.unsubscribe).toHaveBeenCalled();
        });

        it('does NOT call unsubscribe if device was never subscribed', () => {
            // Device NOT in subscriptions set
            const device = makeDevice();
            eventService.deviceOffline(device);

            expect(mockMqttClient.unsubscribe).not.toHaveBeenCalled();
        });

        it('removes device from deviceTopicSubscriptions after going offline', () => {
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');
            const device = makeDevice();
            eventService.deviceOffline(device);

            expect((service as any).deviceTopicSubscriptions.has('aabbccddeeff')).toBe(false);
        });
    });

    describe('BUG 3 REGRESSION — handleWeatherUpdate JSON parse is guarded', () => {
        it('does not throw on invalid JSON weather message', () => {
            expect(() =>
                (service as any).handleWeatherUpdate(Buffer.from('not-json'))
            ).not.toThrow();
        });

        it('logs an error on invalid JSON weather message', () => {
            (service as any).handleWeatherUpdate(Buffer.from('not-json'));
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to parse weather update'),
                expect.anything()
            );
        });

        it('emits DEVICE_WEATHER_UPDATE for valid JSON weather message', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_WEATHER_UPDATE, listener);
            const dto = { temperature: 22.5, humidity: 55, airQuality: 1 };
            (service as any).handleWeatherUpdate(Buffer.from(JSON.stringify(dto)));
            expect(listener).toHaveBeenCalledWith(dto);
        });
    });

    describe('subscribeDeviceSubscriptions', () => {
        it('calls batchSubscribeToTopics and tracks the serial number', () => {
            const subscribeSpy = vi.spyOn(service as any, 'batchSubscribeToTopics');
            (service as any).subscribeDeviceSubscriptions('aabbccddeeff');
            expect(subscribeSpy).toHaveBeenCalled();
            expect((service as any).deviceTopicSubscriptions.has('aabbccddeeff')).toBe(true);
        });
    });

    describe('getHumidityLevel', () => {
        it('returns DRY for humidity <= 40', () => {
            expect((service as any).getHumidityLevel('40')).toBe('0'); // HumidityLevel.DRY = 0
        });

        it('returns NORMAL for humidity between 41-60', () => {
            expect((service as any).getHumidityLevel('60')).toBe('1'); // HumidityLevel.NORMAL = 1
        });

        it('returns MOIST for humidity > 60', () => {
            expect((service as any).getHumidityLevel('75')).toBe('2'); // HumidityLevel.MOIST = 2
        });
    });

    describe('handleFilterReset', () => {
        it('emits DEVICE_FILTER_RESET when serialNumber is defined', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_FILTER_RESET, listener);
            (service as any).handleFilterReset('aabbccddeeff');
            expect(listener).toHaveBeenCalledWith('aabbccddeeff');
        });

        it('logs a warning when serialNumber is undefined', () => {
            (service as any).handleFilterReset(undefined);
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find serial number'));
        });
    });

    describe('mqttClient events', () => {
        it('subscribes to HA status topic on MQTT connect', () => {
            process.env.HOME_ASSISTANT_STATUS_TOPIC = 'homeassistant/status';
            mqttEventHandlers['connect']?.();
            expect(mockMqttClient.subscribe).toHaveBeenCalledWith('homeassistant/status', expect.any(Function));
        });

        it('clears deviceTopicSubscriptions on reconnect', () => {
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');
            mqttEventHandlers['reconnect']?.();
            expect((service as any).deviceTopicSubscriptions.size).toBe(0);
        });

        it('clears deviceTopicSubscriptions on error', () => {
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');
            mqttEventHandlers['error']?.(new Error('connection refused'));
            expect((service as any).deviceTopicSubscriptions.size).toBe(0);
        });
    });

    describe('DEVICE_STATUS_UPDATE_RECEIVED event listener', () => {
        beforeEach(() => {
            process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';
            process.env.MODE_STATE_TOPIC = 'ambientika/%serialNumber/mode/state';
            process.env.ACTION_STATE_TOPIC = 'ambientika/%serialNumber/action';
            process.env.FAN_MODE_STATE_TOPIC = 'ambientika/%serialNumber/fan-mode/state';
            process.env.CURRENT_TEMPERATURE_TOPIC = 'ambientika/%serialNumber/temperature';
            process.env.CURRENT_HUMIDITY_TOPIC = 'ambientika/%serialNumber/humidity';
            process.env.TARGET_HUMIDITY_STATE_TOPIC = 'ambientika/%serialNumber/target-humidity/state';
            process.env.CURRENT_HUMIDITY_LEVEL_TOPIC = 'ambientika/%serialNumber/humidity-level';
            process.env.CURRENT_AIR_QUALITY_TOPIC = 'ambientika/%serialNumber/air-quality';
            process.env.HUMIDITY_ALARM_TOPIC = 'ambientika/%serialNumber/humidity-alarm';
            process.env.FILTER_STATUS_TOPIC = 'ambientika/%serialNumber/filter-status';
            process.env.NIGHT_ALARM_TOPIC = 'ambientika/%serialNumber/night-alarm';
            process.env.LIGHT_SENSITIVITY_TOPIC = 'ambientika/%serialNumber/light-sensitivity/state';
            process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
            process.env.FAN_STATUS_TOPIC = 'ambientika/%serialNumber/fan-status';
            process.env.FAN_MODE_TOPIC = 'ambientika/%serialNumber/fan-mode';
        });

        it('calls mqttClient.publish multiple times when device status update is received', () => {
            const device = makeDevice();
            eventService.deviceStatusUpdate(device);

            expect(mockMqttClient.publish).toHaveBeenCalled();
        });

        it('sends device availability "online" when device status update is received', () => {
            process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
            const device = makeDevice('aabbccddeeff');
            eventService.deviceStatusUpdate(device);

            const availabilityCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('availability')
            );
            expect(availabilityCalls.some(([, msg]: [string, string]) => msg === 'online')).toBe(true);
        });

        it('sends device offline availability on DEVICE_OFFLINE event', () => {
            const device = makeDevice('aabbccddeeff');
            eventService.deviceOffline(device);

            const availabilityCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('availability')
            );
            expect(availabilityCalls.some(([, msg]: [string, string]) => msg === 'offline')).toBe(true);
        });

        it('subscribes device topics when device status update received and not yet subscribed', () => {
            const device = makeDevice('aabbccddeeff');
            eventService.deviceStatusUpdate(device);

            expect((service as any).deviceTopicSubscriptions.has('aabbccddeeff')).toBe(true);
        });

        it('does not call sendDeviceDiscoveryMessages when device already subscribed', () => {
            const sendDiscoverySpy = vi.spyOn(service as any, 'sendDeviceDiscoveryMessages');
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');
            const device = makeDevice('aabbccddeeff');
            eventService.deviceStatusUpdate(device);

            expect(sendDiscoverySpy).not.toHaveBeenCalled();
        });
    });

    describe('handleMessages routing', () => {
        beforeEach(() => {
            process.env.HOME_ASSISTANT_STATUS_TOPIC = 'homeassistant/status';
            process.env.WEATHER_UPDATE_TOPIC = 'ambientika/weather';
            process.env.FAN_MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/fan-mode/set';
            process.env.PRESET_MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/preset/set';
            process.env.MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/mode/set';
            process.env.TARGET_HUMIDITY_COMMAND_TOPIC = 'ambientika/%serialNumber/target-humidity/set';
            process.env.FILTER_RESET_TOPIC = 'ambientika/%serialNumber/filter-reset';
            process.env.DEVICE_SETUP_COMMAND_TOPIC = 'ambientika/%serialNumber/setup';
            process.env.DEVICE_SETUP_JSON_TOPIC = 'ambientika/%serialNumber/setup-json';
            process.env.RAW_COMMAND_TOPIC = 'ambientika/%serialNumber/raw';
            process.env.LIGHT_SENSITIVITY_COMMAND_TOPIC = 'ambientika/%serialNumber/light-sensitivity/set';
            // Pre-register device serial number so extractSerialNumberFromTopic succeeds
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');
        });

        it('routes weather update topic to handleWeatherUpdate', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_WEATHER_UPDATE, listener);
            const dto = { temperature: 22.5, humidity: 60, airQuality: 1 };
            mqttEventHandlers['message']?.('ambientika/weather', Buffer.from(JSON.stringify(dto)));

            expect(listener).toHaveBeenCalledWith(dto);
        });

        it('routes fan mode command topic to deviceOperatingModeUpdate', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, listener);
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/fan-mode/set',
                Buffer.from('low')
            );

            expect(listener).toHaveBeenCalled();
        });

        it('ignores invalid fan speed values', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, listener);
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/fan-mode/set',
                Buffer.from('invalid_speed')
            );

            expect(listener).not.toHaveBeenCalled();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Invalid fan speed')
            );
        });

        it('routes preset mode command topic to deviceOperatingModeUpdate', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, listener);
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/preset/set',
                Buffer.from('NIGHT')
            );

            expect(listener).toHaveBeenCalled();
        });

        it('routes filter reset topic to deviceFilterReset', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_FILTER_RESET, listener);
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/filter-reset',
                Buffer.from('')
            );

            expect(listener).toHaveBeenCalledWith('aabbccddeeff');
        });

        it('routes device setup JSON topic to deviceSetupUpdate', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_SETUP_UPDATE, listener);
            const setupJson = { role: 'MASTER', zone: 0, houseId: 1 };
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/setup-json',
                Buffer.from(JSON.stringify(setupJson))
            );

            expect(listener).toHaveBeenCalled();
        });

        it('logs error for invalid JSON device setup', () => {
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/setup-json',
                Buffer.from('not-json')
            );

            expect(mockLog.error).toHaveBeenCalled();
        });

        it('logs error for JSON setup with missing required fields', () => {
            const incompleteSetup = { role: 'MASTER' }; // missing zone and houseId
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/setup-json',
                Buffer.from(JSON.stringify(incompleteSetup))
            );

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('missing required fields')
            );
        });

        it('warns for unknown topic (topic has serial but no known command)', () => {
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/unknown-command',
                Buffer.from('value')
            );

            expect(mockLog.warn).toHaveBeenCalled();
        });

        it('warns when serial number not found in topic', () => {
            mqttEventHandlers['message']?.(
                'ambientika/no-serial-here/command',
                Buffer.from('value')
            );

            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe('mqttClient reconnect and error events', () => {
        it('logs info on reconnect', () => {
            mqttEventHandlers['reconnect']?.();
            expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('reconnecting'));
        });

        it('logs error on error event', () => {
            mqttEventHandlers['error']?.(new Error('connection refused'));
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('MqttService error'),
                expect.any(Error)
            );
        });
    });

    describe('sendDeviceDiscoveryMessages with HOME_ASSISTANT_AUTO_DISCOVERY=true', () => {
        beforeEach(() => {
            process.env.HOME_ASSISTANT_AUTO_DISCOVERY = 'true';
            process.env.HOME_ASSISTANT_CLIMATE_DISCOVERY_TOPIC = 'homeassistant/climate/%serialNumber/config';
            process.env.HOME_ASSISTANT_BINARY_SENSOR_DISCOVERY_TOPIC = 'homeassistant/binary_sensor/%serialNumber/%sensorId/config';
            process.env.HOME_ASSISTANT_SENSOR_DISCOVERY_TOPIC = 'homeassistant/sensor/%serialNumber/%sensorId/config';
            process.env.HOME_ASSISTANT_BUTTON_DISCOVERY_TOPIC = 'homeassistant/button/%serialNumber/%sensorId/config';
            process.env.HOME_ASSISTANT_SELECT_DISCOVERY_TOPIC = 'homeassistant/select/%serialNumber/%sensorId/config';
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
        });

        afterEach(() => {
            delete process.env.HOME_ASSISTANT_AUTO_DISCOVERY;
            delete process.env.CLOUD_SYNC_ENABLED;
        });

        it('calls publish multiple times inside setImmediate when device not yet subscribed', async () => {
            const device = makeDevice('aabbccddeeff');
            // Device not in subscriptions → triggers sendDeviceDiscoveryMessages
            eventService.deviceStatusUpdate(device);

            // Flush setImmediate callbacks
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(mockMqttClient.publish).toHaveBeenCalled();
        });

        it('also publishes cloud availability discovery when CLOUD_SYNC_ENABLED=true', async () => {
            process.env.CLOUD_SYNC_ENABLED = 'true';
            const device = makeDevice('aabbccddeeff');
            eventService.deviceStatusUpdate(device);

            await new Promise<void>(resolve => setImmediate(resolve));

            const publishCalls = mockMqttClient.publish.mock.calls.map(([topic]: [string]) => topic);
            expect(publishCalls.some((t: string) => t.includes('cloudavailability'))).toBe(true);
        });
    });

    describe('handleHAStatusMessage', () => {
        it('calls getDevices when online message received', () => {
            process.env.HOME_ASSISTANT_STATUS_TOPIC = 'homeassistant/status';
            mqttEventHandlers['message']?.('homeassistant/status', Buffer.from('online'));
            expect(mockStorage.getDevices).toHaveBeenCalled();
        });

        it('does NOT call getDevices when offline message received', () => {
            process.env.HOME_ASSISTANT_STATUS_TOPIC = 'homeassistant/status';
            mqttEventHandlers['message']?.('homeassistant/status', Buffer.from('offline'));
            expect(mockStorage.getDevices).not.toHaveBeenCalled();
        });
    });

    describe('sendFanStatusFromDevice', () => {
        beforeEach(() => {
            process.env.FAN_STATUS_TOPIC = 'ambientika/%serialNumber/fan-status';
            process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';
            process.env.MODE_STATE_TOPIC = 'ambientika/%serialNumber/mode/state';
            process.env.ACTION_STATE_TOPIC = 'ambientika/%serialNumber/action';
            process.env.FAN_MODE_STATE_TOPIC = 'ambientika/%serialNumber/fan-mode/state';
            process.env.CURRENT_TEMPERATURE_TOPIC = 'ambientika/%serialNumber/temperature';
            process.env.CURRENT_HUMIDITY_TOPIC = 'ambientika/%serialNumber/humidity';
            process.env.TARGET_HUMIDITY_STATE_TOPIC = 'ambientika/%serialNumber/target-humidity/state';
            process.env.CURRENT_HUMIDITY_LEVEL_TOPIC = 'ambientika/%serialNumber/humidity-level';
            process.env.CURRENT_AIR_QUALITY_TOPIC = 'ambientika/%serialNumber/air-quality';
            process.env.HUMIDITY_ALARM_TOPIC = 'ambientika/%serialNumber/humidity-alarm';
            process.env.FILTER_STATUS_TOPIC = 'ambientika/%serialNumber/filter-status';
            process.env.NIGHT_ALARM_TOPIC = 'ambientika/%serialNumber/night-alarm';
            process.env.LIGHT_SENSITIVITY_TOPIC = 'ambientika/%serialNumber/light-sensitivity/state';
            process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
            process.env.FAN_MODE_TOPIC = 'ambientika/%serialNumber/fan-mode';
        });

        it('publishes OFF when device operatingMode is OFF', () => {
            const device = makeDevice();
            device.operatingMode = 'OFF';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const fanStatusCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('fan-status')
            );
            expect(fanStatusCalls.some(([, msg]: [string, string]) => msg === 'OFF')).toBe(true);
        });

        it('publishes HIGH when device fanSpeed is HIGH and not OFF mode', () => {
            const device = makeDevice();
            device.operatingMode = 'AUTO';
            device.fanSpeed = 'HIGH';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const fanStatusCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('fan-status')
            );
            expect(fanStatusCalls.some(([, msg]: [string, string]) => msg === 'HIGH')).toBe(true);
        });
    });

    describe('sendFanModeFromDevice', () => {
        beforeEach(() => {
            process.env.FAN_MODE_TOPIC = 'ambientika/%serialNumber/fan-mode';
            process.env.FAN_STATUS_TOPIC = 'ambientika/%serialNumber/fan-status';
            process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';
            process.env.MODE_STATE_TOPIC = 'ambientika/%serialNumber/mode/state';
            process.env.ACTION_STATE_TOPIC = 'ambientika/%serialNumber/action';
            process.env.FAN_MODE_STATE_TOPIC = 'ambientika/%serialNumber/fan-mode/state';
            process.env.CURRENT_TEMPERATURE_TOPIC = 'ambientika/%serialNumber/temperature';
            process.env.CURRENT_HUMIDITY_TOPIC = 'ambientika/%serialNumber/humidity';
            process.env.TARGET_HUMIDITY_STATE_TOPIC = 'ambientika/%serialNumber/target-humidity/state';
            process.env.CURRENT_HUMIDITY_LEVEL_TOPIC = 'ambientika/%serialNumber/humidity-level';
            process.env.CURRENT_AIR_QUALITY_TOPIC = 'ambientika/%serialNumber/air-quality';
            process.env.HUMIDITY_ALARM_TOPIC = 'ambientika/%serialNumber/humidity-alarm';
            process.env.FILTER_STATUS_TOPIC = 'ambientika/%serialNumber/filter-status';
            process.env.NIGHT_ALARM_TOPIC = 'ambientika/%serialNumber/night-alarm';
            process.env.LIGHT_SENSITIVITY_TOPIC = 'ambientika/%serialNumber/light-sensitivity/state';
            process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
        });

        it('publishes OFF for fan-mode when operatingMode is OFF', () => {
            const device = makeDevice();
            device.operatingMode = 'OFF';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const fanModeCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.endsWith('/fan-mode')
            );
            expect(fanModeCalls.some(([, msg]: [string, string]) => msg === 'OFF')).toBe(true);
        });

        it('publishes AUTO for fan-mode when operatingMode is AUTO', () => {
            const device = makeDevice();
            device.operatingMode = 'AUTO';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const fanModeCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.endsWith('/fan-mode')
            );
            expect(fanModeCalls.some(([, msg]: [string, string]) => msg === 'AUTO')).toBe(true);
        });

        it('publishes MANUAL for fan-mode when operatingMode is NIGHT', () => {
            const device = makeDevice();
            device.operatingMode = 'NIGHT';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const fanModeCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.endsWith('/fan-mode')
            );
            expect(fanModeCalls.some(([, msg]: [string, string]) => msg === 'MANUAL')).toBe(true);
        });
    });

    describe('handleRawCommand', () => {
        beforeEach(() => {
            process.env.RAW_COMMAND_TOPIC = 'ambientika/%serialNumber/raw';
            process.env.FAN_MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/fan-mode/set';
            process.env.PRESET_MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/preset/set';
            process.env.MODE_COMMAND_TOPIC = 'ambientika/%serialNumber/mode/set';
            process.env.TARGET_HUMIDITY_COMMAND_TOPIC = 'ambientika/%serialNumber/target-humidity/set';
            process.env.FILTER_RESET_TOPIC = 'ambientika/%serialNumber/filter-reset';
            process.env.DEVICE_SETUP_COMMAND_TOPIC = 'ambientika/%serialNumber/setup';
            process.env.DEVICE_SETUP_JSON_TOPIC = 'ambientika/%serialNumber/setup-json';
            process.env.LIGHT_SENSITIVITY_COMMAND_TOPIC = 'ambientika/%serialNumber/light-sensitivity/set';
            (service as any).deviceTopicSubscriptions.add('aabbccddeeff');
        });

        it('emits localSocketDataUpdate for valid hex command', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: any) => void) => cb({
                    id: 1, serialNumber: 'aabbccddeeff', status: 'ONLINE',
                    lastUpdate: new Date().toISOString(), firstSeen: new Date().toISOString(),
                    operatingMode: 'AUTO', fanSpeed: 'LOW', humidityLevel: 'NORMAL',
                    temperature: 22, humidity: 55, airQuality: 'GOOD', humidityAlarm: false,
                    filterStatus: 'GOOD', nightAlarm: false, deviceRole: 'MASTER',
                    remoteAddress: '192.168.1.1', lastOperatingMode: 'SMART', lightSensitivity: 'LOW',
                })
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/raw',
                Buffer.from('0200aabbccddeeff01010000')
            );

            expect(listener).toHaveBeenCalled();
        });

        it('logs error for hex string with odd length', () => {
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/raw',
                Buffer.from('abc') // odd length hex
            );

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('even number')
            );
        });

        it('logs error for hex string with invalid characters', () => {
            mqttEventHandlers['message']?.(
                'ambientika/aabbccddeeff/raw',
                Buffer.from('zzzz') // invalid hex characters
            );

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid hex characters')
            );
        });
    });

    describe('sendDeviceMode', () => {
        beforeEach(() => {
            process.env.MODE_STATE_TOPIC = 'ambientika/%serialNumber/mode/state';
            process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';
            process.env.ACTION_STATE_TOPIC = 'ambientika/%serialNumber/action';
            process.env.FAN_MODE_STATE_TOPIC = 'ambientika/%serialNumber/fan-mode/state';
            process.env.CURRENT_TEMPERATURE_TOPIC = 'ambientika/%serialNumber/temperature';
            process.env.CURRENT_HUMIDITY_TOPIC = 'ambientika/%serialNumber/humidity';
            process.env.TARGET_HUMIDITY_STATE_TOPIC = 'ambientika/%serialNumber/target-humidity/state';
            process.env.CURRENT_HUMIDITY_LEVEL_TOPIC = 'ambientika/%serialNumber/humidity-level';
            process.env.CURRENT_AIR_QUALITY_TOPIC = 'ambientika/%serialNumber/air-quality';
            process.env.HUMIDITY_ALARM_TOPIC = 'ambientika/%serialNumber/humidity-alarm';
            process.env.FILTER_STATUS_TOPIC = 'ambientika/%serialNumber/filter-status';
            process.env.NIGHT_ALARM_TOPIC = 'ambientika/%serialNumber/night-alarm';
            process.env.LIGHT_SENSITIVITY_TOPIC = 'ambientika/%serialNumber/light-sensitivity/state';
            process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
            process.env.FAN_STATUS_TOPIC = 'ambientika/%serialNumber/fan-status';
            process.env.FAN_MODE_TOPIC = 'ambientika/%serialNumber/fan-mode';
        });

        it('publishes "off" to mode topic when device operatingMode is OFF', () => {
            const device = makeDevice();
            device.operatingMode = 'OFF';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const modeCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('mode/state')
            );
            expect(modeCalls.some(([, msg]: [string, string]) => msg === 'off')).toBe(true);
        });
    });

    describe('sendDeviceAction', () => {
        beforeEach(() => {
            process.env.ACTION_STATE_TOPIC = 'ambientika/%serialNumber/action';
            process.env.MODE_STATE_TOPIC = 'ambientika/%serialNumber/mode/state';
            process.env.PRESET_MODE_STATE_TOPIC = 'ambientika/%serialNumber/preset/state';
            process.env.FAN_MODE_STATE_TOPIC = 'ambientika/%serialNumber/fan-mode/state';
            process.env.CURRENT_TEMPERATURE_TOPIC = 'ambientika/%serialNumber/temperature';
            process.env.CURRENT_HUMIDITY_TOPIC = 'ambientika/%serialNumber/humidity';
            process.env.TARGET_HUMIDITY_STATE_TOPIC = 'ambientika/%serialNumber/target-humidity/state';
            process.env.CURRENT_HUMIDITY_LEVEL_TOPIC = 'ambientika/%serialNumber/humidity-level';
            process.env.CURRENT_AIR_QUALITY_TOPIC = 'ambientika/%serialNumber/air-quality';
            process.env.HUMIDITY_ALARM_TOPIC = 'ambientika/%serialNumber/humidity-alarm';
            process.env.FILTER_STATUS_TOPIC = 'ambientika/%serialNumber/filter-status';
            process.env.NIGHT_ALARM_TOPIC = 'ambientika/%serialNumber/night-alarm';
            process.env.LIGHT_SENSITIVITY_TOPIC = 'ambientika/%serialNumber/light-sensitivity/state';
            process.env.AVAILABILITY_TOPIC = 'ambientika/%serialNumber/availability';
            process.env.FAN_STATUS_TOPIC = 'ambientika/%serialNumber/fan-status';
            process.env.FAN_MODE_TOPIC = 'ambientika/%serialNumber/fan-mode';
        });

        it('publishes "off" to action topic when device operatingMode is OFF', () => {
            const device = makeDevice();
            device.operatingMode = 'OFF';
            (service as any).deviceTopicSubscriptions.add(device.serialNumber);
            eventService.deviceStatusUpdate(device);

            const actionCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('/action')
            );
            expect(actionCalls.some(([, msg]: [string, string]) => msg === 'off')).toBe(true);
        });
    });

    describe('publish when not connected', () => {
        it('does not call mqttClient.publish when not connected', () => {
            (mockMqttClient as any).connected = false;
            try {
                (service as any).publish('some/topic', 'some-message');
                expect(mockMqttClient.publish).not.toHaveBeenCalled();
            } finally {
                (mockMqttClient as any).connected = true;
            }
        });
    });

    describe('batchSubscribeToTopics error fallback', () => {
        it('falls back to individual subscriptions when batch subscribe fails', () => {
            mockMqttClient.subscribe = vi.fn((_topics: unknown, cb?: (err: Error | null) => void) => {
                if (cb) cb(new Error('batch subscribe failed'));
            });

            (service as any).batchSubscribeToTopics(['ambientika/aabbccddeeff/fan-mode/set']);

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('batch subscription error'),
                expect.any(Error)
            );
            // Restore
            mockMqttClient.subscribe = vi.fn((_topics: unknown, cb?: (err: Error | null) => void) => { if (cb) cb(null); });
        });
    });

    describe('getDeviceSensorPublishTopic', () => {
        it('returns empty string when topic is undefined', () => {
            const result = (service as any).getDeviceSensorPublishTopic(undefined, 'aabbccddeeff', 'sensor1');
            expect(result).toBe('');
        });

        it('returns interpolated topic with serialNumber and sensorId', () => {
            const result = (service as any).getDeviceSensorPublishTopic(
                'homeassistant/sensor/%serialNumber/%sensorId/config',
                'aabbccddeeff',
                'airquality'
            );
            expect(result).toBe('homeassistant/sensor/aabbccddeeff/airquality/config');
        });
    });

    describe('sendDeviceCloudAvailability', () => {
        it('does not publish when device not found by remoteAddress', () => {
            mockStorage.findExistingDeviceByRemoteAddress.mockImplementation(
                (_addr: string, cb: (d: any) => void) => cb(undefined)
            );

            (service as any).sendDeviceCloudAvailability('192.168.1.99', 'true');

            const cloudCalls = mockMqttClient.publish.mock.calls.filter(
                ([topic]: [string]) => topic.includes('cloud-availability')
            );
            expect(cloudCalls).toHaveLength(0);
        });
    });

    describe('subscribeDeviceSubscriptions when not connected', () => {
        it('does not subscribe when mqtt client is not connected', () => {
            (mockMqttClient as any).connected = false;
            try {
                (service as any).subscribeDeviceSubscriptions('newdevice');
                expect((service as any).deviceTopicSubscriptions.has('newdevice')).toBe(false);
            } finally {
                (mockMqttClient as any).connected = true;
            }
        });
    });

    describe('REMOTE_SOCKET_CONNECTED / DISCONNECTED events', () => {
        it('calls findExistingDeviceByRemoteAddress on REMOTE_SOCKET_CONNECTED', () => {
            eventService.remoteSocketConnected('192.168.1.1');
            expect(mockStorage.findExistingDeviceByRemoteAddress).toHaveBeenCalledWith(
                '192.168.1.1', expect.any(Function)
            );
        });

        it('calls findExistingDeviceByRemoteAddress on REMOTE_SOCKET_DISCONNECTED', () => {
            eventService.remoteSocketDisconnected('192.168.1.1');
            expect(mockStorage.findExistingDeviceByRemoteAddress).toHaveBeenCalledWith(
                '192.168.1.1', expect.any(Function)
            );
        });
    });
});
