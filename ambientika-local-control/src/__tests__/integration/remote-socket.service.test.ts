import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppEvents } from '../../models/enum/app-events.enum';

// Capture remote socket event handlers
const remoteSocketHandlers: Record<string, (...args: any[]) => void> = {};

const mockRemoteSocket = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        remoteSocketHandlers[event] = handler;
    }),
    connect: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(),
    destroyed: false,
};

vi.mock('node:net', () => ({
    Socket: vi.fn().mockImplementation(() => mockRemoteSocket),
    createServer: vi.fn(),
    default: {
        Socket: vi.fn().mockImplementation(() => mockRemoteSocket),
        createServer: vi.fn(),
    },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { RemoteSocketService } from '../../services/remote-socket.service';
import { EventService } from '../../services/event.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
} as any;

// 9-byte filter reset buffer
function make9ByteBuffer(): Buffer {
    const buf = Buffer.alloc(9);
    buf[2] = 0xaa; buf[3] = 0xbb; buf[4] = 0xcc;
    buf[5] = 0xdd; buf[6] = 0xee; buf[7] = 0xff;
    buf[8] = 0x03; // filter reset command
    return buf;
}

// 13-byte command buffer with given commandType at byte 8
function make13ByteBuffer(commandType = 1): Buffer {
    const buf = Buffer.alloc(13);
    buf[8] = commandType;
    return buf;
}

// 15-byte device setup buffer
function make15ByteBuffer(): Buffer {
    const buf = Buffer.alloc(15);
    buf[2] = 0xaa; buf[3] = 0xbb; buf[4] = 0xcc;
    buf[5] = 0xdd; buf[6] = 0xee; buf[7] = 0xff;
    return buf;
}

describe('RemoteSocketService', () => {
    let eventService: EventService;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(remoteSocketHandlers).forEach(k => delete remoteSocketHandlers[k]);
        mockRemoteSocket.destroyed = false;
        eventService = new EventService(mockLog);
    });

    describe('CLOUD_SYNC_ENABLED=false', () => {
        it('does not create any socket connections when cloud sync is disabled', async () => {
            process.env.CLOUD_SYNC_ENABLED = 'false';
            new RemoteSocketService(mockLog, eventService);

            const net = await import('node:net');
            expect(net.Socket).not.toHaveBeenCalled();
        });

        it('does not register LOCAL_SOCKET_CONNECTED listener when disabled', () => {
            process.env.CLOUD_SYNC_ENABLED = 'false';
            new RemoteSocketService(mockLog, eventService);

            // Even if LOCAL_SOCKET_CONNECTED fires, no socket should be created
            eventService.localSocketConnected('192.168.1.100');

            expect(mockRemoteSocket.connect).not.toHaveBeenCalled();
        });
    });

    describe('CLOUD_SYNC_ENABLED=true', () => {
        beforeEach(() => {
            process.env.CLOUD_SYNC_ENABLED = 'true';
            process.env.REMOTE_CLOUD_SOCKET_PORT = '11000';
            process.env.REMOTE_CLOUD_HOST = '185.214.203.87';
            new RemoteSocketService(mockLog, eventService);
        });

        it('creates a socket and connects when LOCAL_SOCKET_CONNECTED fires', async () => {
            eventService.localSocketConnected('192.168.1.100');

            const net = await import('node:net');
            expect(net.Socket).toHaveBeenCalled();
            expect(mockRemoteSocket.connect).toHaveBeenCalledWith(11000, '185.214.203.87');
        });

        it('registers connect, close, error, and data handlers on the remote socket', () => {
            eventService.localSocketConnected('192.168.1.100');

            expect(remoteSocketHandlers['connect']).toBeDefined();
            expect(remoteSocketHandlers['close']).toBeDefined();
            expect(remoteSocketHandlers['error']).toBeDefined();
            expect(remoteSocketHandlers['data']).toBeDefined();
        });

        it('emits remoteSocketConnected on "connect" event', () => {
            eventService.localSocketConnected('192.168.1.100');
            const listener = vi.fn();
            eventService.on(AppEvents.REMOTE_SOCKET_CONNECTED, listener);

            remoteSocketHandlers['connect']?.();

            expect(listener).toHaveBeenCalledWith('192.168.1.100');
        });

        it('emits remoteSocketDisconnected on "close" event', () => {
            eventService.localSocketConnected('192.168.1.100');
            const listener = vi.fn();
            eventService.on(AppEvents.REMOTE_SOCKET_DISCONNECTED, listener);

            remoteSocketHandlers['close']?.();

            expect(listener).toHaveBeenCalledWith('192.168.1.100');
        });

        describe('data handling', () => {
            beforeEach(() => {
                eventService.localSocketConnected('192.168.1.100');
            });

            it('emits remoteSocketDataUpdateReceived for any data', () => {
                const listener = vi.fn();
                eventService.on(AppEvents.REMOTE_SOCKET_DATA_UPDATE_RECEIVED, listener);

                remoteSocketHandlers['data']?.(make9ByteBuffer());

                expect(listener).toHaveBeenCalled();
            });

            it('emits deviceSetupUpdate for 15-byte data', () => {
                const listener = vi.fn();
                eventService.on(AppEvents.DEVICE_SETUP_UPDATE, listener);

                remoteSocketHandlers['data']?.(make15ByteBuffer());

                expect(listener).toHaveBeenCalled();
            });

            it('logs debug for 9-byte filter reset data', () => {
                remoteSocketHandlers['data']?.(make9ByteBuffer());

                expect(mockLog.debug).toHaveBeenCalled();
            });

            it('logs debug for 13-byte command data (type 1)', () => {
                remoteSocketHandlers['data']?.(make13ByteBuffer(1));

                expect(mockLog.debug).toHaveBeenCalled();
            });

            it('logs debug for 13-byte weather update data (type 4)', () => {
                remoteSocketHandlers['data']?.(make13ByteBuffer(4));

                expect(mockLog.debug).toHaveBeenCalled();
            });
        });

        describe('error handling', () => {
            beforeEach(() => {
                eventService.localSocketConnected('192.168.1.100');
            });

            it('destroys socket and removes client on ECONNRESET', () => {
                const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
                remoteSocketHandlers['error']?.(err);

                expect(mockRemoteSocket.destroy).toHaveBeenCalled();
            });

            it('destroys socket on ECONNREFUSED', () => {
                const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
                remoteSocketHandlers['error']?.(err);

                expect(mockRemoteSocket.destroy).toHaveBeenCalled();
            });

            it('does NOT destroy socket on non-fatal error', () => {
                const err = Object.assign(new Error('other error'), { code: 'EOTHER' });
                remoteSocketHandlers['error']?.(err);

                expect(mockRemoteSocket.destroy).not.toHaveBeenCalled();
            });

            it('does not destroy already-destroyed socket on fatal error', () => {
                mockRemoteSocket.destroyed = true;
                const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
                remoteSocketHandlers['error']?.(err);

                expect(mockRemoteSocket.destroy).not.toHaveBeenCalled();
            });
        });

        describe('write()', () => {
            it('writes data to client socket when client exists', () => {
                eventService.localSocketConnected('192.168.1.100');
                // remoteSocket is now in clients map
                const data = Buffer.from('hello');

                // Directly call write on the service instance (created in outer beforeEach)
                // The service was created by `new RemoteSocketService(mockLog, eventService)` in beforeEach
                // which registered LOCAL_SOCKET_CONNECTED listener — localSocketConnected above adds the client
                const svc = new RemoteSocketService(mockLog, eventService);
                // localSocketConnected was already fired above; need separate service instance
                // Use direct internal write on the already set-up eventService instance
                // Client was added by the outer beforeEach service via localSocketConnected
                (svc as any).clients.set('192.168.1.200', mockRemoteSocket);
                const writeListener = vi.fn();
                eventService.on(AppEvents.REMOTE_SOCKET_CONNECTED, writeListener);

                (svc as any).write(data, '192.168.1.200');

                expect(mockRemoteSocket.write).toHaveBeenCalledWith(data);
            });

            it('emits remoteSocketConnected when writing to existing client', () => {
                const svc = new RemoteSocketService(mockLog, eventService);
                (svc as any).clients.set('192.168.1.5', mockRemoteSocket);

                const connectedListener = vi.fn();
                eventService.on(AppEvents.REMOTE_SOCKET_CONNECTED, connectedListener);

                (svc as any).write(Buffer.from('data'), '192.168.1.5');

                expect(connectedListener).toHaveBeenCalledWith('192.168.1.5');
            });

            it('logs warning when no client found for address', () => {
                const service = new RemoteSocketService(mockLog, eventService);
                (service as any).write(Buffer.from('test'), '10.0.0.1');

                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('LOCAL_SOCKET_DATA_UPDATE_RECEIVED event calls write with data', () => {
                const svc = new RemoteSocketService(mockLog, eventService);
                (svc as any).clients.set('192.168.1.99', mockRemoteSocket);

                const data = Buffer.from([0x01, 0x02, 0x03]);
                // Simulate the event that initEventListener listens to
                eventService.emit(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, data, '192.168.1.99');

                expect(mockRemoteSocket.write).toHaveBeenCalledWith(data);
            });
        });
    });
});
