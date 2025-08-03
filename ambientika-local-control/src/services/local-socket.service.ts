import {Server, Socket} from 'node:net';
import {Logger} from 'winston';
import dotenv from 'dotenv'
import * as net from 'node:net';
import {DeviceMapper} from './device.mapper';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';

dotenv.config()

export class LocalSocketService {
    private localServer: Server;
    private clients: Map<string, Socket> = new Map();
    private deviceMapper: DeviceMapper;

    constructor(private log: Logger, private eventService: EventService) {
        this.log.debug('Construct LocalSocketService');
        this.deviceMapper = new DeviceMapper(this.log);
        this.initLocalSocketServerOnClientConnect();
        this.initEventListener();
    }

    private initLocalSocketServerOnClientConnect(): void {
        const localSocketPort = parseInt(process.env.PORT || "11000");
        this.localServer = net.createServer(() => {
        });
        this.localServer.on('connection', (socket: Socket) => {
            this.initConnectionListener(socket);
        })
        this.localServer.listen(localSocketPort, '0.0.0.0', () => {
            this.log.debug(`local socket service listening on port ${localSocketPort}`);
        });
    }

    private initConnectionListener(serverSocket: Socket): void {
        if (serverSocket.remoteAddress) {
            this.clients.set(serverSocket.remoteAddress, serverSocket)
            this.log.debug(`local connection from ${serverSocket.remoteAddress}:${serverSocket.remotePort}`);
            this.eventService.localSocketConnected(serverSocket.remoteAddress);
        }

        serverSocket.on('close', () => {
            if (serverSocket.remoteAddress) {
                this.log.debug(`local connection from ${serverSocket.remoteAddress} closed`);
                this.eventService.localSocketDisconnected(serverSocket.remoteAddress);
                this.clients.delete(serverSocket.remoteAddress);
            }
        });

        serverSocket.on('data', (data: Buffer) => {
            this.log.silly('Received data on local socket %o', data);
            if (serverSocket.remoteAddress) {
                this.eventService.localSocketDataUpdateReceived(data, serverSocket.remoteAddress);
            }
            if (data.length === 18) {
                const deviceInfo = this.deviceMapper.deviceInformationFromSocketBuffer(data);
                this.log.debug('Created device info from data %o', deviceInfo);
            }
            if (data.length === 21) {
                const remoteAddress = serverSocket.remoteAddress || '';
                const device = this.deviceMapper.deviceFromSocketBuffer(data, remoteAddress);
                this.log.debug('Created device from data %o', device);
                this.eventService.deviceStatusUpdate(device);
            }
        });
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.REMOTE_SOCKET_DATA_UPDATE_RECEIVED, (data: Buffer,
                                                                            remoteAddress: string) => {
            this.log.silly(`Update local data for ${remoteAddress} received: %o from cloud`, data);
            this.write(data, remoteAddress);
        })
        this.eventService.on(AppEvents.LOCAL_SOCKET_DATA_UPDATE, (data: Buffer, remoteAddress: string) => {
            this.log.silly(`Update local data for ${remoteAddress} received: %o`, data);
            this.write(data, remoteAddress);
        })
    }

    write(data: Buffer, remoteAddress: string) {
        const client: Socket | undefined = this.clients.get(remoteAddress);
        if (client) {
            client.write(data);
        } else {
            this.log.warn(`Local Socket for ${remoteAddress} not found.`);
        }
    }
}
