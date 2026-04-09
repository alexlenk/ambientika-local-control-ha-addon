import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceMapper } from '../../services/device.mapper';
import { OperatingMode } from '../../models/enum/operating-mode.enum';
import { FanSpeed } from '../../models/enum/fan-speed.enum';
import { HumidityLevel } from '../../models/enum/humidity-level.enum';
import { AirQuality } from '../../models/enum/air-quality.enum';
import { FilterStatus } from '../../models/enum/filter-status.enum';
import { DeviceRole } from '../../models/enum/device-role.enum';
import { LightSensitivity } from '../../models/enum/light-sensitivity.enum';
import { FanMode } from '../../models/enum/fan-mode.enum';
import { FanStatus } from '../../models/enum/fan-status.enum';
import { DeviceDto } from '../../dto/device.dto';

const mockLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
} as any;

describe('DeviceMapper', () => {
    let mapper: DeviceMapper;

    beforeEach(() => {
        mapper = new DeviceMapper(mockLog);
        vi.clearAllMocks();
    });

    describe('deviceFromSocketBuffer', () => {
        it('parses a 21-byte status buffer into a Device', () => {
            // bytes: [cmd, 0x00, sn×6, opMode, fanSpeed, humLvl, temp, hum, airQ, humAlarm, filterSt, nightAlarm, role, lastOpMode, lightSens, signal]
            const buf = Buffer.alloc(21);
            buf.writeUInt8(0x02, 0);
            buf.writeUInt8(0x00, 1);
            // serial number: aa bb cc dd ee ff
            buf.writeUInt8(0xaa, 2);
            buf.writeUInt8(0xbb, 3);
            buf.writeUInt8(0xcc, 4);
            buf.writeUInt8(0xdd, 5);
            buf.writeUInt8(0xee, 6);
            buf.writeUInt8(0xff, 7);
            buf.writeUInt8(OperatingMode.AUTO, 8);       // operatingMode = AUTO (1)
            buf.writeUInt8(FanSpeed.HIGH, 9);             // fanSpeed = HIGH (2)
            buf.writeUInt8(HumidityLevel.NORMAL, 10);     // humidityLevel = NORMAL (1)
            buf.writeUInt8(22, 11);                       // temperature = 22
            buf.writeUInt8(60, 12);                       // humidity = 60
            buf.writeUInt8(AirQuality.GOOD, 13);          // airQuality = GOOD (1)
            buf.writeUInt8(0, 14);                        // humidityAlarm = false
            buf.writeUInt8(FilterStatus.GOOD, 15);         // filterStatus = GOOD (0)
            buf.writeUInt8(0, 16);                        // nightAlarm = false
            buf.writeUInt8(DeviceRole.MASTER, 17);        // deviceRole = MASTER (0)
            buf.writeUInt8(OperatingMode.NIGHT, 18);      // lastOperatingMode = NIGHT (3)
            buf.writeUInt8(LightSensitivity.MEDIUM, 19); // lightSensitivity
            buf.writeUInt8(80, 20);                       // signalStrength = 80

            const device = mapper.deviceFromSocketBuffer(buf, '192.168.1.100');

            expect(device.serialNumber).toBe('aabbccddeeff');
            expect(device.operatingMode).toBe('AUTO');
            expect(device.fanSpeed).toBe('HIGH');
            expect(device.humidityLevel).toBe('NORMAL');
            expect(device.temperature).toBe(22);
            expect(device.humidity).toBe(60);
            expect(device.airQuality).toBe('GOOD');
            expect(device.humidityAlarm).toBe(false);
            expect(device.filterStatus).toBe('GOOD');
            expect(device.nightAlarm).toBe(false);
            expect(device.deviceRole).toBe('MASTER');
            expect(device.lastOperatingMode).toBe('NIGHT');
            expect(device.remoteAddress).toBe('192.168.1.100');
            expect(device.signalStrength).toBe(80);
        });

        it('sets humidityAlarm and nightAlarm to true when byte is 1', () => {
            const buf = Buffer.alloc(21);
            buf.writeUInt8(1, 14); // humidityAlarm = true
            buf.writeUInt8(1, 16); // nightAlarm = true

            const device = mapper.deviceFromSocketBuffer(buf, '10.0.0.1');

            expect(device.humidityAlarm).toBe(true);
            expect(device.nightAlarm).toBe(true);
        });

        it('falls back to MEDIUM fan speed for unknown fanSpeed value and logs warning', () => {
            const buf = Buffer.alloc(21);
            buf.writeUInt8(99, 9); // unknown fanSpeed

            const device = mapper.deviceFromSocketBuffer(buf, '10.0.0.1');

            expect(device.fanSpeed).toBe('MEDIUM');
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid fanSpeed'));
        });

        it('falls back to MASTER device role for unknown role value and logs warning', () => {
            const buf = Buffer.alloc(21);
            buf.writeUInt8(99, 17); // unknown deviceRole

            const device = mapper.deviceFromSocketBuffer(buf, '10.0.0.1');

            expect(device.deviceRole).toBe('MASTER');
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown device role'));
        });
    });

    describe('deviceInformationFromSocketBuffer', () => {
        it('parses firmware version strings from 18-byte buffer', () => {
            const buf = Buffer.alloc(18);
            // serial: 01 02 03 04 05 06
            buf.writeUInt8(0x01, 2);
            buf.writeUInt8(0x02, 3);
            buf.writeUInt8(0x03, 4);
            buf.writeUInt8(0x04, 5);
            buf.writeUInt8(0x05, 6);
            buf.writeUInt8(0x06, 7);
            // radioFwVersion: 1.2.3
            buf.writeUInt8(1, 8);
            buf.writeUInt8(2, 9);
            buf.writeUInt8(3, 10);
            // microFwVersion: 4.5.6
            buf.writeUInt8(4, 11);
            buf.writeUInt8(5, 12);
            buf.writeUInt8(6, 13);
            // radioAtCommandsFwVersion: 7.8.9.10
            buf.writeUInt8(7, 14);
            buf.writeUInt8(8, 15);
            buf.writeUInt8(9, 16);
            buf.writeUInt8(10, 17);

            const info = mapper.deviceInformationFromSocketBuffer(buf);

            expect(info.serialNumber).toBe('010203040506');
            expect(info.radioFwVersion).toBe('1.2.3');
            expect(info.microFwVersion).toBe('4.5.6');
            expect(info.radioAtCommandsFwVersion).toBe('7.8.9.10');
        });
    });

    describe('deviceSetupFromSocketBuffer', () => {
        it('parses role, zone, and houseId from 16-byte buffer (proxy-injected format)', () => {
            const buf = Buffer.alloc(16);
            buf.writeUInt8(0xaa, 2);
            buf.writeUInt8(0xbb, 3);
            buf.writeUInt8(0xcc, 4);
            buf.writeUInt8(0xdd, 5);
            buf.writeUInt8(0xee, 6);
            buf.writeUInt8(0xff, 7);
            buf.writeUInt8(0x00, 8);               // padding
            buf.writeUInt8(DeviceRole.SLAVE_EQUAL_MASTER, 9);  // deviceRole = SLAVE_EQUAL_MASTER (1)
            buf.writeUInt8(2, 10);                 // zoneIndex = 2
            buf.writeUInt8(0x00, 11);              // padding
            buf.writeUInt32LE(12345, 12);          // houseId = 12345

            const setup = mapper.deviceSetupFromSocketBuffer(buf);

            expect(setup.serialNumber).toBe('aabbccddeeff');
            expect(setup.deviceRole).toBe('SLAVE_EQUAL_MASTER');
            expect(setup.zoneIndex).toBe(2);
            expect(setup.houseId).toBe(12345);
        });

        it('parses role, zone, and houseId from 15-byte buffer (cloud format)', () => {
            const buf = Buffer.alloc(15);
            buf.writeUInt8(0xaa, 2);
            buf.writeUInt8(0xbb, 3);
            buf.writeUInt8(0xcc, 4);
            buf.writeUInt8(0xdd, 5);
            buf.writeUInt8(0xee, 6);
            buf.writeUInt8(0xff, 7);
            buf.writeUInt8(0x00, 8);               // padding
            buf.writeUInt8(DeviceRole.MASTER, 9);  // deviceRole = MASTER (0)
            buf.writeUInt8(0, 10);                 // zoneIndex = 0
            buf.writeUInt32LE(12048, 11);          // houseId = 12048 (no padding at byte 11)

            const setup = mapper.deviceSetupFromSocketBuffer(buf);

            expect(setup.serialNumber).toBe('aabbccddeeff');
            expect(setup.deviceRole).toBe('MASTER');
            expect(setup.zoneIndex).toBe(0);
            expect(setup.houseId).toBe(12048);
        });

        it('falls back to MASTER for unknown role in setup', () => {
            const buf = Buffer.alloc(16);
            buf.writeUInt8(99, 9);

            const setup = mapper.deviceSetupFromSocketBuffer(buf);

            expect(setup.deviceRole).toBe('MASTER');
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown device role'));
        });
    });

    describe('deviceFilterResetFromSocketBuffer', () => {
        it('parses serial number and filterReset value', () => {
            const buf = Buffer.alloc(9);
            buf.writeUInt8(0x11, 2);
            buf.writeUInt8(0x22, 3);
            buf.writeUInt8(0x33, 4);
            buf.writeUInt8(0x44, 5);
            buf.writeUInt8(0x55, 6);
            buf.writeUInt8(0x66, 7);
            buf.writeUInt8(1, 8); // filterReset = 1

            const result = mapper.deviceFilterResetFromSocketBuffer(buf);

            expect(result.serialNumber).toBe('112233445566');
            expect(result.filterReset).toBe(1);
        });
    });

    describe('deviceStatusBroadCastFromBuffer', () => {
        it('extracts zoneIndex, fanMode, and fanStatus from broadcast buffer', () => {
            const buf = Buffer.alloc(4);
            // byte 1: lower nibble = zoneIndex = 3
            buf.writeUInt8(0x03, 1);
            // byte 2: upper nibble = fanMode (FanMode.ALTERNATING = 2), lower nibble = fanStatus (FanStatus.START_SLOW = 1)
            buf.writeUInt8((FanMode.ALTERNATING << 4) | FanStatus.START_SLOW, 2);

            const result = mapper.deviceStatusBroadCastFromBuffer(buf, 'aabbccddeeff');

            expect(result.serialNumber).toBe('aabbccddeeff');
            expect(result.zoneIndex).toBe(3);
            expect(result.fanMode).toBe('ALTERNATING');
            expect(result.fanStatus).toBe('START_SLOW');
        });

        it('passes through undefined serialNumber', () => {
            const buf = Buffer.alloc(4);
            const result = mapper.deviceStatusBroadCastFromBuffer(buf, undefined);
            expect(result.serialNumber).toBeUndefined();
        });
    });

    describe('Device.equals()', () => {
        it('returns true when two devices have the same serialNumber', () => {
            const buf = Buffer.alloc(21);
            buf.writeUInt8(0xaa, 2); buf.writeUInt8(0xbb, 3); buf.writeUInt8(0xcc, 4);
            buf.writeUInt8(0xdd, 5); buf.writeUInt8(0xee, 6); buf.writeUInt8(0xff, 7);
            const d1 = mapper.deviceFromSocketBuffer(buf, '192.168.1.1');
            const d2 = mapper.deviceFromSocketBuffer(buf, '192.168.1.2');
            expect(d1.equals(d2)).toBe(true);
        });

        it('returns false when two devices have different serialNumbers', () => {
            const buf1 = Buffer.alloc(21);
            buf1.writeUInt8(0xaa, 2); buf1.writeUInt8(0xbb, 3); buf1.writeUInt8(0xcc, 4);
            buf1.writeUInt8(0xdd, 5); buf1.writeUInt8(0xee, 6); buf1.writeUInt8(0xff, 7);
            const buf2 = Buffer.alloc(21);
            buf2.writeUInt8(0x11, 2); buf2.writeUInt8(0x22, 3); buf2.writeUInt8(0x33, 4);
            buf2.writeUInt8(0x44, 5); buf2.writeUInt8(0x55, 6); buf2.writeUInt8(0x66, 7);
            const d1 = mapper.deviceFromSocketBuffer(buf1, '192.168.1.1');
            const d2 = mapper.deviceFromSocketBuffer(buf2, '192.168.1.1');
            expect(d1.equals(d2)).toBe(false);
        });
    });

    describe('getSignedInt16FromBufferSlice error path', () => {
        it('returns 0 and logs warning when buffer is too short for weather update', () => {
            // 8-byte buffer — deviceWeatherUpdateFromSocketBuffer reads bytes 9-11 for temperature
            const shortBuf = Buffer.alloc(8);
            mapper.deviceWeatherUpdateFromSocketBuffer(shortBuf);
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not get int from buffer'));
        });
    });

    describe('getBooleanFromBufferSlice error path', () => {
        it('returns false and logs warning when buffer is truncated at byte 14', () => {
            // 14-byte buffer — humidityAlarm is at bytes 14-15, which is out of range
            const shortBuf = Buffer.alloc(14);
            mapper.deviceFromSocketBuffer(shortBuf, '10.0.0.1');
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Could not get boolean from buffer'));
        });
    });

    describe('deviceFromDto', () => {
        it('maps all DeviceDto fields to a Device', () => {
            const dto: DeviceDto = {
                id: 1,
                serialNumber: 'aabbccddeeff',
                status: 'ONLINE',
                lastUpdate: new Date().toISOString(),
                firstSeen: new Date().toISOString(),
                operatingMode: 'AUTO',
                fanSpeed: 'LOW',
                humidityLevel: 'NORMAL',
                temperature: 21,
                humidity: 55,
                airQuality: 'GOOD',
                humidityAlarm: false,
                filterStatus: 'GOOD',
                nightAlarm: false,
                deviceRole: 'MASTER',
                remoteAddress: '192.168.1.50',
                lastOperatingMode: 'SMART',
                lightSensitivity: 'LOW',
            };

            const device = mapper.deviceFromDto(dto);

            expect(device.serialNumber).toBe('aabbccddeeff');
            expect(device.operatingMode).toBe('AUTO');
            expect(device.fanSpeed).toBe('LOW');
            expect(device.humidityLevel).toBe('NORMAL');
            expect(device.temperature).toBe(21);
            expect(device.humidity).toBe(55);
            expect(device.airQuality).toBe('GOOD');
            expect(device.humidityAlarm).toBe(false);
            expect(device.filterStatus).toBe('GOOD');
            expect(device.nightAlarm).toBe(false);
            expect(device.deviceRole).toBe('MASTER');
            expect(device.lastOperatingMode).toBe('SMART');
            expect(device.lightSensitivity).toBe('LOW');
            expect(device.remoteAddress).toBe('192.168.1.50');
            expect(device.signalStrength).toBe(0);
        });
    });
});
