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
    private clients: Map<string, Socket> = new Map(); // connectionKey -> Socket
    private deviceConnections: Map<string, string> = new Map(); // serialNumber -> connectionKey
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
        if (serverSocket.remoteAddress && serverSocket.remotePort) {
            const connectionKey = `${serverSocket.remoteAddress}:${serverSocket.remotePort}`;
            this.clients.set(connectionKey, serverSocket)
            this.log.info(`Device connected: ${connectionKey}`);
            this.eventService.localSocketConnected(serverSocket.remoteAddress);
        }

        serverSocket.on('close', () => {
            if (serverSocket.remoteAddress && serverSocket.remotePort) {
                const connectionKey = `${serverSocket.remoteAddress}:${serverSocket.remotePort}`;
                this.log.info(`Device disconnected: ${connectionKey}`);
                
                // Clean up device connection mapping
                for (const [serialNumber, connKey] of this.deviceConnections.entries()) {
                    if (connKey === connectionKey) {
                        this.log.debug(`Removed device mapping: ${serialNumber} -> ${connectionKey}`);
                        this.deviceConnections.delete(serialNumber);
                    }
                }
                
                this.eventService.localSocketDisconnected(serverSocket.remoteAddress);
                this.clients.delete(connectionKey);
            }
        });

        serverSocket.on('data', (data: Buffer) => {
            this.log.silly('Received data on local socket %o', data);
            if (serverSocket.remoteAddress) {
                this.eventService.localSocketDataUpdateReceived(data, serverSocket.remoteAddress);
            }
            if (data.length === 18) {
                const connectionKey = `${serverSocket.remoteAddress}:${serverSocket.remotePort}`;
                const deviceInfo = this.deviceMapper.deviceInformationFromSocketBuffer(data);
                this.log.debug('Created device info from data %o', deviceInfo);
                
                // Map device serial number to connection key for command routing
                this.deviceConnections.set(deviceInfo.serialNumber, connectionKey);
                this.log.debug(`Mapped device ${deviceInfo.serialNumber} to connection ${connectionKey}`);
            }
            if (data.length === 21) {
                const remoteAddress = serverSocket.remoteAddress || '';
                const connectionKey = `${serverSocket.remoteAddress}:${serverSocket.remotePort}`;
                const device = this.deviceMapper.deviceFromSocketBuffer(data, remoteAddress);
                this.log.info(`Device status: ${device.serialNumber} [${device.deviceRole}] → ${device.operatingMode} (${device.fanSpeed})`);
                
                // Map device serial number to connection key for command routing
                this.deviceConnections.set(device.serialNumber, connectionKey);
                this.log.debug(`Mapped device ${device.serialNumber} to connection ${connectionKey}`);
                
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
            this.log.info(`Sending command to device ${remoteAddress}: ${data.toString('hex')}`);
            this.write(data, remoteAddress);
        })
    }

    write(data: Buffer, remoteAddress: string) {
        // Extract serial number from command buffer (bytes 2-7)
        if (data.length >= 8) {
            const serialHex = data.slice(2, 8).toString('hex');
            const connectionKey = this.deviceConnections.get(serialHex);
            
            if (connectionKey) {
                const client = this.clients.get(connectionKey);
                if (client) {
                    this.log.debug(`Writing ${data.length} bytes to device ${serialHex} via ${connectionKey}`);
                    client.write(data);
                    return;
                } else {
                    this.log.error(`Socket for device ${serialHex} connection ${connectionKey} not found!`);
                }
            } else {
                this.log.error(`No connection mapping found for device ${serialHex}`);
            }
        }
        
        // Fallback to old method (will likely fail for multi-device scenarios)
        const client: Socket | undefined = this.clients.get(remoteAddress);
        if (client) {
            this.log.debug(`Using fallback: Writing ${data.length} bytes to ${remoteAddress}`);
            client.write(data);
        } else {
            this.log.error(`Local Socket for ${remoteAddress} not found - command not sent!`);
        }
    }
}
