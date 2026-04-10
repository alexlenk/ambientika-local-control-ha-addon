import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceCommandService } from '../../services/device-command-service';
import { EventService } from '../../services/event.service';
import { WeatherUpdateDto } from '../../dto/weather-update.dto';
import { Device } from '../../models/device.model';
import { OperatingModeDto } from '../../dto/operating-mode.dto';
import { DeviceSetupDto } from '../../dto/device-setup.dto';

const mockLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
} as any;

// Minimal mock — buffer methods don't touch storage, only private helpers need mocking
const mockStorage = {
    findExistingDeviceBySerialNumber: vi.fn(),
    findExistingDeviceByRemoteAddress: vi.fn(),
    getDevices: vi.fn(),
    saveDevice: vi.fn(),
    getStoredOperatingMode: vi.fn(),
    getStoredFanSpeed: vi.fn(),
} as any;

function makeDevice(serialNumber = 'aabbccddeeff'): Device {
    return new Device(serialNumber, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', '192.168.1.1', 80);
}

describe('DeviceCommandService — buffer generation (bug regression tests)', () => {
    let service: DeviceCommandService;
    let eventService: EventService;

    beforeEach(() => {
        vi.clearAllMocks();
        eventService = new EventService(mockLog);
        service = new DeviceCommandService(mockLog, mockStorage, eventService);
    });

    // Helper to access private methods
    function getWeatherBuffer(serialNumber: string, dto: WeatherUpdateDto): Buffer {
        return (service as any).getWeatherUpdateBufferData(serialNumber, dto);
    }
    function getUpdateBuffer(opMode: OperatingModeDto, device: Device): Buffer {
        return (service as any).getUpdateBufferData(opMode, device);
    }
    function getFilterResetBuffer(serialNumber: string): Buffer {
        return (service as any).getFilterResetBufferData(serialNumber);
    }
    function getSetupBuffer(dto: DeviceSetupDto): Buffer {
        return (service as any).getDeviceSetupBufferData(dto);
    }

    describe('getWeatherUpdateBufferData — Bug 1 & Bug 4 regression', () => {
        it('BUG 1 REGRESSION: encodes temperature correctly (was always 0 before fix)', () => {
            const dto: WeatherUpdateDto = { temperature: 23.5, humidity: 60, airQuality: 1 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);

            // Before fix: weatherUpdateDto.toString() → "[object Object]" → digits stripped → 0
            // After fix:  weatherUpdateDto.temperature.toString() → "23.5" → "235" → "2350" → 2350
            const tempValue = buf.readInt16LE(8);
            expect(tempValue).toBe(2350);
            expect(tempValue).not.toBe(0);
        });

        it('encodes zero temperature as 0', () => {
            const dto: WeatherUpdateDto = { temperature: 0, humidity: 50, airQuality: 0 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf.readInt16LE(8)).toBe(0);
        });

        it('encodes positive integer temperature correctly', () => {
            const dto: WeatherUpdateDto = { temperature: 20, humidity: 50, airQuality: 0 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            // "20" → "20" → padEnd(4,'0') → "2000" → 2000
            expect(buf.readInt16LE(8)).toBe(2000);
        });

        it('encodes negative temperature as negative value', () => {
            const dto: WeatherUpdateDto = { temperature: -3, humidity: 50, airQuality: 0 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf.readInt16LE(8)).toBeLessThan(0);
        });

        it('BUG 4 REGRESSION: serial number bytes are correct (writeUInt8, not writeInt16LE)', () => {
            const dto: WeatherUpdateDto = { temperature: 23.5, humidity: 60, airQuality: 1 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);

            // Serial number should be in bytes 2-7
            expect(buf[2]).toBe(0xaa);
            expect(buf[3]).toBe(0xbb);
            expect(buf[4]).toBe(0xcc);
            expect(buf[5]).toBe(0xdd);
            expect(buf[6]).toBe(0xee);
            expect(buf[7]).toBe(0xff);
        });

        it('encodes humidity in the correct byte position', () => {
            const dto: WeatherUpdateDto = { temperature: 23.5, humidity: 72, airQuality: 2 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf[10]).toBe(72);   // humidity at byte 10
            expect(buf[11]).toBe(2);    // airQuality at byte 11
        });

        it('allocates 13-byte buffer', () => {
            const dto: WeatherUpdateDto = { temperature: 10, humidity: 50, airQuality: 0 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf.length).toBe(13);
        });

        it('starts with 0x02, 0x00 header bytes', () => {
            const dto: WeatherUpdateDto = { temperature: 10, humidity: 50, airQuality: 0 };
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf[0]).toBe(0x02);
            expect(buf[1]).toBe(0x00);
        });
    });

    describe('getFilterResetBufferData — Bug 4 regression', () => {
        it('allocates 9-byte buffer', () => {
            const buf = getFilterResetBuffer('aabbccddeeff');
            expect(buf.length).toBe(9);
        });

        it('writes command byte 0x03 at offset 8', () => {
            const buf = getFilterResetBuffer('aabbccddeeff');
            expect(buf[8]).toBe(0x03);
        });

        it('BUG 4 REGRESSION: serial number bytes are correct at offsets 2-7', () => {
            const buf = getFilterResetBuffer('112233445566');
            expect(buf[2]).toBe(0x11);
            expect(buf[3]).toBe(0x22);
            expect(buf[4]).toBe(0x33);
            expect(buf[5]).toBe(0x44);
            expect(buf[6]).toBe(0x55);
            expect(buf[7]).toBe(0x66);
        });

        it('starts with 0x02, 0x00 header bytes', () => {
            const buf = getFilterResetBuffer('aabbccddeeff');
            expect(buf[0]).toBe(0x02);
            expect(buf[1]).toBe(0x00);
        });
    });

    describe('getUpdateBufferData — Bug 4 regression', () => {
        it('allocates 13-byte buffer', () => {
            const device = makeDevice();
            const opMode: OperatingModeDto = { operatingMode: 'AUTO', fanSpeed: 'LOW', humidityLevel: 'NORMAL', lightSensitivity: 'LOW' };
            const buf = getUpdateBuffer(opMode, device);
            expect(buf.length).toBe(13);
        });

        it('writes command byte 0x01 at offset 8', () => {
            const device = makeDevice();
            const opMode: OperatingModeDto = { operatingMode: 'AUTO' };
            const buf = getUpdateBuffer(opMode, device);
            expect(buf[8]).toBe(0x01);
        });

        it('BUG 4 REGRESSION: serial number bytes are correct at offsets 2-7', () => {
            const device = makeDevice('aabbccddeeff');
            const opMode: OperatingModeDto = { operatingMode: 'AUTO' };
            const buf = getUpdateBuffer(opMode, device);
            expect(buf[2]).toBe(0xaa);
            expect(buf[3]).toBe(0xbb);
            expect(buf[4]).toBe(0xcc);
            expect(buf[5]).toBe(0xdd);
            expect(buf[6]).toBe(0xee);
            expect(buf[7]).toBe(0xff);
        });
    });

    describe('getDeviceSetupBufferData', () => {
        // Protocol: 02 00 <MAC 6b> 00 <role> <zone> <houseId 4b LE> = 15 bytes
        // Matches cloud setup packet format (no padding byte before houseId).
        // Example: 0200aabbccddeeff000200102f0000
        //   → SLAVE_OPPOSITE_MASTER (role=2), zone=0, houseId=12048

        it('allocates 15-byte buffer', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'MASTER', zoneIndex: 0, houseId: 1 };
            const buf = getSetupBuffer(dto);
            expect(buf.length).toBe(15);
        });

        it('writes fixed header bytes', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'MASTER', zoneIndex: 0, houseId: 1 };
            const buf = getSetupBuffer(dto);
            expect(buf[0]).toBe(0x02);
            expect(buf[1]).toBe(0x00);
            expect(buf[8]).toBe(0x00);  // fixed byte
        });

        it('writes correct serial number at offsets 2-7', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'MASTER', zoneIndex: 0, houseId: 1 };
            const buf = getSetupBuffer(dto);
            expect(buf[2]).toBe(0xaa);
            expect(buf[3]).toBe(0xbb);
            expect(buf[4]).toBe(0xcc);
            expect(buf[5]).toBe(0xdd);
            expect(buf[6]).toBe(0xee);
            expect(buf[7]).toBe(0xff);
        });

        it('writes device role at offset 9', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'SLAVE_OPPOSITE_MASTER', zoneIndex: 0, houseId: 0 };
            const buf = getSetupBuffer(dto);
            expect(buf[9]).toBe(2); // SLAVE_OPPOSITE_MASTER = 2
        });

        it('writes zoneIndex at offset 10', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'MASTER', zoneIndex: 3, houseId: 0 };
            const buf = getSetupBuffer(dto);
            expect(buf[10]).toBe(3);
        });

        it('writes houseId as uint32LE at offset 11', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'MASTER', zoneIndex: 0, houseId: 12345 };
            const buf = getSetupBuffer(dto);
            expect(buf.readUInt32LE(11)).toBe(12345);
        });

        it('matches cloud packet format for SLAVE_OPPOSITE_MASTER zone=0 houseId=12048', () => {
            const dto: DeviceSetupDto = { serialNumber: 'aabbccddeeff', deviceRole: 'SLAVE_OPPOSITE_MASTER', zoneIndex: 0, houseId: 12048 };
            const buf = getSetupBuffer(dto);
            expect(buf.toString('hex')).toBe('0200aabbccddeeff000200102f0000');
        });
    });
});
