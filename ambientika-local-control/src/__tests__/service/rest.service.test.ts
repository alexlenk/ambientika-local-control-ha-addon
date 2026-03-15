import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceDto } from '../../dto/device.dto';

// Capture route handlers set up by RestService
const routeHandlers: Record<string, (req: any, res: any) => void> = {};

vi.mock('express', () => {
    const mockApp = {
        use: vi.fn(),
        listen: vi.fn((_port: unknown, cb?: () => void) => { if (cb) cb(); }),
        get: vi.fn((path: string, handler: (req: any, res: any) => void) => {
            routeHandlers[`GET:${path}`] = handler;
        }),
        post: vi.fn((path: string, handler: (req: any, res: any) => void) => {
            routeHandlers[`POST:${path}`] = handler;
        }),
    };
    const express = vi.fn(() => mockApp) as any;
    express.json = vi.fn(() => ({}));
    express.Router = vi.fn(() => mockApp);
    return { default: express };
});

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { RestService } from '../../services/rest.service';
import { EventService } from '../../services/event.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} as any;

function makeDto(sn = 'aabbccddeeff'): DeviceDto {
    return {
        id: 1, serialNumber: sn, status: 'ONLINE',
        lastUpdate: new Date().toISOString(), firstSeen: new Date().toISOString(),
        operatingMode: 'AUTO', fanSpeed: 'LOW', humidityLevel: 'NORMAL',
        temperature: 22, humidity: 55, airQuality: 'GOOD', humidityAlarm: false,
        filterStatus: 'GOOD', nightAlarm: false, deviceRole: 'MASTER',
        remoteAddress: '192.168.1.1', lastOperatingMode: 'SMART', lightSensitivity: 'LOW',
    };
}

describe('RestService', () => {
    let eventService: EventService;
    let mockStorage: any;

    beforeEach(() => {
        vi.clearAllMocks();
        eventService = new EventService(mockLog);
        mockStorage = {
            findExistingDeviceBySerialNumber: vi.fn(),
            getDevices: vi.fn(),
        };
        // Instantiate — this registers all route handlers
        new RestService(mockLog, mockStorage, eventService);
    });

    describe('GET /device/status/:serialNumber', () => {
        it('returns 200 with device DTO when device is found', () => {
            const dto = makeDto();
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(dto)
            );
            const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
            routeHandlers['GET:/device/status/:serialNumber']({ params: { serialNumber: 'aabbccddeeff' } }, res);

            expect(mockStorage.findExistingDeviceBySerialNumber).toHaveBeenCalledWith('aabbccddeeff', expect.any(Function));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith(dto);
        });

        it('returns 404 when device is not found', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(undefined)
            );
            const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
            routeHandlers['GET:/device/status/:serialNumber']({ params: { serialNumber: 'notfound' } }, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.send).toHaveBeenCalledWith('Not Found');
        });
    });

    describe('POST /device/operating-mode/:serialNumber', () => {
        it('emits DEVICE_OPERATING_MODE_UPDATE and sends empty response', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceOperatingModeUpdate');
            const res = { send: vi.fn() };
            const opMode = { operatingMode: 'NIGHT', fanSpeed: 'HIGH' };
            routeHandlers['POST:/device/operating-mode/:serialNumber']({ params: { serialNumber: 'aabbccddeeff' }, body: opMode }, res);

            expect(emitSpy).toHaveBeenCalledWith(opMode, 'aabbccddeeff');
            expect(res.send).toHaveBeenCalled();
        });
    });

    describe('POST /device/reset-filter/:serialNumber', () => {
        it('emits DEVICE_FILTER_RESET and sends empty response', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceFilterReset');
            const res = { send: vi.fn() };
            routeHandlers['POST:/device/reset-filter/:serialNumber']({ params: { serialNumber: 'aabbccddeeff' }, body: {} }, res);

            expect(emitSpy).toHaveBeenCalledWith('aabbccddeeff');
            expect(res.send).toHaveBeenCalled();
        });
    });

    describe('POST /device/weather-update', () => {
        it('emits DEVICE_WEATHER_UPDATE and sends empty response', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceWeatherUpdate');
            const res = { send: vi.fn() };
            const weatherDto = { temperature: 23.5, humidity: 60, airQuality: 1 };
            routeHandlers['POST:/device/weather-update']({ params: {}, body: weatherDto }, res);

            expect(emitSpy).toHaveBeenCalledWith(weatherDto);
            expect(res.send).toHaveBeenCalled();
        });
    });
});
