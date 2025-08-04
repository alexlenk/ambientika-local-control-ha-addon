import {Device} from '../models/device.model';
import * as sqlite3 from 'sqlite3';
import dotenv from 'dotenv'
import {Logger} from 'winston';
import * as fs from 'node:fs';
import {Database} from 'sqlite3';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {Instant} from '@js-joda/core';
import {DeviceDto} from '../dto/device.dto';
import {DeviceMapper} from './device.mapper';
import {OperatingModeDto} from '../dto/operating-mode.dto';

dotenv.config()

export class DeviceStorageService {

    private db: Database;
    private deviceMapper: DeviceMapper;
    private commandSentTimestamps: Map<string, number> = new Map();
    private readonly COMMAND_DEBOUNCE_MS = 15000; // 15 seconds debounce for testing

    constructor(private log: Logger, private eventService: EventService) {
        this.deviceMapper = new DeviceMapper(this.log);
        this.db = this.createDbConnection();
        this.initEventListener();
    }

    createDbConnection() {
        const filepath = process.env.DEVICE_DB || 'devices.db';
        if (fs.existsSync(filepath)) {
            return new sqlite3.Database(filepath);
        } else {
            const db = new sqlite3.Database(filepath, (error) => {
                if (error) {
                    this.log.error('Error creating db', error);
                }
                this.createTable(db);
            });
            this.log.info("Connection with SQLite has been established");
            return db;
        }
    }


    createTable(db: Database): void {
        db.exec(`
            CREATE TABLE devices
            (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                serialNumber      VARCHAR(50) NOT NULL,
                operatingMode     VARCHAR(20) NOT NULL,
                fanSpeed          VARCHAR(20) NOT NULL,
                humidityLevel     VARCHAR(20) NOT NULL,
                temperature       INTEGER,
                humidity          INTEGER,
                airQuality        VARCHAR(20) NOT NULL,
                humidityAlarm     INTEGER,
                filterStatus      VARCHAR(20) NOT NULL,
                nightAlarm        INTEGER,
                deviceRole        VARCHAR(20) NOT NULL,
                lastOperatingMode VARCHAR(20) NOT NULL,
                lightSensitivity  VARCHAR(20) NOT NULL,
                remoteAddress     VARCHAR(255) DEFAULT NULL,
                lastUpdate        VARCHAR(255) DEFAULT NULL,
                firstSeen         VARCHAR(255) DEFAULT NULL
            );
        `);
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, (device: Device) => {
            this.log.debug(`Storage service local data update received: `, device);
            
            // Check if a command was recently sent to this device
            const lastCommandTime = this.commandSentTimestamps.get(device.serialNumber);
            const now = Date.now();
            
            if (lastCommandTime && (now - lastCommandTime) < this.COMMAND_DEBOUNCE_MS) {
                this.log.debug(`Ignoring device status update for ${device.serialNumber} - command was sent ${now - lastCommandTime}ms ago`);
                return;
            }
            
            this.saveDevice(device);
        });

        this.eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, (opMode: OperatingModeDto, serialNumber: string) => {
            this.log.debug(`Command sent to device ${serialNumber}, marking timestamp for debounce`);
            this.commandSentTimestamps.set(serialNumber, Date.now());
        });
    }

    saveDevice(device: Device) {
        this.findExistingDeviceBySerialNumber(device.serialNumber, (existingDevice: DeviceDto | undefined) => {
            if (!existingDevice) {
                this.createDevice(device);
            } else {
                this.updateDevice(device, existingDevice);
            }
        });
    }

    getDevices(callback: (device: DeviceDto[]) => void): void {
        this.db.all(`SELECT *
                     FROM devices`, (error, rows: DeviceDto[]) => {
            if (error) {
                this.log.error('Error fetching devices from db', error);
            } else {
                callback(rows)
            }
        });
    }

    deleteDevice(dto: DeviceDto): void {
        this.db.run('DELETE FROM devices WHERE id=?', dto.id, (error) => {
            if (error) {
                this.log.error(`Error deleting device from db  ${dto}`, error);
            } else {
                const device = this.deviceMapper.deviceFromDto(dto);
                this.eventService.deviceOffline(device);
                this.log.debug(`Deleted device from db ${device}`)
            }
        })
    }

    findExistingDeviceBySerialNumber(serialNumber: string, callback: (device: (DeviceDto | undefined)) => void): void {
        this.db.get(`SELECT *
                     FROM devices
                     WHERE serialNumber = ?`,
            serialNumber, (error, row: DeviceDto | undefined) => {
                if (error) {
                    this.log.error('Error fetching device from db', error);
                } else {
                    callback(row)
                }
            });
    }

    findExistingDeviceByRemoteAddress(remoteAddress: string,
                                      callback: (device: (DeviceDto | undefined)) => void): void {
        this.db.get(`SELECT *
                     FROM devices
                     WHERE remoteAddress = ?`,
            remoteAddress, (error, row: DeviceDto | undefined) => {
                if (error) {
                    this.log.error('Error fetching device from db', error);
                } else {
                    callback(row)
                }
            });
    }

    createDevice(device: Device): void {
        this.db.run('INSERT INTO devices ' + this.getValueString(),
            this.getParams(device), (error: Error) => {
                if (error) {
                    this.log.error('Error created device on db', error);
                } else {
                    this.log.debug('Successfully created device on db', error);
                }
            });
    }

    updateDevice(device: Device, existingDevice: DeviceDto): void {
        const params = this.getParams(device)
        params.$lastUpdate = Instant.now().toString();
        params.$firstSeen = existingDevice.firstSeen;
        params.$id = existingDevice.id;
        this.db.run('REPLACE INTO devices ' + this.getValueString(existingDevice.id), params
            , (error: Error) => {
                if (error) {
                    this.log.error('Error created device on db', error);
                } else {
                    this.log.debug('Successfully updated device on db', error);
                }
            });
    }

    private getValueString(id?: number): string {
        let valueString = '(';
        if (id) {
            valueString += 'id,';
        }
        valueString += 'serialNumber,' +
            'operatingMode,' +
            'fanSpeed,' +
            'humidityLevel,' +
            'temperature,' +
            'humidity,' +
            'airQuality,' +
            'humidityAlarm,' +
            'filterStatus,' +
            'nightAlarm,' +
            'deviceRole,' +
            'lastOperatingMode,' +
            'lightSensitivity,' +
            'remoteAddress,firstSeen,lastUpdate';

        valueString += ') VALUES (';
        if (id) {
            valueString += '$id,';
        }
        valueString += '$serialNumber,' +
            '$operatingMode,' +
            '$fanSpeed,' +
            '$humidityLevel,' +
            '$temperature,' +
            '$humidity,' +
            '$airQuality,' +
            '$humidityAlarm,' +
            '$filterStatus,' +
            '$nightAlarm,' +
            '$deviceRole,' +
            '$lastOperatingMode,' +
            '$lightSensitivity,' +
            '$remoteAddress,$firstSeen,$lastUpdate';
        valueString += ')';
        return valueString;
    }

    private getParams(device: Device): DeviceQueryParams {
        return {
            $serialNumber: device.serialNumber,
            $operatingMode: device.operatingMode,
            $fanSpeed: device.fanSpeed,
            $humidityLevel: device.humidityLevel,
            $temperature: device.temperature,
            $humidity: device.humidity,
            $airQuality: device.airQuality,
            $humidityAlarm: device.humidityAlarm ? 1 : 0,
            $filterStatus: device.filterStatus,
            $nightAlarm: device.nightAlarm ? 1 : 0,
            $deviceRole: device.deviceRole,
            $lastOperatingMode: device.lastOperatingMode,
            $lightSensitivity: device.lightSensitivity,
            $remoteAddress: device.remoteAddress,
            $lastUpdate: Instant.now().toString(),
            $firstSeen: Instant.now().toString()
        } as DeviceQueryParams;
    }

}

export interface DeviceQueryParams {
    $id?: number;
    $serialNumber: string;
    $operatingMode: string;
    $fanSpeed: string;
    $humidityLevel: string;
    $temperature: number;
    $humidity: number;
    $airQuality: string;
    $humidityAlarm: number;
    $filterStatus: string;
    $nightAlarm: number
    $deviceRole: string;
    $lastOperatingMode: string;
    $lightSensitivity: string;
    $remoteAddress: string;
    $lastUpdate: string;
    $firstSeen: string;
}
