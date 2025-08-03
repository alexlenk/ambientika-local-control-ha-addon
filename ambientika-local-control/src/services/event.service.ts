import EventEmitter from 'node:events';
import {Device} from '../models/device.model';
import {AppEvents} from '../models/enum/app-events.enum';
import {Logger} from 'winston';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {WeatherUpdateDto} from '../dto/weather-update.dto';
import {DeviceBroadcastStatus} from '../models/device-broadcast-status.model';

export class EventService extends EventEmitter {
    constructor(private log: Logger) {
        super();
    }

    localSocketConnected(remoteAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.LOCAL_SOCKET_CONNECTED}`, remoteAddress);
        this.emit(AppEvents.LOCAL_SOCKET_CONNECTED, remoteAddress);
    }

    localSocketDisconnected(remoteAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.LOCAL_SOCKET_DISCONNECTED}`, remoteAddress);
        this.emit(AppEvents.LOCAL_SOCKET_DISCONNECTED, remoteAddress);
    }

    localSocketDataUpdateReceived(data: Buffer, remoteAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED}`, data, remoteAddress);
        this.emit(AppEvents.LOCAL_SOCKET_DATA_UPDATE_RECEIVED, data, remoteAddress);
    }

    remoteSocketConnected(localAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.REMOTE_SOCKET_CONNECTED}`, localAddress);
        this.emit(AppEvents.REMOTE_SOCKET_CONNECTED, localAddress);
    }

    remoteSocketDisconnected(localAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.REMOTE_SOCKET_DISCONNECTED}`, localAddress);
        this.emit(AppEvents.REMOTE_SOCKET_DISCONNECTED, localAddress);
    }

    remoteSocketDataUpdateReceived(data: Buffer, remoteAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.REMOTE_SOCKET_DATA_UPDATE_RECEIVED}`, data, remoteAddress);
        this.emit(AppEvents.REMOTE_SOCKET_DATA_UPDATE_RECEIVED, data, remoteAddress);
    }

    deviceStatusUpdate(device: Device): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_STATUS_UPDATE_RECEIVED}`, device);
        this.emit(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, device);
    }

    deviceOnline(device: Device): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_ONLINE}`, device);
        this.emit(AppEvents.DEVICE_ONLINE, device);
    }

    deviceOffline(device: Device): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_OFFLINE}`, device);
        this.emit(AppEvents.DEVICE_OFFLINE, device);
    }

    deviceOperatingModeUpdate(operatingMode: OperatingModeDto, serialNumber: string): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_OPERATING_MODE_UPDATE}`, operatingMode, serialNumber);
        this.emit(AppEvents.DEVICE_OPERATING_MODE_UPDATE, operatingMode, serialNumber);
    }

    deviceFilterReset(serialNumber: string): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_FILTER_RESET}`, serialNumber);
        this.emit(AppEvents.DEVICE_FILTER_RESET, serialNumber);
    }

    deviceWeatherUpdate(weatherUpdateDto: WeatherUpdateDto): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_WEATHER_UPDATE}`, weatherUpdateDto);
        this.emit(AppEvents.DEVICE_WEATHER_UPDATE, weatherUpdateDto);
    }

    localSocketDataUpdate(data: Buffer, localAddress: string): void {
        this.log.debug(`Emit event ${AppEvents.LOCAL_SOCKET_DATA_UPDATE}`, data, localAddress);
        this.emit(AppEvents.LOCAL_SOCKET_DATA_UPDATE, data, localAddress);
    }

    deviceBroadcastStatus(deviceBroadcastStatus: DeviceBroadcastStatus): void {
        this.log.debug(`Emit event ${AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED}`, deviceBroadcastStatus);
        this.emit(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED, deviceBroadcastStatus);
    }

}
