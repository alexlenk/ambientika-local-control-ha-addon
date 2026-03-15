import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceDto } from '../../dto/device.dto';
import { AppEvents } from '../../models/enum/app-events.enum';

// Capture the cron job callback registered by SchedulerService
let capturedJobCallback: (() => void) | null = null;

vi.mock('node-schedule', () => ({
    scheduleJob: vi.fn((_expr: unknown, cb: () => void) => {
        capturedJobCallback = cb;
        return { cancel: vi.fn() };
    }),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { SchedulerService } from '../../services/scheduler.service';
import { EventService } from '../../services/event.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} as any;

function makeDto(overrides: Partial<DeviceDto> = {}): DeviceDto {
    return {
        id: 1, serialNumber: 'aabbccddeeff', status: 'ONLINE',
        lastUpdate: new Date().toISOString(),
        firstSeen: new Date(Date.now() - 120000).toISOString(),
        operatingMode: 'AUTO', fanSpeed: 'LOW', humidityLevel: 'NORMAL',
        temperature: 22, humidity: 55, airQuality: 'GOOD', humidityAlarm: false,
        filterStatus: 'GOOD', nightAlarm: false, deviceRole: 'MASTER',
        remoteAddress: '192.168.1.1', lastOperatingMode: 'SMART', lightSensitivity: 'LOW',
        ...overrides,
    };
}

describe('SchedulerService', () => {
    let eventService: EventService;
    let mockStorage: any;

    beforeEach(() => {
        vi.clearAllMocks();
        capturedJobCallback = null;
        eventService = new EventService(mockLog);
        mockStorage = { getDevices: vi.fn() };
        // Instantiate — registers the scheduleJob callback
        new SchedulerService(mockLog, mockStorage, eventService);
    });

    it('registers a cron job in the constructor', () => {
        expect(capturedJobCallback).not.toBeNull();
    });

    it('emits DEVICE_OFFLINE for devices whose lastUpdate is older than staleTimeout', () => {
        // Set DEVICE_STALE_TIMEOUT=10 seconds, but device lastUpdate was 120 seconds ago
        process.env.DEVICE_STALE_TIMEOUT = '10';
        const staleDate = new Date(Date.now() - 120000).toISOString();
        const dto = makeDto({ lastUpdate: staleDate });

        mockStorage.getDevices.mockImplementation((cb: (dtos: DeviceDto[]) => void) => cb([dto]));

        const offlineListener = vi.fn();
        eventService.on(AppEvents.DEVICE_OFFLINE, offlineListener);

        capturedJobCallback!();

        expect(offlineListener).toHaveBeenCalledOnce();
        expect(offlineListener.mock.calls[0][0].serialNumber).toBe('aabbccddeeff');
    });

    it('does NOT emit DEVICE_OFFLINE for devices updated recently', () => {
        process.env.DEVICE_STALE_TIMEOUT = '60';
        const freshDate = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
        const dto = makeDto({ lastUpdate: freshDate });

        mockStorage.getDevices.mockImplementation((cb: (dtos: DeviceDto[]) => void) => cb([dto]));

        const offlineListener = vi.fn();
        eventService.on(AppEvents.DEVICE_OFFLINE, offlineListener);

        capturedJobCallback!();

        expect(offlineListener).not.toHaveBeenCalled();
    });

    it('handles multiple devices — only emits offline for stale ones', () => {
        process.env.DEVICE_STALE_TIMEOUT = '10';
        const staleDto = makeDto({ serialNumber: 'aabbccddeeff', lastUpdate: new Date(Date.now() - 120000).toISOString() });
        const freshDto = makeDto({ serialNumber: '112233445566', lastUpdate: new Date(Date.now() - 5000).toISOString() });

        mockStorage.getDevices.mockImplementation((cb: (dtos: DeviceDto[]) => void) => cb([staleDto, freshDto]));

        const offlineListener = vi.fn();
        eventService.on(AppEvents.DEVICE_OFFLINE, offlineListener);

        capturedJobCallback!();

        expect(offlineListener).toHaveBeenCalledOnce();
        expect(offlineListener.mock.calls[0][0].serialNumber).toBe('aabbccddeeff');
    });

    it('does nothing when no devices are returned', () => {
        mockStorage.getDevices.mockImplementation((cb: (dtos: DeviceDto[]) => void) => cb([]));
        const offlineListener = vi.fn();
        eventService.on(AppEvents.DEVICE_OFFLINE, offlineListener);
        capturedJobCallback!();
        expect(offlineListener).not.toHaveBeenCalled();
    });
});
