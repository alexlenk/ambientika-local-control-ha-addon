import {Logger} from 'winston';
import {EventService} from './event.service';
import dotenv from 'dotenv';
import {createSocket, Socket} from 'node:dgram';
import {RemoteInfo} from 'dgram';
import {AppEvents} from '../models/enum/app-events.enum';
import {Device} from '../models/device.model';
import {DeviceMapper} from './device.mapper';

dotenv.config();

export class UDPBroadcastService {

    private localAddressesSerialNumbers: Map<string, string> = new Map();
    private listener: Map<number, Socket> = new Map();
    private deviceMapper: DeviceMapper;

    constructor(private log: Logger, private eventService: EventService) {
        this.log.debug('Construct UDPBroadcastService');
        this.deviceMapper = new DeviceMapper(this.log);
        this.initialize();
    }


    private initialize(): void {
        this.log.debug('Initializing UDPBroadcastService');
        this.initEventListener();
        const zoneCount = parseInt(process.env.ZONE_COUNT || '1');
        let listenerPort = parseInt(process.env.UDP_BROADCAST_LISTENER_START_PORT || '45000');
        let zoneIndex = 0;
        while (zoneIndex < zoneCount) {
            this.initListener(zoneIndex, listenerPort);
            zoneIndex++;
            listenerPort++;
        }
    }

    private initListener(zoneIndex: number, listenerPort: number): void {
        const socket = createSocket('udp4');
        socket.on('message', (data: Buffer, remoteInfo: RemoteInfo) => {
            this.log.silly(`Received data on udp socket ${listenerPort} for 
            ${remoteInfo.address}:${remoteInfo.port} %o`, data);
            const serialNumber = this.localAddressesSerialNumbers.get(remoteInfo.address);
            const deviceStatus = this.deviceMapper.deviceStatusBroadCastFromBuffer(data, serialNumber);
            this.log.silly('Created device status broadcast from data %o', deviceStatus);
            this.eventService.deviceBroadcastStatus(deviceStatus);
        });

        socket.on('listening', () => {
            const address = socket.address();
            socket.setBroadcast(true);
            this.log.debug(`UDP socket listening ${address.address}:${address.port}`);
        });

        socket.bind(listenerPort);
        this.listener.set(zoneIndex, socket);
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, (device: Device) => {
            // Store by IP address only (without port) to match UDP broadcast source addresses
            const deviceIp = device.remoteAddress.split(':')[0];
            this.localAddressesSerialNumbers.set(deviceIp, device.serialNumber);
        });
        this.eventService.on(AppEvents.LOCAL_SOCKET_DISCONNECTED, (localAddress: string) => {
            // Convert IP:port to IP for lookup
            const ip = localAddress.split(':')[0];
            if (this.localAddressesSerialNumbers.has(ip)) {
                this.localAddressesSerialNumbers.delete(ip);
            }
        });
    }
}
