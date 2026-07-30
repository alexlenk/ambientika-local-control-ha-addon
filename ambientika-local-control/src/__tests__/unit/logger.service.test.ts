import { describe, it, expect, afterEach } from 'vitest';
import { maskSerialsInMessage, maskSerials, registerSerialForMasking } from '../../services/logger.service';

describe('log serial masking (#43)', () => {
    afterEach(() => {
        delete process.env.LOG_FULL_SERIALS;
    });

    it('masks a registered serial appearing standalone in a message', () => {
        registerSerialForMasking('aabbccddeeff');

        const masked = maskSerialsInMessage('Device connected: aabbccddeeff at 192.168.1.10');

        expect(masked).toBe('Device connected: xxxxxxxxeeff at 192.168.1.10');
    });

    it('masks a registered serial embedded inside a longer hex dump', () => {
        registerSerialForMasking('8813bf1650e0');

        const masked = maskSerialsInMessage('→ device 13b: 01008813bf1650e00301011b350000');

        expect(masked).toBe('→ device 13b: 0100xxxxxxxx50e00301011b350000');
        expect(masked).not.toContain('8813bf1650e0');
    });

    it('is case-insensitive when registering and masking', () => {
        registerSerialForMasking('AABB11223344');

        const masked = maskSerialsInMessage('serial aabb11223344 seen');

        expect(masked).toBe('serial xxxxxxxx3344 seen');
    });

    it('preserves the last 4 hex characters so multiple devices stay distinguishable', () => {
        registerSerialForMasking('111111111111');
        registerSerialForMasking('222222222222');

        const masked = maskSerialsInMessage('devices: 111111111111 and 222222222222');

        expect(masked).toBe('devices: xxxxxxxx1111 and xxxxxxxx2222');
    });

    it('falls back to masking any standalone 12-hex-char token even when not registered', () => {
        const masked = maskSerialsInMessage('unregistered serial: ff00ff00ff00 seen');

        expect(masked).toBe('unregistered serial: xxxxxxxxff00 seen');
    });

    it('does not mask hex tokens shorter or longer than 12 characters', () => {
        const masked = maskSerialsInMessage('short abc123 and long abcdefabcdef1234');

        expect(masked).toBe('short abc123 and long abcdefabcdef1234');
    });

    it('winston format masks the serial in info.message by default', () => {
        registerSerialForMasking('444444444444');
        const format = maskSerials();
        const result = format.transform({ message: 'serial 444444444444', level: 'info' } as any, {});

        expect((result as any).message).toBe('serial xxxxxxxx4444');
    });

    it('winston format is a pass-through when LOG_FULL_SERIALS=true', () => {
        process.env.LOG_FULL_SERIALS = 'true';
        registerSerialForMasking('555555555555');
        const format = maskSerials();
        const result = format.transform({ message: 'serial 555555555555', level: 'info' } as any, {});

        expect((result as any).message).toBe('serial 555555555555');
    });

    it('ignores undefined serials passed to registerSerialForMasking', () => {
        expect(() => registerSerialForMasking(undefined)).not.toThrow();
    });
});
