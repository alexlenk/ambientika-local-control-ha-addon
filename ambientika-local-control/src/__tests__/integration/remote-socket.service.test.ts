import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('node:net', () => {
    const isIP = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? 4 : 0;
    return {
        Socket: vi.fn().mockImplementation(function () { return mockRemoteSocket; }),
        createServer: vi.fn(),
        isIP,
        default: {
            Socket: vi.fn().mockImplementation(function () { return mockRemoteSocket; }),
            createServer: vi.fn(),
            isIP,
        },
    };
});

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

// 16-byte device setup buffer
function make16ByteBuffer(): Buffer {
    const buf = Buffer.alloc(16);
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

        it('does not open a cloud connection when the cloud host itself connects locally', async () => {
            eventService.localSocketConnected('185.214.203.87');

            const net = await import('node:net');
            expect(net.Socket).not.toHaveBeenCalled();
            expect(mockRemoteSocket.connect).not.toHaveBeenCalled();
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

        it('emits remoteSocketDisconnected on "close" event when socket is still active', () => {
            eventService.localSocketConnected('192.168.1.100');
            const listener = vi.fn();
            eventService.on(AppEvents.REMOTE_SOCKET_DISCONNECTED, listener);

            remoteSocketHandlers['close']?.();

            expect(listener).toHaveBeenCalledWith('192.168.1.100');
        });

        it('does not emit remoteSocketDisconnected on "close" if socket was replaced (orphan guard)', () => {
            const svc = new RemoteSocketService(mockLog, eventService);
            eventService.localSocketConnected('192.168.1.100');
            // Capture the close handler registered for the first socket
            const firstCloseHandler = remoteSocketHandlers['close'];

            // Simulate reconnect: second LOCAL_SOCKET_CONNECTED replaces the client in the map
            (svc as any).clients.set('192.168.1.100', {} as any); // different socket object

            const listener = vi.fn();
            eventService.on(AppEvents.REMOTE_SOCKET_DISCONNECTED, listener);

            // Old socket closes — guard should prevent cleanup of the new entry
            firstCloseHandler?.();

            expect(listener).not.toHaveBeenCalled();
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

            it('emits deviceSetupUpdate for 16-byte data', () => {
                const listener = vi.fn();
                eventService.on(AppEvents.DEVICE_SETUP_UPDATE, listener);

                remoteSocketHandlers['data']?.(make16ByteBuffer());

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

                expect(mockRemoteSocket.write).toHaveBeenCalledWith(data, expect.any(Function));
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

                expect(mockRemoteSocket.write).toHaveBeenCalledWith(data, expect.any(Function));
            });

            it('does not relay LOCAL_SOCKET_DATA_UPDATE_RECEIVED from the cloud host', () => {
                const svc = new RemoteSocketService(mockLog, eventService);
                (svc as any).clients.set('185.214.203.87', mockRemoteSocket);

                const data = Buffer.from([0x01, 0x02, 0x03]);
                eventService.emit(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, data, '185.214.203.87');

                expect(mockRemoteSocket.write).not.toHaveBeenCalled();
            });
        });

        describe('close()', () => {
            it('destroys all cloud sockets and clears the client map', () => {
                const svc = new RemoteSocketService(mockLog, eventService);
                (svc as any).clients.set('192.168.1.99', mockRemoteSocket);

                svc.close();

                expect(mockRemoteSocket.destroy).toHaveBeenCalled();
                expect((svc as any).clients.size).toBe(0);
            });

            it('cancels any pending reconnect timers', async () => {
                vi.useFakeTimers();
                try {
                    const svc = new RemoteSocketService(mockLog, eventService);
                    eventService.localSocketConnected('192.168.1.100');
                    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
                    remoteSocketHandlers['error']?.(err);
                    expect((svc as any).reconnectTimers.size).toBe(1);

                    svc.close();

                    expect((svc as any).reconnectTimers.size).toBe(0);
                    const net = await import('node:net');
                    const callsBefore = (net.Socket as any).mock.calls.length;
                    vi.advanceTimersByTime(60000);
                    expect((net.Socket as any).mock.calls.length).toBe(callsBefore);
                } finally {
                    vi.useRealTimers();
                }
            });
        });

        describe('reconnect with backoff', () => {
            beforeEach(() => {
                vi.useFakeTimers();
            });

            afterEach(() => {
                vi.useRealTimers();
            });

            it('schedules a reconnect at the initial delay after a fatal error', () => {
                eventService.localSocketConnected('192.168.1.100');
                const connectCallsBefore = mockRemoteSocket.connect.mock.calls.length;

                const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
                remoteSocketHandlers['error']?.(err);

                vi.advanceTimersByTime(4999);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(connectCallsBefore);

                vi.advanceTimersByTime(1);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(connectCallsBefore + 1);
            });

            it('does not reconnect once the device has disconnected locally', () => {
                eventService.localSocketConnected('192.168.1.100');
                const connectCallsBefore = mockRemoteSocket.connect.mock.calls.length;

                const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
                remoteSocketHandlers['error']?.(err);

                eventService.localSocketDisconnected('192.168.1.100');

                vi.advanceTimersByTime(60000);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(connectCallsBefore);
            });

            it('doubles the backoff delay on repeated failures, capped at 60s', () => {
                eventService.localSocketConnected('192.168.1.100');

                const fail = () => remoteSocketHandlers['error']?.(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));

                fail(); // schedules at 5000ms, next delay becomes 10000ms
                vi.advanceTimersByTime(5000);
                const afterFirst = mockRemoteSocket.connect.mock.calls.length;

                fail(); // should now schedule at 10000ms
                vi.advanceTimersByTime(9999);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(afterFirst);
                vi.advanceTimersByTime(1);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(afterFirst + 1);
            });

            it('resets the backoff delay after a successful connect', () => {
                eventService.localSocketConnected('192.168.1.100');

                remoteSocketHandlers['error']?.(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
                vi.advanceTimersByTime(5000); // first reconnect fires, delay would be 10000 next
                remoteSocketHandlers['connect']?.(); // succeeds — backoff should reset

                const connectCallsBefore = mockRemoteSocket.connect.mock.calls.length;
                remoteSocketHandlers['error']?.(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
                vi.advanceTimersByTime(4999);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(connectCallsBefore);
                vi.advanceTimersByTime(1);
                expect(mockRemoteSocket.connect.mock.calls.length).toBe(connectCallsBefore + 1);
            });

            it('only emits REMOTE_SOCKET_CONNECTED/DISCONNECTED on actual state transitions', () => {
                const connectedListener = vi.fn();
                const disconnectedListener = vi.fn();
                eventService.on(AppEvents.REMOTE_SOCKET_CONNECTED, connectedListener);
                eventService.on(AppEvents.REMOTE_SOCKET_DISCONNECTED, disconnectedListener);

                eventService.localSocketConnected('192.168.1.100');
                remoteSocketHandlers['connect']?.();
                remoteSocketHandlers['connect']?.(); // duplicate — should not re-emit

                expect(connectedListener).toHaveBeenCalledTimes(1);

                remoteSocketHandlers['close']?.();
                remoteSocketHandlers['close']?.(); // already removed from clients, guard prevents re-entry anyway

                expect(disconnectedListener).toHaveBeenCalledTimes(1);
            });

            it('rate-limits the "Cloud socket not found" warning to once per backoff window', () => {
                const svc = new RemoteSocketService(mockLog, eventService);
                mockLog.warn.mockClear();

                (svc as any).write(Buffer.from('a'), '10.0.0.1');
                (svc as any).write(Buffer.from('b'), '10.0.0.1');
                (svc as any).write(Buffer.from('c'), '10.0.0.1');

                const warnCalls = mockLog.warn.mock.calls.filter((c: any[]) => c[0].includes('not found'));
                expect(warnCalls.length).toBe(1);
                expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('already warned'));

                vi.advanceTimersByTime(5000);
                (svc as any).write(Buffer.from('d'), '10.0.0.1');
                const warnCallsAfter = mockLog.warn.mock.calls.filter((c: any[]) => c[0].includes('not found'));
                expect(warnCallsAfter.length).toBe(2);
            });
        });
    });
});
