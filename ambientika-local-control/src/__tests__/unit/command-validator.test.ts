import { describe, it, expect } from 'vitest';
import {
    isValidEnumKey, validateDeviceSetup, validateOperatingMode, validateWeatherUpdate,
} from '../../services/command-validator';
import { OperatingMode } from '../../models/enum/operating-mode.enum';

describe('command-validator (#93)', () => {
    describe('isValidEnumKey', () => {
        it('accepts enum names and rejects values, numbers and excluded names', () => {
            expect(isValidEnumKey(OperatingMode, 'SMART')).toBe(true);
            expect(isValidEnumKey(OperatingMode, 'FOO')).toBe(false);
            expect(isValidEnumKey(OperatingMode, 0)).toBe(false);
            expect(isValidEnumKey(OperatingMode, '0')).toBe(false);
            expect(isValidEnumKey(OperatingMode, 'LAST', ['LAST'])).toBe(false);
        });
    });

    describe('validateOperatingMode', () => {
        it('accepts a valid command', () => {
            expect(validateOperatingMode({ operatingMode: 'INTAKE', fanSpeed: 'HIGH', humidityLevel: 'NORMAL', lightSensitivity: 'LOW' })).toBeUndefined();
            expect(validateOperatingMode({})).toBeUndefined();
        });

        it('rejects LAST by name, and by its numeric sentinel unless allowed', () => {
            expect(validateOperatingMode({ operatingMode: 'LAST' })).toBe('Invalid operatingMode: LAST');
            expect(validateOperatingMode({ operatingMode: '12' })).toBe('Invalid operatingMode: 12');
            expect(validateOperatingMode({ operatingMode: '12' }, true)).toBeUndefined();
        });

        it.each([
            [{ operatingMode: 'FOO' }, 'Invalid operatingMode: FOO'],
            [{ fanSpeed: 'TURBO' }, 'Invalid fanSpeed: TURBO'],
            [{ humidityLevel: '1' }, 'Invalid humidityLevel: 1'],
            [{ lightSensitivity: 'BRIGHT' }, 'Invalid lightSensitivity: BRIGHT'],
        ])('rejects %j', (dto, error) => {
            expect(validateOperatingMode(dto)).toBe(error);
        });
    });

    describe('validateWeatherUpdate', () => {
        it('accepts a valid update', () => {
            expect(validateWeatherUpdate({ temperature: -3.2, humidity: 72, airQuality: 2 })).toBeUndefined();
        });

        it.each([
            [undefined, 'Invalid weather update: expected an object'],
            [null, 'Invalid weather update: expected an object'],
            [{ temperature: 61, humidity: 50, airQuality: 1 }, 'Invalid temperature: 61'],
            [{ temperature: Number.NaN, humidity: 50, airQuality: 1 }, 'Invalid temperature: NaN'],
            [{ temperature: 20, humidity: 50.5, airQuality: 1 }, 'Invalid humidity: 50.5'],
            [{ temperature: 20, humidity: 50, airQuality: 0 }, 'Invalid airQuality: 0'],
            [{ temperature: 20, humidity: 50, airQuality: 6 }, 'Invalid airQuality: 6'],
        ])('rejects %j', (dto, error) => {
            expect(validateWeatherUpdate(dto as any)).toBe(error);
        });
    });

    describe('validateDeviceSetup', () => {
        it('accepts a valid setup', () => {
            expect(validateDeviceSetup('SLAVE_OPPOSITE_MASTER', 15, 0xFFFFFFFF)).toBeUndefined();
        });

        it.each([
            ['BOSS', 1, 1, 'Invalid role: BOSS'],
            [0, 1, 1, 'Invalid role: 0'],
            ['MASTER', 16, 1, 'Invalid zone: 16'],
            ['MASTER', '1', 1, 'Invalid zone: 1'],
            ['MASTER', 1, -1, 'Invalid houseId: -1'],
            ['MASTER', 1, 0x100000000, 'Invalid houseId: 4294967296'],
        ])('rejects role=%s zone=%s houseId=%s', (role, zone, houseId, error) => {
            expect(validateDeviceSetup(role, zone, houseId)).toBe(error);
        });
    });
});
