import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppEvents } from '../../models/enum/app-events.enum';

// Capture server and socket event handlers
const serverHandlers: Record<string, (...args: any[]) => void> = {};
const socketHandlers: Record<string, (...args: any[]) => void> = {};

const mockSocket = {
    remoteAddress: '192.168.1.100',
    remotePort: 12345,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        socketHandlers[event] = handler;
    }),
    write: vi.fn(),
    destroy: vi.fn(),
    destroyed: false,
};

const mockServer = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        serverHandlers[event] = handler;
    }),
    listen: vi.fn((_port: unknown, _host: unknown, cb?: () => void) => { if (cb) cb(); }),
};

vi.mock('node:net', () => ({
    createServer: vi.fn(() => mockServer),
    Server: vi.fn(),
    Socket: vi.fn(),
    default: { createServer: vi.fn(() => mockServer), Server: vi.fn(), Socket: vi.fn() },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { LocalSocketService } from '../../services/local-socket.service';
import { EventService } from '../../services/event.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
} as any;

// Build a valid 21-byte device status buffer
function make21ByteBuffer(sn = 'aabbccddeeff'): Buffer {
    const buf = Buffer.alloc(21);
    const octets = sn.match(/.{2}/g) || [];
    for (let i = 0; i < 6; i++) {
        buf[2 + i] = parseInt(octets[i] || '00', 16);
    }
    buf[8] = 1;  // OperatingMode.AUTO
    buf[9] = 0;  // FanSpeed.LOW
    buf[20] = 80; // signalStrength
    return buf;
}

// Build a valid 18-byte device info buffer
function make18ByteBuffer(sn = 'aabbccddeeff'): Buffer {
    const buf = Buffer.alloc(18);
    const octets = sn.match(/.{2}/g) || [];
    for (let i = 0; i < 6; i++) {
        buf[2 + i] = parseInt(octets[i] || '00', 16);
    }
    return buf;
}

describe('LocalSocketService', () => {
    let service: LocalSocketService;
    let eventService: EventService;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(serverHandlers).forEach(k => delete serverHandlers[k]);
        Object.keys(socketHandlers).forEach(k => delete socketHandlers[k]);
        mockSocket.destroyed = false;
        eventService = new EventService(mockLog);
        service = new LocalSocketService(mockLog, eventService);
    });

    it('creates a TCP server via net.createServer', async () => {
        const net = await import('node:net');
        expect(net.createServer).toHaveBeenCalled();
    });

    it('listens on PORT env or default 11000', async () => {
        process.env.PORT = '12000';
        eventService = new EventService(mockLog);
        new LocalSocketService(mockLog, eventService);
        expect(mockServer.listen).toHaveBeenCalledWith(12000, '0.0.0.0', expect.any(Function));
        delete process.env.PORT;
    });

    describe('connection handling', () => {
        it('emits localSocketConnected with remoteAddress on connection', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_CONNECTED, listener);

            serverHandlers['connection']?.(mockSocket);

            expect(listener).toHaveBeenCalledWith('192.168.1.100');
        });

        it('registers data, close, and error handlers on the socket', () => {
            serverHandlers['connection']?.(mockSocket);

            expect(socketHandlers['data']).toBeDefined();
            expect(socketHandlers['close']).toBeDefined();
            expect(socketHandlers['error']).toBeDefined();
        });
    });

    describe('data handling', () => {
        beforeEach(() => {
            serverHandlers['connection']?.(mockSocket);
        });

        it('21-byte data: emits deviceStatusUpdate event', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, listener);

            socketHandlers['data']?.(make21ByteBuffer());

            expect(listener).toHaveBeenCalled();
        });

        it('21-byte data: maps serial number to connection key', () => {
            socketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));

            const deviceConnections = (service as any).deviceConnections;
            expect(deviceConnections.has('aabbccddeeff')).toBe(true);
        });

        it('18-byte data: maps serial number to connection key', () => {
            socketHandlers['data']?.(make18ByteBuffer('aabbccddeeff'));

            const deviceConnections = (service as any).deviceConnections;
            expect(deviceConnections.has('aabbccddeeff')).toBe(true);
        });

        it('18-byte data: does NOT emit deviceStatusUpdate', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, listener);

            socketHandlers['data']?.(make18ByteBuffer());

            expect(listener).not.toHaveBeenCalled();
        });

        it('unknown packet size: does not emit deviceStatusUpdate', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, listener);

            socketHandlers['data']?.(Buffer.alloc(10));

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('close handling', () => {
        beforeEach(() => {
            serverHandlers['connection']?.(mockSocket);
        });

        it('emits localSocketDisconnected on socket close', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_DISCONNECTED, listener);

            socketHandlers['close']?.();

            expect(listener).toHaveBeenCalledWith('192.168.1.100');
        });

        it('removes device from deviceConnections on close', () => {
            // First register a device
            socketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));
            expect((service as any).deviceConnections.has('aabbccddeeff')).toBe(true);

            socketHandlers['close']?.();

            expect((service as any).deviceConnections.has('aabbccddeeff')).toBe(false);
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            serverHandlers['connection']?.(mockSocket);
        });

        it('destroys socket on fatal ECONNRESET error', () => {
            const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
            socketHandlers['error']?.(err);

            expect(mockSocket.destroy).toHaveBeenCalled();
        });

        it('destroys socket on fatal EPIPE error', () => {
            const err = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
            socketHandlers['error']?.(err);

            expect(mockSocket.destroy).toHaveBeenCalled();
        });

        it('does NOT destroy socket on non-fatal error', () => {
            const err = Object.assign(new Error('some error'), { code: 'EOTHER' });
            socketHandlers['error']?.(err);

            expect(mockSocket.destroy).not.toHaveBeenCalled();
        });

        it('logs a warning for any socket error', () => {
            const err = Object.assign(new Error('test error'), { code: 'EOTHER' });
            socketHandlers['error']?.(err);

            expect(mockLog.warn).toHaveBeenCalled();
        });

        it('does not destroy already-destroyed socket', () => {
            mockSocket.destroyed = true;
            const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
            socketHandlers['error']?.(err);

            expect(mockSocket.destroy).not.toHaveBeenCalled();
        });
    });

    describe('cloud inbound connection handling', () => {
        const cloudSocketHandlers: Record<string, (...args: any[]) => void> = {};
        const cloudSocket = {
            remoteAddress: '185.214.203.87',
            remotePort: 60000,
            on: vi.fn((event: string, handler: (...args: any[]) => void) => {
                cloudSocketHandlers[event] = handler;
            }),
            write: vi.fn(),
            destroy: vi.fn(),
            destroyed: false,
        };

        beforeEach(() => {
            vi.clearAllMocks();
            Object.keys(cloudSocketHandlers).forEach(k => delete cloudSocketHandlers[k]);
            process.env.REMOTE_CLOUD_HOST = '185.214.203.87';
            // Connect a real device first so deviceConnections is populated
            serverHandlers['connection']?.(mockSocket);
            socketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));
            // Now simulate cloud connecting back
            serverHandlers['connection']?.(cloudSocket);
        });

        it('does NOT emit LOCAL_SOCKET_CONNECTED for cloud connection', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.LOCAL_SOCKET_CONNECTED, listener);
            serverHandlers['connection']?.(cloudSocket);
            expect(listener).not.toHaveBeenCalled();
        });

        it('routes cloud data to the target device socket by serial number', () => {
            const commandBuf = Buffer.alloc(13);
            commandBuf[2] = 0xaa; commandBuf[3] = 0xbb; commandBuf[4] = 0xcc;
            commandBuf[5] = 0xdd; commandBuf[6] = 0xee; commandBuf[7] = 0xff;

            cloudSocketHandlers['data']?.(commandBuf);

            expect(mockSocket.write).toHaveBeenCalledWith(commandBuf);
        });

        it('does NOT emit DEVICE_STATUS_UPDATE_RECEIVED for cloud echo', () => {
            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, listener);

            cloudSocketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));

            expect(listener).not.toHaveBeenCalled();
        });

        it('does NOT overwrite deviceConnections with cloud socket key', () => {
            cloudSocketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));

            const deviceConnections = (service as any).deviceConnections;
            const connectionKey = deviceConnections.get('aabbccddeeff');
            expect(connectionKey).toBe('192.168.1.100:12345'); // still device, not cloud
        });

        it('warns when cloud sends command for unknown device', () => {
            const commandBuf = Buffer.alloc(13);
            // serial 99887766554 — not registered
            commandBuf[2] = 0x99; commandBuf[3] = 0x88; commandBuf[4] = 0x77;
            commandBuf[5] = 0x66; commandBuf[6] = 0x55; commandBuf[7] = 0x44;

            cloudSocketHandlers['data']?.(commandBuf);

            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No connection mapping'));
        });
    });

    describe('write()', () => {
        it('writes to socket via serialNumber routing when device is connected', () => {
            serverHandlers['connection']?.(mockSocket);
            // Register device via 21-byte data
            socketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));

            // Build a command buffer with serial number at bytes 2-7
            const commandBuf = Buffer.alloc(13);
            commandBuf[2] = 0xaa; commandBuf[3] = 0xbb; commandBuf[4] = 0xcc;
            commandBuf[5] = 0xdd; commandBuf[6] = 0xee; commandBuf[7] = 0xff;

            service.write(commandBuf, '192.168.1.100');

            expect(mockSocket.write).toHaveBeenCalledWith(commandBuf);
        });

        it('logs error when no connection mapping found for device', () => {
            serverHandlers['connection']?.(mockSocket);

            const commandBuf = Buffer.alloc(13);
            // serial number 112233445566 — not registered
            commandBuf[2] = 0x11; commandBuf[3] = 0x22; commandBuf[4] = 0x33;
            commandBuf[5] = 0x44; commandBuf[6] = 0x55; commandBuf[7] = 0x66;

            service.write(commandBuf, '192.168.1.100');

            expect(mockLog.error).toHaveBeenCalled();
        });

        it('logs error when connectionKey exists in deviceConnections but socket not found in clients', () => {
            serverHandlers['connection']?.(mockSocket);
            // Register device so connectionKey is mapped
            socketHandlers['data']?.(make21ByteBuffer('aabbccddeeff'));

            // Manually remove the socket from clients but keep deviceConnections entry
            const connectionKey = `${mockSocket.remoteAddress}:${mockSocket.remotePort}`;
            (service as any).clients.delete(connectionKey);

            const commandBuf = Buffer.alloc(13);
            commandBuf[2] = 0xaa; commandBuf[3] = 0xbb; commandBuf[4] = 0xcc;
            commandBuf[5] = 0xdd; commandBuf[6] = 0xee; commandBuf[7] = 0xff;

            service.write(commandBuf, '192.168.1.100');

            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining('Socket for device aabbccddeeff')
            );
        });

        it('falls back to remoteAddress lookup when no serial-based connectionKey found', () => {
            serverHandlers['connection']?.(mockSocket);
            // Add the socket directly via the remoteAddress key (simulating the fallback path)
            (service as any).clients.set('192.168.1.100', mockSocket);

            // Use a buffer with an unregistered serial number so primary lookup fails
            const commandBuf = Buffer.alloc(13);
            commandBuf[2] = 0x99; commandBuf[3] = 0x88; commandBuf[4] = 0x77;
            commandBuf[5] = 0x66; commandBuf[6] = 0x55; commandBuf[7] = 0x44;

            service.write(commandBuf, '192.168.1.100');

            // Fallback path writes via remoteAddress
            expect(mockSocket.write).toHaveBeenCalledWith(commandBuf);
        });
    });
});
