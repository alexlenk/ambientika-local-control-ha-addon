import {Logger} from 'winston';
import dotenv from 'dotenv'
import {DeviceStorageService} from './device-storage.service';
import express, {NextFunction, Response, Request} from 'express';
import {Server} from 'node:http';
import {EventService} from './event.service';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {DeviceDto} from '../dto/device.dto';
import {WeatherUpdateDto} from '../dto/weather-update.dto';
import {registerSerialForMasking} from './logger.service';
import {OperatingMode} from '../models/enum/operating-mode.enum';
import {FanSpeed} from '../models/enum/fan-speed.enum';
import {HumidityLevel} from '../models/enum/humidity-level.enum';
import {LightSensitivity} from '../models/enum/light-sensitivity.enum';
import {DeviceRole} from '../models/enum/device-role.enum';

dotenv.config()

const SERIAL_NUMBER_PATTERN = /^[0-9a-f]{12}$/i;

function isValidEnumKey<T extends Record<string, string | number>>(enumObj: T, value: unknown, exclude: string[] = []): boolean {
    return typeof value === 'string' && !exclude.includes(value) && typeof enumObj[value as keyof T] === 'number';
}

export class RestService {
    private server!: Server;

    constructor(private log: Logger,
                private deviceStorageService: DeviceStorageService,
                private eventService: EventService) {
        this.init();
    }

    private init(): void {
        this.log.debug('Initializing RestService');
        const port = parseInt(process.env.REST_API_PORT || '3000', 10);
        const bindHost = process.env.REST_API_BIND || '0.0.0.0';
        const token = process.env.REST_API_TOKEN;
        this.log.info(token
            ? 'REST API token auth is enabled'
            : 'REST API token auth is disabled (rest_api_token not set) — anyone reaching the REST port can control devices');
        const app = express();
        app.use(express.json());
        this.server = app.listen(port, bindHost, () => {
            this.log.debug(`Rest service listening on ${bindHost}:${port.toString()}`);
        });

        // Central serial validation — applied to every route with a :serialNumber param.
        // Untrusted, malformed serials otherwise flow into Buffer.from(serial, 'hex') and
        // command-buffer building (device-command-service.ts), where a non-hex value
        // produces NaN and crashes writeUInt8 with an unhandled RangeError.
        app.param('serialNumber', (request: Request, response: Response, next: NextFunction, value: string) => {
            if (!SERIAL_NUMBER_PATTERN.test(value)) {
                response.status(400).send('Invalid serialNumber: expected 12 hex characters');
                return;
            }
            request.params.serialNumber = value.toLowerCase();
            registerSerialForMasking(request.params.serialNumber);
            next();
        });

        // GET /health is intentionally never auth-gated — the HA Supervisor watchdog polls
        // it directly with no credentials, and gating it would break auto-restart on hang.
        app.get("/health", (_request: Request, response: Response) => {
            this.deviceStorageService.getDevices((devices: DeviceDto[]) => {
                response.status(200).send({
                    status: 'ok',
                    uptimeSeconds: Math.floor(process.uptime()),
                    deviceCount: devices?.length ?? 0,
                });
            });
        });

        if (token) {
            app.use((request: Request, response: Response, next: NextFunction) => {
                const header = request.header('authorization') || '';
                const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
                if (provided !== token) {
                    response.status(401).send('Unauthorized');
                    return;
                }
                next();
            });
        }

        app.get("/device/status/:serialNumber", (request: Request, response: Response) => {
            this.deviceStorageService.findExistingDeviceBySerialNumber(request.params.serialNumber as string,
                (existingDevice: DeviceDto | undefined) => {
                    if (existingDevice) {
                        response.status(200).send(existingDevice);
                    } else {
                        response.status(404).send('Not Found');
                    }
                });
        });

        app.post("/device/operating-mode/:serialNumber", (request: Request, response: Response) => {
            const dto = request.body as OperatingModeDto;
            if (dto.operatingMode !== undefined && !isValidEnumKey(OperatingMode, dto.operatingMode, ['LAST'])) {
                response.status(400).send(`Invalid operatingMode: ${dto.operatingMode}`);
                return;
            }
            if (dto.fanSpeed !== undefined && !isValidEnumKey(FanSpeed, dto.fanSpeed)) {
                response.status(400).send(`Invalid fanSpeed: ${dto.fanSpeed}`);
                return;
            }
            if (dto.humidityLevel !== undefined && !isValidEnumKey(HumidityLevel, dto.humidityLevel)) {
                response.status(400).send(`Invalid humidityLevel: ${dto.humidityLevel}`);
                return;
            }
            if (dto.lightSensitivity !== undefined && !isValidEnumKey(LightSensitivity, dto.lightSensitivity)) {
                response.status(400).send(`Invalid lightSensitivity: ${dto.lightSensitivity}`);
                return;
            }
            this.eventService.deviceOperatingModeUpdate(dto, request.params.serialNumber as string);
            response.send();
        });

        app.post("/device/reset-filter/:serialNumber", (request: Request, response: Response) => {
            this.eventService.deviceFilterReset(request.params.serialNumber as string);
            response.send();
        });

        app.post("/device/weather-update", (request: Request, response: Response) => {
            const dto = request.body as WeatherUpdateDto;
            if (typeof dto.temperature !== 'number' || !Number.isFinite(dto.temperature) || dto.temperature < -50 || dto.temperature > 60) {
                response.status(400).send(`Invalid temperature: ${dto.temperature}`);
                return;
            }
            if (typeof dto.humidity !== 'number' || !Number.isInteger(dto.humidity) || dto.humidity < 0 || dto.humidity > 100) {
                response.status(400).send(`Invalid humidity: ${dto.humidity}`);
                return;
            }
            // airQuality is the raw 1-based wire value (device.mapper subtracts 1 to reach
            // the 5-member AirQuality enum), so the valid range here is 1-5.
            if (typeof dto.airQuality !== 'number' || !Number.isInteger(dto.airQuality) || dto.airQuality < 1 || dto.airQuality > 5) {
                response.status(400).send(`Invalid airQuality: ${dto.airQuality}`);
                return;
            }
            this.eventService.deviceWeatherUpdate(dto);
            response.send();
        });

        // Debug: inject 16-byte setup packet into cloud socket for a device
        // POST /cloud/send-setup/8813bf16089c  body: {"role":0,"zone":1,"houseId":12048}
        // Disabled by default — lets any caller reconfigure a device's role/zone/house.
        app.post("/cloud/send-setup/:serialNumber", (request: Request, response: Response) => {
            if (process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
                response.status(403).send('Debug endpoints are disabled (enable_debug_endpoints)');
                return;
            }
            const serialNumber = request.params.serialNumber as string;
            const { role = 0, zone = 0, houseId = 0 } = request.body;
            if (!Number.isInteger(role) || DeviceRole[role] === undefined) {
                response.status(400).send(`Invalid role: ${role}`);
                return;
            }
            if (!Number.isInteger(zone) || zone < 0 || zone > 15) {
                response.status(400).send(`Invalid zone: ${zone}`);
                return;
            }
            if (!Number.isInteger(houseId) || houseId < 0 || houseId > 0xFFFFFFFF) {
                response.status(400).send(`Invalid houseId: ${houseId}`);
                return;
            }
            this.deviceStorageService.findExistingDeviceBySerialNumber(serialNumber, (device) => {
                if (!device || !device.remoteAddress) {
                    response.status(404).send('Device not found or no IP');
                    return;
                }
                const serialBytes = Buffer.from(serialNumber, 'hex');
                const buf = Buffer.alloc(16);
                buf.writeUInt8(0x02, 0);
                buf.writeUInt8(0x00, 1);
                serialBytes.copy(buf, 2);
                buf.writeUInt8(0x00, 8);
                buf.writeUInt8(role, 9);
                buf.writeUInt8(zone, 10);
                buf.writeUInt8(0x00, 11);
                buf.writeUInt32LE(houseId, 12);
                this.log.info(`Injecting setup to cloud for ${serialNumber} via ${device.remoteAddress}: ${buf.toString('hex')}`);
                this.eventService.localSocketDataUpdateReceived(buf, device.remoteAddress);
                response.status(200).send({ sent: buf.toString('hex'), via: device.remoteAddress });
            });
        });
    }

    close(): Promise<void> {
        this.log.debug('Closing RestService');
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
}
