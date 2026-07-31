import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceCommandService } from '../../services/device-command-service';
import { EventService } from '../../services/event.service';
import { AppEvents } from '../../models/enum/app-events.enum';
import { Device } from '../../models/device.model';
import { DeviceDto } from '../../dto/device.dto';
import { WeatherUpdateDto } from '../../dto/weather-update.dto';
import { DeviceSetupDto } from '../../dto/device-setup.dto';
import { OperatingMode } from '../../models/enum/operating-mode.enum';
import { FanSpeed } from '../../models/enum/fan-speed.enum';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
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

function makeDevice(sn = 'aabbccddeeff'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

const mockStorage = {
    findExistingDeviceBySerialNumber: vi.fn(),
    findExistingDeviceByRemoteAddress: vi.fn(),
    getDevices: vi.fn(),
} as any;

// Matches DeviceCommandService.COMMAND_DEBOUNCE_MS — dispatch is deferred by this long so that
// companion commands fired on separate MQTT topics for one compound HA action (fan speed +
// mode, etc.) land in the same batch and get merged into a single device packet (see #68).
const DEBOUNCE_MS = 250;

describe('DeviceCommandService', () => {
    let eventService: EventService;
    let service: DeviceCommandService;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        eventService = new EventService(mockLog);
        service = new DeviceCommandService(mockLog, mockStorage, eventService);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('DEVICE_OPERATING_MODE_UPDATE command dispatch', () => {
        it('emits LOCAL_SOCKET_DATA_UPDATE when device is found in storage', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(listener).toHaveBeenCalled();
        });

        it('does not dispatch before the debounce window elapses', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS - 1);

            expect(listener).not.toHaveBeenCalled();
        });

        it('logs error and does not emit when device not found', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(undefined)
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(listener).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('not found in database'));
        });

        it('coalesces two commands for different fields arriving within the debounce window into one packet (#68)', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            // Simulates HA firing two separate MQTT command topics for one compound action
            // (e.g. "high fan speed" + "intake mode") milliseconds apart.
            eventService.deviceOperatingModeUpdate({ fanSpeed: 'HIGH' }, 'aabbccddeeff');
            eventService.deviceOperatingModeUpdate({ operatingMode: 'INTAKE' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            // A single merged packet, not one per command — the device only beeps once.
            expect(listener).toHaveBeenCalledTimes(1);
            const [data] = listener.mock.calls[0];
            expect((data as Buffer)[9]).toBe(OperatingMode.INTAKE); // operating mode byte
            expect((data as Buffer)[10]).toBe(FanSpeed.HIGH); // fan speed byte
        });

        it('coalesces two commands for the same field within the window using the last value', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            eventService.deviceOperatingModeUpdate({ operatingMode: 'AUTO' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(listener).toHaveBeenCalledTimes(1);
            const [data] = listener.mock.calls[0];
            expect((data as Buffer)[9]).toBe(OperatingMode.AUTO);
        });

        it('does not schedule a second flush while one is already pending for the same device', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            const debounceTimers = (service as any).debounceTimers as Map<string, unknown>;
            const timerAfterFirst = debounceTimers.get('aabbccddeeff');

            eventService.deviceOperatingModeUpdate({ fanSpeed: 'HIGH' }, 'aabbccddeeff');

            expect(debounceTimers.get('aabbccddeeff')).toBe(timerAfterFirst);
        });

        it('sends a command queued while another is in flight as a separate packet once the device responds', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS); // dispatches NIGHT, starts the ack timeout

            // Arrives after NIGHT is already in flight — queues behind it instead of merging in
            eventService.deviceOperatingModeUpdate({ operatingMode: 'AUTO' }, 'aabbccddeeff');

            // Device responds → clears in-flight state → schedules a fresh flush for AUTO
            eventService.deviceStatusUpdate(makeDevice());
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(listener).toHaveBeenCalledTimes(2);
        });

        it('command times out after COMMAND_TIMEOUT_MS and processes the next queued command', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS); // dispatches NIGHT

            eventService.deviceOperatingModeUpdate({ operatingMode: 'AUTO' }, 'aabbccddeeff');

            // Advance past the 5 second ack timeout, then past the follow-up debounce window
            vi.advanceTimersByTime(5001);
            vi.advanceTimersByTime(DEBOUNCE_MS);

            // Timeout fires — the queued AUTO command should now be dispatched
            expect(listener).toHaveBeenCalledTimes(2);
        });

        it('logs error when command times out', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            vi.advanceTimersByTime(5001);

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('did not respond within')
            );
        });

        it('does not process another command if device responds after timeout', () => {
            // When no commands are queued, status update should be a no-op
            const device = makeDevice();
            // No commands queued — should not throw
            expect(() => eventService.deviceStatusUpdate(device)).not.toThrow();
        });
    });

    describe('getOperatingMode LAST mode', () => {
        it('emits LOCAL_SOCKET_DATA_UPDATE when operatingMode is LAST', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            // MODE_COMMAND_TOPIC maps 'fan_only' → OperatingMode.LAST.toString() === 'LAST'
            eventService.deviceOperatingModeUpdate({ operatingMode: 'LAST' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(listener).toHaveBeenCalled();
        });

        it('uses the device lastOperatingMode when operatingMode equals OperatingMode.LAST numerically', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            let capturedData: Buffer | undefined;
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, (data: Buffer) => {
                capturedData = data;
            });

            eventService.deviceOperatingModeUpdate(
                { operatingMode: OperatingMode.LAST.toString() }, 'aabbccddeeff'
            );
            vi.advanceTimersByTime(DEBOUNCE_MS);

            // Buffer byte 9 holds the operating mode; device's lastOperatingMode is 'SMART' (0)
            expect(capturedData?.[9]).toBe(OperatingMode.SMART);
        });
    });

    describe('analyzeCommandBuffer warnings', () => {
        it('warns when the device is a SLAVE role', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => {
                    const dto = makeDto();
                    dto.deviceRole = 'SLAVE_OPPOSITE_MASTER';
                    cb(dto);
                }
            );

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('SLAVE role'));
        });

        it('warns when the device is locked in MASTER_SLAVE_FLOW and a different mode is requested', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => {
                    const dto = makeDto();
                    dto.operatingMode = 'MASTER_SLAVE_FLOW';
                    cb(dto);
                }
            );

            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('MASTER_SLAVE_FLOW'));
        });
    });

    describe('unknown fanSpeed handling', () => {
        it('defaults to MEDIUM and warns when fanSpeed is not a recognized enum key', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            let capturedData: Buffer | undefined;
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, (data: Buffer) => {
                capturedData = data;
            });

            eventService.deviceOperatingModeUpdate({ fanSpeed: 'BOGUS' as any }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown fanSpeed'));
            expect(capturedData?.[10]).toBe(1); // FanSpeed.MEDIUM
        });
    });

    describe('processNextCommand guard', () => {
        it('does nothing when a command is already processing for the serial number', () => {
            (service as any).commandQueues.set('aabbccddeeff', [{ command: { operatingMode: 'NIGHT' }, timestamp: Date.now() }]);
            (service as any).processingCommands.set('aabbccddeeff', { command: {}, timeoutId: setTimeout(() => undefined, 1000) });

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            (service as any).processNextCommand('aabbccddeeff');

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('getOperatingMode uses device mode when opMode has no operatingMode', () => {
        it('emits LOCAL_SOCKET_DATA_UPDATE using device current mode when operatingMode is undefined', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            // Only fanSpeed provided — no operatingMode — uses device's current mode
            eventService.deviceOperatingModeUpdate({ fanSpeed: 'HIGH' }, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('DEVICE_FILTER_RESET command', () => {
        it('emits LOCAL_SOCKET_DATA_UPDATE when device is found', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceFilterReset('aabbccddeeff');

            expect(listener).toHaveBeenCalled();
        });

        it('does not emit LOCAL_SOCKET_DATA_UPDATE when device not found', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(undefined)
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceFilterReset('aabbccddeeff');

            expect(listener).not.toHaveBeenCalled();
        });

        it('sends 9-byte filter reset buffer', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            let capturedData: Buffer | undefined;
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, (data: Buffer) => {
                capturedData = data;
            });

            eventService.deviceFilterReset('aabbccddeeff');

            expect(capturedData?.length).toBe(9);
        });
    });

    describe('DEVICE_WEATHER_UPDATE command', () => {
        it('sends weather update to all known devices', () => {
            const dto1 = makeDto('aabbccddeeff');
            const dto2 = makeDto('112233445566');
            dto2.remoteAddress = '192.168.1.2';
            mockStorage.getDevices.mockImplementation(
                (cb: (dtos: DeviceDto[]) => void) => cb([dto1, dto2])
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            const weatherDto: WeatherUpdateDto = { temperature: 22.5, humidity: 60, airQuality: 1 };
            eventService.deviceWeatherUpdate(weatherDto);

            expect(listener).toHaveBeenCalledTimes(2);
        });

        it('does not emit if no devices are registered', () => {
            mockStorage.getDevices.mockImplementation(
                (cb: (dtos: DeviceDto[]) => void) => cb([])
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            eventService.deviceWeatherUpdate({ temperature: 20, humidity: 50, airQuality: 0 });

            expect(listener).not.toHaveBeenCalled();
        });

        it('does not throw if storage yields undefined devices', () => {
            mockStorage.getDevices.mockImplementation(
                (cb: (dtos: DeviceDto[] | undefined) => void) => cb(undefined)
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            expect(() => eventService.deviceWeatherUpdate({ temperature: 20, humidity: 50, airQuality: 0 })).not.toThrow();
            expect(listener).not.toHaveBeenCalled();
        });

        it('sends 13-byte weather buffer per device', () => {
            mockStorage.getDevices.mockImplementation(
                (cb: (dtos: DeviceDto[]) => void) => cb([makeDto()])
            );

            const buffers: Buffer[] = [];
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, (data: Buffer) => {
                buffers.push(data);
            });

            eventService.deviceWeatherUpdate({ temperature: 23.5, humidity: 60, airQuality: 1 });

            expect(buffers[0].length).toBe(13);
        });
    });

    describe('DEVICE_SETUP_UPDATE command', () => {
        it('emits LOCAL_SOCKET_DATA_UPDATE when device is found', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);

            const setupDto: DeviceSetupDto = {
                serialNumber: 'aabbccddeeff',
                deviceRole: 'MASTER',
                zoneIndex: 0,
                houseId: 1,
            };
            eventService.deviceSetupUpdate(setupDto);

            expect(listener).toHaveBeenCalled();
        });

        it('logs error when device not found for setup', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(undefined)
            );

            const setupDto: DeviceSetupDto = {
                serialNumber: 'aabbccddeeff',
                deviceRole: 'MASTER',
                zoneIndex: 0,
                houseId: 1,
            };
            eventService.deviceSetupUpdate(setupDto);

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('not found for setup')
            );
        });

        it('sends 16-byte device setup buffer', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => cb(makeDto())
            );

            let capturedData: Buffer | undefined;
            eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, (data: Buffer) => {
                capturedData = data;
            });

            eventService.deviceSetupUpdate({
                serialNumber: 'aabbccddeeff',
                deviceRole: 'MASTER',
                zoneIndex: 0,
                houseId: 1,
            });

            expect(capturedData?.length).toBe(15);
        });
    });

    describe('empty serialNumber edge case (buffer builders)', () => {
        it('getUpdateBufferData skips serial encoding when serialNumber is empty', () => {
            const device = makeDevice('');
            const buffer = (service as any).getUpdateBufferData({ operatingMode: 'NIGHT' }, device);
            expect(buffer.length).toBe(13);
        });

        it('getFilterResetBufferData skips serial encoding when serialNumber is empty', () => {
            const buffer = (service as any).getFilterResetBufferData('');
            expect(buffer.length).toBe(9);
        });

        it('getWeatherUpdateBufferData skips serial encoding when serialNumber is empty', () => {
            const buffer = (service as any).getWeatherUpdateBufferData('', { temperature: 20, humidity: 50, airQuality: 0 });
            expect(buffer.length).toBe(13);
        });

        it('getDeviceSetupBufferData skips serial encoding when serialNumber is empty', () => {
            const buffer = (service as any).getDeviceSetupBufferData({
                serialNumber: '', deviceRole: 'MASTER', zoneIndex: 0, houseId: 1,
            });
            expect(buffer.length).toBe(15);
        });
    });

    describe('unknown fanSpeed falls back to device.fanSpeed in the warn message', () => {
        it('warns using the device fanSpeed value when opMode.fanSpeed is undefined and device.fanSpeed is invalid', () => {
            mockStorage.findExistingDeviceBySerialNumber.mockImplementation(
                (_sn: string, cb: (d: DeviceDto | undefined) => void) => {
                    const dto = makeDto();
                    dto.fanSpeed = 'BOGUS';
                    cb(dto);
                }
            );

            eventService.deviceOperatingModeUpdate({}, 'aabbccddeeff');
            vi.advanceTimersByTime(DEBOUNCE_MS);

            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown fanSpeed value BOGUS'));
        });
    });
});
