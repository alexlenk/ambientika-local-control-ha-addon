import {Logger} from 'winston';
import {DeviceStorageService} from './device-storage.service';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {OperatingMode} from '../models/enum/operating-mode.enum';
import {DeviceDto} from '../dto/device.dto';
import {FanSpeed} from '../models/enum/fan-speed.enum';
import {HumidityLevel} from '../models/enum/humidity-level.enum';
import {Device} from '../models/device.model';
import {DeviceMapper} from './device.mapper';
import {LightSensitivity} from '../models/enum/light-sensitivity.enum';
import {WeatherUpdateDto} from '../dto/weather-update.dto';
import {DeviceSetupDto} from '../dto/device-setup.dto';
import {DeviceRole} from '../models/enum/device-role.enum';

export class DeviceCommandService {

    private deviceMapper: DeviceMapper;
    private pendingCommands: Map<string, { timestamp: number, command: OperatingModeDto, timeoutId: NodeJS.Timeout }> = new Map();
    private readonly COMMAND_TIMEOUT_MS = 5000; // 5 seconds timeout for device response

    constructor(private log: Logger,
                private deviceStorageService: DeviceStorageService,
                private eventService: EventService) {
        this.deviceMapper = new DeviceMapper(this.log);
        this.init();
    }

    private init(): void {
        this.log.debug('Initializing DeviceCommandService');
        this.initEventListener();
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, (opMode: OperatingModeDto
            , serialNumber: string) => {
            this.log.info(`Sending command to ${serialNumber}: ${JSON.stringify(opMode)}`);
            this.handleOperatingModeUpdate(opMode, serialNumber)
        });
        this.eventService.on(AppEvents.DEVICE_FILTER_RESET, (serialNumber: string) => {
            this.log.debug(`Command service filter reset received for: ${serialNumber}`);
            this.handleFilterReset(serialNumber)
        });
        this.eventService.on(AppEvents.DEVICE_WEATHER_UPDATE, (weatherUpdateDto: WeatherUpdateDto) => {
            this.log.debug(`Command service weather update received`);
            this.handleWeatherUpdate(weatherUpdateDto);
        });
        this.eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, (device: Device) => {
            this.handleDeviceStatusUpdate(device);
        });
        this.eventService.on(AppEvents.DEVICE_SETUP_UPDATE, (deviceSetupDto: DeviceSetupDto) => {
            this.log.info(`Device setup command received: ${JSON.stringify(deviceSetupDto)}`);
            this.handleDeviceSetup(deviceSetupDto);
        });
    }

    private handleDeviceStatusUpdate(device: Device): void {
        const pending = this.pendingCommands.get(device.serialNumber);
        if (pending) {
            this.log.info(`✅ Device ${device.serialNumber} responded - clearing timeout`);
            clearTimeout(pending.timeoutId);
            this.pendingCommands.delete(device.serialNumber);
        }
    }

    private handleOperatingModeUpdate(opMode: OperatingModeDto, serialNumber: string): void {
        const now = Date.now();
        
        this.log.info(`=== DEEP COMMAND ANALYSIS for ${serialNumber} ===`);
        this.log.info(`Command: ${JSON.stringify(opMode)}`);
        
        this.deviceStorageService.findExistingDeviceBySerialNumber(serialNumber,
            (dto: DeviceDto | undefined) => {
                if (dto) {
                    const device = this.deviceMapper.deviceFromDto(dto);
                    this.log.info(`Current device state: mode=${device.operatingMode}, lastMode=${device.lastOperatingMode}, fanSpeed=${device.fanSpeed}, role=${device.deviceRole}`);
                    
                    const data = this.getUpdateBufferData(opMode, device);
                    this.log.info(`Generated command buffer: ${data.toString('hex')}`);
                    this.analyzeCommandBuffer(data, opMode, device);
                    
                    // Clear any existing timeout for this device
                    const existingPending = this.pendingCommands.get(serialNumber);
                    if (existingPending) {
                        clearTimeout(existingPending.timeoutId);
                    }
                    
                    // Setup timeout for device response
                    const timeoutId = setTimeout(() => {
                        this.log.error(`❌ Device ${serialNumber} did not respond within ${this.COMMAND_TIMEOUT_MS}ms`);
                        this.log.error(`❌ Command that timed out: ${JSON.stringify(opMode)}`);
                        this.log.error(`❌ Device may be unresponsive - check socket connection`);
                        this.pendingCommands.delete(serialNumber);
                    }, this.COMMAND_TIMEOUT_MS);
                    
                    this.pendingCommands.set(serialNumber, { timestamp: now, command: opMode, timeoutId });
                    this.log.info(`⏱️  Command timeout set for ${this.COMMAND_TIMEOUT_MS}ms`);
                    
                    this.localSocketDataUpdate(data, device.remoteAddress);
                }
            });
    }

    private getUpdateBufferData(opMode: OperatingModeDto, device: Device): Buffer {
        const buffer = Buffer.alloc(13);
        buffer.writeInt8(0x02);
        buffer.writeInt8(0x00, 1);
        const serialNumberChars = device.serialNumber.match(/.{2}/g);
        let offset = 2;
        if (serialNumberChars) {
            serialNumberChars?.forEach((octet: string) => {
                buffer.writeInt16LE(parseInt(octet, 16), offset);
                offset++;
            });

            buffer.writeInt8(1, offset);
            offset++;

            const operatingMode = this.getOperatingMode(opMode, device);
            buffer.writeInt8(operatingMode, offset);
            offset++;

            const fanSpeedValue = opMode.fanSpeed !== undefined ?
                FanSpeed[opMode.fanSpeed as keyof typeof FanSpeed] :
                FanSpeed[device.fanSpeed as keyof typeof FanSpeed];
            
            // Handle unknown fan speeds by defaulting to MEDIUM
            const finalFanSpeed = fanSpeedValue !== undefined ? fanSpeedValue : FanSpeed.MEDIUM;
            
            if (fanSpeedValue === undefined) {
                this.log.warn(`Unknown fanSpeed value ${opMode.fanSpeed || device.fanSpeed}, defaulting to MEDIUM`);
            }
            
            buffer.writeInt8(finalFanSpeed.valueOf(), offset);
            offset++;

            const humidityLevel = opMode.humidityLevel !== undefined ?
                HumidityLevel[opMode.humidityLevel as keyof typeof HumidityLevel] :
                HumidityLevel[device.humidityLevel as keyof typeof HumidityLevel];
            buffer.writeInt8(humidityLevel.valueOf(), offset);
            offset++;

            const lightSensitivity = opMode.lightSensitivity !== undefined ?
                LightSensitivity[opMode.lightSensitivity as keyof typeof LightSensitivity] :
                LightSensitivity[device.lightSensitivity as keyof typeof LightSensitivity];
            buffer.writeInt8(lightSensitivity.valueOf(), offset);
        }
        return buffer;
    }

    private analyzeCommandBuffer(buffer: Buffer, opMode: OperatingModeDto, device: Device): void {
        this.log.info(`=== BUFFER ANALYSIS ===`);
        this.log.info(`Buffer length: ${buffer.length} bytes`);
        this.log.info(`Hex: ${buffer.toString('hex')}`);
        
        // Parse buffer structure
        this.log.info(`Byte 0: ${buffer[0].toString(16)} (should be 0x02)`);
        this.log.info(`Byte 1: ${buffer[1].toString(16)} (should be 0x00)`);
        
        // Serial number (bytes 2-7)
        const serialHex = buffer.slice(2, 8).toString('hex');
        this.log.info(`Serial (bytes 2-7): ${serialHex} (should be ${device.serialNumber})`);
        
        // Command byte (should be 0x01)
        this.log.info(`Command byte 8: ${buffer[8].toString(16)} (should be 0x01)`);
        
        // Operating mode
        const operatingModeByte = buffer[9];
        this.log.info(`Operating mode byte 9: ${operatingModeByte} (requested: ${opMode.operatingMode})`);
        
        // Fan speed
        const fanSpeedByte = buffer[10];
        this.log.info(`Fan speed byte 10: ${fanSpeedByte} (current device: ${device.fanSpeed})`);
        
        // Remaining bytes
        for (let i = 11; i < buffer.length; i++) {
            this.log.info(`Byte ${i}: ${buffer[i].toString(16)}`);
        }
        
        // Check for potential issues
        if (device.deviceRole === 'SLAVE_OPPOSITE_MASTER' || device.deviceRole === 'SLAVE') {
            this.log.warn(`⚠️  Device is SLAVE role - might reject master commands!`);
        }
        
        if (device.operatingMode === 'MASTER_SLAVE_FLOW' && opMode.operatingMode !== 'MASTER_SLAVE_FLOW') {
            this.log.warn(`⚠️  Device locked in MASTER_SLAVE_FLOW - might reject mode changes!`);
        }
    }

    private localSocketDataUpdate(data: Buffer, remoteAddress: string): void {
        this.eventService.localSocketDataUpdate(data, remoteAddress);
    }

    private getOperatingMode(opMode: OperatingModeDto, device: Device): number {
        if (opMode.operatingMode !== undefined) {
            if (opMode.operatingMode === OperatingMode.LAST.toString()) {
                return OperatingMode[device.lastOperatingMode as keyof typeof OperatingMode];
            } else {
                return OperatingMode[opMode.operatingMode as keyof typeof OperatingMode];
            }
        } else {
            return OperatingMode[device.operatingMode as keyof typeof OperatingMode];
        }
    }

    private handleFilterReset(serialNumber: string): void {
        this.deviceStorageService.findExistingDeviceBySerialNumber(serialNumber,
            (dto: DeviceDto | undefined) => {
                if (dto) {
                    const device = this.deviceMapper.deviceFromDto(dto);
                    const data = this.getFilterResetBufferData(serialNumber);
                    this.localSocketDataUpdate(data, device.remoteAddress);
                }
            });
    }

    private getFilterResetBufferData(serialNumber: string): Buffer {
        const buffer = Buffer.alloc(9);
        buffer.writeInt8(0x02);
        buffer.writeInt8(0x00, 1);
        const serialNumberChars = serialNumber.match(/.{2}/g);
        let offset = 2;
        if (serialNumberChars) {
            serialNumberChars.forEach((octet: string) => {
                buffer.writeInt16LE(parseInt(octet, 16), offset);
                offset++;
            });
        }
        buffer.writeInt8(0x03, offset);
        return buffer;
    }


    private handleWeatherUpdate(weatherUpdateDto: WeatherUpdateDto): void {
        this.deviceStorageService.getDevices(
            (dtos: DeviceDto[] | undefined) => {
                if (dtos) {
                    dtos.forEach(dto => {
                        const device = this.deviceMapper.deviceFromDto(dto);
                        const data = this.getWeatherUpdateBufferData(device.serialNumber, weatherUpdateDto);
                        this.localSocketDataUpdate(data, device.remoteAddress);
                    });
                }
            });
    }

    private getWeatherUpdateBufferData(serialNumber: string, weatherUpdateDto: WeatherUpdateDto): Buffer {
        const buffer = Buffer.alloc(13);
        buffer.writeInt8(0x02);
        buffer.writeInt8(0x00, 1);
        const serialNumberChars = serialNumber.match(/.{2}/g);
        let offset = 2;
        if (serialNumberChars) {
            serialNumberChars.forEach((octet: string) => {
                buffer.writeInt16LE(parseInt(octet, 16), offset);
                offset++;
            });
        }
        buffer.writeInt8(0x04, offset);

        let minus = false;
        if (weatherUpdateDto.temperature < 0) {
            minus = true;
        }
        let temp = weatherUpdateDto.toString().replace(/\D/g, '');
        temp = temp.padEnd(4, '0').substring(0, 4);
        let tempInt = parseInt(temp);
        if (minus) {
            tempInt = tempInt * -1;
        }
        buffer.writeInt16LE(tempInt, offset);
        offset++;
        offset++;
        buffer.writeInt8(weatherUpdateDto.humidity, offset);
        offset++;
        buffer.writeInt8(weatherUpdateDto.airQuality, offset);

        return buffer;
    }

    private handleDeviceSetup(deviceSetupDto: DeviceSetupDto): void {
        this.deviceStorageService.findExistingDeviceBySerialNumber(deviceSetupDto.serialNumber,
            (dto: DeviceDto | undefined) => {
                if (dto) {
                    const device = this.deviceMapper.deviceFromDto(dto);
                    this.log.info(`Sending device setup to ${deviceSetupDto.serialNumber}: role=${deviceSetupDto.deviceRole}, zone=${deviceSetupDto.zoneIndex}, houseId=${deviceSetupDto.houseId}`);
                    
                    const data = this.getDeviceSetupBufferData(deviceSetupDto);
                    this.log.info(`Generated setup buffer: ${data.toString('hex')}`);
                    
                    this.localSocketDataUpdate(data, device.remoteAddress);
                } else {
                    this.log.error(`Device ${deviceSetupDto.serialNumber} not found for setup command`);
                }
            });
    }

    private getDeviceSetupBufferData(deviceSetupDto: DeviceSetupDto): Buffer {
        const buffer = Buffer.alloc(16);
        buffer.writeInt8(0x02);
        buffer.writeInt8(0x00, 1);
        
        // Write serial number (6 bytes)
        const serialNumberChars = deviceSetupDto.serialNumber.match(/.{2}/g);
        let offset = 2;
        if (serialNumberChars) {
            serialNumberChars.forEach((octet: string) => {
                buffer.writeUInt8(parseInt(octet, 16), offset);
                offset++;
            });
        }
        
        // Command bytes (discovered format: 00 02 for device setup)
        buffer.writeInt8(0x00, offset);
        offset++;
        buffer.writeInt8(0x02, offset);
        offset++;
        
        // Zone index (byte 10)
        buffer.writeInt8(deviceSetupDto.zoneIndex, offset);
        offset++;
        
        // Device role (byte 11)
        const roleValue = DeviceRole[deviceSetupDto.deviceRole as keyof typeof DeviceRole];
        buffer.writeInt8(roleValue, offset);
        offset++;
        
        // House ID (4 bytes, little endian, bytes 12-15)
        buffer.writeUInt32LE(deviceSetupDto.houseId, offset);
        
        this.log.info(`Device setup buffer breakdown:
        Header: ${buffer.slice(0, 2).toString('hex')}
        Serial: ${buffer.slice(2, 8).toString('hex')} 
        Command: ${buffer.slice(8, 10).toString('hex')}
        Zone: ${buffer[10]} 
        Role: ${buffer[11]} (${deviceSetupDto.deviceRole})
        House ID: ${buffer.slice(12, 16).toString('hex')} (${deviceSetupDto.houseId})`);
        
        return buffer;
    }
}
