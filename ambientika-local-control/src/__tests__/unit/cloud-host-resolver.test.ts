import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns', () => ({
    lookup: (...args: any[]) => lookupMock(...args),
    default: { lookup: (...args: any[]) => lookupMock(...args) },
}));

import { CloudHostResolver } from '../../services/cloud-host-resolver';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
} as any;

describe('CloudHostResolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('matches an IP literal directly without DNS lookup', () => {
        const resolver = new CloudHostResolver('195.39.253.2', mockLog);

        expect(lookupMock).not.toHaveBeenCalled();
        expect(resolver.matches('195.39.253.2')).toBe(true);
        expect(resolver.matches('1.2.3.4')).toBe(false);
    });

    it('resolves a hostname via DNS and matches the resolved IP', () => {
        lookupMock.mockImplementation((_host: string, cb: (err: Error | null, address?: string) => void) => {
            cb(null, '195.39.253.2');
        });
        const resolver = new CloudHostResolver('app.ambientika.eu', mockLog);

        expect(lookupMock).toHaveBeenCalledWith('app.ambientika.eu', expect.any(Function));
        expect(resolver.matches('195.39.253.2')).toBe(true);
        expect(resolver.matches('app.ambientika.eu')).toBe(false);
    });

    it('falls back to comparing the raw hostname while DNS lookup is still pending', () => {
        lookupMock.mockImplementation(() => {
            // never calls back — simulates a lookup still in flight
        });
        const resolver = new CloudHostResolver('app.ambientika.eu', mockLog);

        expect(resolver.matches('app.ambientika.eu')).toBe(true);
        expect(resolver.matches('195.39.253.2')).toBe(false);
    });

    it('logs a warning and keeps the hostname fallback when DNS lookup fails', () => {
        lookupMock.mockImplementation((_host: string, cb: (err: Error | null, address?: string) => void) => {
            cb(new Error('ENOTFOUND'));
        });
        const resolver = new CloudHostResolver('app.ambientika.eu', mockLog);

        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('app.ambientika.eu'));
        expect(resolver.matches('app.ambientika.eu')).toBe(true);
    });
});
