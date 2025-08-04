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
    private lastSentCommands: Map<string, OperatingModeDto> = new Map();

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
            this.log.silly(`Storage service local data update received: `, device);
            
            // Check if we have a pending command for this device
            const lastCommand = this.lastSentCommands.get(device.serialNumber);
            if (lastCommand) {
                let commandApplied = true;
                
                // Check operating mode override
                if (lastCommand.operatingMode && device.operatingMode !== lastCommand.operatingMode) {
                    this.log.debug(`Overriding device ${device.serialNumber} operating mode from ${device.operatingMode} to ${lastCommand.operatingMode} (pending command)`);
                    device.operatingMode = lastCommand.operatingMode;
                    commandApplied = false;
                }
                
                // Check fan speed override
                if (lastCommand.fanSpeed && device.fanSpeed !== lastCommand.fanSpeed.toUpperCase()) {
                    this.log.debug(`Overriding device ${device.serialNumber} fan speed from ${device.fanSpeed} to ${lastCommand.fanSpeed} (pending command)`);
                    device.fanSpeed = lastCommand.fanSpeed.toUpperCase();
                    commandApplied = false;
                }
                
                // Remove command if device has applied it
                if (commandApplied) {
                    this.log.info(`Device ${device.serialNumber} applied command successfully`);
                    this.lastSentCommands.delete(device.serialNumber);
                }
            }
            
            this.saveDevice(device);
        });

        this.eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, (opMode: OperatingModeDto, serialNumber: string) => {
            this.log.debug(`Command stored for persistence: ${serialNumber} → ${JSON.stringify(opMode)}`);
            this.lastSentCommands.set(serialNumber, opMode);
            
            // Immediately trigger MQTT update with the commanded values
            this.findExistingDeviceBySerialNumber(serialNumber, (dto: DeviceDto | undefined) => {
                if (dto) {
                    const device = this.deviceMapper.deviceFromDto(dto);
                    
                    // Override with commanded values
                    if (opMode.operatingMode) {
                        device.operatingMode = opMode.operatingMode;
                    }
                    if (opMode.fanSpeed) {
                        device.fanSpeed = opMode.fanSpeed.toUpperCase();
                    }
                    
                    // Trigger immediate MQTT update
                    this.eventService.deviceStatusUpdate(device);
                }
            });
        });
    }

    hasStoredCommand(serialNumber: string): boolean {
        return this.lastSentCommands.has(serialNumber);
    }

    getStoredOperatingMode(serialNumber: string): string | undefined {
        const command = this.lastSentCommands.get(serialNumber);
        return command?.operatingMode;
    }

    getStoredFanSpeed(serialNumber: string): string | undefined {
        const command = this.lastSentCommands.get(serialNumber);
        return command?.fanSpeed;
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
                    this.log.silly('Successfully updated device on db', error);
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
