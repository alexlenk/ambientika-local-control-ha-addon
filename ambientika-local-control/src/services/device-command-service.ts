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

export class DeviceCommandService {

    private deviceMapper: DeviceMapper;

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
            this.log.debug(`Command service operating Mode update received for: ${serialNumber} with data %o`, opMode);
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
    }

    private handleOperatingModeUpdate(opMode: OperatingModeDto, serialNumber: string): void {
        this.deviceStorageService.findExistingDeviceBySerialNumber(serialNumber,
            (dto: DeviceDto | undefined) => {
                if (dto) {
                    const device = this.deviceMapper.deviceFromDto(dto);
                    const data = this.getUpdateBufferData(opMode, device);
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
}
