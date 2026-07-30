import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceDto } from '../../dto/device.dto';

// Capture route handlers, middleware, and the serialNumber param handler set up by RestService
const routeHandlers: Record<string, (req: any, res: any) => void> = {};
const middlewaresAtRegistration: Record<string, Array<(req: any, res: any, next: () => void) => void>> = {};
const middlewares: Array<(req: any, res: any, next: () => void) => void> = [];
let paramHandler: ((req: any, res: any, next: () => void, value: string) => void) | undefined;

vi.mock('express', () => {
    const mockApp = {
        use: vi.fn((mw: (req: any, res: any, next: () => void) => void) => { middlewares.push(mw); }),
        listen: vi.fn((_port: unknown, _host: unknown, cb?: () => void) => {
            if (cb) cb();
            return { close: vi.fn((closeCb?: () => void) => { if (closeCb) closeCb(); }) };
        }),
        param: vi.fn((_name: string, handler: any) => { paramHandler = handler; }),
        get: vi.fn((path: string, handler: (req: any, res: any) => void) => {
            routeHandlers[`GET:${path}`] = handler;
            middlewaresAtRegistration[`GET:${path}`] = [...middlewares];
        }),
        post: vi.fn((path: string, handler: (req: any, res: any) => void) => {
            routeHandlers[`POST:${path}`] = handler;
            middlewaresAtRegistration[`POST:${path}`] = [...middlewares];
        }),
    };
    const express = vi.fn(() => mockApp) as any;
    express.json = vi.fn(() => (_req: any, _res: any, next: () => void) => next());
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

function makeRes() {
    return { status: vi.fn().mockReturnThis(), send: vi.fn() };
}

// Simulates Express dispatching a request through: the serialNumber param handler (if the
// route has one), then any middleware registered before this route, then the route handler.
function dispatch(key: string, req: any, res: any) {
    const invokeChain = () => {
        const mws = middlewaresAtRegistration[key] || [];
        let idx = 0;
        const next = () => {
            if (idx < mws.length) {
                mws[idx++](req, res, next);
            } else {
                routeHandlers[key](req, res);
            }
        };
        next();
    };
    if (req.params?.serialNumber !== undefined && paramHandler) {
        paramHandler(req, res, invokeChain, req.params.serialNumber);
    } else {
        invokeChain();
    }
}

describe('RestService', () => {
    let eventService: EventService;
    let mockStorage: any;
    let service: RestService;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(routeHandlers).forEach(k => delete routeHandlers[k]);
        Object.keys(middlewaresAtRegistration).forEach(k => delete middlewaresAtRegistration[k]);
        middlewares.length = 0;
        paramHandler = undefined;
        delete process.env.REST_API_TOKEN;
        delete process.env.ENABLE_DEBUG_ENDPOINTS;
        eventService = new EventService(mockLog);
        mockStorage = {
            findExistingDeviceBySerialNumber: vi.fn(),
            getDevices: vi.fn(),
        };
        // Instantiate — this registers all route handlers
        service = new RestService(mockLog, mockStorage, eventService);
    });

    afterEach(() => {
        delete process.env.REST_API_TOKEN;
        delete process.env.ENABLE_DEBUG_ENDPOINTS;
    });

    describe('serialNumber validation (param middleware)', () => {
        it('rejects a serialNumber that is not 12 hex characters', () => {
            const res = makeRes();
            dispatch('GET:/device/status/:serialNumber', { params: { serialNumber: 'not-hex!' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Invalid serialNumber'));
        });

        it('lowercases a valid mixed-case serialNumber before it reaches the route', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );
            const res = makeRes();
            const req = { params: { serialNumber: 'AABBCCDDEEFF' } };
            dispatch('GET:/device/status/:serialNumber', req, res);

            expect(mockStorage.findExistingDeviceBySerialNumber).toHaveBeenCalledWith('aabbccddeeff', expect.any(Function));
            expect(req.params.serialNumber).toBe('aabbccddeeff');
        });
    });

    describe('GET /health', () => {
        it('returns 200 with status ok, uptime, and device count', () => {
            mockStorage.getDevices.mockImplementation(
                (cb: (devices: DeviceDto[]) => void) => cb([makeDto('aabbccddeeff'), makeDto('112233445566')])
            );
            const res = makeRes();
            dispatch('GET:/health', {}, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok', deviceCount: 2 }));
        });

        it('reports deviceCount 0 when storage returns no devices', () => {
            mockStorage.getDevices.mockImplementation((cb: (devices: DeviceDto[]) => void) => cb([]));
            const res = makeRes();
            dispatch('GET:/health', {}, res);

            expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ deviceCount: 0 }));
        });

        it('reports deviceCount 0 when storage yields undefined', () => {
            mockStorage.getDevices.mockImplementation((cb: (devices: DeviceDto[]) => void) => cb(undefined as unknown as DeviceDto[]));
            const res = makeRes();
            dispatch('GET:/health', {}, res);

            expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ deviceCount: 0 }));
        });

        it('is never auth-gated, even when a token is configured', () => {
            process.env.REST_API_TOKEN = 'secret';
            Object.keys(routeHandlers).forEach(k => delete routeHandlers[k]);
            middlewares.length = 0;
            new RestService(mockLog, mockStorage, eventService);
            mockStorage.getDevices.mockImplementation((cb: (devices: DeviceDto[]) => void) => cb([]));

            const res = makeRes();
            dispatch('GET:/health', {}, res); // no Authorization header at all

            expect(res.status).not.toHaveBeenCalledWith(401);
            expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
        });
    });

    describe('GET /device/status/:serialNumber', () => {
        it('returns 200 with device DTO when device is found', () => {
            const dto = makeDto();
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(dto)
            );
            const res = makeRes();
            dispatch('GET:/device/status/:serialNumber', { params: { serialNumber: 'aabbccddeeff' } }, res);

            expect(mockStorage.findExistingDeviceBySerialNumber).toHaveBeenCalledWith('aabbccddeeff', expect.any(Function));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith(dto);
        });

        it('returns 404 when device is not found', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(undefined)
            );
            const res = makeRes();
            dispatch('GET:/device/status/:serialNumber', { params: { serialNumber: 'aabbccddeeff' } }, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.send).toHaveBeenCalledWith('Not Found');
        });
    });

    describe('POST /device/operating-mode/:serialNumber', () => {
        it('emits DEVICE_OPERATING_MODE_UPDATE and sends empty response for a valid body', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceOperatingModeUpdate');
            const res = makeRes();
            const opMode = { operatingMode: 'NIGHT', fanSpeed: 'HIGH' };
            dispatch('POST:/device/operating-mode/:serialNumber', { params: { serialNumber: 'aabbccddeeff' }, body: opMode }, res);

            expect(emitSpy).toHaveBeenCalledWith(opMode, 'aabbccddeeff');
            expect(res.send).toHaveBeenCalled();
        });

        it('rejects an invalid operatingMode with 400', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceOperatingModeUpdate');
            const res = makeRes();
            dispatch('POST:/device/operating-mode/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: { operatingMode: 'NOT_A_MODE' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(emitSpy).not.toHaveBeenCalled();
        });

        it('rejects the internal LAST sentinel as an operatingMode', () => {
            const res = makeRes();
            dispatch('POST:/device/operating-mode/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: { operatingMode: 'LAST' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects an invalid fanSpeed with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/operating-mode/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: { fanSpeed: 'ULTRA' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects an invalid humidityLevel with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/operating-mode/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: { humidityLevel: 'SOAKED' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects an invalid lightSensitivity with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/operating-mode/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: { lightSensitivity: 'BLINDING' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('accepts an empty body (all fields optional)', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceOperatingModeUpdate');
            const res = makeRes();
            dispatch('POST:/device/operating-mode/:serialNumber', { params: { serialNumber: 'aabbccddeeff' }, body: {} }, res);

            expect(emitSpy).toHaveBeenCalledWith({}, 'aabbccddeeff');
        });
    });

    describe('POST /device/reset-filter/:serialNumber', () => {
        it('emits DEVICE_FILTER_RESET and sends empty response', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceFilterReset');
            const res = makeRes();
            dispatch('POST:/device/reset-filter/:serialNumber', { params: { serialNumber: 'aabbccddeeff' }, body: {} }, res);

            expect(emitSpy).toHaveBeenCalledWith('aabbccddeeff');
            expect(res.send).toHaveBeenCalled();
        });
    });

    describe('POST /device/weather-update', () => {
        it('emits DEVICE_WEATHER_UPDATE and sends empty response for a valid body', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceWeatherUpdate');
            const res = makeRes();
            const weatherDto = { temperature: 23.5, humidity: 60, airQuality: 2 };
            dispatch('POST:/device/weather-update', { params: {}, body: weatherDto }, res);

            expect(emitSpy).toHaveBeenCalledWith(weatherDto);
            expect(res.send).toHaveBeenCalled();
        });

        it('rejects an out-of-range temperature with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/weather-update', { params: {}, body: { temperature: 999, humidity: 50, airQuality: 1 } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects a non-finite temperature with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/weather-update', { params: {}, body: { temperature: NaN, humidity: 50, airQuality: 1 } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects an out-of-range humidity with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/weather-update', { params: {}, body: { temperature: 20, humidity: 150, airQuality: 1 } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects a non-integer humidity with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/weather-update', { params: {}, body: { temperature: 20, humidity: 55.5, airQuality: 1 } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects an out-of-range airQuality with 400', () => {
            const res = makeRes();
            dispatch('POST:/device/weather-update', { params: {}, body: { temperature: 20, humidity: 55, airQuality: 9 } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('token auth', () => {
        beforeEach(() => {
            process.env.REST_API_TOKEN = 'secret-token';
            Object.keys(routeHandlers).forEach(k => delete routeHandlers[k]);
            Object.keys(middlewaresAtRegistration).forEach(k => delete middlewaresAtRegistration[k]);
            middlewares.length = 0;
            new RestService(mockLog, mockStorage, eventService);
        });

        it('rejects a request with no Authorization header with 401', () => {
            const res = makeRes();
            dispatch('POST:/device/reset-filter/:serialNumber', { params: { serialNumber: 'aabbccddeeff' }, body: {}, header: () => undefined }, res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('rejects a request with the wrong token with 401', () => {
            const res = makeRes();
            dispatch('POST:/device/reset-filter/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: {}, header: () => 'Bearer wrong-token' }, res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('accepts a request with the correct Bearer token', () => {
            const emitSpy = vi.spyOn(eventService, 'deviceFilterReset');
            const res = makeRes();
            dispatch('POST:/device/reset-filter/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: {}, header: () => 'Bearer secret-token' }, res);

            expect(emitSpy).toHaveBeenCalledWith('aabbccddeeff');
            expect(res.status).not.toHaveBeenCalledWith(401);
        });
    });

    describe('POST /cloud/send-setup/:serialNumber (debug endpoint)', () => {
        it('is disabled by default and returns 403', () => {
            const res = makeRes();
            dispatch('POST:/cloud/send-setup/:serialNumber',
                { params: { serialNumber: 'aabbccddeeff' }, body: { role: 0, zone: 1, houseId: 12048 } }, res);

            expect(res.status).toHaveBeenCalledWith(403);
        });

        describe('when enabled', () => {
            beforeEach(() => {
                process.env.ENABLE_DEBUG_ENDPOINTS = 'true';
                Object.keys(routeHandlers).forEach(k => delete routeHandlers[k]);
                Object.keys(middlewaresAtRegistration).forEach(k => delete middlewaresAtRegistration[k]);
                middlewares.length = 0;
                new RestService(mockLog, mockStorage, eventService);
            });

            it('returns 404 when the device is not found', () => {
                mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                    (_sn: string, cb: (d: any) => void) => cb(undefined)
                );
                const res = makeRes();
                dispatch('POST:/cloud/send-setup/:serialNumber',
                    { params: { serialNumber: 'aabbccddeeff' }, body: { role: 0, zone: 1, houseId: 12048 } }, res);

                expect(res.status).toHaveBeenCalledWith(404);
            });

            it('injects a setup packet when the device is found', () => {
                mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                    (_sn: string, cb: (d: any) => void) => cb({ remoteAddress: '192.168.1.50' })
                );
                const emitSpy = vi.spyOn(eventService, 'localSocketDataUpdateReceived');
                const res = makeRes();
                dispatch('POST:/cloud/send-setup/:serialNumber',
                    { params: { serialNumber: 'aabbccddeeff' }, body: { role: 0, zone: 1, houseId: 12048 } }, res);

                expect(emitSpy).toHaveBeenCalled();
                expect(res.status).toHaveBeenCalledWith(200);
            });

            it('rejects an invalid role with 400', () => {
                const res = makeRes();
                dispatch('POST:/cloud/send-setup/:serialNumber',
                    { params: { serialNumber: 'aabbccddeeff' }, body: { role: 9, zone: 1, houseId: 12048 } }, res);

                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('rejects an out-of-range zone with 400', () => {
                const res = makeRes();
                dispatch('POST:/cloud/send-setup/:serialNumber',
                    { params: { serialNumber: 'aabbccddeeff' }, body: { role: 0, zone: 99, houseId: 12048 } }, res);

                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('rejects an out-of-range houseId with 400', () => {
                const res = makeRes();
                dispatch('POST:/cloud/send-setup/:serialNumber',
                    { params: { serialNumber: 'aabbccddeeff' }, body: { role: 0, zone: 1, houseId: -1 } }, res);

                expect(res.status).toHaveBeenCalledWith(400);
            });
        });
    });

    describe('close()', () => {
        it('closes the underlying http server', async () => {
            await expect(service.close()).resolves.toBeUndefined();
        });
    });
});
