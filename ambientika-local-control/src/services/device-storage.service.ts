import {Device} from '../models/device.model';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv'
import {Logger} from 'winston';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {Instant} from '@js-joda/core';
import {DeviceDto} from '../dto/device.dto';
import {DeviceMapper} from './device.mapper';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {OperatingMode} from '../models/enum/operating-mode.enum';

dotenv.config()

export class DeviceStorageService {

    private db: DatabaseSync;
    private deviceMapper: DeviceMapper;
    // Last commanded mode/fan speed per device, published to HA instead of the device-reported
    // value so the UI doesn't jump back to the old value while the device is still applying the
    // command. It expires so a command the device rejects or never echoes back (e.g. SMART,
    // which the device reports as its free-cooling sub-mode) can't pin HA's state forever (#91).
    private static readonly COMMAND_OVERRIDE_TTL_MS = 30000;
    private lastSentCommands: Map<string, { command: OperatingModeDto, storedAt: number }> = new Map();

    constructor(private log: Logger, private eventService: EventService) {
        this.deviceMapper = new DeviceMapper(this.log);
        this.db = this.createDbConnection();
        this.initEventListener();
    }

    private createDbConnection(): DatabaseSync {
        const filepath = process.env.DEVICE_DB || 'devices.db';
        const db = new DatabaseSync(filepath);
        this.createTable(db);
        this.migrateDb(db);
        this.log.info('Connection with SQLite has been established');
        return db;
    }

    private migrateDb(db: DatabaseSync): void {
        // Add zone/houseId columns if they don't exist (safe to run on every startup —
        // ALTER TABLE ADD COLUMN has no "IF NOT EXISTS" form, so a "duplicate column"
        // error here just means a previous startup already applied it).
        for (const statement of [
            'ALTER TABLE devices ADD COLUMN zone INTEGER DEFAULT NULL',
            'ALTER TABLE devices ADD COLUMN houseId INTEGER DEFAULT NULL',
        ]) {
            try {
                db.exec(statement);
            } catch {
                // column already exists
            }
        }
    }

    private createTable(db: DatabaseSync): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS devices
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
                firstSeen         VARCHAR(255) DEFAULT NULL,
                zone              INTEGER DEFAULT NULL,
                houseId           INTEGER DEFAULT NULL
            );
        `);
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED, (device: Device) => {
            this.log.silly(`Storage service local data update received: `, device);

            const lastCommand = this.getActiveCommand(device.serialNumber);
            if (lastCommand) {
                // Check if device applied the command
                let commandApplied = true;

                if (lastCommand.operatingMode && device.operatingMode !== lastCommand.operatingMode) {
                    this.log.warn(`Device ${device.serialNumber} REJECTED command: sent ${lastCommand.operatingMode}, device reports ${device.operatingMode}`);
                    commandApplied = false;
                }

                if (lastCommand.fanSpeed && device.fanSpeed !== lastCommand.fanSpeed.toUpperCase()) {
                    this.log.warn(`Device ${device.serialNumber} REJECTED fanSpeed: sent ${lastCommand.fanSpeed}, device reports ${device.fanSpeed}`);
                    commandApplied = false;
                }

                if (commandApplied) {
                    this.log.info(`Device ${device.serialNumber} applied command successfully: ${JSON.stringify(lastCommand)}`);
                    this.lastSentCommands.delete(device.serialNumber);
                } else {
                    this.log.debug(`Device ${device.serialNumber} command still pending: ${JSON.stringify(lastCommand)}`);
                }
            }

            this.saveDevice(device);
        });

        this.eventService.on(AppEvents.DEVICE_OPERATING_MODE_UPDATE, (opMode: OperatingModeDto, serialNumber: string) => {
            const command = {...opMode};
            // HA's fan_only arrives as the internal LAST sentinel, which the device never
            // reports back; store the mode it resolves to instead (#91).
            if (command.operatingMode === OperatingMode.LAST.toString()) {
                let lastOperatingMode: string | undefined;
                try {
                    const existing = this.db.prepare('SELECT lastOperatingMode FROM devices WHERE serialNumber = ?')
                        .get(serialNumber) as { lastOperatingMode?: string } | undefined;
                    lastOperatingMode = existing?.lastOperatingMode;
                } catch (error) {
                    this.log.error('Error fetching device from db', error);
                }
                if (lastOperatingMode) {
                    command.operatingMode = lastOperatingMode;
                } else {
                    delete command.operatingMode;
                }
            }
            // HA sends each changed attribute as a separate message, so merge rather than
            // replace — otherwise a mode change drops the fan speed sent just before it.
            const merged = {...this.getActiveCommand(serialNumber), ...command};
            this.log.debug(`Command stored for persistence: ${serialNumber} → ${JSON.stringify(merged)}`);
            this.lastSentCommands.set(serialNumber, {command: merged, storedAt: Date.now()});
        });
    }

    private getActiveCommand(serialNumber: string): OperatingModeDto | undefined {
        const entry = this.lastSentCommands.get(serialNumber);
        if (!entry) {
            return undefined;
        }
        if (Date.now() - entry.storedAt > DeviceStorageService.COMMAND_OVERRIDE_TTL_MS) {
            this.log.debug(`Command override for ${serialNumber} expired, showing device-reported state: ${JSON.stringify(entry.command)}`);
            this.lastSentCommands.delete(serialNumber);
            return undefined;
        }
        return entry.command;
    }

    hasStoredCommand(serialNumber: string): boolean {
        return this.getActiveCommand(serialNumber) !== undefined;
    }

    getStoredOperatingMode(serialNumber: string): string | undefined {
        return this.getActiveCommand(serialNumber)?.operatingMode;
    }

    getStoredFanSpeed(serialNumber: string): string | undefined {
        return this.getActiveCommand(serialNumber)?.fanSpeed;
    }

    saveDeviceZoneHouseId(serialNumber: string, zone: number | undefined, houseId: number | undefined): void {
        if (zone === undefined && houseId === undefined) return;
        const updates: string[] = [];
        const params: Record<string, string | number> = { $serialNumber: serialNumber };
        if (zone !== undefined) { updates.push('zone = $zone'); params.$zone = zone; }
        if (houseId !== undefined) { updates.push('houseId = $houseId'); params.$houseId = houseId; }
        try {
            this.db.prepare(`UPDATE devices SET ${updates.join(', ')} WHERE serialNumber = $serialNumber`).run(params);
        } catch (error) {
            this.log.error(`Error saving zone/houseId for ${serialNumber}`, error);
        }
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
        try {
            const rows = this.db.prepare('SELECT * FROM devices').all() as unknown as DeviceDto[];
            callback(rows);
        } catch (error) {
            this.log.error('Error fetching devices from db', error);
        }
    }

    deleteDevice(dto: DeviceDto): void {
        try {
            this.db.prepare('DELETE FROM devices WHERE id=?').run(dto.id as number);
            const device = this.deviceMapper.deviceFromDto(dto);
            this.eventService.deviceOffline(device);
            this.log.debug(`Deleted device from db ${device}`)
        } catch (error) {
            this.log.error(`Error deleting device from db  ${dto}`, error);
        }
    }

    findExistingDeviceBySerialNumber(serialNumber: string, callback: (device: (DeviceDto | undefined)) => void): void {
        try {
            const row = this.db.prepare('SELECT * FROM devices WHERE serialNumber = ?').get(serialNumber) as DeviceDto | undefined;
            callback(row);
        } catch (error) {
            this.log.error('Error fetching device from db', error);
        }
    }

    // Resolves the master of the zone a device belongs to (a master resolves to itself).
    // Slaves never clear their own filter flag — the zone master's flag is the one that
    // counts, and the official app only ever sends the filter reset to the master (#88).
    // Slaves don't send UDP broadcasts, so their zone/houseId is only known from cloud or
    // MQTT setup packets; without it, or with more than one candidate master, this
    // resolves to undefined rather than guessing.
    findZoneMaster(serialNumber: string, callback: (master: DeviceDto | undefined) => void): void {
        let master: DeviceDto | undefined;
        try {
            const device = this.db.prepare('SELECT * FROM devices WHERE serialNumber = ?').get(serialNumber) as DeviceDto | undefined;
            if (device?.deviceRole === 'MASTER') {
                master = device;
            } else if (device && device.zone !== undefined && device.zone !== null) {
                const hasHouseId = device.houseId !== undefined && device.houseId !== null;
                const candidates = (hasHouseId
                    ? this.db.prepare("SELECT * FROM devices WHERE deviceRole = 'MASTER' AND zone = ? AND houseId = ? AND serialNumber != ?")
                        .all(device.zone, device.houseId as number, serialNumber)
                    : this.db.prepare("SELECT * FROM devices WHERE deviceRole = 'MASTER' AND zone = ? AND serialNumber != ?")
                        .all(device.zone, serialNumber)) as unknown as DeviceDto[];
                if (candidates.length === 1) {
                    master = candidates[0];
                } else {
                    this.log.debug(`Found ${candidates.length} candidate zone masters for ${serialNumber} (zone=${device.zone}, houseId=${device.houseId})`);
                }
            } else if (device) {
                this.log.debug(`Zone of ${serialNumber} is unknown, cannot resolve its zone master`);
            }
        } catch (error) {
            this.log.error('Error fetching zone master from db', error);
            return;
        }
        callback(master);
    }

    findExistingDeviceByRemoteAddress(remoteAddress: string,
                                      callback: (device: (DeviceDto | undefined)) => void): void {
        try {
            const row = this.db.prepare('SELECT * FROM devices WHERE remoteAddress = ?').get(remoteAddress) as DeviceDto | undefined;
            callback(row);
        } catch (error) {
            this.log.error('Error fetching device from db', error);
        }
    }

    createDevice(device: Device): void {
        try {
            this.db.prepare('INSERT INTO devices ' + this.getValueString()).run(this.getParams(device) as unknown as Record<string, string | number>);
            this.log.debug('Successfully created device on db');
        } catch (error) {
            this.log.error('Error created device on db', error);
        }
    }

    updateDevice(device: Device, existingDevice: DeviceDto): void {
        const params = this.getParams(device)
        params.$lastUpdate = Instant.now().toString();
        params.$firstSeen = existingDevice.firstSeen;
        params.$id = existingDevice.id;
        try {
            this.db.prepare('REPLACE INTO devices ' + this.getValueString(existingDevice.id)).run(params as unknown as Record<string, string | number>);
            this.log.silly('Successfully updated device on db');
        } catch (error) {
            this.log.error('Error created device on db', error);
        }
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

    close(): Promise<void> {
        this.log.debug('Closing DeviceStorageService');
        try {
            this.db.close();
        } catch (error) {
            this.log.error('Error closing db', error);
        }
        return Promise.resolve();
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
