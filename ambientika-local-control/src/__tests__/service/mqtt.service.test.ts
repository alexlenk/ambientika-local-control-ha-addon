import { describe, it, expect, vi, beforeEach } from 'vitest';
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
