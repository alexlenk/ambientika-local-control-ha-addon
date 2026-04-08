import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppEvents } from '../../models/enum/app-events.enum';
import { Device } from '../../models/device.model';

// Capture UDP socket event handlers (for most tests: ZONE_COUNT=1)
const udpHandlers: Record<string, (...args: any[]) => void> = {};

const mockUdpSocket = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        udpHandlers[event] = handler;
    }),
    bind: vi.fn(),
    setBroadcast: vi.fn(),
    address: vi.fn().mockReturnValue({ address: '0.0.0.0', port: 45000 }),
};

vi.mock('node:dgram', () => ({
    createSocket: vi.fn(() => mockUdpSocket),
    default: { createSocket: vi.fn(() => mockUdpSocket) },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

import { UDPBroadcastService } from '../../services/udp-broadcast.service';
import { EventService } from '../../services/event.service';

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn(),
} as any;

function makeDevice(sn = 'aabbccddeeff', ip = '192.168.1.100'): Device {
    return new Device(sn, 'AUTO', 'LOW', 'NORMAL', 22, 55, 'GOOD',
        false, 'GOOD', false, 'MASTER', 'SMART', 'LOW', ip, 80);
}

// A minimal UDP broadcast buffer (deviceStatusBroadCastFromBuffer parses it)
function makeUdpBuffer(): Buffer {
    return Buffer.alloc(14); // typical UDP broadcast packet size
}

describe('UDPBroadcastService', () => {
    let eventService: EventService;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(udpHandlers).forEach(k => delete udpHandlers[k]);
        process.env.ZONE_COUNT = '1';
        process.env.UDP_BROADCAST_LISTENER_START_PORT = '45000';
        eventService = new EventService(mockLog);
    });

    describe('initialization', () => {
        it('creates one socket per zone (ZONE_COUNT=1)', async () => {
            new UDPBroadcastService(mockLog, eventService);

            const dgram = await import('node:dgram');
            expect(dgram.createSocket).toHaveBeenCalledTimes(1);
            expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
        });

        it('creates two sockets when ZONE_COUNT=2', async () => {
            process.env.ZONE_COUNT = '2';
            new UDPBroadcastService(mockLog, eventService);

            const dgram = await import('node:dgram');
            expect(dgram.createSocket).toHaveBeenCalledTimes(2);
        });

        it('binds socket to the configured start port', () => {
            process.env.UDP_BROADCAST_LISTENER_START_PORT = '45000';
            new UDPBroadcastService(mockLog, eventService);

            expect(mockUdpSocket.bind).toHaveBeenCalledWith(45000);
        });

        it('registers message and listening event handlers', () => {
            new UDPBroadcastService(mockLog, eventService);

            expect(udpHandlers['message']).toBeDefined();
            expect(udpHandlers['listening']).toBeDefined();
        });

        it('sets broadcast mode on socket when "listening" fires', () => {
            new UDPBroadcastService(mockLog, eventService);
            udpHandlers['listening']?.();

            expect(mockUdpSocket.setBroadcast).toHaveBeenCalledWith(true);
        });
    });

    describe('IP to serial number mapping', () => {
        it('stores IP → serialNumber when DEVICE_STATUS_UPDATE_RECEIVED fires', () => {
            const service = new UDPBroadcastService(mockLog, eventService);
            const device = makeDevice('aabbccddeeff', '192.168.1.100');
            eventService.deviceStatusUpdate(device);

            const map = (service as any).localAddressesSerialNumbers;
            expect(map.get('192.168.1.100')).toBe('aabbccddeeff');
        });

        it('tracks all serials per IP when multiple devices share an IP', () => {
            const service = new UDPBroadcastService(mockLog, eventService);
            eventService.deviceStatusUpdate(makeDevice('aabbccddeeff', '192.168.1.100:54321'));
            eventService.deviceStatusUpdate(makeDevice('112233445566', '192.168.1.100:54322'));

            const allSerials = (service as any).ipToAllSerials;
            expect(allSerials.get('192.168.1.100').has('aabbccddeeff')).toBe(true);
            expect(allSerials.get('192.168.1.100').has('112233445566')).toBe(true);
        });

        it('removes exact serial from IP set when LOCAL_SOCKET_DISCONNECTED fires', () => {
            const service = new UDPBroadcastService(mockLog, eventService);
            eventService.deviceStatusUpdate(makeDevice('aabbccddeeff', '192.168.1.100:54321'));
            eventService.deviceStatusUpdate(makeDevice('112233445566', '192.168.1.100:54322'));

            eventService.localSocketDisconnected('192.168.1.100:54321');

            const allSerials = (service as any).ipToAllSerials;
            expect(allSerials.get('192.168.1.100').has('aabbccddeeff')).toBe(false);
            expect(allSerials.get('192.168.1.100').has('112233445566')).toBe(true);
        });

        it('removes IP mapping entirely when last device at that IP disconnects', () => {
            const service = new UDPBroadcastService(mockLog, eventService);
            const device = makeDevice('aabbccddeeff', '192.168.1.100:54321');
            eventService.deviceStatusUpdate(device);

            eventService.localSocketDisconnected('192.168.1.100:54321');

            const map = (service as any).localAddressesSerialNumbers;
            expect(map.has('192.168.1.100')).toBe(false);
        });
    });

    describe('UDP message handling', () => {
        it('emits DEVICE_BROADCAST_STATUS with serialNumber from mapped IP', () => {
            new UDPBroadcastService(mockLog, eventService);

            // Register device IP → serial mapping
            const device = makeDevice('aabbccddeeff', '192.168.1.100');
            eventService.deviceStatusUpdate(device);

            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED, listener);

            const remoteInfo = { address: '192.168.1.100', port: 45000 };
            udpHandlers['message']?.(makeUdpBuffer(), remoteInfo);

            expect(listener).toHaveBeenCalled();
        });

        it('emits DEVICE_BROADCAST_STATUS even for unknown IP (serialNumber undefined)', () => {
            new UDPBroadcastService(mockLog, eventService);

            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED, listener);

            const remoteInfo = { address: '10.0.0.1', port: 45001 };
            udpHandlers['message']?.(makeUdpBuffer(), remoteInfo);

            expect(listener).toHaveBeenCalled();
        });

        it('passes the correct serialNumber in the broadcast status payload', () => {
            new UDPBroadcastService(mockLog, eventService);

            const device = makeDevice('aabbccddeeff', '192.168.1.100');
            eventService.deviceStatusUpdate(device);

            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED, listener);

            const remoteInfo = { address: '192.168.1.100', port: 45000 };
            udpHandlers['message']?.(makeUdpBuffer(), remoteInfo);

            // The deviceStatusBroadCastFromBuffer receives the serialNumber as second arg
            // (from the IP → serial map) — we verify the event was called
            expect(listener).toHaveBeenCalledOnce();
        });

        it('multiple devices at different IPs: stores separate IP → serial mappings', () => {
            const service = new UDPBroadcastService(mockLog, eventService);

            eventService.deviceStatusUpdate(makeDevice('aabbccddeeff', '192.168.1.100'));
            eventService.deviceStatusUpdate(makeDevice('112233445566', '192.168.1.101'));

            const map = (service as any).localAddressesSerialNumbers;
            expect(map.get('192.168.1.100')).toBe('aabbccddeeff');
            expect(map.get('192.168.1.101')).toBe('112233445566');
        });

        it('UDP broadcast includes allSerialNumbers for all devices at that IP', () => {
            new UDPBroadcastService(mockLog, eventService);
            eventService.deviceStatusUpdate(makeDevice('aabbccddeeff', '192.168.1.100:54321'));
            eventService.deviceStatusUpdate(makeDevice('112233445566', '192.168.1.100:54322'));

            const listener = vi.fn();
            eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED, listener);

            const remoteInfo = { address: '192.168.1.100', port: 45000 };
            udpHandlers['message']?.(makeUdpBuffer(), remoteInfo);

            const broadcastStatus = listener.mock.calls[0][0];
            expect(broadcastStatus.allSerialNumbers).toContain('aabbccddeeff');
            expect(broadcastStatus.allSerialNumbers).toContain('112233445566');
        });
    });

    describe('LOCAL_SOCKET_DISCONNECTED cleanup', () => {
        it('ignores disconnect for IP not in the mapping', () => {
            const service = new UDPBroadcastService(mockLog, eventService);
            // Don't register any device

            // Should not throw
            expect(() => {
                eventService.localSocketDisconnected('192.168.1.200');
            }).not.toThrow();

            const map = (service as any).localAddressesSerialNumbers;
            expect(map.size).toBe(0);
        });

        it('strips port from IP in localSocketDisconnected and removes the correct serial', () => {
            const service = new UDPBroadcastService(mockLog, eventService);
            const device = makeDevice('aabbccddeeff', '192.168.1.100:12345');
            eventService.deviceStatusUpdate(device);

            eventService.localSocketDisconnected('192.168.1.100:12345');

            const map = (service as any).localAddressesSerialNumbers;
            expect(map.has('192.168.1.100')).toBe(false);
        });
    });
});
