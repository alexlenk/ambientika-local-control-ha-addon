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
});
