import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventService } from '../../services/event.service';
import { Device } from '../../models/device.model';
import { DeviceDto } from '../../dto/device.dto';

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { DeviceStorageService } from '../../services/device-storage.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
} as any;

function makeDevice(sn = 'aabbccddeeff'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

function makeRoleDevice(sn: string, role: string, filterStatus = 'GOOD'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, filterStatus, false, role, 'SMART', 'LOW', '192.168.1.1', 80);
}

function makeAlarmedDevice(sn = 'aabbccddeeff'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        true, 'GOOD', true, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

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

// Real (in-memory, by default) node:sqlite databases — no mocking needed since it's a
// Node built-in with no native compilation step. See #47.
describe('DeviceStorageService', () => {
    let service: DeviceStorageService;
    let eventService: EventService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DEVICE_DB = ':memory:';
        eventService = new EventService(mockLog);
        service = new DeviceStorageService(mockLog, eventService);
    });

    describe('getStoredOperatingMode / getStoredFanSpeed / hasStoredCommand', () => {
        it('returns undefined when no command stored', () => {
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBeUndefined();
            expect(service.getStoredFanSpeed('aabbccddeeff')).toBeUndefined();
            expect(service.hasStoredCommand('aabbccddeeff')).toBe(false);
        });

        it('stores operating mode after DEVICE_OPERATING_MODE_UPDATE event', () => {
            const opMode = { operatingMode: 'NIGHT', fanSpeed: 'HIGH' };
            eventService.deviceOperatingModeUpdate(opMode, 'aabbccddeeff');
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBe('NIGHT');
            expect(service.getStoredFanSpeed('aabbccddeeff')).toBe('HIGH');
            expect(service.hasStoredCommand('aabbccddeeff')).toBe(true);
        });

        it('clears stored command once device reports matching state', () => {
            const opMode = { operatingMode: 'NIGHT', fanSpeed: 'HIGH' };
            eventService.deviceOperatingModeUpdate(opMode, 'aabbccddeeff');
            const device = makeDevice();
            device.operatingMode = 'NIGHT';
            device.fanSpeed = 'HIGH';
            eventService.deviceStatusUpdate(device);
            expect(service.hasStoredCommand('aabbccddeeff')).toBe(false);
        });
    });

    describe('command override expiry, merging and LAST resolution (#91)', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('keeps the override for 30 s, then falls back to the device-reported state', () => {
            vi.useFakeTimers();
            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');

            vi.advanceTimersByTime(30000);
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBe('NIGHT');

            vi.advanceTimersByTime(1);
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBeUndefined();
            expect(service.hasStoredCommand('aabbccddeeff')).toBe(false);
        });

        it('expires a command the device rejects instead of pinning it forever', () => {
            vi.useFakeTimers();
            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT' }, 'aabbccddeeff');
            eventService.deviceStatusUpdate(makeDevice()); // still reports AUTO
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBe('NIGHT');

            vi.advanceTimersByTime(30001);
            eventService.deviceStatusUpdate(makeDevice());
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBeUndefined();
        });

        it('merges separate attribute commands instead of replacing them', () => {
            eventService.deviceOperatingModeUpdate({ fanSpeed: 'HIGH' }, 'aabbccddeeff');
            eventService.deviceOperatingModeUpdate({ operatingMode: 'INTAKE' }, 'aabbccddeeff');

            expect(service.getStoredFanSpeed('aabbccddeeff')).toBe('HIGH');
            expect(service.getStoredOperatingMode('aabbccddeeff')).toBe('INTAKE');
        });

        it('a newer command restarts the expiry window', () => {
            vi.useFakeTimers();
            eventService.deviceOperatingModeUpdate({ fanSpeed: 'HIGH' }, 'aabbccddeeff');
            vi.advanceTimersByTime(20000);
            eventService.deviceOperatingModeUpdate({ operatingMode: 'INTAKE' }, 'aabbccddeeff');
            vi.advanceTimersByTime(20000);

            expect(service.getStoredFanSpeed('aabbccddeeff')).toBe('HIGH');
        });

        it("stores fan_only (LAST) as the device's last operating mode, never as '12'", () => {
            service.saveDevice(makeDevice()); // lastOperatingMode = SMART
            eventService.deviceOperatingModeUpdate({ operatingMode: '12' }, 'aabbccddeeff');

            expect(service.getStoredOperatingMode('aabbccddeeff')).toBe('SMART');
        });

        it('stores no mode override for LAST when the device is unknown', () => {
            eventService.deviceOperatingModeUpdate({ operatingMode: '12' }, 'aabbccddeeff');

            expect(service.getStoredOperatingMode('aabbccddeeff')).toBeUndefined();
        });

        it('does not mutate the command object other listeners receive', () => {
            service.saveDevice(makeDevice());
            const opMode = { operatingMode: '12' };
            eventService.deviceOperatingModeUpdate(opMode, 'aabbccddeeff');

            expect(opMode.operatingMode).toBe('12');
        });

        it('logs instead of throwing when resolving LAST fails', () => {
            service.close();
            expect(() => eventService.deviceOperatingModeUpdate({ operatingMode: '12' }, 'aabbccddeeff')).not.toThrow();
            expect(mockLog.error).toHaveBeenCalledWith('Error fetching device from db', expect.any(Error));
        });
    });

    describe('getDevices', () => {
        it('calls callback with empty array when the table has no rows', () => {
            const callback = vi.fn();
            service.getDevices(callback);
            expect(callback).toHaveBeenCalledWith([]);
        });

        it('logs an error instead of throwing when the query fails', () => {
            service.close();
            const callback = vi.fn();
            expect(() => service.getDevices(callback)).not.toThrow();
            expect(callback).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith('Error fetching devices from db', expect.any(Error));
        });

        it('calls callback with all rows after devices are saved', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            service.saveDevice(makeDevice('112233445566'));

            const callback = vi.fn();
            service.getDevices(callback);

            const rows = callback.mock.calls[0][0] as DeviceDto[];
            expect(rows).toHaveLength(2);
            expect(rows.map(r => r.serialNumber).sort()).toEqual(['112233445566', 'aabbccddeeff']);
        });
    });

    describe('findExistingDeviceBySerialNumber', () => {
        it('calls callback with undefined when no matching row exists', () => {
            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(undefined);
        });

        it('calls callback with the row once the device has been saved', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'aabbccddeeff', operatingMode: 'AUTO' }));
        });

        it('logs an error instead of throwing when the query fails', () => {
            service.close();
            const callback = vi.fn();
            expect(() => service.findExistingDeviceBySerialNumber('aabbccddeeff', callback)).not.toThrow();
            expect(callback).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith('Error fetching device from db', expect.any(Error));
        });
    });

    describe('findExistingDeviceByRemoteAddress', () => {
        it('calls callback with undefined when no matching row exists', () => {
            const callback = vi.fn();
            service.findExistingDeviceByRemoteAddress('192.168.1.1', callback);
            expect(callback).toHaveBeenCalledWith(undefined);
        });

        it('calls callback with the row once a device at that address has been saved', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            const callback = vi.fn();
            service.findExistingDeviceByRemoteAddress('192.168.1.1', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'aabbccddeeff' }));
        });

        it('logs an error instead of throwing when the query fails', () => {
            service.close();
            const callback = vi.fn();
            expect(() => service.findExistingDeviceByRemoteAddress('192.168.1.1', callback)).not.toThrow();
            expect(callback).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith('Error fetching device from db', expect.any(Error));
        });
    });

    describe('saveDevice', () => {
        it('creates a new row (INSERT) when the device does not exist', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));

            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'aabbccddeeff' }));
        });

        it('updates the existing row (REPLACE), preserving id and firstSeen', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            let firstDto: DeviceDto | undefined;
            service.findExistingDeviceBySerialNumber('aabbccddeeff', (dto) => { firstDto = dto; });

            const updated = makeDevice('aabbccddeeff');
            updated.operatingMode = 'NIGHT';
            updated.temperature = 25;
            service.saveDevice(updated);

            let secondDto: DeviceDto | undefined;
            service.findExistingDeviceBySerialNumber('aabbccddeeff', (dto) => { secondDto = dto; });

            expect(secondDto?.id).toBe(firstDto?.id);
            expect(secondDto?.firstSeen).toBe(firstDto?.firstSeen);
            expect(secondDto?.operatingMode).toBe('NIGHT');
            expect(secondDto?.temperature).toBe(25);
        });

        it('persists humidityAlarm and nightAlarm as 1 when true', () => {
            service.saveDevice(makeAlarmedDevice('aabbccddeeff'));

            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ humidityAlarm: 1, nightAlarm: 1 }));
        });

        it('createDevice logs an error instead of throwing when the insert fails', () => {
            service.close();
            expect(() => service.createDevice(makeDevice())).not.toThrow();
            expect(mockLog.error).toHaveBeenCalledWith('Error created device on db', expect.any(Error));
        });

        it('updateDevice logs an error instead of throwing when the replace fails', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            let existing: DeviceDto | undefined;
            service.findExistingDeviceBySerialNumber('aabbccddeeff', (dto) => { existing = dto; });
            service.close();

            expect(() => service.updateDevice(makeDevice('aabbccddeeff'), existing as DeviceDto)).not.toThrow();
            expect(mockLog.error).toHaveBeenCalledWith('Error created device on db', expect.any(Error));
        });
    });

    describe('saveDeviceZoneHouseId', () => {
        it('persists zone and houseId for an existing device', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            service.saveDeviceZoneHouseId('aabbccddeeff', 3, 12048);

            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ zone: 3, houseId: 12048 }));
        });

        it('updates only zone when houseId is undefined', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            service.saveDeviceZoneHouseId('aabbccddeeff', 5, undefined);

            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ zone: 5, houseId: null }));
        });

        it('does nothing when both zone and houseId are undefined', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            expect(() => service.saveDeviceZoneHouseId('aabbccddeeff', undefined, undefined)).not.toThrow();
        });

        it('updates only houseId when zone is undefined', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            service.saveDeviceZoneHouseId('aabbccddeeff', undefined, 12048);

            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ zone: null, houseId: 12048 }));
        });

        it('logs an error instead of throwing when the update fails', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            service.close();
            expect(() => service.saveDeviceZoneHouseId('aabbccddeeff', 3, 12048)).not.toThrow();
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Error saving zone/houseId'),
                expect.any(Error)
            );
        });
    });

    describe('findZoneMaster (#88)', () => {
        const MASTER = '111111111111';
        const SLAVE = '222222222222';
        const OTHER_MASTER = '333333333333';

        function find(serialNumber: string): DeviceDto | undefined {
            const callback = vi.fn();
            service.findZoneMaster(serialNumber, callback);
            expect(callback).toHaveBeenCalledTimes(1);
            return callback.mock.calls[0]![0];
        }

        it('resolves a master to itself', () => {
            service.saveDevice(makeRoleDevice(MASTER, 'MASTER'));
            expect(find(MASTER)?.serialNumber).toBe(MASTER);
        });

        it('resolves a slave to the master with the same zone and houseId', () => {
            service.saveDevice(makeRoleDevice(MASTER, 'MASTER', 'BAD'));
            service.saveDevice(makeRoleDevice(SLAVE, 'SLAVE_OPPOSITE_MASTER'));
            service.saveDevice(makeRoleDevice(OTHER_MASTER, 'MASTER'));
            service.saveDeviceZoneHouseId(MASTER, 1, 12048);
            service.saveDeviceZoneHouseId(SLAVE, 1, 12048);
            service.saveDeviceZoneHouseId(OTHER_MASTER, 0, 12048);

            const master = find(SLAVE);
            expect(master?.serialNumber).toBe(MASTER);
            expect(master?.filterStatus).toBe('BAD');
        });

        it('does not match a master of the same zone index in a different house', () => {
            service.saveDevice(makeRoleDevice(MASTER, 'MASTER'));
            service.saveDevice(makeRoleDevice(SLAVE, 'SLAVE_EQUAL_MASTER'));
            service.saveDeviceZoneHouseId(MASTER, 1, 99999);
            service.saveDeviceZoneHouseId(SLAVE, 1, 12048);

            expect(find(SLAVE)).toBeUndefined();
        });

        it('matches by zone alone when the slave houseId is unknown and the match is unique', () => {
            service.saveDevice(makeRoleDevice(MASTER, 'MASTER'));
            service.saveDevice(makeRoleDevice(SLAVE, 'SLAVE_EQUAL_MASTER'));
            service.saveDeviceZoneHouseId(MASTER, 2, 12048);
            service.saveDeviceZoneHouseId(SLAVE, 2, undefined);

            expect(find(SLAVE)?.serialNumber).toBe(MASTER);
        });

        it('resolves to undefined when more than one master matches', () => {
            service.saveDevice(makeRoleDevice(MASTER, 'MASTER'));
            service.saveDevice(makeRoleDevice(OTHER_MASTER, 'MASTER'));
            service.saveDevice(makeRoleDevice(SLAVE, 'SLAVE_EQUAL_MASTER'));
            service.saveDeviceZoneHouseId(MASTER, 2, 1);
            service.saveDeviceZoneHouseId(OTHER_MASTER, 2, 2);
            service.saveDeviceZoneHouseId(SLAVE, 2, undefined);

            expect(find(SLAVE)).toBeUndefined();
        });

        it('resolves to undefined when the slave zone is unknown', () => {
            service.saveDevice(makeRoleDevice(MASTER, 'MASTER'));
            service.saveDevice(makeRoleDevice(SLAVE, 'SLAVE_EQUAL_MASTER'));
            service.saveDeviceZoneHouseId(MASTER, 1, 12048);

            expect(find(SLAVE)).toBeUndefined();
        });

        it('resolves to undefined for an unknown device', () => {
            expect(find('ffffffffffff')).toBeUndefined();
        });

        it('logs an error and does not call back when the query fails', () => {
            service.close();
            const callback = vi.fn();
            service.findZoneMaster(MASTER, callback);
            expect(callback).not.toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith('Error fetching zone master from db', expect.any(Error));
        });
    });

    describe('deleteDevice', () => {
        it('removes the row and emits DEVICE_OFFLINE', () => {
            service.saveDevice(makeDevice('aabbccddeeff'));
            let saved: DeviceDto | undefined;
            service.findExistingDeviceBySerialNumber('aabbccddeeff', (dto) => { saved = dto; });

            const listener = vi.fn();
            eventService.on('DEVICE_OFFLINE', listener);

            service.deleteDevice(saved as DeviceDto);

            expect(listener).toHaveBeenCalled();
            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(undefined);
        });

        it('logs an error instead of throwing when the delete fails', () => {
            // No such id — DELETE affects 0 rows but does not throw in SQLite; force a real
            // failure instead by closing the db first so the prepared statement errors.
            service.close();
            expect(() => service.deleteDevice(makeDto())).not.toThrow();
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Error deleting device'),
                expect.any(Error)
            );
        });
    });

    describe('command tracking: DEVICE_STATUS_UPDATE_RECEIVED with stored command', () => {
        it('warns when device reports non-matching operatingMode', () => {
            eventService.deviceOperatingModeUpdate({ operatingMode: 'AUTO', fanSpeed: 'HIGH' }, 'aabbccddeeff');
            const device = makeDevice();
            device.operatingMode = 'NIGHT';
            device.fanSpeed = 'HIGH';
            eventService.deviceStatusUpdate(device);
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('REJECTED command'));
        });

        it('warns when device reports non-matching fanSpeed', () => {
            eventService.deviceOperatingModeUpdate({ operatingMode: 'AUTO', fanSpeed: 'HIGH' }, 'aabbccddeeff');
            const device = makeDevice();
            device.operatingMode = 'AUTO';
            device.fanSpeed = 'LOW';
            eventService.deviceStatusUpdate(device);
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('REJECTED fanSpeed'));
        });

        it('logs info when device applied command successfully', () => {
            eventService.deviceOperatingModeUpdate({ operatingMode: 'NIGHT', fanSpeed: 'HIGH' }, 'aabbccddeeff');
            const device = makeDevice();
            device.operatingMode = 'NIGHT';
            device.fanSpeed = 'HIGH';
            eventService.deviceStatusUpdate(device);
            expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('applied command successfully'));
            expect(service.hasStoredCommand('aabbccddeeff')).toBe(false);
        });

        it('just saves the device when there is no stored command for it', () => {
            const device = makeDevice();
            expect(() => eventService.deviceStatusUpdate(device)).not.toThrow();

            const callback = vi.fn();
            service.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'aabbccddeeff' }));
        });
    });

    describe('migration (real file-backed db)', () => {
        let tmpFile: string;

        beforeEach(() => {
            tmpFile = path.join(os.tmpdir(), `devices-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
        });

        afterEach(() => {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        });

        it('creates the schema on first run and reuses it (with zone/houseId) on a second run against the same file', () => {
            process.env.DEVICE_DB = tmpFile;
            const svc1 = new DeviceStorageService(mockLog, new EventService(mockLog));
            svc1.saveDevice(makeDevice('aabbccddeeff'));
            svc1.close();

            const svc2 = new DeviceStorageService(mockLog, new EventService(mockLog));
            const callback = vi.fn();
            svc2.findExistingDeviceBySerialNumber('aabbccddeeff', callback);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'aabbccddeeff', zone: null, houseId: null }));
            svc2.close();
        });

        it('defaults to devices.db when DEVICE_DB is unset', () => {
            delete process.env.DEVICE_DB;
            const defaultDbPath = path.join(process.cwd(), 'devices.db');
            const svc = new DeviceStorageService(mockLog, new EventService(mockLog));
            svc.close();
            if (fs.existsSync(defaultDbPath)) fs.unlinkSync(defaultDbPath);
        });
    });

    describe('close()', () => {
        it('closes the underlying db connection without throwing', async () => {
            await expect(service.close()).resolves.toBeUndefined();
        });

        it('logs an error instead of throwing when closing twice', async () => {
            await service.close();
            await service.close(); // second close on an already-closed handle throws internally
            expect(mockLog.error).toHaveBeenCalledWith('Error closing db', expect.any(Error));
        });
    });
});
