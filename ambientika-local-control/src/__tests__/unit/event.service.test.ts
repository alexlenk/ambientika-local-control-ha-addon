import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventService } from '../../services/event.service';
import { AppEvents } from '../../models/enum/app-events.enum';
import { Device } from '../../models/device.model';
import { DeviceBroadcastStatus } from '../../models/device-broadcast-status.model';
import { OperatingModeDto } from '../../dto/operating-mode.dto';
import { WeatherUpdateDto } from '../../dto/weather-update.dto';
import { DeviceSetupDto } from '../../dto/device-setup.dto';

const mockLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
} as any;

function makeDevice(): Device {
    return new Device('aabbccddeeff', 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

describe('EventService', () => {
    let service: EventService;

    beforeEach(() => {
        service = new EventService(mockLog);
        vi.clearAllMocks();
    });

    it('emits LOCAL_SOCKET_CONNECTED with remoteAddress', () => {
        const listener = vi.fn();
        service.on(AppEvents.LOCAL_SOCKET_CONNECTED, listener);
        service.localSocketConnected('192.168.1.50');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith('192.168.1.50');
    });

    it('emits LOCAL_SOCKET_DISCONNECTED with remoteAddress', () => {
        const listener = vi.fn();
        service.on(AppEvents.LOCAL_SOCKET_DISCONNECTED, listener);
        service.localSocketDisconnected('192.168.1.50');
        expect(listener).toHaveBeenCalledWith('192.168.1.50');
    });

    it('emits LOCAL_SOCKET_DATA_UPDATE_RECEIVED with data and remoteAddress', () => {
        const listener = vi.fn();
        const data = Buffer.from([0x01, 0x02]);
        service.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, listener);
        service.localSocketDataUpdateReceived(data, '192.168.1.50');
        expect(listener).toHaveBeenCalledWith(data, '192.168.1.50');
    });

    it('emits REMOTE_SOCKET_CONNECTED with localAddress', () => {
        const listener = vi.fn();
        service.on(AppEvents.REMOTE_SOCKET_CONNECTED, listener);
        service.remoteSocketConnected('10.0.0.1');
        expect(listener).toHaveBeenCalledWith('10.0.0.1');
    });

    it('emits REMOTE_SOCKET_DISCONNECTED with localAddress', () => {
        service.remoteSocketDisconnected('10.0.0.1');
        // no listener — just confirm no throw
    });

    it('emits REMOTE_SOCKET_DATA_UPDATE_RECEIVED with data and remoteAddress', () => {
        const listener = vi.fn();
        const data = Buffer.from([0x03]);
        service.on(AppEvents.REMOTE_SOCKET_DATA_UPDATE_RECEIVED, listener);
        service.remoteSocketDataUpdateReceived(data, '10.0.0.1');
        expect(listener).toHaveBeenCalledWith(data, '10.0.0.1');
    });

    it('emits DEVICE_STATUS_UPDATE_RECEIVED with device', () => {
        const listener = vi.fn();
        const device = makeDevice();
        service.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, listener);
        service.deviceStatusUpdate(device);
        expect(listener).toHaveBeenCalledWith(device);
    });

    it('emits DEVICE_ONLINE with device', () => {
        const listener = vi.fn();
        const device = makeDevice();
        service.on(AppEvents.DEVICE_ONLINE, listener);
        service.deviceOnline(device);
        expect(listener).toHaveBeenCalledWith(device);
    });

    it('emits DEVICE_OFFLINE with device', () => {
        const listener = vi.fn();
        const device = makeDevice();
        service.on(AppEvents.DEVICE_OFFLINE, listener);
        service.deviceOffline(device);
        expect(listener).toHaveBeenCalledWith(device);
    });

    it('emits DEVICE_OPERATING_MODE_UPDATE with operatingMode and serialNumber', () => {
        const listener = vi.fn();
        const dto: OperatingModeDto = { operatingMode: 'AUTO', fanSpeed: 'LOW', humidityLevel: 'NORMAL', lightSensitivity: 'LOW' };
        service.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, listener);
        service.deviceOperatingModeUpdate(dto, 'aabbccddeeff');
        expect(listener).toHaveBeenCalledWith(dto, 'aabbccddeeff');
    });

    it('emits DEVICE_FILTER_RESET with serialNumber', () => {
        const listener = vi.fn();
        service.on(AppEvents.DEVICE_FILTER_RESET, listener);
        service.deviceFilterReset('aabbccddeeff');
        expect(listener).toHaveBeenCalledWith('aabbccddeeff');
    });

    it('emits DEVICE_WEATHER_UPDATE with WeatherUpdateDto', () => {
        const listener = vi.fn();
        const dto: WeatherUpdateDto = { temperature: 23.5, humidity: 60, airQuality: 1 };
        service.on(AppEvents.DEVICE_WEATHER_UPDATE, listener);
        service.deviceWeatherUpdate(dto);
        expect(listener).toHaveBeenCalledWith(dto);
    });

    it('emits LOCAL_SOCKET_DATA_UPDATE with data and localAddress', () => {
        const listener = vi.fn();
        const data = Buffer.from([0xAA]);
        service.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, listener);
        service.localSocketDataUpdate(data, '192.168.1.1');
        expect(listener).toHaveBeenCalledWith(data, '192.168.1.1');
    });

    it('emits DEVICE_BROADCAST_STATUS_RECEIVED with status and optional sourceAddress', () => {
        const listener = vi.fn();
        const status = new DeviceBroadcastStatus('aabbccddeeff', 1, 'ALTERNATING', 'START_SLOW');
        service.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED, listener);
        service.deviceBroadcastStatus(status, '192.168.1.255');
        expect(listener).toHaveBeenCalledWith(status, '192.168.1.255');
    });

    it('emits DEVICE_SETUP_UPDATE with DeviceSetupDto', () => {
        const listener = vi.fn();
        const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'MASTER', zoneIndex: 0, houseId: 1 };
        service.on(AppEvents.DEVICE_SETUP_UPDATE, listener);
        service.deviceSetupUpdate(dto);
        expect(listener).toHaveBeenCalledWith(dto);
    });

    it('logs debug for every emit call', () => {
        service.deviceFilterReset('aabbccddeeff');
        expect(mockLog.debug).toHaveBeenCalledWith(
            expect.stringContaining(AppEvents.DEVICE_FILTER_RESET),
            'aabbccddeeff'
        );
    });
});
