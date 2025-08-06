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
            this.log.debug("connection to cloud established");
            this.eventService.remoteSocketConnected(localAddress);
        });
        remoteSocket.on('close', () => {
            this.log.debug("connection to cloud closed");
            this.eventService.remoteSocketDisconnected(localAddress);
            this.clients.delete(localAddress);
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
            if (data.length === 15) {
                const deviceSetup = this.deviceMapper.deviceSetupFromSocketBuffer(data);
                this.log.debug('Created device setup from data %o', deviceSetup);
                this.eventService.deviceSetupUpdate(deviceSetup);
            }
        });
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, (data: Buffer, localAddress: string) => {
            this.log.silly(`Update cloud data from ${localAddress}: %o`, data);
            this.write(data, localAddress);
        });

        this.eventService.on(AppEvents.LOCAL_SOCKET_CONNECTED, (localAddress: string) => {
            this.log.debug(`Local device connected: ${localAddress} init cloud connection`);
            this.initRemoteSocketServer(localAddress);
        });
    }

    write(data: Buffer, localAddress: string): void {
        const client: Socket | undefined = this.clients.get(localAddress);
        if (client) {
            this.eventService.remoteSocketConnected(localAddress);
            client.write(data);
        } else {
            this.eventService.remoteSocketDisconnected(localAddress);
            this.log.warn(`Cloud socket for ${localAddress} not found.`);
        }
    }
}
