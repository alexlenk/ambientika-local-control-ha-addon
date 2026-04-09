import {Socket} from 'node:net';
import {Logger} from 'winston';
import dotenv from 'dotenv'
import * as net from 'node:net';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {DeviceMapper} from './device.mapper';

dotenv.config()

export class RemoteSocketService {

    private clients: Map<string, Socket> = new Map();
    private deviceMapper: DeviceMapper;

    constructor(private log: Logger, private eventService: EventService) {
        this.log.debug('Construct RemoteSocketService');
        this.deviceMapper = new DeviceMapper(this.log);
        if (process.env.CLOUD_SYNC_ENABLED === 'true') {
            this.log.debug('Cloud sync enabled');
            this.initEventListener();
        }
    }

    private initRemoteSocketServer(localAddress: string): void {
        const remoteSocketPort = parseInt(process.env.REMOTE_CLOUD_SOCKET_PORT || '11000');
        const remoteSocketHost = process.env.REMOTE_CLOUD_HOST || '185.214.203.87';
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
            this.eventService.remoteSocketConnected(localAddress);
        });
        remoteSocket.on('close', () => {
            this.log.debug(`connection to cloud closed for ${localAddress}`);
            // Only clean up if this socket is still the active one — prevents an
            // orphaned socket's close event from deleting a newer socket for the same IP.
            if (this.clients.get(localAddress) === remoteSocket) {
                this.eventService.remoteSocketDisconnected(localAddress);
                this.clients.delete(localAddress);
            }
        });
        remoteSocket.on('error', (error: Error) => {
            this.log.warn(`Remote socket error for ${localAddress}: ${error.message}`);
            
            // Only clean up for fatal errors, not transient ones
            const errorCode = (error as any).code;
            if (errorCode === 'ECONNRESET' || errorCode === 'EPIPE' || errorCode === 'ENOTCONN' || errorCode === 'ECONNREFUSED') {
                this.eventService.remoteSocketDisconnected(localAddress);
                this.clients.delete(localAddress);
                
                // Only destroy socket for fatal connection errors
                if (!remoteSocket.destroyed) {
                    remoteSocket.destroy();
                }
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
        const cloudHost = process.env.REMOTE_CLOUD_HOST || '185.214.203.87';

        this.eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, (data: Buffer, localAddress: string) => {
            if (localAddress === cloudHost) {
                return;
            }
            this.log.silly(`Update cloud data from ${localAddress}: %o`, data);
            this.write(data, localAddress);
        });

        this.eventService.on(AppEvents.LOCAL_SOCKET_CONNECTED, (localAddress: string) => {
            if (localAddress === cloudHost) {
                this.log.debug(`Ignoring inbound connection from cloud host ${localAddress}`);
                return;
            }
            this.log.debug(`Local device connected: ${localAddress} init cloud connection`);
            this.initRemoteSocketServer(localAddress);
        });
    }

    // DEBUG: use exact packet templates from bring-online.ts with the real device
    // MAC (bytes 2–7) swapped in at runtime. Placeholder MACs in templates are
    // overwritten — never stored in source. Remove once root cause is confirmed.
    private static readonly DEBUG_TEMPLATES: Record<string, { firmware: Buffer; status: Buffer }> = {
        // OUI 88:13:BF family — placeholder MAC 000000000000, overwritten at runtime
        '88': {
            firmware: Buffer.from('030000000000000001010901010902010000', 'hex'),
            status:   Buffer.from('0100000000000000000201161703000000000002cd', 'hex'),
        },
        // OUI 48:31:B7 family — placeholder MAC 000000000000, overwritten at runtime
        '48': {
            firmware: Buffer.from('030000000000000001010c01010c02040200', 'hex'),
            status:   Buffer.from('0100000000000000000101151a00000200020102c5', 'hex'),
        },
    };

    private debugBuildPacket(data: Buffer): Buffer {
        const mac = data.slice(2, 8);
        const ouiKey = mac[0].toString(16).padStart(2, '0');
        const templates = RemoteSocketService.DEBUG_TEMPLATES[ouiKey];
        if (!templates) { return data; }

        if (data.length === 18 && data[0] === 0x03) {
            const out = Buffer.from(templates.firmware);
            mac.copy(out, 2);
            return out;
        }
        if (data.length === 21 && data[0] === 0x01) {
            const out = Buffer.from(templates.status);
            mac.copy(out, 2);
            return out;
        }
        return data;
    }

    write(data: Buffer, localAddress: string): void {
        const client: Socket | undefined = this.clients.get(localAddress);
        if (client) {
            this.eventService.remoteSocketConnected(localAddress);

            const isDebugPacket = (data.length === 18 && data[0] === 0x03) || (data.length === 21 && data[0] === 0x01);
            const payload = isDebugPacket ? this.debugBuildPacket(data) : data;

            this.log.silly(`→ cloud [${localAddress}] in  ${data.length}b: ${data.toString('hex')}`);
            this.log.silly(`→ cloud [${localAddress}] out ${payload.length}b: ${payload.toString('hex')}`);

            const flushed = client.write(payload, (err) => {
                if (err) {
                    this.log.warn(`TCP write error for ${localAddress}: ${err.message}`);
                } else {
                    this.log.silly(`✓ cloud [${localAddress}] ${payload.length}b flushed to kernel`);
                }
            });
            if (!flushed) {
                this.log.warn(`TCP send buffer full for ${localAddress} — backpressure on ${payload.length}b write`);
            }
        } else {
            this.eventService.remoteSocketDisconnected(localAddress);
            this.log.warn(`Cloud socket for ${localAddress} not found.`);
        }
    }
}
