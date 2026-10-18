import {OperatingMode} from '../models/enum/operating-mode.enum';
import {FanSpeed} from '../models/enum/fan-speed.enum';
import {HumidityLevel} from '../models/enum/humidity-level.enum';
import {LightSensitivity} from '../models/enum/light-sensitivity.enum';
import {DeviceRole} from '../models/enum/device-role.enum';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {WeatherUpdateDto} from '../dto/weather-update.dto';

// Shared input validation for commands arriving via REST and MQTT. Both paths feed the same
// command buffer builders, where an unknown enum name silently becomes byte 0 (e.g. preset
// "FOO" → SMART) and an out-of-range number throws a RangeError, so the checks must not
// differ between the two entry points (#93). Each validator returns an error message, or
// undefined when the input is valid.

export function isValidEnumKey<T extends Record<string, string | number>>(enumObj: T, value: unknown,
                                                                           exclude: string[] = []): boolean {
    return typeof value === 'string' && !exclude.includes(value) && typeof enumObj[value as keyof T] === 'number';
}

// LAST is an internal sentinel (resolved to the device's last mode), not a mode a caller
// may name; HA's fan_only is mapped to it by MqttService itself.
export function validateOperatingMode(dto: OperatingModeDto | undefined | null, allowLast = false): string | undefined {
    if (typeof dto !== 'object' || dto === null) {
        return 'Invalid command: expected an object';
    }
    if (dto.operatingMode !== undefined && !(allowLast && dto.operatingMode === OperatingMode.LAST.toString())
        && !isValidEnumKey(OperatingMode, dto.operatingMode, ['LAST'])) {
        return `Invalid operatingMode: ${dto.operatingMode}`;
    }
    if (dto.fanSpeed !== undefined && !isValidEnumKey(FanSpeed, dto.fanSpeed)) {
        return `Invalid fanSpeed: ${dto.fanSpeed}`;
    }
    if (dto.humidityLevel !== undefined && !isValidEnumKey(HumidityLevel, dto.humidityLevel)) {
        return `Invalid humidityLevel: ${dto.humidityLevel}`;
    }
    if (dto.lightSensitivity !== undefined && !isValidEnumKey(LightSensitivity, dto.lightSensitivity)) {
        return `Invalid lightSensitivity: ${dto.lightSensitivity}`;
    }
    return undefined;
}

export function validateWeatherUpdate(dto: WeatherUpdateDto | undefined | null): string | undefined {
    if (typeof dto !== 'object' || dto === null) {
        return 'Invalid weather update: expected an object';
    }
    if (typeof dto.temperature !== 'number' || !Number.isFinite(dto.temperature) || dto.temperature < -50 || dto.temperature > 60) {
        return `Invalid temperature: ${dto.temperature}`;
    }
    if (typeof dto.humidity !== 'number' || !Number.isInteger(dto.humidity) || dto.humidity < 0 || dto.humidity > 100) {
        return `Invalid humidity: ${dto.humidity}`;
    }
    // airQuality is the raw 1-based wire value (device.mapper subtracts 1 to reach
    // the 5-member AirQuality enum), so the valid range here is 1-5.
    if (typeof dto.airQuality !== 'number' || !Number.isInteger(dto.airQuality) || dto.airQuality < 1 || dto.airQuality > 5) {
        return `Invalid airQuality: ${dto.airQuality}`;
    }
    return undefined;
}

export function validateDeviceSetup(role: unknown, zone: unknown, houseId: unknown): string | undefined {
    if (!isValidEnumKey(DeviceRole, role)) {
        return `Invalid role: ${role}`;
    }
    if (typeof zone !== 'number' || !Number.isInteger(zone) || zone < 0 || zone > 15) {
        return `Invalid zone: ${zone}`;
    }
    if (typeof houseId !== 'number' || !Number.isInteger(houseId) || houseId < 0 || houseId > 0xFFFFFFFF) {
        return `Invalid houseId: ${houseId}`;
    }
    return undefined;
}
