import {Socket} from 'node:net';
import {Logger} from 'winston';
import dotenv from 'dotenv'
import * as net from 'node:net';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {DeviceMapper} from './device.mapper';
import {CloudHostResolver} from './cloud-host-resolver';

dotenv.config()

export class RemoteSocketService {

    private static readonly INITIAL_RECONNECT_DELAY_MS = 5000;
    private static readonly MAX_RECONNECT_DELAY_MS = 60000;

    private clients: Map<string, Socket> = new Map();
    private deviceMapper: DeviceMapper;
    private cloudHostResolver: CloudHostResolver;
    // Addresses with a currently-connected local device — a reconnect is only
    // scheduled/attempted for addresses still in this set.
    private locallyConnectedAddresses: Set<string> = new Set();
    private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
    private reconnectDelays: Map<string, number> = new Map();
    // Last known REMOTE_SOCKET_CONNECTED/DISCONNECTED state we emitted per address,
    // so we only emit on actual transitions instead of on every write()/failure.
    private lastConnectedState: Map<string, boolean> = new Map();
    private lastNotFoundWarnAt: Map<string, number> = new Map();

    constructor(private log: Logger, private eventService: EventService) {
        this.log.debug('Construct RemoteSocketService');
        this.deviceMapper = new DeviceMapper(this.log);
        this.cloudHostResolver = new CloudHostResolver(process.env.REMOTE_CLOUD_HOST || 'app.ambientika.eu', this.log);
        if (process.env.CLOUD_SYNC_ENABLED === 'true') {
            this.log.debug('Cloud sync enabled');
            this.initEventListener();
        }
    }

    private initRemoteSocketServer(localAddress: string): void {
        const remoteSocketPort = parseInt(process.env.REMOTE_CLOUD_SOCKET_PORT || '11000');
        const remoteSocketHost = process.env.REMOTE_CLOUD_HOST || 'app.ambientika.eu';
        const remoteSocket = new net.Socket();
        remoteSocket.connect(remoteSocketPort, remoteSocketHost);
        this.clients.set(localAddress, remoteSocket);
        this.initConnectionListener(remoteSocket, localAddress);
    }

    private initConnectionListener(remoteSocket: Socket, localAddress: string): void {
        this.log.debug('Init RemoteSocketService connection listener');
        remoteSocket.on('connecting', () => {
            this.log.debug("connection to cloud connecting");
        });
        remoteSocket.on('connect', () => {
            this.log.debug(`connection to cloud established for ${localAddress} (local port ${remoteSocket.localPort})`);
            this.reconnectDelays.delete(localAddress);
            this.setConnectedState(localAddress, true);
        });
        remoteSocket.on('close', () => {
            this.log.debug(`connection to cloud closed for ${localAddress}`);
            // Only clean up if this socket is still the active one — prevents an
            // orphaned socket's close event from deleting a newer socket for the same IP.
            if (this.clients.get(localAddress) === remoteSocket) {
                this.setConnectedState(localAddress, false);
                this.clients.delete(localAddress);
                this.scheduleReconnect(localAddress);
            }
        });
        remoteSocket.on('error', (error: Error) => {
            this.log.warn(`Remote socket error for ${localAddress}: ${error.message}`);

            // Only clean up for fatal errors, not transient ones
            const errorCode = (error as NodeJS.ErrnoException).code;
            if (errorCode === 'ECONNRESET' || errorCode === 'EPIPE' || errorCode === 'ENOTCONN' || errorCode === 'ECONNREFUSED') {
                this.setConnectedState(localAddress, false);
                this.clients.delete(localAddress);

                // Only destroy socket for fatal connection errors
                if (!remoteSocket.destroyed) {
                    remoteSocket.destroy();
                }
                this.scheduleReconnect(localAddress);
            }
        });

        remoteSocket.on('data', (data: Buffer) => {
            this.log.silly(`Received data on remote socket for ${localAddress} %o`, data);
            this.eventService.remoteSocketDataUpdateReceived(data, localAddress);
            if (data.length === 9) {
                const deviceFilterReset = this.deviceMapper.deviceFilterResetFromSocketBuffer(data);
                this.log.debug('Created device filter reset from data %o', deviceFilterReset);
            }
            if (data.length === 13) {
                const commandType = data.subarray(8, 9).readUInt8();
                if (commandType === 4) {
                    const deviceWeatherUpdate = this.deviceMapper.deviceWeatherUpdateFromSocketBuffer(data);
                    this.log.debug('Created device weather update from data %o', deviceWeatherUpdate);
                } else if (commandType === 0 || commandType === 1) {
                    const deviceCommand = this.deviceMapper.deviceDeviceCommandFromSocketBuffer(data);
                    this.log.debug('Created device command from data %o', deviceCommand);
                } else {
                    this.log.debug('Unknown device command type');
                }
            }
            if (data.length === 16) {
                const deviceSetup = this.deviceMapper.deviceSetupFromSocketBuffer(data);
                this.log.debug('Created device setup from data %o', deviceSetup);
                this.eventService.deviceSetupUpdate(deviceSetup);
            }
        });
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, (data: Buffer, localAddress: string) => {
            if (this.cloudHostResolver.matches(localAddress)) {
                return;
            }
            this.log.silly(`Update cloud data from ${localAddress}: %o`, data);
            this.write(data, localAddress);
        });

        this.eventService.on(AppEvents.LOCAL_SOCKET_CONNECTED, (localAddress: string) => {
            if (this.cloudHostResolver.matches(localAddress)) {
                this.log.debug(`Ignoring inbound connection from cloud host ${localAddress}`);
                return;
            }
            this.log.debug(`Local device connected: ${localAddress} init cloud connection`);
            this.locallyConnectedAddresses.add(localAddress);
            this.initRemoteSocketServer(localAddress);
        });

        this.eventService.on(AppEvents.LOCAL_SOCKET_DISCONNECTED, (localAddress: string) => {
            this.locallyConnectedAddresses.delete(localAddress);
            this.cancelReconnect(localAddress);
            this.lastNotFoundWarnAt.delete(localAddress);
            const client = this.clients.get(localAddress);
            if (client) {
                client.destroy();
                this.clients.delete(localAddress);
            }
        });
    }

    private scheduleReconnect(localAddress: string): void {
        if (!this.locallyConnectedAddresses.has(localAddress) || this.reconnectTimers.has(localAddress)) {
            return;
        }
        const delay = this.reconnectDelays.get(localAddress) ?? RemoteSocketService.INITIAL_RECONNECT_DELAY_MS;
        this.log.debug(`Scheduling cloud reconnect for ${localAddress} in ${delay}ms`);
        const timer = setTimeout(() => {
            this.reconnectTimers.delete(localAddress);
            if (this.locallyConnectedAddresses.has(localAddress) && !this.clients.has(localAddress)) {
                this.initRemoteSocketServer(localAddress);
            }
        }, delay);
        timer.unref();
        this.reconnectTimers.set(localAddress, timer);
        this.reconnectDelays.set(localAddress, Math.min(delay * 2, RemoteSocketService.MAX_RECONNECT_DELAY_MS));
    }

    private cancelReconnect(localAddress: string): void {
        const timer = this.reconnectTimers.get(localAddress);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(localAddress);
        }
        this.reconnectDelays.delete(localAddress);
    }

    private setConnectedState(localAddress: string, connected: boolean): void {
        if (this.lastConnectedState.get(localAddress) === connected) {
            return;
        }
        this.lastConnectedState.set(localAddress, connected);
        if (connected) {
            this.eventService.remoteSocketConnected(localAddress);
        } else {
            this.eventService.remoteSocketDisconnected(localAddress);
        }
    }

    write(data: Buffer, localAddress: string): void {
        const client: Socket | undefined = this.clients.get(localAddress);
        if (client) {
            this.setConnectedState(localAddress, true);
            this.log.silly(`→ cloud [${localAddress}] ${data.length}b: ${data.toString('hex')}`);
            const flushed = client.write(data, (err) => {
                if (err) {
                    this.log.warn(`TCP write error for ${localAddress}: ${err.message}`);
                } else {
                    this.log.silly(`✓ cloud [${localAddress}] ${data.length}b flushed to kernel`);
                }
            });
            if (!flushed) {
                this.log.warn(`TCP send buffer full for ${localAddress} — backpressure on ${data.length}b write`);
            }
        } else {
            this.setConnectedState(localAddress, false);
            const delay = this.reconnectDelays.get(localAddress) ?? RemoteSocketService.INITIAL_RECONNECT_DELAY_MS;
            const lastWarn = this.lastNotFoundWarnAt.get(localAddress);
            if (lastWarn === undefined || Date.now() - lastWarn >= delay) {
                this.log.warn(`Cloud socket for ${localAddress} not found.`);
                this.lastNotFoundWarnAt.set(localAddress, Date.now());
            } else {
                this.log.debug(`Cloud socket for ${localAddress} not found (already warned this backoff window).`);
            }
            // Lazily (re)establish the connection if a device is known to be
            // locally connected but we somehow have no client/reconnect scheduled
            // for it (e.g. the very first packet before LOCAL_SOCKET_CONNECTED wiring).
            if (this.locallyConnectedAddresses.has(localAddress)) {
                this.scheduleReconnect(localAddress);
            }
        }
    }

    close(): void {
        this.log.debug('Closing RemoteSocketService');
        for (const timer of this.reconnectTimers.values()) {
            clearTimeout(timer);
        }
        this.reconnectTimers.clear();
        for (const socket of this.clients.values()) {
            socket.destroy();
        }
        this.clients.clear();
    }
}
