import {Device} from '../models/device.model';
import {OperatingMode} from '../models/enum/operating-mode.enum';
import {FanSpeed} from '../models/enum/fan-speed.enum';
import {HumidityLevel} from '../models/enum/humidity-level.enum';
import {DeviceRole} from '../models/enum/device-role.enum';
import {DeviceDto} from '../dto/device.dto';
import {DeviceInfo} from '../models/device-information.model';
import {DeviceSetup} from '../models/device-setup.model';
import {DeviceFilterReset} from '../models/device-filter-reset.model';
import {DeviceCommand} from '../models/device-command.model';
import {AirQuality} from '../models/enum/air-quality.enum';
import {LightSensitivity} from '../models/enum/light-sensitivity.enum';
import {FilterStatus} from '../models/enum/filter-status.enum';
import {DeviceWeatherUpdate} from '../models/device-weather-update.model';
import {FanStatus} from '../models/enum/fan-status.enum';
import {FanMode} from '../models/enum/fan-mode.enum';
import {DeviceBroadcastStatus} from '../models/device-broadcast-status.model';
import {Logger} from 'winston';

export class DeviceMapper {
    private buffer: Buffer;

    constructor(private log: Logger) {
    }

    deviceFromSocketBuffer(data: Buffer, remoteAddress: string): Device {
        this.buffer = data;
        const serialNumber = this.getHexStringFromBufferSlice(2,8);
        const operatingMode = OperatingMode[this.getIntFromBufferSlice(8, 9)];
        const fanSpeedValue = this.getIntFromBufferSlice(9, 10);
        const fanSpeed = FanSpeed[fanSpeedValue];
        if (fanSpeed === undefined) {
            this.log.warn(`Invalid fanSpeed value ${fanSpeedValue} from device buffer, using MEDIUM fallback`);
        }
        const finalFanSpeed = fanSpeed || FanSpeed[FanSpeed.MEDIUM];
        const humidityLevel = HumidityLevel[this.getIntFromBufferSlice(10, 11)];
        const temperature = this.getIntFromBufferSlice(11, 12);
        const humidity = this.getIntFromBufferSlice(12, 13);
        const airQuality = AirQuality[this.getIntFromBufferSlice(13, 14)];
        const humidityAlarm = this.getBooleanFromBufferSlice(14, 15);
        const filterStatus = FilterStatus[this.getIntFromBufferSlice(15, 16)];
        const nightAlarm = this.getBooleanFromBufferSlice(16, 17);
        const deviceRoleValue = this.getIntFromBufferSlice(17, 18);
        const deviceRole = DeviceRole[deviceRoleValue];
        const lastOperatingMode = OperatingMode[this.getIntFromBufferSlice(18, 19)];
        const lightSensitivity = LightSensitivity[this.getIntFromBufferSlice(19, 20)];
        const signalStrength = this.getIntFromBufferSlice(20, 21);
        
        // Extract house ID (bytes 18-21, but we need to handle buffer length safely)
        let houseId = 0;
        let zoneId = 0;
        
        if (this.buffer.length >= 22) {
            // House ID is in bytes 18-21 (little-endian)
            houseId = this.getUInt32LEFromBufferSlice(18, 22);
        }
        
        // Zone ID could be extracted from UDP broadcasts or estimated from device communication patterns
        // For now, we'll use a placeholder - this may need device-specific logic
        zoneId = 0;
        
        return new Device(
            serialNumber,
            operatingMode,
            finalFanSpeed,
            humidityLevel,
            temperature,
            humidity,
            airQuality,
            humidityAlarm,
            filterStatus,
            nightAlarm,
            deviceRole,
            lastOperatingMode,
            lightSensitivity,
            remoteAddress,
            signalStrength,
            houseId,
            zoneId
        )
    }

    deviceInformationFromSocketBuffer(data: Buffer): DeviceInfo {
        this.buffer = data;
        const serialNumber = this.getHexStringFromBufferSlice(2,8);
        let radioFwVersion = this.getIntFromBufferSlice(8, 9).toString();
        radioFwVersion += '.' + this.getIntFromBufferSlice(9, 10).toString();
        radioFwVersion += '.' + this.getIntFromBufferSlice(10, 11).toString();
        let microFwVersion = this.getIntFromBufferSlice(11, 12).toString();
        microFwVersion += '.' + this.getIntFromBufferSlice(12, 13).toString();
        microFwVersion += '.' + this.getIntFromBufferSlice(13, 14).toString();
        let radioAtCommandsFwVersion = this.getIntFromBufferSlice(14, 15).toString();
        radioAtCommandsFwVersion += '.' + this.getIntFromBufferSlice(15, 16).toString();
        radioAtCommandsFwVersion += '.' + this.getIntFromBufferSlice(16, 17).toString();
        radioAtCommandsFwVersion += '.' + this.getIntFromBufferSlice(17, 18).toString();
        return new DeviceInfo(serialNumber, radioFwVersion, microFwVersion, radioAtCommandsFwVersion);
    }

    deviceSetupFromSocketBuffer(data: Buffer): DeviceSetup {
        this.buffer = data;
        const serialNumber = this.getHexStringFromBufferSlice(2,8);
        const deviceRole = DeviceRole[this.getIntFromBufferSlice(9, 10)];
        const zoneIndex = this.getIntFromBufferSlice(10, 11);
        const houseId = this.getUInt32LEFromBufferSlice(11, 15);
        return new DeviceSetup(serialNumber, deviceRole, zoneIndex, houseId);
    }

    deviceFilterResetFromSocketBuffer(data: Buffer): DeviceFilterReset {
        this.buffer = data;
        const serialNumber = this.getHexStringFromBufferSlice(2,8);
        const filterReset = this.getIntFromBufferSlice(8, 9);
        return new DeviceFilterReset(serialNumber, filterReset);
    }

    deviceDeviceCommandFromSocketBuffer(data: Buffer): DeviceCommand {
        this.buffer = data;
        const serialNumber = this.getHexStringFromBufferSlice(2,8);
        const operatingMode = OperatingMode[this.getIntFromBufferSlice(9, 10)];
        const fanSpeed = FanSpeed[this.getIntFromBufferSlice(10, 11)];
        const humidityLevel = HumidityLevel[this.getIntFromBufferSlice(11, 12)];
        const lightSensorLevel = LightSensitivity[this.getIntFromBufferSlice(12, 13)];
        return new DeviceCommand(serialNumber, operatingMode, fanSpeed, humidityLevel, lightSensorLevel);
    }

    deviceWeatherUpdateFromSocketBuffer(data: Buffer): DeviceWeatherUpdate {
        this.buffer = data;
        const serialNumber = this.getHexStringFromBufferSlice(2,8);
        const temperature = this.getSignedInt16FromBufferSlice(9, 11);
        const humidity = this.getIntFromBufferSlice(11, 12);
        const airQuality = AirQuality[this.getIntFromBufferSlice(12, 13) - 1];
        return new DeviceWeatherUpdate(serialNumber, temperature, humidity, airQuality);
    }

    deviceStatusBroadCastFromBuffer(data: Buffer, serialNumber: string | undefined): DeviceBroadcastStatus {
        this.buffer = data;
        const zoneIndex = this.getIntFromBufferSlice(1, 2) & 15;
        const fanMode = FanMode[this.getIntFromBufferSlice(2, 3) >> 4];
        const fanStatus = FanStatus[this.getIntFromBufferSlice(2, 3) & 15];
        return new DeviceBroadcastStatus(serialNumber, zoneIndex, fanMode, fanStatus)
    }

    private getHexStringFromBufferSlice(start: number, end: number): string {
        if (this.buffer.length >= end) {
            const slice = this.buffer.subarray(start, end)
            return slice.toString('hex');
        } else {
            this.log.warn(`Could not hex string from buffer ${this.buffer} slice ${start},${end} `)
            return '';
        }
    }

    private getIntFromBufferSlice(start: number, end: number): number {
        if (this.buffer.length >= end) {
            const slice = this.buffer.subarray(start, end)
            return slice.readUInt8();
        } else {
            this.log.warn(`Could not get uint from buffer ${this.buffer} slice ${start},${end} `)
            return 0;
        }
    }

    private getUInt32LEFromBufferSlice(start: number, end: number): number {
        if (this.buffer.length >= end) {
            const slice = this.buffer.subarray(start, end)
            return slice.readUInt32LE();
        } else {
            this.log.warn(`Could not get uint32le from buffer ${this.buffer} slice ${start},${end} `)
            return 0;
        }
    }

    private getSignedInt16FromBufferSlice(start: number, end: number): number {
        if (this.buffer.length >= end) {
            const slice = this.buffer.subarray(start, end);
            const int16 = slice.readInt16LE();
            return Math.round(((int16 * 0.01) + Number.EPSILON) * 100) / 100;
        } else {
            this.log.warn(`Could not get int from buffer ${this.buffer} slice ${start},${end} `)
            return 0;
        }
    }

    private getBooleanFromBufferSlice(start: number, end: number): boolean {
        if (this.buffer.length >= end) {
            const slice = this.buffer.subarray(start, end)
            return slice.readInt8() === 1;
        } else {
            this.log.warn(`Could not get boolean from buffer ${this.buffer} slice ${start},${end} `)
            return false;
        }
    }

    deviceFromDto(dto: DeviceDto): Device {
        return new Device(
            dto.serialNumber,
            dto.operatingMode,
            dto.fanSpeed,
            dto.humidityLevel,
            dto.temperature,
            dto.humidity,
            dto.airQuality,
            dto.humidityAlarm,
            dto.filterStatus,
            dto.nightAlarm,
            dto.deviceRole,
            dto.lastOperatingMode,
            dto.lightSensitivity,
            dto.remoteAddress,
            0,
            dto.houseId || 0,
            dto.zoneId || 0
        );
    }
}
