import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceCommandService } from '../../services/device-command-service';
import { EventService } from '../../services/event.service';
import { WeatherUpdateDto } from '../../dto/weather-update.dto';
import { Device } from '../../models/device.model';
import { OperatingModeDto } from '../../dto/operating-mode.dto';
import { DeviceSetupDto } from '../../dto/device-setup.dto';
import { DeviceMapper } from '../../services/device.mapper';
import { MqttService } from '../../services/mqtt.service';

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

    describe('humidity level from the HA target-humidity slider (#89)', () => {
        it.each([
            ['40', 0],
            ['60', 1],
            ['75', 2],
        ])('slider %s %% is encoded as humidity level %d at byte 11', (slider, expected) => {
            const mqtt = { getHumidityLevel: (MqttService.prototype as any).getHumidityLevel };
            const humidityLevel = mqtt.getHumidityLevel(slider);
            const buf = (service as any).getUpdateBufferData({ humidityLevel } as OperatingModeDto, makeDevice());
            expect(buf[11]).toBe(expected);
        });
    });

    describe('getWeatherUpdateBufferData (#90)', () => {
        const dto: WeatherUpdateDto = { temperature: 23.5, humidity: 72, airQuality: 2 };

        it('matches the cloud frame from the protocol doc byte for byte (17.12 °C, 89 %, AQ 1)', () => {
            const buf = getWeatherBuffer('aabbccddeeff', { temperature: 17.12, humidity: 89, airQuality: 1 });
            expect(buf.toString('hex')).toBe('0200aabbccddeeff04b0065901');
        });

        it('keeps the 0x04 command byte at byte 8 (was overwritten by the temperature)', () => {
            expect(getWeatherBuffer('aabbccddeeff', dto)[8]).toBe(0x04);
        });

        it.each([
            [21.5, 2150],
            [10, 1000],
            [5, 500],        // was encoded as 5000 (50 °C)
            [5.5, 550],      // was 5500
            [0.5, 50],       // was 500
            [0, 0],
            [-3.2, -320],    // was -3200
            [-15, -1500],
            [17.123, 1712],  // rounded to hundredths
        ])('encodes %d °C as int16 LE %d at bytes 9-10', (temperature, expected) => {
            const buf = getWeatherBuffer('aabbccddeeff', { temperature, humidity: 50, airQuality: 1 });
            expect(buf.readInt16LE(9)).toBe(expected);
        });

        it('puts humidity at byte 11 and airQuality at byte 12', () => {
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf[11]).toBe(72);
            expect(buf[12]).toBe(2);
        });

        it('writes header and serial number', () => {
            const buf = getWeatherBuffer('aabbccddeeff', dto);
            expect(buf.length).toBe(13);
            expect(buf.subarray(0, 8).toString('hex')).toBe('0200aabbccddeeff');
        });

        it("round-trips through the add-on's own cloud weather frame parser", () => {
            const parsed = new DeviceMapper(mockLog).deviceWeatherUpdateFromSocketBuffer(
                getWeatherBuffer('aabbccddeeff', { temperature: -3.2, humidity: 72, airQuality: 2 }));
            expect(parsed.serialNumber).toBe('aabbccddeeff');
            expect(parsed.temperature).toBe(-3.2);
            expect(parsed.humidity).toBe(72);
            expect(parsed.airQuality).toBe('GOOD');
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
